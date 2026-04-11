/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Mark, mergeAttributes, Node, type Editor } from '@tiptap/core';
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
	/** Footnote body; empty becomes a non-breaking space placeholder. */
	body?: string;
	/**
	 * Where to insert the reference. If omitted, uses the current selection
	 * (caret → insert at `from`; non-empty selection → insert after `to`).
	 */
	range?: { from: number; to: number };
};

/**
 * Insert a footnote reference and a definition block at the end of the document (Markdown).
 * Prefer passing `body` from the composer; omit for a placeholder body.
 */
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

	editor.chain().focus().insertContentAt(insertPos, supHtml).run();
	const end = editor.state.doc.content.size;
	const rawBody = options?.body !== undefined ? options.body : 'Footnote text.';
	editor.chain().insertContentAt(end, buildFootnoteDefinitionParagraphHtml(id, rawBody)).run();
}

/** Scroll the definition paragraph for `footnoteId` into view. */
export function scrollFootnoteDefIntoView(editor: Editor, footnoteId: string): void {
	const el = editor.view.dom.querySelector(
		`p.writer-fn-def[data-footnote-id="${CSS.escape(footnoteId)}"]`,
	);
	el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

/** Remove the in-text reference and the matching definition block. */
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

	ranges.sort((a, b) => b.from - a.from);
	let chain = editor.chain().focus();
	for (const r of ranges) {
		chain = chain.deleteRange({ from: r.from, to: r.to });
	}
	chain.run();
}
