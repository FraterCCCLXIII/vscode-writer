/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as vscode from 'vscode';
import { plainTextToRtf } from './rtfSerialize';
import { rtfToPlainText } from './rtfImport';
import type { FromWebview, ToWebview } from './protocol';
import { CommentService, normalizeFileResourceUri, quotesLooselyMatch, resolveCommentOffsets } from './commentService';
import { registerWriterPanel, unregisterWriterPanel } from './writerPanelRegistry';
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
		registerWriterPanel(document.uri, webviewPanel);

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
		let writeNextCts: vscode.CancellationTokenSource | undefined;
		const postToWebview = (msg: ToWebview) => {
			void webviewPanel.webview.postMessage(msg);
		};

		const notifyCommentAddedUi = () => {
			const open = vscode.l10n.t('Open Comments');
			void vscode.window.showInformationMessage(vscode.l10n.t('Comment added.'), open).then(selection => {
				if (selection === open) {
					void vscode.commands.executeCommand('vscode.writer.showComments');
				}
			});
		};

		const postCommentsForResource = () => {
			const resourceKey = normalizeFileResourceUri(document.uri.toString());
			const list = this._commentService.getForResource(resourceKey);
			const msg: ToWebview = {
				type: 'commentsForResource',
				resource: resourceKey,
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

		/** True after first `ready` + `postInitFromWorkspace` completes — avoids focus before doc is applied. */
		let hostEditorReady = false;

		const focusSub = this._commentService.onDidRequestFocusComment(ev => {
			if (normalizeFileResourceUri(document.uri.toString()) !== ev.resource) {
				return;
			}
			if (!hostEditorReady) {
				return;
			}
			if (this._commentService.consumePendingFocusIfMatches(document.uri.toString(), ev.commentId)) {
				const c = this._commentService.getCommentById(ev.commentId);
				const msg: ToWebview = {
					type: 'focusComment',
					commentId: ev.commentId,
					quote: c?.anchor.quote,
				};
				void webviewPanel.webview.postMessage(msg);
			}
		});

		const clearActiveSub = this._commentService.onDidRequestClearActiveComment(ev => {
			if (normalizeFileResourceUri(document.uri.toString()) !== ev.resource) {
				return;
			}
			if (!hostEditorReady) {
				return;
			}
			const msg: ToWebview = { type: 'clearActiveComment' };
			void webviewPanel.webview.postMessage(msg);
		});

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

		const writeNextTools: vscode.LanguageModelChatTool[] = [
			{
				name: 'read_file',
				description: 'Read the contents of a file in the workspace. Use this to pull in outlines, research notes, chapter drafts, or any reference material that would help you continue writing.',
				inputSchema: {
					type: 'object',
					properties: {
						path: { type: 'string', description: 'Relative path to the file within the workspace.' },
						maxChars: { type: 'number', description: 'Maximum characters to return. Defaults to 4000.' },
					},
					required: ['path'],
				},
			},
			{
				name: 'search_workspace',
				description: 'Search across all documents in the workspace for a keyword or phrase. Returns matching snippets with filenames. Use this to find relevant passages about a topic.',
				inputSchema: {
					type: 'object',
					properties: {
						query: { type: 'string', description: 'The keyword or phrase to search for.' },
					},
					required: ['query'],
				},
			},
		];

		const gatherWorkspaceFileTree = async (): Promise<string> => {
			const folder = vscode.workspace.getWorkspaceFolder(document.uri);
			if (!folder) {
				return '(no workspace folder open)';
			}
			const maxFiles = 100;
			const files = await vscode.workspace.findFiles(
				new vscode.RelativePattern(folder, '**/*.{md,rtf,txt}'),
				'**/node_modules/**',
				maxFiles + 1,
			);
			const lines = files
				.slice(0, maxFiles)
				.map(f => vscode.workspace.asRelativePath(f, false))
				.sort();
			if (files.length > maxFiles) {
				lines.push(`... and ${files.length - maxFiles} more files`);
			}
			return lines.join('\n') || '(no .md, .rtf, or .txt files found)';
		};

		const fulfillWriteNextTool = async (toolName: string, input: Record<string, unknown>): Promise<string> => {
			const folder = vscode.workspace.getWorkspaceFolder(document.uri);
			if (!folder) {
				return 'No workspace folder open.';
			}
			switch (toolName) {
				case 'read_file': {
					const relPath = String(input.path ?? '');
					if (!relPath) {
						return 'Error: path is required.';
					}
					try {
						const fileUri = vscode.Uri.joinPath(folder.uri, relPath);
						const doc = await vscode.workspace.openTextDocument(fileUri);
						const text = doc.getText();
						const max = typeof input.maxChars === 'number' ? input.maxChars : 4000;
						return text.length > max ? text.slice(0, max) + '\n...(truncated)' : text;
					} catch {
						return `Error: could not read "${relPath}".`;
					}
				}
				case 'search_workspace': {
					const query = String(input.query ?? '').toLowerCase();
					if (!query) {
						return 'Error: query is required.';
					}
					const files = await vscode.workspace.findFiles(
						new vscode.RelativePattern(folder, '**/*.{md,rtf,txt}'),
						'**/node_modules/**',
						50,
					);
					const snippets: string[] = [];
					for (const f of files) {
						if (snippets.length >= 5) {
							break;
						}
						try {
							const doc = await vscode.workspace.openTextDocument(f);
							const text = doc.getText();
							const idx = text.toLowerCase().indexOf(query);
							if (idx >= 0) {
								const start = Math.max(0, idx - 200);
								const end = Math.min(text.length, idx + query.length + 200);
								const rel = vscode.workspace.asRelativePath(f, false);
								snippets.push(`### ${rel}\n...${text.slice(start, end)}...`);
							}
						} catch {
							// skip unreadable files
						}
					}
					return snippets.length > 0 ? snippets.join('\n\n') : 'No results found.';
				}
				default:
					return `Unknown tool: ${toolName}`;
			}
		};

		const MAX_TOOL_ROUNDS = 5;

		const runWriteNext = async (beforeContext: string, afterContext: string, _format: 'markdown' | 'rtf') => {
			writeNextCts?.cancel();
			writeNextCts?.dispose();
			writeNextCts = new vscode.CancellationTokenSource();
			const token = writeNextCts.token;
			try {
				const models = await vscode.lm.selectChatModels();
				if (token.isCancellationRequested) {
					return;
				}
				if (models.length === 0) {
					postToWebview({
						type: 'writeNextError',
						message: vscode.l10n.t('No language models are available. Sign in to GitHub Copilot or configure a chat model.'),
					});
					return;
				}
				const model = models[0];

				postToWebview({ type: 'writeNextStatus', message: vscode.l10n.t('Preparing...') });
				const fileTree = await gatherWorkspaceFileTree();
				if (token.isCancellationRequested) {
					return;
				}

				const instruction = [
					'You are a writing assistant continuing a document. Match the existing style, tone, and formatting.',
					'',
					'Here are the files in this project:',
					'---',
					fileTree,
					'---',
					'',
					'You have tools to read any of these files or search across them.',
					'If the text references specific topics, characters, facts, or terminology, use read_file or search_workspace to look them up.',
					'If the text is casual or self-contained and no references are needed, skip tools and write directly.',
					'',
					'## Current document -- before cursor:',
					beforeContext,
					'',
					'## Current document -- after cursor (do not repeat):',
					afterContext,
					'',
					'Write 1-3 natural paragraphs continuing from where the "before" text ends.',
					'Reply with ONLY the new text -- no preamble, no explanation.',
				].join('\n');

				const messages: vscode.LanguageModelChatMessage[] = [
					vscode.LanguageModelChatMessage.User(instruction),
				];
				const requestOptions: vscode.LanguageModelChatRequestOptions = {
					tools: writeNextTools,
					toolMode: vscode.LanguageModelChatToolMode.Auto,
				};

				for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
					const response = await model.sendRequest(messages, requestOptions, token);
					if (token.isCancellationRequested) {
						return;
					}

					const assistantParts: (vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart)[] = [];
					let hasToolCalls = false;

					for await (const chunk of response.stream) {
						if (token.isCancellationRequested) {
							return;
						}
						if (chunk instanceof vscode.LanguageModelTextPart) {
							assistantParts.push(chunk);
							postToWebview({ type: 'writeNextDelta', text: chunk.value });
						} else if (chunk instanceof vscode.LanguageModelToolCallPart) {
							hasToolCalls = true;
							assistantParts.push(chunk);
						}
					}

					if (!hasToolCalls) {
						postToWebview({ type: 'writeNextDone' });
						return;
					}

					messages.push(vscode.LanguageModelChatMessage.Assistant(assistantParts));

					for (const part of assistantParts) {
						if (!(part instanceof vscode.LanguageModelToolCallPart)) {
							continue;
						}
						const toolInput = part.input as Record<string, unknown>;
						const label = part.name === 'read_file'
							? vscode.l10n.t('Reading {0}...', String(toolInput.path ?? ''))
							: vscode.l10n.t('Searching for "{0}"...', String(toolInput.query ?? ''));
						postToWebview({ type: 'writeNextStatus', message: label });

						const result = await fulfillWriteNextTool(part.name, toolInput);
						if (token.isCancellationRequested) {
							return;
						}
						messages.push(
							vscode.LanguageModelChatMessage.User([
								new vscode.LanguageModelToolResultPart(part.callId, [
									new vscode.LanguageModelTextPart(result),
								]),
							]),
						);
					}
				}

				postToWebview({ type: 'writeNextDone' });
			} catch (e) {
				if (token.isCancellationRequested) {
					return;
				}
				const err = e as { name?: string; message?: string };
				if (err?.name === 'Canceled' || err?.name === 'CancellationError') {
					return;
				}
				const messageText = err?.message ?? String(e);
				postToWebview({ type: 'writeNextError', message: messageText });
			}
		};

		const sub = webviewPanel.webview.onDidReceiveMessage(async (message: FromWebview) => {
			switch (message.type) {
				case 'ready':
					void postInitFromWorkspace().then(() => {
						scheduleDiagnostics();
						postCommentsForResource();
						setTimeout(() => scheduleDiagnostics(), 1200);
						hostEditorReady = true;
						const pending = this._commentService.tryConsumePendingFocusComment(document.uri.toString());
						if (pending) {
							const c = this._commentService.getCommentById(pending);
							setTimeout(() => {
								const msg: ToWebview = {
									type: 'focusComment',
									commentId: pending,
									quote: c?.anchor.quote,
								};
								void webviewPanel.webview.postMessage(msg);
							}, 80);
						}
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
				case 'activeCommentChanged':
					this._commentService.setActiveCommentFromEditor(message.commentId);
					break;
				case 'inlineAiRequest':
					void runInlineAi(message.prompt, message.selectionPlain, message.format);
					break;
				case 'inlineAiCancel':
					inlineAiCts?.cancel();
					break;
				case 'writeNextRequest':
					void runWriteNext(message.beforeContext, message.afterContext, message.format);
					break;
				case 'writeNextCancel':
					writeNextCts?.cancel();
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
								notifyCommentAddedUi();
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
									notifyCommentAddedUi();
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
							notifyCommentAddedUi();
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
						notifyCommentAddedUi();
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
				case 'agentActionFailed': {
					if (typeof message.message === 'string' && message.message.length > 0) {
						void vscode.window.showWarningMessage(message.message);
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
			unregisterWriterPanel(document.uri);
			inlineAiCts?.cancel();
			inlineAiCts?.dispose();
			inlineAiCts = undefined;
			if (diagDebounce) {
				clearTimeout(diagDebounce);
				diagDebounce = undefined;
			}
			sub.dispose();
			commentSub.dispose();
			focusSub.dispose();
			clearActiveSub.dispose();
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
		html {
			height: 100%;
			margin: 0;
			padding: 0;
			overflow: hidden;
		}
		body {
			height: 100%;
			margin: 0;
			padding: 0;
			min-height: 0;
			/* Host styles can restore overflow; keep a single scroll region in the React tree (.writer-editor-scroll). */
			overflow: hidden !important;
			font-family: var(--vscode-font-family);
			font-size: var(--vscode-font-size);
			color: var(--vscode-editor-foreground);
			background: var(--vscode-editor-background);
		}
		#root {
			height: 100%;
			margin: 0;
			padding: 0;
			min-height: 0;
			overflow: hidden;
			display: flex;
			flex-direction: column;
			box-sizing: border-box;
		}
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
