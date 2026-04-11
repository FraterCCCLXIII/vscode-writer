/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as vscode from 'vscode';
import { plainTextToRtf } from './rtfSerialize';
import { rtfToPlainText } from './rtfImport';
import type { FromWebview, ToWebview } from './protocol';
import { CommentService, quotesLooselyMatch, resolveCommentOffsets } from './commentService';
import { WriterSelectionStore } from './writerSelectionStore';

function isMarkdown(uri: vscode.Uri): boolean {
	return uri.path.toLowerCase().endsWith('.md');
}

function isRtf(uri: vscode.Uri): boolean {
	return uri.path.toLowerCase().endsWith('.rtf');
}

function stripBom(s: string): string {
	return s.replace(/^\uFEFF/, '');
}

/** CSP nonce: alphanumeric only (avoid `.` etc. in Date+Math.random nonce confusing parsers). */
function newCspNonce(): string {
	const hex = '0123456789ABCDEF';
	let s = '';
	for (let i = 0; i < 32; i++) {
		s += hex.charAt(Math.floor(Math.random() * 16));
	}
	return s;
}

function escapeHtmlAttr(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function mimeToExt(mime: string): string {
	const m = mime.toLowerCase();
	if (m.includes('png')) {
		return 'png';
	}
	if (m.includes('jpeg') || m.includes('jpg')) {
		return 'jpg';
	}
	if (m.includes('gif')) {
		return 'gif';
	}
	if (m.includes('webp')) {
		return 'webp';
	}
	if (m.includes('svg')) {
		return 'svg';
	}
	return 'png';
}

function sanitizeBasename(name: string): string {
	const s = name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
	return s || 'image';
}

function resolvePathRelativeToDocument(documentUri: vscode.Uri, relativePath: string): vscode.Uri {
	const dir = path.dirname(documentUri.fsPath);
	const resolved = path.normalize(path.join(dir, relativePath));
	return vscode.Uri.file(resolved);
}

export class WriterEditorProvider implements vscode.CustomTextEditorProvider {
	public static readonly viewType = 'vscode.writer.editor';

	constructor(
		private readonly _extensionUri: vscode.Uri,
		private readonly _selectionStore: WriterSelectionStore,
		private readonly _commentService: CommentService,
	) { }

	public async resolveCustomTextEditor(
		document: vscode.TextDocument,
		webviewPanel: vscode.WebviewPanel,
		_token: vscode.CancellationToken,
	): Promise<void> {
		const localRoots = [vscode.Uri.joinPath(this._extensionUri, 'media')];
		const wf = vscode.workspace.getWorkspaceFolder(document.uri);
		if (wf) {
			localRoots.push(wf.uri);
		}
		webviewPanel.webview.options = {
			enableScripts: true,
			localResourceRoots: localRoots,
		};

		webviewPanel.webview.html = this._getHtml(webviewPanel.webview);

		let applyingFromWebview = false;
		let ignoreNextDocumentChange = false;

		/** Re-read from the workspace so init matches disk (custom editor `document` can lag the first `ready`). */
		const postInitFromWorkspace = async () => {
			const doc = await vscode.workspace.openTextDocument(document.uri);
			const raw = stripBom(doc.getText());
			if (isMarkdown(document.uri)) {
				const msg: ToWebview = {
					type: 'init',
					format: 'markdown',
					payload: { markdown: raw },
					resource: document.uri.toString(),
				};
				void webviewPanel.webview.postMessage(msg);
			} else if (isRtf(document.uri)) {
				const plain = rtfToPlainText(raw);
				const msg: ToWebview = {
					type: 'init',
					format: 'rtf',
					payload: { plainText: plain },
					resource: document.uri.toString(),
				};
				void webviewPanel.webview.postMessage(msg);
			}
		};

		const applyDiskTextToDocument = async (newText: string): Promise<boolean> => {
			const doc = await vscode.workspace.openTextDocument(document.uri);
			const text = doc.getText();
			const fullRange = new vscode.Range(
				doc.positionAt(0),
				doc.positionAt(text.length),
			);
			applyingFromWebview = true;
			try {
				const edit = new vscode.WorkspaceEdit();
				edit.replace(document.uri, fullRange, newText);
				return await vscode.workspace.applyEdit(edit);
			} finally {
				applyingFromWebview = false;
			}
		};

		let inlineAiCts: vscode.CancellationTokenSource | undefined;
		const postToWebview = (msg: ToWebview) => {
			void webviewPanel.webview.postMessage(msg);
		};

		const postCommentsForResource = () => {
			const list = this._commentService.getForResource(document.uri.toString());
			const msg: ToWebview = {
				type: 'commentsForResource',
				resource: document.uri.toString(),
				comments: list.map(c => ({
					id: c.id,
					body: c.body,
					createdAt: c.createdAt,
					orphaned: c.orphaned,
					anchor: c.anchor,
				})),
			};
			void webviewPanel.webview.postMessage(msg);
		};

		const commentSub = this._commentService.onDidChange(() => {
			postCommentsForResource();
		});

		/** Bridge LSP diagnostics (e.g. Harper) into the webview — they do not paint on custom editors by default. */
		let diagDebounce: ReturnType<typeof setTimeout> | undefined;
		const pushDiagnostics = async () => {
			if (!isMarkdown(document.uri)) {
				return;
			}
			try {
				const doc = await vscode.workspace.openTextDocument(document.uri);
				const full = doc.getText();
				const diags = vscode.languages.getDiagnostics(document.uri);
				const items = diags.map(d => ({
					message: d.message,
					severity: d.severity,
					text: full.substring(doc.offsetAt(d.range.start), doc.offsetAt(d.range.end)),
				}));
				const msg: ToWebview = { type: 'diagnostics', items };
				void webviewPanel.webview.postMessage(msg);
			} catch {
				// ignore
			}
		};
		const scheduleDiagnostics = () => {
			if (diagDebounce) {
				clearTimeout(diagDebounce);
			}
			diagDebounce = setTimeout(() => {
				diagDebounce = undefined;
				void pushDiagnostics();
			}, 450);
		};

		const runInlineAi = async (prompt: string, selectionPlain: string, format: 'markdown' | 'rtf') => {
			inlineAiCts?.cancel();
			inlineAiCts?.dispose();
			inlineAiCts = new vscode.CancellationTokenSource();
			const token = inlineAiCts.token;
			try {
				const models = await vscode.lm.selectChatModels();
				if (token.isCancellationRequested) {
					return;
				}
				if (models.length === 0) {
					postToWebview({
						type: 'inlineAiError',
						message: vscode.l10n.t('No language models are available. Sign in to GitHub Copilot or configure a chat model.'),
					});
					return;
				}
				const model = models[0];
				const instruction =
					format === 'markdown'
						? [
							'Replace ONLY the selected passage. Reply with the replacement text only — no preamble, no explanation, no markdown code fences unless the replacement itself must contain them.',
							'',
							'Selected text:',
							'---',
							selectionPlain,
							'---',
							'',
							'Request:',
							prompt,
						].join('\n')
						: [
							'Replace ONLY the selected plain text. Reply with replacement plain text only — no preamble.',
							'',
							'Selected:',
							'---',
							selectionPlain,
							'---',
							'',
							'Request:',
							prompt,
						].join('\n');
				const userMessage = vscode.LanguageModelChatMessage.User(instruction);
				const response = await model.sendRequest([userMessage], {}, token);
				if (token.isCancellationRequested) {
					return;
				}
				for await (const chunk of response.text) {
					if (token.isCancellationRequested) {
						return;
					}
					postToWebview({ type: 'inlineAiDelta', text: chunk });
				}
				postToWebview({ type: 'inlineAiDone' });
			} catch (e) {
				if (token.isCancellationRequested) {
					return;
				}
				const err = e as { name?: string; message?: string };
				if (err?.name === 'Canceled' || err?.name === 'CancellationError') {
					return;
				}
				const messageText = err?.message ?? String(e);
				postToWebview({ type: 'inlineAiError', message: messageText });
			}
		};

		const sub = webviewPanel.webview.onDidReceiveMessage(async (message: FromWebview) => {
			switch (message.type) {
				case 'ready':
					void postInitFromWorkspace().then(() => {
						scheduleDiagnostics();
						postCommentsForResource();
						setTimeout(() => scheduleDiagnostics(), 1200);
					});
					break;
				case 'contentChanged': {
					let out: string;
					if (message.format === 'markdown') {
						out = message.markdown;
					} else {
						out = plainTextToRtf(message.plainText);
					}
					ignoreNextDocumentChange = true;
					const applied = await applyDiskTextToDocument(out);
					if (!applied) {
						ignoreNextDocumentChange = false;
					} else if (message.format === 'markdown') {
						scheduleDiagnostics();
					}
					break;
				}
				case 'selectionChanged':
					this._selectionStore.set(document.uri, message.text);
					break;
				case 'inlineAiRequest':
					void runInlineAi(message.prompt, message.selectionPlain, message.format);
					break;
				case 'inlineAiCancel':
					inlineAiCts?.cancel();
					break;
				case 'resolveImagePaths': {
					const map: Record<string, string> = {};
					for (const p of message.paths) {
						if (!p || p.startsWith('http') || p.startsWith('data:') || p.startsWith('vscode-webview-resource:')) {
							continue;
						}
						try {
							const abs = resolvePathRelativeToDocument(document.uri, p);
							const stat = await vscode.workspace.fs.stat(abs);
							if (stat.type === vscode.FileType.File) {
								map[p] = webviewPanel.webview.asWebviewUri(abs).toString();
							}
						} catch {
							// ignore missing or invalid paths
						}
					}
					const msg: ToWebview = { type: 'pathsResolved', map };
					void webviewPanel.webview.postMessage(msg);
					break;
				}
				case 'commentAdd': {
					try {
						const uri = vscode.Uri.parse(message.resource);
						const hasMdSnapshot =
							message.markdownSnapshot !== undefined &&
							message.start !== undefined &&
							message.end !== undefined;

						if (isMarkdown(uri) && hasMdSnapshot) {
							const snap = stripBom(message.markdownSnapshot!);
							// Always write the webview snapshot so disk matches the editor (debounced save may lag).
							ignoreNextDocumentChange = true;
							const appliedSnap = await applyDiskTextToDocument(snap);
							if (!appliedSnap) {
								ignoreNextDocumentChange = false;
							} else {
								scheduleDiagnostics();
							}
							const doc = await vscode.workspace.openTextDocument(uri);
							const full = stripBom(doc.getText());
							const pq = message.plainQuote;

							// Prefer search in synced file (handles CRLF vs LF; disambiguates with webview hint).
							const resolved = resolveCommentOffsets(
								full,
								message.selectionMarkdown,
								pq,
								message.start,
							);
							if (resolved) {
								this._commentService.addComment({
									resource: message.resource,
									start: resolved.start,
									end: resolved.end,
									quote: resolved.quote,
									body: message.body,
								});
								postCommentsForResource();
								break;
							}

							const start = message.start!;
							const end = message.end!;
							if (start >= 0 && end <= full.length && start <= end) {
								const slice = full.slice(start, end);
								if (pq.length === 0 || quotesLooselyMatch(slice, pq)) {
									this._commentService.addComment({
										resource: message.resource,
										start,
										end,
										quote: pq || slice,
										body: message.body,
									});
									postCommentsForResource();
									break;
								}
							}

							void vscode.window.showWarningMessage(
								vscode.l10n.t(
									'Could not locate the selection after syncing the document. Try again.',
								),
							);
							break;
						}

						if (isRtf(uri) && message.plainTextSnapshot !== undefined) {
							const rtfOut = plainTextToRtf(message.plainTextSnapshot);
							ignoreNextDocumentChange = true;
							const appliedRtf = await applyDiskTextToDocument(rtfOut);
							if (!appliedRtf) {
								ignoreNextDocumentChange = false;
							}
							const doc = await vscode.workspace.openTextDocument(uri);
							const full = stripBom(doc.getText());
							const resolved = resolveCommentOffsets(
								full,
								message.selectionMarkdown,
								message.plainQuote,
							);
							if (!resolved) {
								void vscode.window.showWarningMessage(
									vscode.l10n.t(
										'Could not locate the selection in the saved file. Save the document and try again.',
									),
								);
								break;
							}
							this._commentService.addComment({
								resource: message.resource,
								start: resolved.start,
								end: resolved.end,
								quote: resolved.quote,
								body: message.body,
							});
							postCommentsForResource();
							break;
						}

						const doc = await vscode.workspace.openTextDocument(uri);
						const full = stripBom(doc.getText());
						const resolved = resolveCommentOffsets(
							full,
							message.selectionMarkdown,
							message.plainQuote,
						);
						if (!resolved) {
							void vscode.window.showWarningMessage(
								vscode.l10n.t(
									'Could not locate the selection in the saved file. Save the document and try again.',
								),
							);
							break;
						}
						this._commentService.addComment({
							resource: message.resource,
							start: resolved.start,
							end: resolved.end,
							quote: resolved.quote,
							body: message.body,
						});
						postCommentsForResource();
					} catch {
						void vscode.window.showErrorMessage(
							vscode.l10n.t('Could not add comment for this document.'),
						);
					}
					break;
				}
				case 'saveImage': {
					const wsFolder = vscode.workspace.getWorkspaceFolder(document.uri);
					if (!wsFolder) {
						const err: ToWebview = {
							type: 'imageSaveError',
							message: 'Open a folder in the workspace to save images.',
						};
						void webviewPanel.webview.postMessage(err);
						break;
					}
					try {
						const mediaDir = vscode.Uri.joinPath(wsFolder.uri, 'Media');
						await vscode.workspace.fs.createDirectory(mediaDir);
						const ext = mimeToExt(message.mimeType);
						const hint = message.filenameHint?.replace(/\.[^.]+$/, '') ?? 'image';
						const base = sanitizeBasename(hint);
						const filename = `${base}-${Date.now()}.${ext}`;
						const fileUri = vscode.Uri.joinPath(mediaDir, filename);
						const buffer = Buffer.from(message.base64, 'base64');
						await vscode.workspace.fs.writeFile(fileUri, buffer);
						const rel = path.relative(path.dirname(document.uri.fsPath), fileUri.fsPath).replace(/\\/g, '/');
						const webviewSrc = webviewPanel.webview.asWebviewUri(fileUri).toString();
						const ok: ToWebview = {
							type: 'imageSaved',
							markdownPath: rel,
							webviewSrc,
							alt: '',
						};
						void webviewPanel.webview.postMessage(ok);
					} catch (e) {
						const err: ToWebview = {
							type: 'imageSaveError',
							message: `Could not save image: ${(e as Error)?.message ?? e}`,
						};
						void webviewPanel.webview.postMessage(err);
					}
					break;
				}
				default:
					break;
			}
		});

		const diagSub = vscode.languages.onDidChangeDiagnostics(e => {
			if (e.uris.some(u => u.toString() === document.uri.toString())) {
				scheduleDiagnostics();
			}
		});

		const docSub = vscode.workspace.onDidChangeTextDocument(e => {
			if (e.document.uri.toString() !== document.uri.toString()) {
				return;
			}
			if (applyingFromWebview) {
				return;
			}
			if (ignoreNextDocumentChange) {
				ignoreNextDocumentChange = false;
				return;
			}
			const raw = stripBom(e.document.getText());
			if (isMarkdown(document.uri)) {
				const msg: ToWebview = {
					type: 'documentChanged',
					format: 'markdown',
					payload: { markdown: raw },
					resource: document.uri.toString(),
				};
				void webviewPanel.webview.postMessage(msg);
			} else if (isRtf(document.uri)) {
				const plain = rtfToPlainText(raw);
				const msg: ToWebview = {
					type: 'documentChanged',
					format: 'rtf',
					payload: { plainText: plain },
					resource: document.uri.toString(),
				};
				void webviewPanel.webview.postMessage(msg);
			}
		});

		webviewPanel.onDidChangeViewState(e => {
			if (e.webviewPanel.active) {
				this._selectionStore.setFocusedUri(document.uri);
			}
		});

		webviewPanel.onDidDispose(() => {
			inlineAiCts?.cancel();
			inlineAiCts?.dispose();
			inlineAiCts = undefined;
			if (diagDebounce) {
				clearTimeout(diagDebounce);
				diagDebounce = undefined;
			}
			sub.dispose();
			commentSub.dispose();
			diagSub.dispose();
			docSub.dispose();
			this._selectionStore.clear(document.uri);
		});
	}

	private _getHtml(webview: vscode.Webview): string {
		const nonce = newCspNonce();
		const scriptUri = webview
			.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.js'))
			.toString();
		const cspSource = webview.cspSource;
		// script-src must be nonce-only: appending cspSource duplicates 'self' and breaks CSP parsing in
		// Chromium (inline bootstrap blocked → no acquireVsCodeApi → no ready / no saves). External scripts
		// with a matching nonce attribute are still allowed (same pattern as media-preview).
		const csp = [
			`default-src 'none'`,
			`style-src ${cspSource} 'unsafe-inline'`,
			`script-src 'nonce-${nonce}'`,
			`img-src ${cspSource} https: data:`,
			`font-src ${cspSource}`,
		].join('; ');

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta http-equiv="Content-Security-Policy" content="${escapeHtmlAttr(csp)}" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<title>Writer</title>
	<style>
		/* Reset VS Code-injected webview defaults (pre/index.html @layer vscode-default uses body { padding: 0 20px }). */
		html, body, #root { height: 100%; margin: 0; padding: 0; }
		body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); }
	</style>
</head>
<body>
	<div id="root"></div>
	<script nonce="${nonce}">globalThis.__writerVsCodeApi = acquireVsCodeApi();</script>
	<script nonce="${nonce}" type="module" src="${escapeHtmlAttr(scriptUri)}"></script>
</body>
</html>`;
	}
}
