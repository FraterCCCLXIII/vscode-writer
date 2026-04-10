/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export class WriterSelectionStore {
	private readonly _byUri = new Map<string, string>();
	private _focusedUri: vscode.Uri | undefined;

	public setFocusedUri(uri: vscode.Uri | undefined): void {
		this._focusedUri = uri;
	}

	public getFocusedSelection(): string | undefined {
		if (!this._focusedUri) {
			return undefined;
		}
		return this._byUri.get(this._focusedUri.toString());
	}

	public set(uri: vscode.Uri, selectedText: string): void {
		const key = uri.toString();
		if (!selectedText.trim()) {
			this._byUri.delete(key);
			return;
		}
		this._byUri.set(key, selectedText);
	}

	public get(uri: vscode.Uri): string | undefined {
		return this._byUri.get(uri.toString());
	}

	public clear(uri: vscode.Uri): void {
		this._byUri.delete(uri.toString());
		if (this._focusedUri?.toString() === uri.toString()) {
			this._focusedUri = undefined;
		}
	}
}
