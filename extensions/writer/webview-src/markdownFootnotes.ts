/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Extract `[^id]:` footnote definitions (with optional indented continuations) and
 * replace inline `[^id]` references with HTML for TipTap (sup mark).
 */

export interface FootnoteDefinition {
	id: string;
	text: string;
}

function escapeAttr(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/** Display digit(s) for `fn1` → `1`; other ids fall back to the raw id. */
export function footnoteIdToDisplayNumber(id: string): string {
	const m = /^fn(\d+)$/.exec(id);
	if (m) {
		return m[1];
	}
	return id;
}

/**
 * Parse footnote definition blocks from markdown, return body without those lines and defs map.
 */
export function extractFootnoteDefinitions(md: string): { body: string; defs: FootnoteDefinition[] } {
	const lines = md.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
	const defs: FootnoteDefinition[] = [];
	const out: string[] = [];
	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		const m = /^\[\^([^\]]+)\]:\s*(.*)$/.exec(line);
		if (m) {
			const id = m[1];
			let text = m[2] ?? '';
			i++;
			while (i < lines.length) {
				const cont = lines[i];
				if (/^ {4}/.test(cont) || /^\t/.test(cont)) {
					text += '\n' + cont.replace(/^ {4}|\t/, '');
					i++;
				} else {
					break;
				}
			}
			defs.push({ id, text: text.trimEnd() });
			continue;
		}
		out.push(line);
		i++;
	}
	return { body: out.join('\n'), defs };
}

/** Replace `[^id]` in body with HTML sup elements (v1: not code-fence aware). */
export function replaceInlineFootnoteRefs(body: string): string {
	return body.replace(/\[\^([^\]]+)\]/g, (_full, id: string) => {
		const safe = String(id).replace(/[^a-zA-Z0-9_-]/g, '_');
		const num = footnoteIdToDisplayNumber(id);
		return `<sup class="writer-fn-ref" data-footnote-id="${escapeAttr(id)}"><a href="#fn-${escapeAttr(safe)}">${escapeHtml(num)}</a></sup>`;
	});
}

/** One footnote definition block: leading number + body (plain text; Markdown round-trip strips the number on save). */
export function buildFootnoteDefinitionParagraphHtml(id: string, rawBody: string, displayNumOverride?: string): string {
	const safe = id.replace(/[^a-zA-Z0-9_-]/g, '_');
	const n = displayNumOverride ?? footnoteIdToDisplayNumber(id);
	const text = rawBody.replace(/\r\n/g, '\n');
	const lines = text.split('\n');
	const firstLine = escapeHtml(lines[0] ?? '');
	const rest = lines.slice(1).map(escapeHtml).join('<br>');
	if (!text.trim()) {
		return `<p class="writer-fn-def" data-footnote-id="${escapeAttr(id)}" id="fn-${escapeAttr(safe)}">${escapeHtml(n)}.&nbsp;</p>`;
	}
	const head = `${escapeHtml(n)}. ${firstLine}`;
	const inner = rest ? `${head}<br>${rest}` : head;
	return `<p class="writer-fn-def" data-footnote-id="${escapeAttr(id)}" id="fn-${escapeAttr(safe)}">${inner}</p>`;
}

export function renderFootnoteDefinitionsHtml(defs: FootnoteDefinition[]): string {
	if (defs.length === 0) {
		return '';
	}
	const parts = defs.map(d => buildFootnoteDefinitionParagraphHtml(d.id, d.text));
	return `\n${parts.join('')}\n`;
}
