/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as vscode from 'vscode';

let cachedStandaloneByok: boolean | undefined;

/**
 * Reads {@code standaloneByokChat} from the workbench {@code product.json} (same pattern as other extension code).
 */
export function isStandaloneByokChatFromProduct(): boolean {
	if (cachedStandaloneByok !== undefined) {
		return cachedStandaloneByok;
	}
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const product = require(path.join(vscode.env.appRoot, 'product.json')) as { standaloneByokChat?: boolean };
		cachedStandaloneByok = product.standaloneByokChat === true;
	} catch {
		cachedStandaloneByok = false;
	}
	return cachedStandaloneByok;
}
