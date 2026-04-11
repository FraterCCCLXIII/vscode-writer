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
	| { type: 'saveImage'; base64: string; mimeType: string; filenameHint?: string }
	| {
		type: 'commentAdd';
		resource: string;
		selectionMarkdown: string;
		plainQuote: string;
		body: string;
		/** Full Markdown matching the editor (synced to disk before anchoring). */
		markdownSnapshot?: string;
		/** UTF-16 offsets into `markdownSnapshot` / file text after sync. */
		start?: number;
		end?: number;
		/** Full plain text for RTF sync before resolving anchors. */
		plainTextSnapshot?: string;
	}
	| { type: 'activeCommentChanged'; commentId: string | null };

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
	}
	| {
		type: 'commentsForResource';
		resource: string;
		comments: {
			id: string;
			body: string;
			createdAt: number;
			orphaned?: boolean;
			anchor: { start: number; end: number; quote: string };
		}[];
	}
	| { type: 'focusComment'; commentId: string; quote?: string }
	| { type: 'clearActiveComment' };
