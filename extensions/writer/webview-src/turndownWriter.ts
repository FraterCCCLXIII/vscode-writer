/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

/**
 * Format an image destination for Markdown so parsers (marked / GFM) emit real `<img>` nodes.
 * Unescaped whitespace in `![](path)` is not parsed as an image — use `![](<path>)` instead.
 */
function formatMarkdownImageDestination(dest: string): string {
	const d = dest.trim();
	if (!d) {
		return d;
	}
	if (/\s/.test(d)) {
		return `<${d}>`;
	}
	return d;
}

export function createWriterTurndown(): TurndownService {
	const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
	td.use(gfm);

	td.addRule('writerImage', {
		filter: 'img',
		replacement(_content, node) {
			const el = node as HTMLElement;
			const mdSrc = el.getAttribute('data-md-src') || el.getAttribute('src') || '';
			const alt = el.getAttribute('alt') || '';
			return `![${alt}](${formatMarkdownImageDestination(mdSrc)})`;
		},
	});

	td.addRule('writerFootnoteRef', {
		filter(node) {
			return (
				node.nodeType === 1 &&
				(node as HTMLElement).nodeName === 'SUP' &&
				(node as HTMLElement).classList.contains('writer-fn-ref')
			);
		},
		replacement(_content, node) {
			const id = (node as HTMLElement).getAttribute('data-footnote-id') || '';
			return `[^${id}]`;
		},
	});

	td.addRule('writerTextAlign', {
		filter(node) {
			if (node.nodeType !== 1) {
				return false;
			}
			const el = node as HTMLElement;
			const style = el.getAttribute('style') || '';
			if (!/text-align:\s*(left|center|right)/.test(style)) {
				return false;
			}
			return ['P', 'H1', 'H2', 'H3'].includes(el.tagName);
		},
		replacement(_content, node) {
			return `\n${(node as HTMLElement).outerHTML}\n`;
		},
	});

	return td;
}

/** Shared instance for Markdown serialization. */
export const writerTurndown = createWriterTurndown();
