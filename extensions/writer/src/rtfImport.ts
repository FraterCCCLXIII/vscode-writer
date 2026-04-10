/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Best-effort RTF → plain text for v1 (no external parser dependency).
 */
export function rtfToPlainText(rtf: string): string {
	let t = rtf.replace(/\{\\\*[^}]*\}/g, '');
	t = t.replace(/\\par[d]?\s*/gi, '\n\n');
	t = t.replace(/\\line\s*/gi, '\n');
	t = t.replace(/\\tab\s*/gi, '\t');
	t = t.replace(/\\'([0-9a-fA-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
	t = t.replace(/\\u(-?\d+)\s*\??/g, (_, d: string) => {
		const code = parseInt(d, 10);
		return String.fromCharCode(code < 0 ? code + 65536 : code);
	});
	t = t.replace(/\\[a-zA-Z]+-?\d*\s*?/g, '');
	t = t.replace(/[{}]/g, ' ');
	t = t.replace(/[ \t]+\n/g, '\n');
	t = t.replace(/\n{3,}/g, '\n\n');
	return t.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
}
