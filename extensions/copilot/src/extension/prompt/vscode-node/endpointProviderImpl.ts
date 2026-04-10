/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type { ChatRequest, LanguageModelChat } from 'vscode';
import { IAuthenticationService } from '../../../platform/authentication/common/authentication';
import { IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { ChatEndpointFamily, EmbeddingsEndpointFamily, IChatModelInformation, ICompletionModelInformation, IEmbeddingModelInformation, IEndpointProvider } from '../../../platform/endpoint/common/endpointProvider';
import { AutoChatEndpoint } from '../../../platform/endpoint/node/autoChatEndpoint';
import { IAutomodeService } from '../../../platform/endpoint/node/automodeService';
import { CopilotChatEndpoint } from '../../../platform/endpoint/node/copilotChatEndpoint';
import { EmbeddingEndpoint } from '../../../platform/endpoint/node/embeddingsEndpoint';
import { IModelMetadataFetcher, ModelMetadataFetcher } from '../../../platform/endpoint/node/modelMetadataFetcher';
import { ExtensionContributedChatEndpoint } from '../../../platform/endpoint/vscode-node/extChatEndpoint';
import { ILogService } from '../../../platform/log/common/logService';
import { IChatEndpoint, IEmbeddingsEndpoint } from '../../../platform/networking/common/networking';
import { Emitter, Event } from '../../../util/vs/base/common/event';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { isStandaloneByokChatFromProduct } from '../../byok/common/standaloneByokProduct';


export class ProductionEndpointProvider extends Disposable implements IEndpointProvider {

	declare readonly _serviceBrand: undefined;

	private readonly _onDidModelsRefresh = this._register(new Emitter<void>());
	readonly onDidModelsRefresh: Event<void> = this._onDidModelsRefresh.event;

	private _chatEndpoints: Map<string, IChatEndpoint> = new Map();
	private _embeddingEndpoints: Map<string, IEmbeddingsEndpoint> = new Map();
	private readonly _modelFetcher: IModelMetadataFetcher;

	constructor(
		@IAutomodeService private readonly _autoModeService: IAutomodeService,
		@ILogService protected readonly _logService: ILogService,
		@IConfigurationService protected readonly _configService: IConfigurationService,
		@IInstantiationService protected readonly _instantiationService: IInstantiationService,
		@IAuthenticationService protected readonly _authService: IAuthenticationService,
	) {
		super();

		this._modelFetcher = this._instantiationService.createInstance(ModelMetadataFetcher,
			false,
		);

		// When new models come in from CAPI we want to clear our local caches and let the endpoints be recreated since there may be new info
		this._register(this._modelFetcher.onDidModelsRefresh(() => {
			this._chatEndpoints.clear();
			this._embeddingEndpoints.clear();
			this._onDidModelsRefresh.fire();
		}));
	}

	private getOrCreateChatEndpointInstance(modelMetadata: IChatModelInformation): IChatEndpoint {
		const modelId = modelMetadata.id;
		let chatEndpoint = this._chatEndpoints.get(modelId);
		if (!chatEndpoint) {
			chatEndpoint = this._instantiationService.createInstance(CopilotChatEndpoint, modelMetadata);
			this._chatEndpoints.set(modelId, chatEndpoint);
		}
		return chatEndpoint;
	}

	/**
	 * Known BYOK / third-party vendors (must not use `selectChatModels({})` — that re-enters the Copilot
	 * `copilot` LM provider while it is building the model list).
	 */
	private static readonly _thirdPartyLmVendors = [
		'openai', 'anthropic', 'ollama', 'openrouter', 'azure', 'gemini', 'xai', 'customoai',
	] as const;

	/**
	 * Third-party / BYOK models registered via VS Code's Language Model API. Same idea as Roo Code:
	 * aggregate OpenAI-compatible and other local/API models into the endpoint layer when CAPI is empty.
	 */
	private async _extensionContributedEndpointsFromVsCodeLm(): Promise<IChatEndpoint[]> {
		const out: IChatEndpoint[] = [];
		const seen = new Set<string>();
		try {
			for (const vendor of ProductionEndpointProvider._thirdPartyLmVendors) {
				try {
					const lms = await vscode.lm.selectChatModels({ vendor });
					for (const lm of lms) {
						const key = `${lm.vendor}/${lm.id}`;
						if (seen.has(key)) {
							continue;
						}
						seen.add(key);
						out.push(this._instantiationService.createInstance(ExtensionContributedChatEndpoint, lm));
					}
				} catch {
					// Vendor not registered or no models — ignore.
				}
			}
		} catch (e) {
			this._logService.warn(`Could not enumerate third-party language models: ${e}`);
		}
		out.sort((a, b) => `${a.modelProvider}/${a.model}`.localeCompare(`${b.modelProvider}/${b.model}`));
		return out;
	}

	/**
	 * When CAPI returns no chat models (e.g. standalone BYOK + empty stub token), family resolution for
	 * `copilot-base` / `copilot-fast` fails. Prefer an OpenAI BYOK model, else any non-Copilot LM.
	 */
	private async _selectStandaloneByokLanguageModel(): Promise<LanguageModelChat | undefined> {
		try {
			for (const vendor of ProductionEndpointProvider._thirdPartyLmVendors) {
				const lms = await vscode.lm.selectChatModels({ vendor });
				if (lms.length > 0) {
					const sorted = [...lms].sort((a, b) => a.id.localeCompare(b.id));
					return sorted[0];
				}
			}
		} catch (e) {
			this._logService.warn(`Standalone BYOK: could not select a language model: ${e}`);
		}
		return undefined;
	}

	/**
	 * The workbench model picker can surface the same OpenAI model id under `vendor: copilot` (CAPI manifest)
	 * while BYOK registers it under `openai`. In standalone BYOK we must not route those through CopilotChatEndpoint.
	 */
	private async _findThirdPartyLmMatchingCopilotPickerModel(copilotPickerModel: LanguageModelChat): Promise<LanguageModelChat | undefined> {
		const wantId = copilotPickerModel.id;
		if (!wantId) {
			return undefined;
		}
		const wantVersion = copilotPickerModel.version;
		try {
			for (const vendor of ProductionEndpointProvider._thirdPartyLmVendors) {
				try {
					const lms = await vscode.lm.selectChatModels({ vendor });
					for (const lm of lms) {
						if (lm.id !== wantId) {
							continue;
						}
						const versionMismatch =
							wantVersion !== undefined && wantVersion !== '' &&
							lm.version !== undefined && lm.version !== '' &&
							lm.version !== wantVersion;
						if (versionMismatch) {
							continue;
						}
						return lm;
					}
				} catch {
					// Vendor not registered or no models
				}
			}
		} catch (e) {
			this._logService.warn(`Standalone BYOK: could not match third-party LM for copilot-picker model: ${e}`);
		}
		return undefined;
	}

	async getChatEndpoint(requestOrFamilyOrModel: LanguageModelChat | ChatRequest | ChatEndpointFamily): Promise<IChatEndpoint> {
		this._logService.trace(`Resolving chat model`);

		if (typeof requestOrFamilyOrModel === 'string') {
			try {
				const modelMetadata = await this._modelFetcher.getChatModelFromFamily(requestOrFamilyOrModel);
				return this.getOrCreateChatEndpointInstance(modelMetadata!);
			} catch (err) {
				const family = requestOrFamilyOrModel;
				if (isStandaloneByokChatFromProduct() && (family === 'copilot-base' || family === 'copilot-fast')) {
					const lm = await this._selectStandaloneByokLanguageModel();
					if (lm) {
						this._logService.info(`Standalone BYOK: using '${lm.vendor}/${lm.id}' for chat family '${family}' (no CAPI model list).`);
						return this._instantiationService.createInstance(ExtensionContributedChatEndpoint, lm);
					}
				}
				throw err;
			}
		}

		const model = 'model' in requestOrFamilyOrModel ? requestOrFamilyOrModel.model : requestOrFamilyOrModel;

		if (!model) {
			return this.getChatEndpoint('copilot-base');
		}

		if (model.vendor !== 'copilot') {
			return this._instantiationService.createInstance(ExtensionContributedChatEndpoint, model);
		}

		if (model.id === AutoChatEndpoint.pseudoModelId) {
			try {
				const allEndpoints = await this.getAllChatEndpoints();
				return this._autoModeService.resolveAutoModeEndpoint(requestOrFamilyOrModel as ChatRequest, allEndpoints);
			} catch {
				return this.getChatEndpoint('copilot-base');
			}
		}

		if (isStandaloneByokChatFromProduct()) {
			const thirdParty = await this._findThirdPartyLmMatchingCopilotPickerModel(model);
			if (thirdParty) {
				this._logService.info(`Standalone BYOK: routing picker model '${model.vendor}/${model.id}' to third-party LM '${thirdParty.vendor}/${thirdParty.id}'.`);
				return this._instantiationService.createInstance(ExtensionContributedChatEndpoint, thirdParty);
			}
		}

		const modelMetadata = await this._modelFetcher.getChatModelFromApiModel(model);
		// If we fail to resolve a model since this is panel we give copilot base. This really should never happen as the picker is powered by the same service.
		return modelMetadata ? this.getOrCreateChatEndpointInstance(modelMetadata) : this.getChatEndpoint('copilot-base');
	}

	async getEmbeddingsEndpoint(family?: EmbeddingsEndpointFamily): Promise<IEmbeddingsEndpoint> {
		this._logService.trace(`Resolving embedding model`);
		const modelMetadata = await this._modelFetcher.getEmbeddingsModel('text-embedding-3-small');
		const model = await this.getOrCreateEmbeddingEndpointInstance(modelMetadata);
		this._logService.trace(`Resolved embedding model`);
		return model;
	}

	private async getOrCreateEmbeddingEndpointInstance(modelMetadata: IEmbeddingModelInformation): Promise<IEmbeddingsEndpoint> {
		const modelId = 'text-embedding-3-small';
		let embeddingEndpoint = this._embeddingEndpoints.get(modelId);
		if (!embeddingEndpoint) {
			embeddingEndpoint = this._instantiationService.createInstance(EmbeddingEndpoint, modelMetadata);
			this._embeddingEndpoints.set(modelId, embeddingEndpoint);
		}
		return embeddingEndpoint;
	}

	async getAllCompletionModels(forceRefresh?: boolean): Promise<ICompletionModelInformation[]> {
		return this._modelFetcher.getAllCompletionModels(forceRefresh ?? false);
	}

	async getAllChatEndpoints(): Promise<IChatEndpoint[]> {
		const models: IChatModelInformation[] = await this._modelFetcher.getAllChatModels();
		const capiEndpoints = models.map(model => this.getOrCreateChatEndpointInstance(model));

		if (isStandaloneByokChatFromProduct()) {
			// In standalone BYOK mode there is no real GitHub Copilot session. All CAPI endpoints would be
			// blocked in chatMLFetcher anyway (see standalone-byok guard there). Return ONLY extension-contributed
			// (BYOK / local) endpoints so the model picker never surfaces unusable CAPI models.
			return await this._extensionContributedEndpointsFromVsCodeLm();
		}

		/** No CAPI list: merge models from VS Code LM API (OpenAI BYOK, Ollama, etc.). */
		if (models.length === 0) {
			const extra = await this._extensionContributedEndpointsFromVsCodeLm();
			const seen = new Set(capiEndpoints.map(e => e.model));
			const merged = [...capiEndpoints];
			for (const e of extra) {
				if (!seen.has(e.model)) {
					merged.push(e);
					seen.add(e.model);
				}
			}
			return merged;
		}

		return capiEndpoints;
	}
}
