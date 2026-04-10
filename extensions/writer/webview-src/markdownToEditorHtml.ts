/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { marked } from 'marked';

/** Configure marked once for Rich Writer (GFM tables, strikethrough, etc.). */
marked.use({
	gfm: true,
	breaks: false,
});

/**
 * Normalize markdown before parse so common "single block" files still render as blocks.
 */
export function preprocessMarkdownForEditor(md: string): string {
	let t = md.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
	// Ensure trailing newline so parsers can close block elements correctly
	if (t.length > 0 && !t.endsWith('\n')) {
		t += '\n';
	}
	return t;
}

export function markdownToEditorHtml(md: string): string {
	const result = marked.parse(preprocessMarkdownForEditor(md), { async: false });
	return typeof result === 'string' ? result : '';
}
