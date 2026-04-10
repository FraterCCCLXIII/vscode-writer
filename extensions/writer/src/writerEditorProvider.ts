/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { plainTextToRtf } from './rtfSerialize';
import { rtfToPlainText } from './rtfImport';
import type { FromWebview, ToWebview } from './protocol';
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

export class WriterEditorProvider implements vscode.CustomTextEditorProvider {
	public static readonly viewType = 'vscode.writer.editor';

	constructor(
		private readonly _extensionUri: vscode.Uri,
		private readonly _selectionStore: WriterSelectionStore,
	) { }

	public async resolveCustomTextEditor(
		document: vscode.TextDocument,
		webviewPanel: vscode.WebviewPanel,
		_token: vscode.CancellationToken,
	): Promise<void> {
		webviewPanel.webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'media')],
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
					void postInitFromWorkspace();
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
				default:
					break;
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
			sub.dispose();
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
		html, body, #root { height: 100%; margin: 0; }
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
