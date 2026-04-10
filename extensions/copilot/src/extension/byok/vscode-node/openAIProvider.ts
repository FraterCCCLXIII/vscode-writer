/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { IChatModelInformation, ModelSupportedEndpoint } from '../../../platform/endpoint/common/endpointProvider';
import { ILogService } from '../../../platform/log/common/logService';
import { IFetcherService } from '../../../platform/networking/common/fetcherService';
import { IExperimentationService } from '../../../platform/telemetry/common/nullExperimentationService';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { BYOKKnownModels, BYOKModelCapabilities } from '../common/byokProvider';
import { AbstractOpenAICompatibleLMProvider } from './abstractLanguageModelChatProvider';
import { IBYOKStorageService } from './byokStorageService';

/** OpenAI `GET /v1/models` list entry (subset). */
interface OpenAIListedModel {
	readonly id?: string;
}

export class OAIBYOKLMProvider extends AbstractOpenAICompatibleLMProvider {
	public static readonly providerName = 'OpenAI';

	constructor(
		knownModels: BYOKKnownModels,
		byokStorageService: IBYOKStorageService,
		@IFetcherService fetcherService: IFetcherService,
		@ILogService logService: ILogService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IConfigurationService configurationService: IConfigurationService,
		@IExperimentationService expService: IExperimentationService
	) {
		super(
			OAIBYOKLMProvider.providerName.toLowerCase(),
			OAIBYOKLMProvider.providerName,
			knownModels,
			byokStorageService,
			fetcherService,
			logService,
			instantiationService,
			configurationService,
			expService
		);
	}

	protected override getModelsBaseUrl(): string {
		return 'https://api.openai.com/v1';
	}

	protected override getModelInfo(modelId: string, modelUrl: string): IChatModelInformation {
		const modelInfo = super.getModelInfo(modelId, modelUrl);
		modelInfo.supported_endpoints = [
			ModelSupportedEndpoint.ChatCompletions,
			ModelSupportedEndpoint.Responses
		];
		return modelInfo;
	}

	/**
	 * The CDN allowlist often uses dated ids (e.g. `gpt-4o-2024-08-06`) while `/v1/models` returns
	 * aliases like `gpt-4o`, which would otherwise be dropped and show zero BYOK models.
	 */
	protected override resolveModelCapabilities(modelData: unknown): BYOKModelCapabilities | undefined {
		const listed = modelData as OpenAIListedModel;
		const rawId = listed?.id;
		if (!rawId || typeof rawId !== 'string') {
			return undefined;
		}

		const id = rawId.toLowerCase();
		if (
			id.includes('embedding') ||
			id.includes('moderation') ||
			id.includes('whisper') ||
			id.includes('tts') ||
			id.includes('dall-e') ||
			id.includes('davinci') ||
			id.includes('babbage') ||
			id.includes('ada-002') ||
			id.includes('text-similarity') ||
			id.includes('text-search') ||
			id.includes('code-search') ||
			id.startsWith('omni-moderation')
		) {
			return undefined;
		}

		const coreForFamily = id.startsWith('ft:')
			? (id.split(':')[1] ?? id)
			: id;

		const looksLikeChat =
			/^(gpt-[345]|chatgpt-|o[0-9]|o1)/.test(coreForFamily) ||
			coreForFamily.includes('gpt-4') ||
			coreForFamily.includes('gpt-5') ||
			/^o[0-9]/.test(coreForFamily);

		if (!looksLikeChat) {
			return undefined;
		}

		const vision =
			coreForFamily.includes('4o') ||
			coreForFamily.includes('gpt-5') ||
			coreForFamily.includes('vision') ||
			/^o[0-9]/.test(coreForFamily);

		return {
			name: rawId,
			toolCalling: true,
			vision,
			maxInputTokens: 128000,
			maxOutputTokens: 16384
		};
	}
}
