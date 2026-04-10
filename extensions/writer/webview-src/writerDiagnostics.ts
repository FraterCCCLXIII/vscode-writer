/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';

/** DiagnosticSeverity from VS Code (0=Error, 1=Warning, 2=Information, 3=Hint) */
export type WriterDiagnosticItem = {
	message: string;
	severity: number;
	/** Text span from the workspace document (UTF-16 offsets) — used to match in the editor. */
	text: string;
};

const pluginKey = new PluginKey<DecorationSet>('writerDiagnostics');

function findTextRangeInDoc(doc: PMNode, searchText: string): { from: number; to: number } | null {
	const t = searchText.trim();
	if (!t) {
		return null;
	}
	let found: { from: number; to: number } | null = null;
	doc.descendants((node, pos) => {
		if (found) {
			return false;
		}
		if (node.isText) {
			const idx = node.text.indexOf(t);
			if (idx >= 0) {
				found = { from: pos + idx, to: pos + idx + t.length };
				return false;
			}
		}
		return true;
	});
	if (found) {
		return found;
	}
	// Fallback: longest word (spelling mistakes are often one word)
	const words = t.match(/[\p{L}\p{N}']+/gu);
	if (!words?.length) {
		return null;
	}
	const longest = words.reduce((a, b) => (a.length >= b.length ? a : b) ?? '');
	if (longest.length < 2) {
		return null;
	}
	doc.descendants((node, pos) => {
		if (found) {
			return false;
		}
		if (node.isText) {
			const idx = node.text.indexOf(longest);
			if (idx >= 0) {
				found = { from: pos + idx, to: pos + idx + longest.length };
				return false;
			}
		}
		return true;
	});
	return found;
}

function severityClass(severity: number): string {
	switch (severity) {
		case 0:
			return 'writer-lint-error';
		case 1:
			return 'writer-lint-warning';
		case 2:
			return 'writer-lint-info';
		case 3:
			return 'writer-lint-hint';
		default:
			return 'writer-lint-info';
	}
}

function buildDecorationSet(doc: PMNode, items: WriterDiagnosticItem[]): DecorationSet {
	const deco: Decoration[] = [];
	for (const item of items) {
		const range = findTextRangeInDoc(doc, item.text);
		if (!range) {
			continue;
		}
		const cls = severityClass(item.severity);
		deco.push(Decoration.inline(range.from, range.to, { class: cls, title: item.message }));
	}
	return DecorationSet.create(doc, deco);
}

export const WriterDiagnostics = Extension.create({
	name: 'writerDiagnostics',

	addProseMirrorPlugins() {
		return [
			new Plugin({
				key: pluginKey,
				state: {
					init() {
						return DecorationSet.empty;
					},
					apply(tr, oldSet, _oldState, newState) {
						// Note: empty array is valid (clear all) — must not use truthiness on [].
						const diagnosticMeta = tr.getMeta('writerDiagnostics');
						if (diagnosticMeta !== undefined) {
							return buildDecorationSet(newState.doc, diagnosticMeta as WriterDiagnosticItem[]);
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
			setWriterDiagnostics:
				(items: WriterDiagnosticItem[]) =>
					({ tr, dispatch }) => {
						if (dispatch) {
							tr.setMeta('writerDiagnostics', items);
							dispatch(tr);
						}
						return true;
					},
		};
	},
});
