/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Remove footnote definition blocks from editor HTML and return them for Markdown serialization.
 * (Turndown matches generic `p` before custom rules, so we strip defs before turndown.)
 */
export function extractFootnoteDefsFromHtml(html: string): {
	strippedHtml: string;
	defs: { id: string; text: string }[];
} {
	const wrap = `<div class="writer-fn-extract-root">${html}</div>`;
	const doc = new DOMParser().parseFromString(wrap, 'text/html');
	const root = doc.body.querySelector('.writer-fn-extract-root');
	if (!root) {
		return { strippedHtml: html, defs: [] };
	}
	const defs: { id: string; text: string }[] = [];
	root.querySelectorAll('p.writer-fn-def').forEach(p => {
		const id = p.getAttribute('data-footnote-id') ?? '';
		const text = (p.textContent ?? '').replace(/\u00a0/g, ' ');
		if (id) {
			defs.push({ id, text });
		}
		p.remove();
	});
	return { strippedHtml: root.innerHTML, defs };
}

export function appendFootnoteDefsMarkdown(
	md: string,
	defs: { id: string; text: string }[],
): string {
	if (defs.length === 0) {
		return md;
	}
	let out = md.trimEnd();
	for (const d of defs) {
		const lines = d.text.split('\n');
		if (lines.length <= 1) {
			out += `\n\n[^${d.id}]: ${d.text.trim()}\n`;
		} else {
			out += `\n\n[^${d.id}]: ${lines[0]}\n${lines.slice(1).map(l => `    ${l}`).join('\n')}\n`;
		}
	}
	return out;
}
