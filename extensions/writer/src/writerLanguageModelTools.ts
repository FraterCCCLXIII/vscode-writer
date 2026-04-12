/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/** Must match `contributes.languageModelTools[].name` in package.json. */
export const WRITER_ADD_CARET_COMMENT_TOOL = 'writer_addCaretComment';

interface AddCaretCommentInput {
	readonly body: string;
}

/**
 * Registers {@link vscode.lm} tools so chat agents (e.g. Copilot in agent/tool mode) can add
 * Caret review comments via the same path as `vscode.writer.addComment`.
 */
export function registerWriterLanguageModelTools(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.lm.registerTool<AddCaretCommentInput>(WRITER_ADD_CARET_COMMENT_TOOL, {
			prepareInvocation: (options) => {
				const preview = typeof options.input.body === 'string' ? options.input.body.trim().slice(0, 120) : '';
				return {
					invocationMessage: vscode.l10n.t('Adding Caret comment: {0}', preview || '…'),
				};
			},
			invoke: async (options, _token) => {
				const body = typeof options.input.body === 'string' ? options.input.body.trim() : '';
				if (!body) {
					return new vscode.LanguageModelToolResult([
						new vscode.LanguageModelTextPart(
							vscode.l10n.t('The tool requires a non-empty `body` string (the comment text).'),
						),
					]);
				}
				await vscode.commands.executeCommand('vscode.writer.addComment', { body });
				return new vscode.LanguageModelToolResult([
					new vscode.LanguageModelTextPart(
						vscode.l10n.t(
							'Caret comment add was requested. If a warning appeared, open the file with the Caret editor (not the default text editor), focus it, select the passage to comment on, and run the tool again.',
						),
					),
				]);
			},
		}),
	);
}
