/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

const panels = new Map<string, vscode.WebviewPanel>();

export function registerWriterPanel(uri: vscode.Uri, panel: vscode.WebviewPanel): void {
	panels.set(uri.toString(), panel);
}

export function unregisterWriterPanel(uri: vscode.Uri): void {
	panels.delete(uri.toString());
}

export function getWriterPanel(uri: vscode.Uri): vscode.WebviewPanel | undefined {
	return panels.get(uri.toString());
}
