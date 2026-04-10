/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Editor } from '@tiptap/core';
import { marked } from 'marked';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';

type VsCodeApi = { postMessage: (msg: unknown) => void };

type Format = 'markdown' | 'rtf';

type Props = {
	open: boolean;
	onClose: () => void;
	editor: Editor;
	format: Format;
	vscode: VsCodeApi;
	output: string;
	busy: boolean;
	error: string | null;
	onRequestStart: () => void;
	onCancelStream: () => void;
};

const panel: CSSProperties = {
	position: 'absolute',
	left: 16,
	right: 16,
	bottom: 16,
	zIndex: 55,
	maxHeight: 'min(42vh, 360px)',
	display: 'flex',
	flexDirection: 'column',
	borderRadius: 10,
	border: '1px solid var(--vscode-editorWidget-border)',
	background: 'var(--vscode-editor-background)',
	boxShadow: '0 8px 24px var(--vscode-widget-shadow)',
	overflow: 'hidden',
};

function stripMarkdownFences(s: string): string {
	const t = s.trim();
	const fence = /^```(?:[\w+-]*)?\n([\s\S]*?)\n```$/m.exec(t);
	if (fence) {
		return fence[1].trim();
	}
	return t;
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function plainToEditorHtml(plain: string): string {
	const normalized = plain.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
	const paras = normalized.split(/\n\n+/);
	if (paras.length === 0 || (paras.length === 1 && paras[0] === '')) {
		return '<p></p>';
	}
	return paras
		.map(p => {
			const lines = p.split('\n');
			const inner = lines.map(escapeHtml).join('<br>');
			return `<p>${inner}</p>`;
		})
		.join('');
}

export function InlineAiPanel({
	open,
	onClose,
	editor,
	format,
	vscode,
	output,
	busy,
	error,
	onRequestStart,
	onCancelStream,
}: Props) {
	const [prompt, setPrompt] = useState('');
	const promptRef = useRef<HTMLTextAreaElement>(null);

	useEffect(() => {
		if (open) {
			setPrompt('');
			queueMicrotask(() => promptRef.current?.focus());
		}
	}, [open]);

	useEffect(() => {
		if (!open) {
			return;
		}
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				e.preventDefault();
				if (busy) {
					vscode.postMessage({ type: 'inlineAiCancel' });
					onCancelStream();
				}
				onClose();
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [open, busy, onClose, onCancelStream, vscode]);

	const send = useCallback(() => {
		const { from, to } = editor.state.selection;
		if (from === to || !prompt.trim()) {
			return;
		}
		const selectionPlain = editor.state.doc.textBetween(from, to, '\n');
		onRequestStart();
		vscode.postMessage({
			type: 'inlineAiRequest',
			prompt: prompt.trim(),
			selectionPlain,
			format,
		});
	}, [editor, prompt, format, vscode, onRequestStart]);

	const cancel = useCallback(() => {
		vscode.postMessage({ type: 'inlineAiCancel' });
		onCancelStream();
	}, [vscode, onCancelStream]);

	const apply = useCallback(() => {
		const { from, to } = editor.state.selection;
		if (from === to || !output.trim()) {
			return;
		}
		const raw = stripMarkdownFences(output);
		if (format === 'markdown') {
			const htmlParsed = marked.parse(raw, { async: false });
			const html = typeof htmlParsed === 'string' ? htmlParsed : '';
			editor.chain().focus().deleteRange({ from, to }).insertContentAt(from, html).run();
		} else {
			editor.chain().focus().deleteRange({ from, to }).insertContentAt(from, plainToEditorHtml(raw)).run();
		}
		onClose();
	}, [editor, output, format, onClose]);

	if (!open) {
		return null;
	}

	const canSend = !busy && prompt.trim().length > 0 && !editor.state.selection.empty;
	const canApply = !busy && output.trim().length > 0 && !editor.state.selection.empty;

	return (
		<div style={panel} role="dialog" aria-label="Inline AI">
			<div
				style={{
					padding: '10px 12px',
					borderBottom: '1px solid var(--vscode-editorWidget-border)',
					fontSize: 12,
					fontWeight: 600,
					color: 'var(--vscode-editor-foreground)',
				}}
			>
				Inline AI
			</div>
			<div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minHeight: 0 }}>
				<label style={{ fontSize: 12, color: 'var(--vscode-descriptionForeground, var(--vscode-editor-foreground))' }}>
					Prompt
					<textarea
						ref={promptRef}
						value={prompt}
						onChange={e => setPrompt(e.target.value)}
						rows={2}
						disabled={busy}
						placeholder="e.g. Rewrite this more concisely…"
						style={{
							display: 'block',
							width: '100%',
							marginTop: 4,
							boxSizing: 'border-box',
							resize: 'vertical',
							fontFamily: 'var(--vscode-font-family)',
							fontSize: 'var(--vscode-font-size)',
							color: 'var(--vscode-editor-foreground)',
							background: 'var(--vscode-input-background)',
							border: '1px solid var(--vscode-input-border)',
							borderRadius: 6,
							padding: 8,
						}}
					/>
				</label>
				<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
					<button
						type="button"
						disabled={!canSend}
						onClick={send}
						style={{
							padding: '6px 14px',
							borderRadius: 6,
							border: 'none',
							background: 'var(--vscode-button-background)',
							color: 'var(--vscode-button-foreground)',
							cursor: canSend ? 'pointer' : 'not-allowed',
							opacity: canSend ? 1 : 0.45,
						}}
					>
						Send
					</button>
					{busy ? (
						<button
							type="button"
							onClick={cancel}
							style={{
								padding: '6px 14px',
								borderRadius: 6,
								border: '1px solid var(--vscode-editorWidget-border)',
								background: 'transparent',
								color: 'var(--vscode-editor-foreground)',
								cursor: 'pointer',
							}}
						>
							Cancel
						</button>
					) : null}
					<button
						type="button"
						disabled={!canApply}
						onClick={apply}
						style={{
							padding: '6px 14px',
							borderRadius: 6,
							border: 'none',
							background: 'var(--vscode-button-secondaryBackground)',
							color: 'var(--vscode-button-secondaryForeground)',
							cursor: canApply ? 'pointer' : 'not-allowed',
							opacity: canApply ? 1 : 0.45,
						}}
					>
						Apply to selection
					</button>
					<button
						type="button"
						onClick={onClose}
						style={{
							padding: '6px 14px',
							borderRadius: 6,
							border: 'none',
							background: 'transparent',
							color: 'var(--vscode-descriptionForeground, var(--vscode-editor-foreground))',
							cursor: 'pointer',
						}}
					>
						Close
					</button>
				</div>
				{error ? (
					<div style={{ fontSize: 12, color: 'var(--vscode-errorForeground)' }} role="alert">
						{error}
					</div>
				) : null}
				<div
					style={{
						flex: 1,
						minHeight: 80,
						overflow: 'auto',
						fontSize: 13,
						lineHeight: 1.5,
						padding: 8,
						borderRadius: 6,
						background: 'var(--vscode-textCodeBlock-background)',
						color: 'var(--vscode-editor-foreground)',
						whiteSpace: 'pre-wrap',
					}}
					aria-live="polite"
				>
					{output || (busy ? '…' : 'Response appears here.')}
				</div>
			</div>
		</div>
	);
}
