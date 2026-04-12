/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export interface GhostTextRange {
	from: number;
	to: number;
}

const pluginKey = new PluginKey<DecorationSet>('writerGhostText');

function buildDecorationSet(doc: import('@tiptap/pm/model').Node, range: GhostTextRange | null): DecorationSet {
	if (!range || range.from >= range.to) {
		return DecorationSet.empty;
	}
	const clampedTo = Math.min(range.to, doc.content.size);
	const clampedFrom = Math.min(range.from, clampedTo);
	if (clampedFrom >= clampedTo) {
		return DecorationSet.empty;
	}
	const deco = Decoration.inline(clampedFrom, clampedTo, { class: 'write-next-ghost' });
	return DecorationSet.create(doc, [deco]);
}

export const WriterGhostText = Extension.create({
	name: 'writerGhostText',

	addProseMirrorPlugins() {
		return [
			new Plugin({
				key: pluginKey,
				state: {
					init() {
						return DecorationSet.empty;
					},
					apply(tr, oldSet, _oldState, newState) {
						const meta = tr.getMeta('writerGhostText') as GhostTextRange | null | undefined;
						if (meta !== undefined) {
							return buildDecorationSet(newState.doc, meta);
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
			setGhostTextRange:
				(range: GhostTextRange | null) =>
					({ tr, dispatch }) => {
						if (dispatch) {
							tr.setMeta('writerGhostText', range);
							dispatch(tr);
						}
						return true;
					},
		};
	},
});
