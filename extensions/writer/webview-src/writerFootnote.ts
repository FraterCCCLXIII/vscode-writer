/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Mark, mergeAttributes, Node, type Editor } from '@tiptap/core';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { buildFootnoteDefinitionParagraphHtml, footnoteIdToDisplayNumber } from './markdownFootnotes';

/** Inline reference rendered as superscript (from `[^id]` in Markdown). */
export const WriterFootnoteRef = Mark.create({
	name: 'writerFootnoteRef',
	inclusive: false,
	addAttributes() {
		return {
			footnoteId: {
				default: null,
				parseHTML: el => el.getAttribute('data-footnote-id'),
				renderHTML: attrs => (attrs.footnoteId ? { 'data-footnote-id': attrs.footnoteId } : {}),
			},
		};
	},
	parseHTML() {
		return [
			{
				tag: 'sup.writer-fn-ref[data-footnote-id]',
				priority: 60,
				getAttrs: el => ({
					footnoteId: (el as HTMLElement).getAttribute('data-footnote-id'),
				}),
			},
		];
	},
	renderHTML({ HTMLAttributes }) {
		return [
			'sup',
			mergeAttributes(HTMLAttributes, {
				class: 'writer-fn-ref',
			}),
			0,
		];
	},
});

const footnoteGuardKey = new PluginKey('writerFootnoteGuard');

/**
 * When suppressed, the guard plugin does nothing. This flag is set to true while
 * programmatic footnote reconciliation or deletion is running, so the guard doesn't
 * show duplicate confirm dialogs.
 */
let suppressGuard = false;

/** Collect footnote ref ids from a doc. */
function collectRefIds(doc: import('@tiptap/pm/model').Node): Set<string> {
	const ids = new Set<string>();
	doc.descendants(node => {
		if (node.isText) {
			for (const mk of node.marks) {
				if (mk.type.name === 'writerFootnoteRef' && mk.attrs.footnoteId) {
					ids.add(mk.attrs.footnoteId as string);
				}
			}
		}
	});
	return ids;
}

/** Collect footnote def ids from a doc. */
function collectDefIds(doc: import('@tiptap/pm/model').Node): Set<string> {
	const ids = new Set<string>();
	doc.descendants(node => {
		if (node.type.name === 'writerFootnoteDef' && node.attrs.footnoteId) {
			ids.add(node.attrs.footnoteId as string);
		}
	});
	return ids;
}

function createFootnoteGuardPlugin(editor: Editor): Plugin {
	return new Plugin({
		key: footnoteGuardKey,
		filterTransaction(tr: Transaction) {
			if (suppressGuard) {
				return true;
			}
			if (!tr.docChanged) {
				return true;
			}
			const oldDoc = tr.before;
			const newDoc = tr.doc;

			const oldRefs = collectRefIds(oldDoc);
			const newRefs = collectRefIds(newDoc);
			const oldDefs = collectDefIds(oldDoc);
			const newDefs = collectDefIds(newDoc);

			for (const id of oldRefs) {
				if (!newRefs.has(id) && oldDefs.has(id)) {
					const ok = window.confirm(
						'Delete this footnote? The reference and its definition at the bottom will both be removed.',
					);
					if (!ok) {
						return false;
					}
					queueMicrotask(() => {
						suppressGuard = true;
						deleteWriterFootnote(editor, id);
						suppressGuard = false;
					});
					return false;
				}
			}

			for (const id of oldDefs) {
				if (!newDefs.has(id) && oldRefs.has(id)) {
					const ok = window.confirm(
						'Delete this footnote? The definition and its in-text reference will both be removed.',
					);
					if (!ok) {
						return false;
					}
					queueMicrotask(() => {
						suppressGuard = true;
						deleteWriterFootnote(editor, id);
						suppressGuard = false;
					});
					return false;
				}
			}

			return true;
		},
	});
}

/** A single footnote definition block (paragraph at end of document). */
export const WriterFootnoteDef = Node.create({
	name: 'writerFootnoteDef',
	group: 'block',
	content: 'inline*',
	defining: true,
	addAttributes() {
		return {
			footnoteId: {
				default: null,
				parseHTML: el => el.getAttribute('data-footnote-id'),
				renderHTML: attrs => (attrs.footnoteId ? { 'data-footnote-id': attrs.footnoteId } : {}),
			},
		};
	},
	parseHTML() {
		return [
			{
				tag: 'p.writer-fn-def',
				priority: 100,
				getAttrs: el => ({
					footnoteId: (el as HTMLElement).getAttribute('data-footnote-id'),
				}),
			},
		];
	},
	renderHTML({ HTMLAttributes }) {
		const id = String(HTMLAttributes['data-footnote-id'] ?? '');
		const safe = id.replace(/[^a-zA-Z0-9_-]/g, '_');
		return [
			'p',
			mergeAttributes(HTMLAttributes, {
				class: 'writer-fn-def',
				id: `fn-${safe}`,
			}),
			0,
		];
	},
	addProseMirrorPlugins() {
		return [createFootnoteGuardPlugin(this.editor)];
	},
});

function suggestFootnoteId(editor: Editor): string {
	const html = editor.getHTML();
	const used = new Set<string>();
	const re = /data-footnote-id="([^"]+)"/g;
	let m;
	while ((m = re.exec(html))) {
		used.add(m[1]);
	}
	let n = 1;
	while (used.has(`fn${n}`)) {
		n++;
	}
	return `fn${n}`;
}

function escapeHtmlAttr(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

export type InsertWriterFootnoteOptions = {
	body?: string;
	range?: { from: number; to: number };
};

export function insertWriterFootnote(editor: Editor, options?: InsertWriterFootnoteOptions): void {
	const id = suggestFootnoteId(editor);
	const safe = id.replace(/[^a-zA-Z0-9_-]/g, '_');
	const displayNum = footnoteIdToDisplayNumber(id);
	const supHtml = `<sup class="writer-fn-ref" data-footnote-id="${escapeHtmlAttr(id)}"><a href="#fn-${escapeHtmlAttr(safe)}">${escapeHtmlAttr(displayNum)}</a></sup>`;

	const range = options?.range;
	const sel = editor.state.selection;
	const from = range?.from ?? sel.from;
	const to = range?.to ?? sel.to;
	const empty = from === to;
	const insertPos = empty ? from : to;

	suppressGuard = true;
	editor.chain().focus().insertContentAt(insertPos, supHtml).run();
	const end = editor.state.doc.content.size;
	const rawBody = options?.body !== undefined ? options.body : 'Footnote text.';
	editor.chain().insertContentAt(end, buildFootnoteDefinitionParagraphHtml(id, rawBody)).run();
	suppressGuard = false;

	reconcileFootnotes(editor);
}

/** Scroll the definition paragraph for `footnoteId` into view. */
export function scrollFootnoteDefIntoView(editor: Editor, footnoteId: string): void {
	const el = editor.view.dom.querySelector(
		`p.writer-fn-def[data-footnote-id="${CSS.escape(footnoteId)}"]`,
	);
	el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

/** Remove the in-text reference and the matching definition block (no confirmation). */
export function deleteWriterFootnote(editor: Editor, footnoteId: string): void {
	const ranges: { from: number; to: number }[] = [];

	editor.state.doc.descendants((node, pos) => {
		if (node.type.name === 'writerFootnoteDef' && node.attrs.footnoteId === footnoteId) {
			ranges.push({ from: pos, to: pos + node.nodeSize });
		}
	});

	let refStart = -1;
	let refEnd = -1;
	editor.state.doc.descendants((node, pos) => {
		if (!node.isText) {
			return;
		}
		const m = node.marks.find(
			mk => mk.type.name === 'writerFootnoteRef' && mk.attrs.footnoteId === footnoteId,
		);
		if (!m) {
			return;
		}
		const a = pos;
		const b = pos + node.nodeSize;
		if (refStart < 0) {
			refStart = a;
			refEnd = b;
		} else {
			refStart = Math.min(refStart, a);
			refEnd = Math.max(refEnd, b);
		}
	});

	if (refStart >= 0) {
		ranges.push({ from: refStart, to: refEnd });
	}

	if (ranges.length === 0) {
		return;
	}

	suppressGuard = true;
	ranges.sort((a, b) => b.from - a.from);
	let chain = editor.chain().focus();
	for (const r of ranges) {
		chain = chain.deleteRange({ from: r.from, to: r.to });
	}
	chain.run();
	suppressGuard = false;

	reconcileFootnotes(editor);
}

// Reconciliation: reorder defs to match ref document-order; renumber display text

interface RefInfo {
	id: string;
	pos: number;
}

interface DefInfo {
	id: string;
	pos: number;
	nodeSize: number;
	textContent: string;
}

function getRefsInOrder(doc: import('@tiptap/pm/model').Node): RefInfo[] {
	const out: RefInfo[] = [];
	doc.descendants((node, pos) => {
		if (!node.isText) {
			return;
		}
		for (const mk of node.marks) {
			if (mk.type.name === 'writerFootnoteRef' && mk.attrs.footnoteId) {
				const id = mk.attrs.footnoteId as string;
				if (!out.some(r => r.id === id)) {
					out.push({ id, pos });
				}
			}
		}
	});
	return out;
}

function getDefsInOrder(doc: import('@tiptap/pm/model').Node): DefInfo[] {
	const out: DefInfo[] = [];
	doc.descendants((node, pos) => {
		if (node.type.name === 'writerFootnoteDef' && node.attrs.footnoteId) {
			out.push({
				id: node.attrs.footnoteId as string,
				pos,
				nodeSize: node.nodeSize,
				textContent: node.textContent,
			});
		}
	});
	return out;
}

function stripLeadingNumberDot(text: string): string {
	return text.replace(/^\d+\.\s*/, '');
}

/**
 * Reorder footnote definitions so they match the order their references
 * appear in the document, and renumber the display text (both refs and defs).
 *
 * Runs as a single ProseMirror transaction. Safe to call after any edit.
 */
export function reconcileFootnotes(editor: Editor): void {
	const doc = editor.state.doc;
	const refs = getRefsInOrder(doc);
	const defs = getDefsInOrder(doc);

	if (refs.length === 0 && defs.length === 0) {
		return;
	}

	const refOrder = refs.map(r => r.id);
	const defMap = new Map(defs.map(d => [d.id, d]));

	const desiredDefOrder = refOrder.filter(id => defMap.has(id));
	const orphanDefs = defs.filter(d => !refOrder.includes(d.id)).map(d => d.id);
	const fullDesiredOrder = [...desiredDefOrder, ...orphanDefs];

	const currentDefOrder = defs.map(d => d.id);

	const orderChanged = fullDesiredOrder.length !== currentDefOrder.length ||
		fullDesiredOrder.some((id, i) => currentDefOrder[i] !== id);

	let numberingChanged = false;
	for (let i = 0; i < refs.length; i++) {
		const expected = String(i + 1);
		const current = footnoteIdToDisplayNumber(refs[i].id);
		if (current !== expected) {
			numberingChanged = true;
			break;
		}
	}

	if (!numberingChanged) {
		for (let i = 0; i < fullDesiredOrder.length; i++) {
			const d = defMap.get(fullDesiredOrder[i]);
			if (!d) {
				continue;
			}
			const idx = desiredDefOrder.indexOf(d.id);
			if (idx < 0) {
				continue;
			}
			const expected = `${idx + 1}. `;
			const text = d.textContent;
			const m = /^(\d+)\.\s/.exec(text);
			if (!m || m[1] !== String(idx + 1)) {
				numberingChanged = true;
				break;
			}
		}
	}

	if (!orderChanged && !numberingChanged) {
		return;
	}

	suppressGuard = true;

	if (orderChanged && defs.length > 0) {
		const bodiesByDefId = new Map<string, string>();
		for (const d of defs) {
			bodiesByDefId.set(d.id, stripLeadingNumberDot(d.textContent));
		}

		const sortedDefs = [...defs].sort((a, b) => b.pos - a.pos);
		let chain = editor.chain();
		for (const d of sortedDefs) {
			chain = chain.deleteRange({ from: d.pos, to: d.pos + d.nodeSize });
		}
		chain.run();

		const insertEnd = editor.state.doc.content.size;
		let chain2 = editor.chain();
		for (let i = 0; i < fullDesiredOrder.length; i++) {
			const id = fullDesiredOrder[i];
			const body = bodiesByDefId.get(id) ?? '';
			const idx = desiredDefOrder.indexOf(id);
			const displayNum = idx >= 0 ? String(idx + 1) : footnoteIdToDisplayNumber(id);
			const html = buildFootnoteDefinitionParagraphHtml(id, body, displayNum);
			chain2 = chain2.insertContentAt(insertEnd, html);
		}
		chain2.run();
	} else if (numberingChanged) {
		for (let i = 0; i < fullDesiredOrder.length; i++) {
			const id = fullDesiredOrder[i];
			const idx = desiredDefOrder.indexOf(id);
			if (idx < 0) {
				continue;
			}
			const displayNum = String(idx + 1);
			const defEl = editor.view.dom.querySelector(
				`p.writer-fn-def[data-footnote-id="${CSS.escape(id)}"]`,
			);
			if (!defEl) {
				continue;
			}
			const text = defEl.textContent ?? '';
			const body = stripLeadingNumberDot(text);
			const expected = `${displayNum}. ${body}`;
			if (text !== expected) {
				const defNode = getDefsInOrder(editor.state.doc).find(d => d.id === id);
				if (defNode) {
					editor.chain()
						.deleteRange({ from: defNode.pos, to: defNode.pos + defNode.nodeSize })
						.insertContentAt(defNode.pos, buildFootnoteDefinitionParagraphHtml(id, body, displayNum))
						.run();
				}
			}
		}
	}

	updateRefDisplayNumbers(editor, refOrder);

	suppressGuard = false;
}

/**
 * Update the visible text inside each `sup.writer-fn-ref > a` to match
 * the ref's position in document order (1, 2, 3, …). Uses direct DOM
 * manipulation so it doesn't trigger ProseMirror transactions.
 */
function updateRefDisplayNumbers(editor: Editor, orderedIds: string[]): void {
	const dom = editor.view.dom;
	for (let i = 0; i < orderedIds.length; i++) {
		const id = orderedIds[i];
		const sup = dom.querySelector(
			`sup.writer-fn-ref[data-footnote-id="${CSS.escape(id)}"]`,
		);
		if (!sup) {
			continue;
		}
		const a = sup.querySelector('a');
		if (a) {
			const expected = String(i + 1);
			if (a.textContent !== expected) {
				a.textContent = expected;
			}
		}
	}
}
