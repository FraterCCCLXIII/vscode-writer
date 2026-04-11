/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Editor } from '@tiptap/core';
import { DOMSerializer } from '@tiptap/pm/model';
import type TurndownService from 'turndown';

/**
 * Serialize the current selection to Markdown (via HTML fragment) and plain text for comment anchoring.
 */
export function getSelectionForComment(
	editor: Editor,
	turndown: TurndownService,
): { selectionMarkdown: string; plainQuote: string } | undefined {
	const { from, to, empty } = editor.state.selection;
	if (empty) {
		return undefined;
	}
	const plainQuote = editor.state.doc.textBetween(from, to, '\n');
	if (!plainQuote.trim()) {
		return undefined;
	}
	const serializer = DOMSerializer.fromSchema(editor.schema);
	const fragment = editor.state.doc.slice(from, to);
	const dom = serializer.serializeFragment(fragment.content);
	const wrap = document.createElement('div');
	wrap.appendChild(dom);
	const selectionMarkdown = turndown.turndown(wrap.innerHTML).trim();
	return { selectionMarkdown, plainQuote };
}
