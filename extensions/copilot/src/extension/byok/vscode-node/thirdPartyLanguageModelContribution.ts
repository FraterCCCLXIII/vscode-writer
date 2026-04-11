/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { LanguageModelChatInformation, LanguageModelChatProvider, lm } from 'vscode';
import { IAuthenticationService } from '../../../platform/authentication/common/authentication';
import { isStandaloneThirdPartyChatFromProduct } from '../../../platform/authentication/common/standaloneThirdPartyChatProduct';
import { ICAPIClientService } from '../../../platform/endpoint/common/capiClient';
import { IEndpointProvider } from '../../../platform/endpoint/common/endpointProvider';
import { IVSCodeExtensionContext } from '../../../platform/extContext/common/extensionContext';
import { ILogService } from '../../../platform/log/common/logService';
import { IFetcherService } from '../../../platform/networking/common/fetcherService';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { BYOKKnownModels, isBYOKEnabled } from '../../byok/common/byokProvider';
import { IExtensionContribution } from '../../common/contributions';
import { AnthropicLMProvider } from './anthropicProvider';
import { AzureBYOKModelProvider } from './azureProvider';
import { BYOKStorageService, IBYOKStorageService } from './byokStorageService';
import { CustomOAIBYOKModelProvider } from './customOAIProvider';
import { GeminiNativeBYOKLMProvider } from './geminiNativeProvider';
import { OllamaLMProvider } from './ollamaProvider';
import { OAIBYOKLMProvider } from './openAIProvider';
import { OpenRouterLMProvider } from './openRouterProvider';
import { XAIBYOKLMProvider } from './xAIProvider';

export class ThirdPartyLanguageModelContribution extends Disposable implements IExtensionContribution {
	public readonly id: string = 'third-party-language-model-contribution';
	private readonly _apiKeyStorageService: IBYOKStorageService;
	private readonly _providers: Map<string, LanguageModelChatProvider<LanguageModelChatInformation>> = new Map();
	private _thirdPartyProvidersRegistered = false;
	private _registrationInFlight = false;

	constructor(
		@IFetcherService private readonly _fetcherService: IFetcherService,
		@ILogService private readonly _logService: ILogService,
		@ICAPIClientService private readonly _capiClientService: ICAPIClientService,
		@IVSCodeExtensionContext extensionContext: IVSCodeExtensionContext,
		@IAuthenticationService authService: IAuthenticationService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IEndpointProvider private readonly _endpointProvider: IEndpointProvider,
	) {
		super();
		this._apiKeyStorageService = new BYOKStorageService(extensionContext);
		void this._tryRegisterThirdPartyProviders(authService, this._instantiationService);

		this._register(authService.onDidAuthenticationChange(() => {
			void this._tryRegisterThirdPartyProviders(authService, this._instantiationService);
		}));
	}

	private _shouldRegisterThirdPartyProviders(authService: IAuthenticationService): boolean {
		if (isStandaloneThirdPartyChatFromProduct()) {
			return true;
		}
		const token = authService.copilotToken;
		return Boolean(token && isBYOKEnabled(token, this._capiClientService));
	}

	private async _tryRegisterThirdPartyProviders(authService: IAuthenticationService, instantiationService: IInstantiationService) {
		if (this._thirdPartyProvidersRegistered || this._registrationInFlight || !this._shouldRegisterThirdPartyProviders(authService)) {
			return;
		}
		this._registrationInFlight = true;
		let knownModels: Record<string, BYOKKnownModels>;
		try {
			knownModels = await this.fetchKnownModelList(this._fetcherService);
		} catch (e) {
			this._logService.warn(`Third-party language models: failed to fetch known models list from CDN; continuing with empty allowlist. ${e}`);
			knownModels = {};
		}
		if (this._store.isDisposed) {
			this._registrationInFlight = false;
			return;
		}
		this._providers.set(OllamaLMProvider.providerName.toLowerCase(), instantiationService.createInstance(OllamaLMProvider, this._apiKeyStorageService));
		this._providers.set(AnthropicLMProvider.providerName.toLowerCase(), instantiationService.createInstance(AnthropicLMProvider, knownModels[AnthropicLMProvider.providerName], this._apiKeyStorageService));
		this._providers.set(GeminiNativeBYOKLMProvider.providerName.toLowerCase(), instantiationService.createInstance(GeminiNativeBYOKLMProvider, knownModels[GeminiNativeBYOKLMProvider.providerName], this._apiKeyStorageService));
		this._providers.set(XAIBYOKLMProvider.providerName.toLowerCase(), instantiationService.createInstance(XAIBYOKLMProvider, knownModels[XAIBYOKLMProvider.providerName], this._apiKeyStorageService));
		this._providers.set(OAIBYOKLMProvider.providerName.toLowerCase(), instantiationService.createInstance(OAIBYOKLMProvider, knownModels[OAIBYOKLMProvider.providerName], this._apiKeyStorageService));
		this._providers.set(OpenRouterLMProvider.providerName.toLowerCase(), instantiationService.createInstance(OpenRouterLMProvider, this._apiKeyStorageService));
		this._providers.set(AzureBYOKModelProvider.providerName.toLowerCase(), instantiationService.createInstance(AzureBYOKModelProvider, this._apiKeyStorageService));
		this._providers.set(CustomOAIBYOKModelProvider.providerName.toLowerCase(), instantiationService.createInstance(CustomOAIBYOKModelProvider, this._apiKeyStorageService));

		for (const [providerName, provider] of this._providers) {
			this._store.add(lm.registerLanguageModelChatProvider(providerName, provider));
		}
		this._thirdPartyProvidersRegistered = true;
		this._registrationInFlight = false;
		this._endpointProvider.notifyThirdPartyLanguageModelsChanged();
	}
	private async fetchKnownModelList(fetcherService: IFetcherService): Promise<Record<string, BYOKKnownModels>> {
		const data = await (await fetcherService.fetch('https://main.vscode-cdn.net/extensions/copilotChat.json', { method: 'GET', callSite: 'third-party-known-models' })).json();
		// Use this for testing with changes from a local file. Don't check in
		// const data = JSON.parse((await this._fileSystemService.readFile(URI.file('/Users/roblou/code/vscode-engineering/chat/copilotChat.json'))).toString());
		let knownModels: Record<string, BYOKKnownModels>;
		if (data.version !== 1) {
			this._logService.warn('Third-party language models: known models list is not in the expected format. Defaulting to empty list.');
			knownModels = {};
		} else {
			knownModels = data.modelInfo;
		}
		this._logService.info('Third-party language models: known models list fetched successfully.');
		return knownModels;
	}
}
