/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Mark, mergeAttributes, Node, type Editor } from '@tiptap/core';

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

/** Insert a footnote reference at the selection and a definition block at the end of the document (Markdown). */
export function insertWriterFootnote(editor: Editor): void {
	const id = suggestFootnoteId(editor);
	const safe = id.replace(/[^a-zA-Z0-9_-]/g, '_');
	// Prefer HTML so TipTap parses the mark reliably; JSON insert can be dropped by the schema.
	const supHtml = `<sup class="writer-fn-ref" data-footnote-id="${escapeHtmlAttr(id)}"><a href="#fn-${escapeHtmlAttr(safe)}">[${escapeHtmlAttr(id)}]</a></sup>`;
	editor.chain().focus().insertContent(supHtml).run();
	const end = editor.state.doc.content.size;
	editor
		.chain()
		.insertContentAt(end, {
			type: 'writerFootnoteDef',
			attrs: { footnoteId: id },
			content: [{ type: 'text', text: 'Footnote text.' }],
		})
		.run();
	requestAnimationFrame(() => {
		const el = editor.view.dom.querySelector('.writer-fn-def:last-of-type');
		el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
	});
}
