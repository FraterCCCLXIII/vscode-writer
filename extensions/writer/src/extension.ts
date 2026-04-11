/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { CommentService } from './commentService';
import {
	CommentsViewProvider,
	WRITER_COMMENTS_VIEW_ID,
	WRITER_COMMENTS_VIEW_ID_RIGHT,
} from './commentsViewProvider';
import { WriterEditorProvider } from './writerEditorProvider';
import { WriterSelectionStore } from './writerSelectionStore';

const CHAT_OPEN = 'workbench.action.chat.open';

/** Chat resource context provider id — keep in sync with package.json activationEvents. */
export const WRITER_CHAT_CONTEXT_PROVIDER_ID = 'writerDocument';

export function activate(context: vscode.ExtensionContext): void {
	const selectionStore = new WriterSelectionStore();
	const commentService = new CommentService(context);
	context.subscriptions.push(commentService);

	const provider = new WriterEditorProvider(context.extensionUri, selectionStore, commentService);
	context.subscriptions.push(
		vscode.window.registerCustomEditorProvider(WriterEditorProvider.viewType, provider, {
			webviewOptions: { retainContextWhenHidden: true },
		}),
	);

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			WRITER_COMMENTS_VIEW_ID,
			new CommentsViewProvider(context.extensionUri, commentService),
			{ webviewOptions: { retainContextWhenHidden: true } },
		),
		vscode.window.registerWebviewViewProvider(
			WRITER_COMMENTS_VIEW_ID_RIGHT,
			new CommentsViewProvider(context.extensionUri, commentService),
			{ webviewOptions: { retainContextWhenHidden: true } },
		),
	);

	const docSelector: vscode.DocumentSelector = [
		{ scheme: 'file', pattern: '**/*.md' },
		{ scheme: 'file', pattern: '**/*.rtf' },
	];

	context.subscriptions.push(
		vscode.chat.registerChatResourceContextProvider(
			docSelector,
			WRITER_CHAT_CONTEXT_PROVIDER_ID,
			{
				provideResourceChatContext: async (options, _token) => {
					const base = options.resource.path.split('/').pop() ?? options.resource.fsPath;
					let docBody: string;
					try {
						const doc = await vscode.workspace.openTextDocument(options.resource);
						docBody = doc.getText();
					} catch {
						return undefined;
					}
					const selected = selectionStore.get(options.resource)?.trim();
					let value = `## Writer document (${base})\n${docBody}`;
					if (selected) {
						value += `\n\n## Current selection\n${selected}`;
					}
					const modelDescription = selected
						? vscode.l10n.t('Rich Writer document for this file. When a "Current selection" section is present, change only that span (rewrite or replace inline). Do not rewrite the whole document unless the user clearly asks for a full-document pass. Prefer minimal, localized edits.')
						: vscode.l10n.t('Rich Writer document for this file. Prefer localized edits when the user references a specific passage; do not rewrite the whole document unless the user explicitly asks.');
					return {
						label: vscode.l10n.t('Writer ({0})', base),
						resourceUri: options.resource,
						modelDescription,
						value,
					};
				},
				resolveResourceChatContext: (ctx, _token) => ctx,
			},
		),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('vscode.writer.showComments', async () => {
			await vscode.commands.executeCommand('workbench.action.focusSideBar');
			await vscode.commands.executeCommand('workbench.view.extension.writer-sidebar');
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('vscode.writer.showCommentsAuxiliary', async () => {
			await vscode.commands.executeCommand('workbench.action.focusAuxiliaryBar');
			await vscode.commands.executeCommand('workbench.view.extension.writer-secondary');
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('vscode.writer.openChatWithSelection', async () => {
			const text = selectionStore.getFocusedSelection();
			if (!text?.trim()) {
				void vscode.window.showInformationMessage(vscode.l10n.t('Focus the Rich Writer editor and select text to reference in chat.'));
				return;
			}
			await vscode.commands.executeCommand(CHAT_OPEN);
		}),
	);
}

export function deactivate(): void { }
