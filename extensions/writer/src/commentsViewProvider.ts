/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as vscode from 'vscode';
import { CommentService, type WriterComment } from './commentService';
import { WriterEditorProvider } from './writerEditorProvider';

export const WRITER_COMMENTS_VIEW_ID = 'writer.commentsPanel';
/** Same UI in the auxiliary (right) sidebar — discoverable when Secondary Side Bar is visible. */
export const WRITER_COMMENTS_VIEW_ID_RIGHT = 'writer.commentsPanel.right';

function escapeHtmlAttr(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** `showTextDocument` uses the default editor (often the built-in text editor); Caret must be opened explicitly. */
async function openResourceInCaret(uri: vscode.Uri): Promise<void> {
	const pathLower = uri.path.toLowerCase();
	if (pathLower.endsWith('.md') || pathLower.endsWith('.rtf')) {
		await vscode.commands.executeCommand('vscode.openWith', uri, WriterEditorProvider.viewType, {
			preview: false,
		});
		return;
	}
	const doc = await vscode.workspace.openTextDocument(uri);
	await vscode.window.showTextDocument(doc, { preview: false });
}

export class CommentsViewProvider implements vscode.WebviewViewProvider {
	constructor(
		private readonly _extensionUri: vscode.Uri,
		private readonly _commentService: CommentService,
	) { }

	resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	): void {
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'media')],
		};

		const scriptUri = webviewView.webview
			.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'commentsPanel.js'))
			.toString();

		const nonce = getNonce();
		webviewView.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webviewView.webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<title>Comments</title>
</head>
<body style="margin:0;padding:0;font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-foreground);background:var(--vscode-sideBar-background);">
	<div id="root"></div>
	<script nonce="${nonce}">globalThis.__writerCommentsApi = acquireVsCodeApi();</script>
	<script nonce="${nonce}" type="module" src="${escapeHtmlAttr(scriptUri)}"></script>
</body>
</html>`;

		const push = () => {
			const all = [...this._commentService.getAll()];
			all.sort((a, b) => b.createdAt - a.createdAt);
			void webviewView.webview.postMessage({
				type: 'update',
				comments: serializeForWebview(all),
				activeCommentId: this._commentService.getActiveCommentId(),
			});
		};

		webviewView.webview.onDidReceiveMessage(
			async (msg: { type?: string; id?: string; resource?: string }) => {
				if (msg?.type === 'focusComment' && typeof msg.id === 'string' && typeof msg.resource === 'string') {
					this._commentService.scheduleFocusComment(msg.resource, msg.id);
					try {
						const uri = vscode.Uri.parse(msg.resource);
						await openResourceInCaret(uri);
					} catch {
						void vscode.window.showErrorMessage(vscode.l10n.t('Could not open this document.'));
					}
					return;
				}
				if (msg?.type === 'open' && typeof msg.resource === 'string') {
					try {
						const uri = vscode.Uri.parse(msg.resource);
						await openResourceInCaret(uri);
					} catch {
						void vscode.window.showErrorMessage(vscode.l10n.t('Could not open this document.'));
					}
					return;
				}
				if (msg?.type === 'clearActiveComment') {
					this._commentService.requestClearActiveCommentHighlight();
					return;
				}
				if (msg?.type === 'remove' && typeof msg.id === 'string') {
					this._commentService.removeComment(msg.id);
					return;
				}
			},
		);

		const sub = this._commentService.registerCommentsPanelRefresh(push);
		webviewView.onDidDispose(() => sub.dispose());
	}
}

function serializeForWebview(comments: WriterComment[]) {
	return comments.map(c => ({
		id: c.id,
		resource: c.resource,
		label: basenameFromUri(c.resource),
		body: c.body,
		createdAt: c.createdAt,
		orphaned: c.orphaned ?? false,
		quotePreview: truncate(c.anchor.quote, 120),
	}));
}

function basenameFromUri(resource: string): string {
	try {
		return path.basename(vscode.Uri.parse(resource).fsPath);
	} catch {
		return resource;
	}
}

function truncate(s: string, max: number): string {
	const t = s.replace(/\s+/g, ' ').trim();
	if (t.length <= max) {
		return t;
	}
	return `${t.slice(0, max - 1)}…`;
}

function getNonce(): string {
	const hex = '0123456789ABCDEF';
	let s = '';
	for (let i = 0; i < 32; i++) {
		s += hex.charAt(Math.floor(Math.random() * 16));
	}
	return s;
}
