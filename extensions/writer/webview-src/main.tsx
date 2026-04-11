/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { EditorContent, useEditor } from '@tiptap/react';
import type { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Underline from '@tiptap/extension-underline';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TextAlign from '@tiptap/extension-text-align';
import { Toolbar } from './toolbar';
import GlobalDragHandle from './global-drag-handle';
import { SelectionBubbleMenu } from './SelectionBubbleMenu';
import { InlineAiPanel } from './InlineAiPanel';
import { WRITER_THEME_STYLES } from './writerThemeStyles';
import { WriterImage } from './writerImage';
import { augmentImageHtml, extractImgSrcsFromHtml } from './htmlImageHelpers';
import {
	computeOffsetsInSnapshot,
	getMarkdownSnapshotFromEditor,
	getPlainSnapshotFromEditor,
} from './commentAnchor';
import { appendFootnoteDefsMarkdown, extractFootnoteDefsFromHtml } from './htmlFootnotes';
import { writerTurndown } from './turndownWriter';
import { markdownToEditorHtml } from './markdownToEditorHtml';
import { WriterDiagnostics, type WriterDiagnosticItem } from './writerDiagnostics';
import { WriterFootnoteDef, WriterFootnoteRef } from './writerFootnote';

type VsCodeApi = { postMessage: (msg: unknown) => void };

type HostToWebview =
	| { type: 'init'; format: 'markdown'; payload: { markdown: string }; resource: string }
	| { type: 'init'; format: 'rtf'; payload: { plainText: string }; resource: string }
	| { type: 'documentChanged'; format: 'markdown'; payload: { markdown: string }; resource: string }
	| { type: 'documentChanged'; format: 'rtf'; payload: { plainText: string }; resource: string }
	| { type: 'inlineAiDelta'; text: string }
	| { type: 'inlineAiDone' }
	| { type: 'inlineAiError'; message: string }
	| { type: 'pathsResolved'; map: Record<string, string> }
	| { type: 'imageSaved'; markdownPath: string; webviewSrc: string; alt: string }
	| { type: 'imageSaveError'; message: string }
	| { type: 'diagnostics'; items: WriterDiagnosticItem[] }
	| {
		type: 'commentsForResource';
		resource: string;
		comments: {
			id: string;
			body: string;
			createdAt: number;
			orphaned?: boolean;
			anchor: { start: number; end: number; quote: string };
		}[];
	};

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
	/** HTML waiting for `pathsResolved` before setContent. */
	const pendingHtmlRef = useRef<string | null>(null);
	const pendingRawMdRef = useRef<string | null>(null);
	const imageInputRef = useRef<HTMLInputElement>(null);
	const resourceUriRef = useRef<string>('');

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
			const { strippedHtml, defs } = extractFootnoteDefsFromHtml(html);
			let md = writerTurndown.turndown(strippedHtml);
			md = appendFootnoteDefsMarkdown(md, defs);
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
		// Webview is always client-side; avoid a null editor on first paint (breaks init timing vs. marked HTML).
		immediatelyRender: true,
		editorProps: {
			attributes: {
				// Native Chromium spellcheck fights with Harper/LSP decorations and confuses users.
				spellcheck: 'false',
			},
		},
		extensions: [
			StarterKit.configure({
				headingLevels: [1, 2, 3],
				gapcursor: true,
				dropcursor: { color: 'var(--vscode-focusBorder)', width: 3 },
			}),
			Placeholder.configure({ placeholder: 'Start writing…' }),
			Underline,
			TextAlign.configure({
				types: ['heading', 'paragraph'],
				alignments: ['left', 'center', 'right'],
				defaultAlignment: 'left',
			}),
			Table.configure({
				resizable: true,
			}),
			TableRow,
			TableHeader,
			TableCell,
			WriterImage.configure({
				inline: false,
				allowBase64: false,
			}),
			TaskList.configure({
				HTMLAttributes: { class: 'writer-task-list' },
			}),
			TaskItem.configure({
				HTMLAttributes: { class: 'writer-task-item' },
				nested: true,
			}),
			GlobalDragHandle,
			WriterDiagnostics,
			WriterFootnoteRef,
			WriterFootnoteDef,
		],
		content: '<p></p>',
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

			if (msg.type === 'commentsForResource') {
				resourceUriRef.current = msg.resource;
				return;
			}

			if (msg.type === 'diagnostics') {
				const ed = editorRef.current;
				if (ed && !ed.isDestroyed && Array.isArray(msg.items)) {
					(
						ed.chain().focus() as unknown as {
							setWriterDiagnostics: (items: WriterDiagnosticItem[]) => { run: () => boolean };
						}
					).setWriterDiagnostics(msg.items).run();
				}
				return;
			}

			if (msg.type === 'pathsResolved') {
				const pending = pendingHtmlRef.current;
				const rawMd = pendingRawMdRef.current ?? '';
				pendingHtmlRef.current = null;
				pendingRawMdRef.current = null;
				if (pending !== null && editorRef.current) {
					const ed = editorRef.current;
					const html = augmentImageHtml(pending, msg.map);
					requestAnimationFrame(() => {
						if (!ed || ed.isDestroyed) {
							return;
						}
						let toApply = html;
						if (!toApply.trim() && rawMd.trim()) {
							toApply = markdownPlainFallbackAsHtml(rawMd);
						}
						ed.chain().setContent(toApply, false).run();
						queueMicrotask(() => {
							canPushToHostRef.current = true;
						});
					});
				}
				return;
			}

			if (msg.type === 'imageSaved') {
				const ed = editorRef.current;
				if (ed && !ed.isDestroyed) {
					// WriterImage adds dataMdSrc for Markdown paths; cast until command types are extended.
					(ed.chain().focus() as unknown as { setImage: (o: Record<string, string>) => { run: () => boolean } }).setImage({
						src: msg.webviewSrc,
						alt: msg.alt || '',
						dataMdSrc: msg.markdownPath,
					}).run();
				}
				return;
			}

			if (msg.type === 'imageSaveError') {
				window.alert(msg.message);
				return;
			}

			if (msg.type !== 'init' && msg.type !== 'documentChanged') {
				return;
			}

			resourceUriRef.current = msg.resource;

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
					let html = markdownToEditorHtml(md);
					if (!html.trim() && md.trim()) {
						html = markdownPlainFallbackAsHtml(md);
					}
					const imgs = extractImgSrcsFromHtml(html);
					if (imgs.length > 0) {
						pendingHtmlRef.current = html;
						pendingRawMdRef.current = md;
						vscode.postMessage({ type: 'resolveImagePaths', paths: imgs });
						return;
					}
					ed.chain().setContent(html, false).run();
					queueMicrotask(() => {
						canPushToHostRef.current = true;
					});
				} else {
					formatRef.current = 'rtf';
					setDocFormat('rtf');
					const plain = msg.payload.plainText.replace(/^\uFEFF/, '');
					const html = plainTextToEditorHtml(plain);
					ed.chain().setContent(html, false).run();
					queueMicrotask(() => {
						canPushToHostRef.current = true;
					});
				}
			});
		};

		window.addEventListener('message', onMessage);
		vscode.postMessage({ type: 'ready' });

		// Re-send `ready` if the host doesn't respond with `init` within a grace period.
		// This handles the rare session-restore race where the host misses the first `ready`.
		const retryTimer = setInterval(() => {
			if (!canPushToHostRef.current) {
				vscode.postMessage({ type: 'ready' });
			} else {
				clearInterval(retryTimer);
			}
		}, 2000);

		return () => {
			clearInterval(retryTimer);
			window.removeEventListener('message', onMessage);
		};
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

	const onImageFileChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		e.target.value = '';
		if (!file || !vscodeRef.current) {
			return;
		}
		const reader = new FileReader();
		reader.onload = () => {
			const dataUrl = reader.result as string;
			const comma = dataUrl.indexOf(',');
			const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : '';
			vscodeRef.current?.postMessage({
				type: 'saveImage',
				base64,
				mimeType: file.type || 'image/png',
				filenameHint: file.name,
			});
		};
		reader.readAsDataURL(file);
	}, []);

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
			<input
				ref={imageInputRef}
				type="file"
				accept="image/*"
				style={{ display: 'none' }}
				onChange={onImageFileChange}
				aria-hidden
			/>
			<Toolbar
				editor={editor}
				format={docFormat}
				onPickImage={() => imageInputRef.current?.click()}
			/>
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
				<SelectionBubbleMenu
					editor={editor}
					onAskAi={() => setInlineAiOpen(true)}
					onComment={(body, selectionMarkdown, plainQuote) => {
						const ed = editorRef.current;
						if (!ed || ed.isDestroyed) {
							return;
						}
						if (formatRef.current === 'markdown') {
							const markdownSnapshot = getMarkdownSnapshotFromEditor(ed);
							const off = computeOffsetsInSnapshot(
								markdownSnapshot,
								selectionMarkdown,
								plainQuote,
							);
							if (!off) {
								window.alert(
									'Could not locate the selection in the document text. Try selecting again.',
								);
								return;
							}
							vscodeApi.postMessage({
								type: 'commentAdd',
								resource: resourceUriRef.current,
								selectionMarkdown,
								plainQuote,
								body,
								markdownSnapshot,
								start: off.start,
								end: off.end,
							});
						} else {
							vscodeApi.postMessage({
								type: 'commentAdd',
								resource: resourceUriRef.current,
								selectionMarkdown,
								plainQuote,
								body,
								plainTextSnapshot: getPlainSnapshotFromEditor(ed),
							});
						}
					}}
				/>
			</div>
			<style>{WRITER_THEME_STYLES}</style>
		</div>
	);
}

const rootEl = document.getElementById('root');
if (rootEl) {
	createRoot(rootEl).render(<WriterApp />);
}
