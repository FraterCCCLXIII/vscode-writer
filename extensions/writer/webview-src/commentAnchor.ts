/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Editor } from '@tiptap/core';
import { appendFootnoteDefsMarkdown, extractFootnoteDefsFromHtml } from './htmlFootnotes';
import { writerTurndown } from './turndownWriter';

/** Full Markdown as it would be sent in `contentChanged` (must match host after sync). */
export function getMarkdownSnapshotFromEditor(editor: Editor): string {
	const html = editor.getHTML();
	const { strippedHtml, defs } = extractFootnoteDefsFromHtml(html);
	let md = writerTurndown.turndown(strippedHtml);
	md = appendFootnoteDefsMarkdown(md, defs);
	return md;
}

/** Full plain text for RTF (same as editor text). */
export function getPlainSnapshotFromEditor(editor: Editor): string {
	return editor.getText();
}

/**
 * UTF-16 start/end into `snapshot` (JavaScript string indices match VS Code offsets for the same string).
 */
export function computeOffsetsInSnapshot(
	snapshot: string,
	selectionMarkdown: string,
	plainQuote: string,
): { start: number; end: number } | undefined {
	const md = selectionMarkdown.replace(/\r\n/g, '\n');
	const full = snapshot.replace(/\r\n/g, '\n');
	const plain = plainQuote.replace(/\r\n/g, '\n');

	if (md.length > 0) {
		const idx = full.indexOf(md);
		if (idx >= 0) {
			return { start: idx, end: idx + md.length };
		}
	}
	if (plain.length > 0) {
		const indices: number[] = [];
		let pos = 0;
		while (pos < full.length) {
			const i = full.indexOf(plain, pos);
			if (i < 0) {
				break;
			}
			indices.push(i);
			pos = i + 1;
		}
		if (indices.length >= 1) {
			const s = indices[0];
			return { start: s, end: s + plain.length };
		}
	}
	return undefined;
}
