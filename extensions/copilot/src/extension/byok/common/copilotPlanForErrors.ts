/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAuthenticationService } from '../../../platform/authentication/common/authentication';
import { isStandaloneThirdPartyChatFromProduct } from '../../../platform/authentication/common/standaloneThirdPartyChatProduct';

/**
 * Resolves the Copilot plan string for user-facing error copy. Standalone third-party chat builds have no CAPI token.
 */
export async function copilotPlanForErrorMessages(authenticationService: IAuthenticationService): Promise<string> {
	if (isStandaloneThirdPartyChatFromProduct()) {
		return 'individual';
	}
	return (await authenticationService.getCopilotToken()).copilotPlan;
}
