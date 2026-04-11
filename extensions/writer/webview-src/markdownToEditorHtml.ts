/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { marked } from 'marked';
import { extractFootnoteDefinitions, replaceInlineFootnoteRefs, renderFootnoteDefinitionsHtml } from './markdownFootnotes';

/** Configure marked once for Caret (GFM tables, strikethrough, etc.). */
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
	const { body, defs } = extractFootnoteDefinitions(md);
	const withRefs = replaceInlineFootnoteRefs(body);
	const result = marked.parse(preprocessMarkdownForEditor(withRefs), { async: false });
	let html = typeof result === 'string' ? result : '';
	html += renderFootnoteDefinitionsHtml(defs);
	return html;
}
