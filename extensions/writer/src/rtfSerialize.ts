/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Escape plain text for minimal RTF (best-effort round-trip for v1).
 */
function escapeRtfChar(ch: string): string {
	switch (ch) {
		case '\\':
			return '\\\\';
		case '{':
			return '\\{';
		case '}':
			return '\\}';
		default:
			return ch;
	}
}

function escapeRtfText(line: string): string {
	return line.split('').map(escapeRtfChar).join('');
}

/**
 * Convert plain text (newlines preserved) to a minimal valid RTF document.
 */
export function plainTextToRtf(text: string): string {
	const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
	const paragraphs = normalized.split(/\n\n+/);
	const rtfParts: string[] = ['{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Times New Roman;}}'];
	for (const para of paragraphs) {
		const lines = para.split('\n');
		rtfParts.push('\\pard ');
		for (let i = 0; i < lines.length; i++) {
			if (i > 0) {
				rtfParts.push('\\line ');
			}
			rtfParts.push(escapeRtfText(lines[i]!));
		}
		rtfParts.push('\\par ');
	}
	rtfParts.push('}');
	return rtfParts.join('');
}
