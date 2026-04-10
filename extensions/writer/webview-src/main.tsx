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
				dropcursor: { color: '#64748b', width: 3 },
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
		<div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
			<Toolbar editor={editor} />
			<div
				className="writer-editor-scroll"
				style={{
					flex: 1,
					overflow: 'auto',
					padding: inlineAiOpen ? '12px 24px 220px' : '12px 24px 48px',
					maxWidth: '52rem',
					margin: '0 auto',
					width: '100%',
					boxSizing: 'border-box',
					position: 'relative',
				}}
			>
				<EditorContent editor={editor} />
				<SelectionBubbleMenu editor={editor} onAskAi={() => setInlineAiOpen(true)} />
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
			<style>{`
				.ProseMirror { outline: none; min-height: 200px; line-height: 1.65; color: var(--vscode-editor-foreground); }
				.ProseMirror p { margin: 0.5em 0; }
				.ProseMirror h1 { font-size: 1.75em; margin: 0.6em 0 0.3em; font-weight: 600; }
				.ProseMirror h2 { font-size: 1.4em; margin: 0.6em 0 0.3em; font-weight: 600; }
				.ProseMirror h3 { font-size: 1.15em; margin: 0.6em 0 0.3em; font-weight: 600; }
				.ProseMirror ul:not(.writer-task-list), .ProseMirror ol { padding-left: 1.5em; }
				.ProseMirror blockquote { border-left: 3px solid var(--vscode-editorWidget-border); margin-left: 0; padding-left: 1em; }
				.ProseMirror code { background: var(--vscode-textCodeBlock-background, rgba(128,128,128,.15)); padding: 0.1em 0.35em; border-radius: 4px; font-size: 0.9em; }
				.ProseMirror pre { background: var(--vscode-textCodeBlock-background, rgba(128,128,128,.12)); padding: 12px; border-radius: 6px; overflow-x: auto; }
				.writer-task-list { list-style: none; padding-left: 0.25rem; }
				.writer-task-item { display: flex; gap: 0.5rem; align-items: flex-start; margin: 0.75rem 0; }
				.writer-task-item label { flex: 1; }
				.ProseMirror:not(.dragging) .ProseMirror-selectednode {
					outline: none !important;
					background-color: color-mix(in srgb, var(--vscode-focusBorder) 18%, transparent);
					transition: background-color 0.2s;
				}
				.drag-handle {
					position: fixed;
					z-index: 50;
					width: 1.2rem;
					height: 1.5rem;
					cursor: grab;
					opacity: 1;
					border-radius: 0.25rem;
					transition: opacity 0.2s ease, background-color 0.2s;
					background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10' fill='%23808080'%3E%3Cpath d='M3,2 C2.44771525,2 2,1.55228475 2,1 C2,0.44771525 2.44771525,0 3,0 C3.55228475,0 4,0.44771525 4,1 C4,1.55228475 3.55228475,2 3,2 Z M3,6 C2.44771525,6 2,5.55228475 2,5 C2,4.44771525 2.44771525,4 3,4 C3.55228475,4 4,4.44771525 4,5 C4,5.55228475 3.55228475,6 3,6 Z M3,10 C2.44771525,10 2,9.55228475 2,9 C2,8.44771525 2.44771525,8 3,8 C3.55228475,8 4,8.44771525 4,9 C4,9.55228475 3.55228475,10 3,10 Z M7,2 C6.44771525,2 6,1.55228475 6,1 C6,0.44771525 6.44771525,0 7,0 C7.55228475,0 8,0.44771525 8,1 C8,1.55228475 7.55228475,2 7,2 Z M7,6 C6.44771525,6 6,5.55228475 6,5 C6,4.44771525 6.44771525,4 7,4 C7.55228475,4 8,4.44771525 8,5 C8,5.55228475 7.55228475,6 7,6 Z M7,10 C6.44771525,10 6,9.55228475 6,9 C6,8.44771525 6.44771525,8 7,8 C7.55228475,8 8,8.44771525 8,9 C8,9.55228475 7.55228475,10 7,10 Z'/%3E%3C/svg%3E");
					background-repeat: no-repeat;
					background-position: center;
					background-size: calc(0.5em + 0.375rem) calc(0.5em + 0.375rem);
				}
				.drag-handle:hover {
					background-color: color-mix(in srgb, var(--vscode-editor-foreground) 8%, transparent);
				}
				.drag-handle:active {
					cursor: grabbing;
					background-color: color-mix(in srgb, var(--vscode-editor-foreground) 12%, transparent);
				}
				.drag-handle.hide {
					opacity: 0;
					pointer-events: none;
				}
			`}</style>
		</div>
	);
}

const rootEl = document.getElementById('root');
if (rootEl) {
	createRoot(rootEl).render(<WriterApp />);
}
