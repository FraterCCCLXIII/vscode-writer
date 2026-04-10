/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { EditorContent, useEditor } from '@tiptap/react';
import type { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Underline from '@tiptap/extension-underline';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { marked } from 'marked';
import TurndownService from 'turndown';
import { Toolbar } from './toolbar';
import GlobalDragHandle from './global-drag-handle';
import { SelectionBubbleMenu } from './SelectionBubbleMenu';
import { InlineAiPanel } from './InlineAiPanel';
import { WRITER_THEME_STYLES } from './writerThemeStyles';

type VsCodeApi = { postMessage: (msg: unknown) => void };

type HostToWebview =
	| { type: 'init'; format: 'markdown'; payload: { markdown: string }; resource: string }
	| { type: 'init'; format: 'rtf'; payload: { plainText: string }; resource: string }
	| { type: 'documentChanged'; format: 'markdown'; payload: { markdown: string }; resource: string }
	| { type: 'documentChanged'; format: 'rtf'; payload: { plainText: string }; resource: string }
	| { type: 'inlineAiDelta'; text: string }
	| { type: 'inlineAiDone' }
	| { type: 'inlineAiError'; message: string };

function getVsCode(): VsCodeApi {
	const w = globalThis as unknown as { __writerVsCodeApi?: VsCodeApi };
	if (!w.__writerVsCodeApi) {
		throw new Error('VS Code API unavailable');
	}
	return w.__writerVsCodeApi;
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function plainTextToEditorHtml(plain: string): string {
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

function markdownToHtml(md: string): string {
	const result = marked.parse(md, { async: false });
	return typeof result === 'string' ? result : '';
}

/** When marked HTML parses to an empty TipTap doc (unsupported nodes, etc.), show the source as paragraphs. */
function markdownPlainFallbackAsHtml(md: string): string {
	const t = md.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
	if (!t.trim()) {
		return '<p></p>';
	}
	return t
		.split(/\n{2,}/)
		.map(block => {
			const lines = block.split('\n');
			const inner = lines.map(escapeHtml).join('<br>');
			return `<p>${inner || '<br>'}</p>`;
		})
		.join('');
}

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });

function debounce(fn: () => void, ms: number): () => void {
	let t: ReturnType<typeof setTimeout> | undefined;
	return () => {
		if (t) {
			clearTimeout(t);
		}
		t = setTimeout(() => {
			fn();
			t = undefined;
		}, ms);
	};
}

function WriterApp() {
	const vscodeRef = useRef<VsCodeApi | null>(null);
	const formatRef = useRef<'markdown' | 'rtf'>('markdown');
	const editorRef = useRef<Editor | null>(null);
	/** False until host `init` / `documentChanged` has been applied — avoids empty doc overwriting disk on mount. */
	const canPushToHostRef = useRef(false);

	const pushContent = useCallback(() => {
		if (!canPushToHostRef.current) {
			return;
		}
		const ed = editorRef.current;
		const vscode = vscodeRef.current;
		if (!ed || ed.isDestroyed || !vscode) {
			return;
		}
		if (formatRef.current === 'markdown') {
			const html = ed.getHTML();
			const md = turndown.turndown(html);
			vscode.postMessage({ type: 'contentChanged', format: 'markdown', markdown: md });
		} else {
			const plain = ed.getText();
			vscode.postMessage({ type: 'contentChanged', format: 'rtf', plainText: plain });
		}
	}, []);

	const pushSelection = useCallback(() => {
		const ed = editorRef.current;
		const vscode = vscodeRef.current;
		if (!ed || ed.isDestroyed || !vscode) {
			return;
		}
		const { from, to } = ed.state.selection;
		const text = ed.state.doc.textBetween(from, to, '\n');
		vscode.postMessage({ type: 'selectionChanged', text });
	}, []);

	const debouncedPushRef = useRef(debounce(() => pushContent(), 400));
	const debouncedSelectionRef = useRef(debounce(() => pushSelection(), 150));

	const [inlineAiOpen, setInlineAiOpen] = useState(false);
	const [inlineAiOutput, setInlineAiOutput] = useState('');
	const [inlineAiBusy, setInlineAiBusy] = useState(false);
	const [inlineAiError, setInlineAiError] = useState<string | null>(null);
	const [docFormat, setDocFormat] = useState<'markdown' | 'rtf'>('markdown');

	const editor = useEditor({
		extensions: [
			StarterKit.configure({
				headingLevels: [1, 2, 3],
				gapcursor: false,
				dropcursor: { color: 'var(--vscode-focusBorder)', width: 3 },
			}),
			Placeholder.configure({ placeholder: 'Start writing…' }),
			Underline,
			TaskList.configure({
				HTMLAttributes: { class: 'writer-task-list' },
			}),
			TaskItem.configure({
				HTMLAttributes: { class: 'writer-task-item' },
				nested: true,
			}),
			GlobalDragHandle,
		],
		content: '<p></p>',
		immediatelyRender: false,
		onUpdate: () => debouncedPushRef.current(),
		onSelectionUpdate: () => debouncedSelectionRef.current(),
	});

	editorRef.current = editor;

	useEffect(() => {
		debouncedPushRef.current = debounce(() => pushContent(), 400);
		debouncedSelectionRef.current = debounce(() => pushSelection(), 150);
	}, [pushContent, pushSelection]);

	useEffect(() => {
		if (!editor || editor.isDestroyed) {
			return;
		}

		let vscode: VsCodeApi;
		try {
			vscodeRef.current = getVsCode();
			vscode = vscodeRef.current;
		} catch {
			return;
		}

		const onMessage = (event: MessageEvent<HostToWebview>) => {
			const msg = event.data;
			if (!msg || typeof msg !== 'object') {
				return;
			}
			if (msg.type !== 'init' && msg.type !== 'documentChanged') {
				return;
			}
			// EditorContent attaches the ProseMirror view after paint; applying in the same tick can no-op.
			requestAnimationFrame(() => {
				const ed = editorRef.current;
				if (!ed || ed.isDestroyed) {
					return;
				}
				canPushToHostRef.current = false;
				if (msg.format === 'markdown') {
					formatRef.current = 'markdown';
					setDocFormat('markdown');
					const md = msg.payload.markdown.replace(/^\uFEFF/, '');
					const html = markdownToHtml(md);
					ed.chain().setContent(html, false).run();
					const sourceNonEmpty = md.trim().length > 0;
					const editorHasNoText = ed.getText().trim().length === 0;
					if (sourceNonEmpty && editorHasNoText) {
						ed.chain().setContent(markdownPlainFallbackAsHtml(md), false).run();
					}
				} else {
					formatRef.current = 'rtf';
					setDocFormat('rtf');
					const plain = msg.payload.plainText.replace(/^\uFEFF/, '');
					let html = plainTextToEditorHtml(plain);
					ed.chain().setContent(html, false).run();
					const sourceNonEmpty = plain.trim().length > 0;
					const editorHasNoText = ed.getText().trim().length === 0;
					if (sourceNonEmpty && editorHasNoText) {
						html = markdownPlainFallbackAsHtml(plain);
						ed.chain().setContent(html, false).run();
					}
				}
				queueMicrotask(() => {
					canPushToHostRef.current = true;
				});
			});
		};
		window.addEventListener('message', onMessage);
		vscode.postMessage({ type: 'ready' });

		return () => window.removeEventListener('message', onMessage);
	}, [editor]);

	useEffect(() => {
		if (inlineAiOpen) {
			setInlineAiOutput('');
			setInlineAiError(null);
			setInlineAiBusy(false);
		}
	}, [inlineAiOpen]);

	useEffect(() => {
		if (!inlineAiOpen) {
			return;
		}
		const onStreamMessage = (event: MessageEvent) => {
			const msg = event.data as HostToWebview;
			if (!msg || typeof msg !== 'object') {
				return;
			}
			if (msg.type === 'inlineAiDelta' && typeof msg.text === 'string') {
				setInlineAiOutput(o => o + msg.text);
			} else if (msg.type === 'inlineAiDone') {
				setInlineAiBusy(false);
			} else if (msg.type === 'inlineAiError' && typeof msg.message === 'string') {
				setInlineAiBusy(false);
				setInlineAiError(msg.message);
			}
		};
		window.addEventListener('message', onStreamMessage);
		return () => window.removeEventListener('message', onStreamMessage);
	}, [inlineAiOpen]);

	if (!editor) {
		return null;
	}

	let vscodeApi: VsCodeApi;
	try {
		vscodeApi = getVsCode();
	} catch {
		return null;
	}

	return (
		<div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', boxSizing: 'border-box' }}>
			<Toolbar editor={editor} />
			<div
				className="writer-editor-scroll"
				style={{
					flex: 1,
					minHeight: 0,
					overflow: 'auto',
					width: '100%',
					boxSizing: 'border-box',
				}}
			>
				<div
					style={{
						maxWidth: '52rem',
						margin: '0 auto',
						width: '100%',
						boxSizing: 'border-box',
						position: 'relative',
						padding: inlineAiOpen ? '12px 24px 220px' : '12px 24px 48px',
					}}
				>
					<EditorContent editor={editor} />
					<InlineAiPanel
						open={inlineAiOpen}
						onClose={() => setInlineAiOpen(false)}
						editor={editor}
						format={docFormat}
						vscode={vscodeApi}
						output={inlineAiOutput}
						busy={inlineAiBusy}
						error={inlineAiError}
						onRequestStart={() => {
							setInlineAiOutput('');
							setInlineAiError(null);
							setInlineAiBusy(true);
						}}
						onCancelStream={() => setInlineAiBusy(false)}
					/>
				</div>
				<SelectionBubbleMenu editor={editor} onAskAi={() => setInlineAiOpen(true)} />
			</div>
			<style>{WRITER_THEME_STYLES}</style>
		</div>
	);
}

const rootEl = document.getElementById('root');
if (rootEl) {
	createRoot(rootEl).render(<WriterApp />);
}
