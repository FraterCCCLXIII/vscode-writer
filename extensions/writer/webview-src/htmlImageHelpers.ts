/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Collect relative image paths from HTML (for host → webview URI resolution). */
export function extractImgSrcsFromHtml(html: string): string[] {
	const srcs = new Set<string>();
	const re = /<img[^>]+\bsrc=["']([^"']+)["']/gi;
	let m: RegExpExecArray | null;
	while ((m = re.exec(html)) !== null) {
		const s = m[1];
		if (s && !s.startsWith('http') && !s.startsWith('data:') && !s.startsWith('vscode-webview-resource:')) {
			srcs.add(s);
		}
	}
	return [...srcs];
}

/** Rewrite img src to webview URIs and set data-md-src for Markdown round-trip. */
export function augmentImageHtml(html: string, map: Record<string, string>): string {
	const doc = new DOMParser().parseFromString(html, 'text/html');
	doc.querySelectorAll('img').forEach(img => {
		const src = img.getAttribute('src');
		if (!src) {
			return;
		}
		const resolved = map[src];
		if (resolved) {
			img.setAttribute('data-md-src', src);
			img.setAttribute('src', resolved);
		}
	});
	const out = doc.body?.innerHTML ?? '';
	// DOMParser edge cases can yield an empty body even when the fragment had content; keep the original HTML.
	if (!out.trim() && html.trim()) {
		return html;
	}
	return out;
}
