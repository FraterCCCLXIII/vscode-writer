/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAuthenticationService } from '../../../platform/authentication/common/authentication';
import { isStandaloneByokChatFromProduct } from './standaloneByokProduct';

/**
 * Resolves the Copilot plan string for user-facing error copy. Standalone BYOK builds have no CAPI token.
 */
export async function copilotPlanForErrorMessages(authenticationService: IAuthenticationService): Promise<string> {
	if (isStandaloneByokChatFromProduct()) {
		return 'individual';
	}
	return (await authenticationService.getCopilotToken()).copilotPlan;
}
