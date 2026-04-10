/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type FromWebview =
	| { type: 'ready' }
	| { type: 'contentChanged'; format: 'markdown'; markdown: string }
	| { type: 'contentChanged'; format: 'rtf'; plainText: string }
	| { type: 'selectionChanged'; text: string }
	| { type: 'inlineAiRequest'; prompt: string; selectionPlain: string; format: 'markdown' | 'rtf' }
	| { type: 'inlineAiCancel' }
	| { type: 'resolveImagePaths'; paths: string[] }
	| { type: 'saveImage'; base64: string; mimeType: string; filenameHint?: string };

export type ToWebview =
	| {
		type: 'init';
		format: 'markdown';
		payload: { markdown: string };
		resource: string;
	}
	| {
		type: 'init';
		format: 'rtf';
		payload: { plainText: string };
		resource: string;
	}
	| {
		type: 'documentChanged';
		format: 'markdown';
		payload: { markdown: string };
		resource: string;
	}
	| {
		type: 'documentChanged';
		format: 'rtf';
		payload: { plainText: string };
		resource: string;
	}
	| { type: 'inlineAiDelta'; text: string }
	| { type: 'inlineAiDone' }
	| { type: 'inlineAiError'; message: string }
	| { type: 'pathsResolved'; map: Record<string, string> }
	| { type: 'imageSaved'; markdownPath: string; webviewSrc: string; alt: string }
	| { type: 'imageSaveError'; message: string }
	| {
		type: 'diagnostics';
		items: { message: string; severity: number; text: string }[];
	};
