/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

const STORAGE_KEY = 'writer.comments.v1';

export interface WriterCommentAnchor {
	/** UTF-16 offsets into `TextDocument.getText()` */
	start: number;
	end: number;
	/** Plain text at anchor when created — used to re-locate after edits */
	quote: string;
}

export interface WriterComment {
	id: string;
	resource: string;
	createdAt: number;
	body: string;
	anchor: WriterCommentAnchor;
	/** True when the quote could not be matched in the file */
	orphaned?: boolean;
}

interface WriterCommentsMemento {
	version: 1;
	comments: WriterComment[];
}

function newId(): string {
	if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
		return globalThis.crypto.randomUUID();
	}
	return `c-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export class CommentService implements vscode.Disposable {
	private readonly _onDidChange = new vscode.EventEmitter<void>();
	readonly onDidChange = this._onDidChange.event;

	private _comments: WriterComment[] = [];
	private readonly _workspaceSub: vscode.Disposable;

	constructor(private readonly _context: vscode.ExtensionContext) {
		this._load();
		this._workspaceSub = vscode.workspace.onDidChangeTextDocument(e => {
			this._reconcileDocument(e.document);
		});
	}

	dispose(): void {
		this._workspaceSub.dispose();
		this._onDidChange.dispose();
	}

	getAll(): readonly WriterComment[] {
		return this._comments;
	}

	getForResource(resource: string): WriterComment[] {
		return this._comments.filter(c => c.resource === resource);
	}

	addComment(input: {
		resource: string;
		start: number;
		end: number;
		quote: string;
		body: string;
	}): WriterComment {
		const comment: WriterComment = {
			id: newId(),
			resource: input.resource,
			createdAt: Date.now(),
			body: input.body.trim(),
			anchor: {
				start: input.start,
				end: input.end,
				quote: input.quote,
			},
			orphaned: false,
		};
		this._comments = [...this._comments, comment];
		this._persist();
		this._onDidChange.fire();
		return comment;
	}

	removeComment(id: string): void {
		const next = this._comments.filter(c => c.id !== id);
		if (next.length === this._comments.length) {
			return;
		}
		this._comments = next;
		this._persist();
		this._onDidChange.fire();
	}

	private _load(): void {
		const raw = this._context.workspaceState.get<WriterCommentsMemento | undefined>(STORAGE_KEY);
		if (raw?.version === 1 && Array.isArray(raw.comments)) {
			this._comments = raw.comments.map(c => ({
				...c,
				orphaned: c.orphaned ?? false,
			}));
		} else {
			this._comments = [];
		}
	}

	private _persist(): void {
		const memento: WriterCommentsMemento = { version: 1, comments: this._comments };
		void this._context.workspaceState.update(STORAGE_KEY, memento);
	}

	/** Re-anchor comments when a document's text changes (including edits from other editors). */
	private _reconcileDocument(doc: vscode.TextDocument): void {
		if (doc.uri.scheme !== 'file') {
			return;
		}
		const uriStr = doc.uri.toString();
		const relevant = this._comments.filter(c => c.resource === uriStr);
		if (relevant.length === 0) {
			return;
		}
		const text = doc.getText();
		let changed = false;
		const updated = this._comments.map(c => {
			if (c.resource !== uriStr) {
				return c;
			}
			const next = reconcileAnchor(text, c);
			if (next !== c) {
				changed = true;
			}
			return next;
		});
		if (changed) {
			this._comments = updated;
			this._persist();
			this._onDidChange.fire();
		}
	}
}

function reconcileAnchor(text: string, comment: WriterComment): WriterComment {
	const { start, end, quote } = comment.anchor;
	if (quote.length === 0) {
		return { ...comment, orphaned: true };
	}
	// Still valid?
	if (start >= 0 && end <= text.length && start <= end) {
		const slice = text.slice(start, end);
		if (slice === quote) {
			return comment.orphaned ? { ...comment, orphaned: false } : comment;
		}
	}
	// Unique substring match for quote
	const indices: number[] = [];
	let pos = 0;
	while (pos < text.length) {
		const i = text.indexOf(quote, pos);
		if (i < 0) {
			break;
		}
		indices.push(i);
		pos = i + 1;
	}
	if (indices.length === 1) {
		const s = indices[0];
		const e = s + quote.length;
		return {
			...comment,
			orphaned: false,
			anchor: { start: s, end: e, quote },
		};
	}
	return { ...comment, orphaned: true };
}

/**
 * Resolve UTF-16 offsets for a new comment using markdown and/or plain selection vs on-disk text.
 * Indices are always into `fullText` (never a normalized copy — CRLF/LF must stay consistent).
 * @param hintStart Prefer this UTF-16 offset when multiple plain matches exist (e.g. webview precompute).
 */
export function resolveCommentOffsets(
	fullText: string,
	selectionMarkdown: string,
	plainQuote: string,
	hintStart?: number,
): { start: number; end: number; quote: string } | undefined {
	const full = fullText;

	const md = selectionMarkdown.trim().length > 0 ? selectionMarkdown : '';
	if (md.length > 0) {
		let idx = full.indexOf(md);
		let used = md;
		if (idx < 0) {
			const t = md.trim();
			if (t.length > 0) {
				idx = full.indexOf(t);
				if (idx >= 0) {
					used = t;
				}
			}
		}
		if (idx >= 0) {
			return { start: idx, end: idx + used.length, quote: plainQuote || used };
		}
	}

	const plain = plainQuote;
	if (plain.length === 0) {
		return undefined;
	}

	function collectPlainMatches(searchPlain: string): number[] {
		const indices: number[] = [];
		let pos = 0;
		while (pos < full.length) {
			const i = full.indexOf(searchPlain, pos);
			if (i < 0) {
				break;
			}
			indices.push(i);
			pos = i + 1;
		}
		return indices;
	}

	const variants = [plain];
	if (plain.includes('\n') && !plain.includes('\r\n')) {
		variants.push(plain.replace(/\n/g, '\r\n'));
	}

	for (const variant of variants) {
		const indices = collectPlainMatches(variant);
		if (indices.length === 1) {
			const s = indices[0];
			return { start: s, end: s + variant.length, quote: plain };
		}
		if (indices.length > 1 && hintStart !== undefined) {
			const hinted = indices.reduce((best, cur) =>
				Math.abs(cur - hintStart) < Math.abs(best - hintStart) ? cur : best,
			);
			return { start: hinted, end: hinted + variant.length, quote: plain };
		}
		if (indices.length > 1) {
			const s = indices[0];
			return { start: s, end: s + variant.length, quote: plain };
		}
	}

	return undefined;
}

/** Compare selection slice to stored quote allowing CRLF/LF differences only. */
export function quotesLooselyMatch(slice: string, plainQuote: string): boolean {
	if (slice === plainQuote) {
		return true;
	}
	const a = slice.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
	const b = plainQuote.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
	return a === b;
}
