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

/** Canonical `file:` URI string so webview + host + disk always match (e.g. casing on Windows). */
export function normalizeFileResourceUri(uriStr: string): string {
	try {
		const u = vscode.Uri.parse(uriStr);
		if (u.scheme === 'file') {
			return vscode.Uri.file(u.fsPath).toString();
		}
	} catch {
		// keep as-is
	}
	return uriStr;
}

export class CommentService implements vscode.Disposable {
	private readonly _onDidChange = new vscode.EventEmitter<void>();
	readonly onDidChange = this._onDidChange.event;

	private readonly _onDidRequestFocusComment = new vscode.EventEmitter<{ resource: string; commentId: string }>();
	readonly onDidRequestFocusComment = this._onDidRequestFocusComment.event;

	private readonly _onDidRequestClearActiveComment = new vscode.EventEmitter<{ resource: string }>();
	readonly onDidRequestClearActiveComment = this._onDidRequestClearActiveComment.event;

	/** Last file the user focused from the Comments panel — used to route "clear active highlight" to the right webview. */
	private _lastFocusedResource: string | undefined;

	/** Which comment card is shown as active in the Comments side bar (mirrors Caret active highlight). */
	private _activeCommentId: string | null = null;

	private _comments: WriterComment[] = [];
	private readonly _workspaceSub: vscode.Disposable;
	/** Side bar Comments webviews register here so updates work even if `onDidChange` ordering differs. */
	private readonly _commentsPanelRefresh = new Set<() => void>();
	/** Pending scroll/focus when the Caret custom editor is not ready yet. */
	private readonly _pendingFocusByResource = new Map<string, string>();

	constructor(private readonly _context: vscode.ExtensionContext) {
		this._load();
		this._workspaceSub = vscode.workspace.onDidChangeTextDocument(e => {
			this._reconcileDocument(e.document);
		});
	}

	dispose(): void {
		this._workspaceSub.dispose();
		this._onDidChange.dispose();
		this._onDidRequestFocusComment.dispose();
		this._onDidRequestClearActiveComment.dispose();
		this._commentsPanelRefresh.clear();
		this._pendingFocusByResource.clear();
	}

	/** Open/focus document + scroll to comment in the Caret editor (custom editor webview). */
	scheduleFocusComment(resource: string, commentId: string): void {
		const key = normalizeFileResourceUri(resource);
		this._lastFocusedResource = key;
		this._pendingFocusByResource.set(key, commentId);
		if (this._activeCommentId !== commentId) {
			this._activeCommentId = commentId;
			this._refreshCommentsPanelOnly();
		}
		this._onDidRequestFocusComment.fire({ resource: key, commentId });
	}

	getActiveCommentId(): string | null {
		return this._activeCommentId;
	}

	/** Sync active card in the Comments panel when the Caret webview changes selection / focus. */
	setActiveCommentFromEditor(commentId: string | null): void {
		if (this._activeCommentId === commentId) {
			return;
		}
		this._activeCommentId = commentId;
		this._refreshCommentsPanelOnly();
	}

	/** Clear the "active" comment highlight in the Caret editor for the last focused file (from panel background click). */
	requestClearActiveCommentHighlight(): void {
		if (this._lastFocusedResource === undefined) {
			return;
		}
		if (this._activeCommentId !== null) {
			this._activeCommentId = null;
			this._refreshCommentsPanelOnly();
		}
		this._onDidRequestClearActiveComment.fire({ resource: this._lastFocusedResource });
	}

	/** Returns and clears pending focus for this resource, if any (used when the editor becomes ready). */
	tryConsumePendingFocusComment(resource: string): string | undefined {
		const key = normalizeFileResourceUri(resource);
		const id = this._pendingFocusByResource.get(key);
		if (id !== undefined) {
			this._pendingFocusByResource.delete(key);
		}
		return id;
	}

	/** Clears pending focus only when it still matches `commentId` (used when the webview is already initialized). */
	consumePendingFocusIfMatches(resource: string, commentId: string): boolean {
		const key = normalizeFileResourceUri(resource);
		if (this._pendingFocusByResource.get(key) === commentId) {
			this._pendingFocusByResource.delete(key);
			return true;
		}
		return false;
	}

	getCommentById(id: string): WriterComment | undefined {
		return this._comments.find(c => c.id === id);
	}

	/** Register a callback to refresh the Comments side bar; invoked on every comment change. */
	registerCommentsPanelRefresh(callback: () => void): vscode.Disposable {
		this._commentsPanelRefresh.add(callback);
		try {
			callback();
		} catch {
			// ignore
		}
		return { dispose: () => this._commentsPanelRefresh.delete(callback) };
	}

	private _refreshCommentsPanelOnly(): void {
		for (const cb of this._commentsPanelRefresh) {
			try {
				cb();
			} catch {
				// ignore
			}
		}
	}

	private _emitChange(): void {
		this._onDidChange.fire();
		this._refreshCommentsPanelOnly();
	}

	getAll(): readonly WriterComment[] {
		return this._comments;
	}

	getForResource(resource: string): WriterComment[] {
		const key = normalizeFileResourceUri(resource);
		return this._comments.filter(c => c.resource === key);
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
			resource: normalizeFileResourceUri(input.resource),
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
		this._emitChange();
		return comment;
	}

	removeComment(id: string): void {
		const next = this._comments.filter(c => c.id !== id);
		if (next.length === this._comments.length) {
			return;
		}
		if (this._activeCommentId === id) {
			this._activeCommentId = null;
		}
		this._comments = next;
		this._persist();
		this._emitChange();
	}

	private _load(): void {
		const raw = this._context.workspaceState.get<WriterCommentsMemento | undefined>(STORAGE_KEY);
		if (raw?.version === 1 && Array.isArray(raw.comments)) {
			let migrated = false;
			this._comments = raw.comments.map(c => {
				const nr = normalizeFileResourceUri(c.resource);
				if (nr !== c.resource) {
					migrated = true;
				}
				return {
					...c,
					resource: nr,
					orphaned: c.orphaned ?? false,
				};
			});
			if (migrated) {
				void this._context.workspaceState.update(STORAGE_KEY, { version: 1, comments: this._comments });
			}
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
		const uriStr = normalizeFileResourceUri(doc.uri.toString());
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
			this._emitChange();
		}
	}
}

function findAllIndices(haystack: string, needle: string): number[] {
	if (needle.length === 0) {
		return [];
	}
	const out: number[] = [];
	let pos = 0;
	while (pos < haystack.length) {
		const i = haystack.indexOf(needle, pos);
		if (i < 0) {
			break;
		}
		out.push(i);
		pos = i + 1;
	}
	return out;
}

function pickNearest(indices: number[], hint: number): number {
	return indices.reduce((best, cur) =>
		Math.abs(cur - hint) < Math.abs(best - hint) ? cur : best,
	);
}

function findBestQuoteSubstringInNeighborhood(
	text: string,
	quote: string,
	hintStart: number,
	hintEnd: number,
): { start: number; end: number; quote: string } | undefined {
	const windowRadius = 8000;
	const wStart = Math.max(0, hintStart - windowRadius);
	const wEnd = Math.min(text.length, hintEnd + windowRadius);
	const window = text.slice(wStart, wEnd);
	let bestLen = 0;
	let bestStart = -1;
	for (let len = quote.length; len >= 3; len--) {
		for (let i = 0; i + len <= quote.length; i++) {
			const sub = quote.slice(i, i + len);
			const idx = window.indexOf(sub);
			if (idx >= 0 && len > bestLen) {
				bestLen = len;
				bestStart = wStart + idx;
			}
		}
	}
	if (bestStart >= 0 && bestLen >= 3) {
		const s = bestStart;
		const e = bestStart + bestLen;
		return { start: s, end: e, quote: text.slice(s, e) };
	}
	return undefined;
}

function reconcileAnchor(text: string, comment: WriterComment): WriterComment {
	const { start, end, quote } = comment.anchor;
	const n = text.length;

	if (!quote.length) {
		return { ...comment, orphaned: true };
	}

	// 1) Global exact match for full quote (unique or nearest to last-known start).
	const exactMatches = findAllIndices(text, quote);
	if (exactMatches.length === 1) {
		const s = exactMatches[0];
		return { ...comment, orphaned: false, anchor: { start: s, end: s + quote.length, quote } };
	}
	if (exactMatches.length > 1) {
		const s = pickNearest(exactMatches, start);
		return { ...comment, orphaned: false, anchor: { start: s, end: s + quote.length, quote } };
	}

	// 2) CRLF-normalized quote (document may use \r\n while anchor used \n).
	if (!quote.includes('\r\n') && quote.includes('\n')) {
		const q2 = quote.replace(/\n/g, '\r\n');
		const m2 = findAllIndices(text, q2);
		if (m2.length === 1) {
			const s = m2[0];
			return { ...comment, orphaned: false, anchor: { start: s, end: s + q2.length, quote: q2 } };
		}
		if (m2.length > 1) {
			const s = pickNearest(m2, start);
			return { ...comment, orphaned: false, anchor: { start: s, end: s + q2.length, quote: q2 } };
		}
	}

	// 3) Same UTF-16 span still valid: text was rewritten inside the original range (offsets unchanged).
	if (start >= 0 && end <= n && start < end) {
		const slice = text.slice(start, end);
		if (slice.length > 0) {
			return {
				...comment,
				orphaned: false,
				anchor: { start, end, quote: slice },
			};
		}
	}

	// 4) Longest substring of the stored quote near the last-known span (partial deletion / small moves).
	const neigh = findBestQuoteSubstringInNeighborhood(text, quote, start, end);
	if (neigh) {
		return { ...comment, orphaned: false, anchor: neigh };
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
