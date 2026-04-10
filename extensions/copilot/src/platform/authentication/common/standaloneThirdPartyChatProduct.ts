/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as vscode from 'vscode';

/** Stub token username when the product uses third-party API keys only (no GitHub Copilot session). */
export const STANDALONE_THIRD_PARTY_CHAT_TOKEN_USERNAME = 'standalone-third-party-chat';

/** Non-empty placeholder so the session is not treated as missing a key; not sent to hosted Copilot APIs. */
export const STANDALONE_THIRD_PARTY_CHAT_TOKEN_STUB = 'standalone-third-party-chat-stub';

let cachedStandaloneThirdPartyChat: boolean | undefined;

/**
 * Reads {@code standaloneThirdPartyChat} from the workbench {@code product.json}.
 */
export function isStandaloneThirdPartyChatFromProduct(): boolean {
	if (cachedStandaloneThirdPartyChat !== undefined) {
		return cachedStandaloneThirdPartyChat;
	}
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const product = require(path.join(vscode.env.appRoot, 'product.json')) as { standaloneThirdPartyChat?: boolean };
		cachedStandaloneThirdPartyChat = product.standaloneThirdPartyChat === true;
	} catch {
		cachedStandaloneThirdPartyChat = false;
	}
	return cachedStandaloneThirdPartyChat;
}
