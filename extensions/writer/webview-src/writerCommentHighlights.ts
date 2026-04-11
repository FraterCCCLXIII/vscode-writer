/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import { findTextRangeInDoc } from './writerDiagnostics';

export type WriterCommentHighlightItem = {
	id: string;
	/** Plain text at anchor — matched in the editor document. */
	quote: string;
	body: string;
	orphaned?: boolean;
	/** Selected from the Comments panel — stronger decoration + scroll target. */
	isActive?: boolean;
};

const pluginKey = new PluginKey<DecorationSet>('writerCommentHighlights');

function truncateTitle(s: string, max: number): string {
	const t = s.replace(/\s+/g, ' ').trim();
	if (t.length <= max) {
		return t;
	}
	return `${t.slice(0, max - 1)}…`;
}

function buildDecorationSet(doc: PMNode, items: WriterCommentHighlightItem[]): DecorationSet {
	const deco: Decoration[] = [];
	for (const item of items) {
		if (item.orphaned) {
			continue;
		}
		const t = item.quote.trim();
		if (!t.length) {
			continue;
		}
		const range = findTextRangeInDoc(doc, t);
		if (!range) {
			continue;
		}
		const title = item.body.trim().length > 0 ? truncateTitle(item.body, 220) : 'Comment';
		const cls = item.isActive
			? 'writer-comment-highlight writer-comment-highlight-active'
			: 'writer-comment-highlight';
		deco.push(
			Decoration.inline(range.from, range.to, {
				class: cls,
				title,
			}),
		);
	}
	return DecorationSet.create(doc, deco);
}

export const WriterCommentHighlights = Extension.create({
	name: 'writerCommentHighlights',

	addProseMirrorPlugins() {
		return [
			new Plugin({
				key: pluginKey,
				state: {
					init() {
						return DecorationSet.empty;
					},
					apply(tr, oldSet, _oldState, newState) {
						const meta = tr.getMeta('writerCommentHighlights');
						if (meta !== undefined) {
							return buildDecorationSet(newState.doc, meta as WriterCommentHighlightItem[]);
						}
						if (tr.docChanged) {
							return oldSet.map(tr.mapping, tr.doc);
						}
						return oldSet;
					},
				},
				props: {
					decorations(state) {
						return pluginKey.getState(state);
					},
				},
			}),
		];
	},

	addCommands() {
		return {
			setWriterCommentHighlights:
				(items: WriterCommentHighlightItem[]) =>
					({ tr, dispatch }) => {
						if (dispatch) {
							tr.setMeta('writerCommentHighlights', items);
							dispatch(tr);
						}
						return true;
					},
		};
	},
});
