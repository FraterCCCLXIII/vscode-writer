/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isTextSelection, posToDOMRect, type Editor } from '@tiptap/core';
import { Bold, Bookmark, Italic, MessageSquare, Sparkles, Underline } from 'lucide-react';
import {
	useCallback,
	useEffect,
	useRef,
	useState,
	type CSSProperties,
	type MouseEvent,
	type ReactNode,
} from 'react';
import { getSelectionForComment } from './selectionMarkdown';
import { writerTurndown } from './turndownWriter';
import { insertWriterFootnote } from './writerFootnote';

type Props = {
	editor: Editor;
	/** Footnotes are Markdown-only (serialized as [^id] / definitions). */
	format: 'markdown' | 'rtf';
	onAskAi: () => void;
	/** Called with comment body and selection payload after restoring the saved range. */
	onComment: (body: string, selectionMarkdown: string, plainQuote: string) => void;
};

const bar: CSSProperties = {
	display: 'flex',
	alignItems: 'center',
	gap: 2,
	padding: '4px 6px',
	borderRadius: 8,
	border: '1px solid var(--vscode-editorWidget-border)',
	background: 'var(--vscode-editor-background)',
	boxShadow: '0 4px 12px var(--vscode-widget-shadow)',
	pointerEvents: 'auto',
};

function Btn({
	title,
	onClick,
	children,
}: {
	title: string;
	onClick: () => void;
	children: ReactNode;
}) {
	const [hover, setHover] = useState(false);
	return (
		<button
			type="button"
			title={title}
			aria-label={title}
			onMouseDown={(e) => e.preventDefault()}
			onClick={onClick}
			onMouseEnter={() => setHover(true)}
			onMouseLeave={() => setHover(false)}
			style={{
				display: 'flex',
				height: 30,
				width: 30,
				alignItems: 'center',
				justifyContent: 'center',
				border: 'none',
				borderRadius: 6,
				background: hover ? 'var(--vscode-toolbar-hoverBackground)' : 'transparent',
				color: 'var(--vscode-editor-foreground)',
				cursor: 'pointer',
				pointerEvents: 'auto',
			}}
		>
			{children}
		</button>
	);
}

const sep: CSSProperties = {
	width: 1,
	height: 20,
	margin: '0 4px',
	background: 'var(--vscode-editorWidget-border)',
	flexShrink: 0,
};

const APPROX_BAR_H = 42;
const GAP = 6;

function shouldShowFloatingToolbar(editor: Editor): boolean {
	if (editor.isDestroyed || !editor.view || !editor.isEditable) {
		return false;
	}
	const { from, to, empty } = editor.state.selection;
	if (empty) {
		return false;
	}
	const isEmptyTextBlock =
		!editor.state.doc.textBetween(from, to).length && isTextSelection(editor.state.selection);
	return !isEmptyTextBlock;
}

/**
 * Floating selection toolbar without Tippy: VS Code webviews often break popper hit-testing
 * (pointer-events / stacking) when the menu is portaled to document.body.
 */
export function SelectionBubbleMenu({ editor, format, onAskAi, onComment }: Props) {
	const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
	const [commentOpen, setCommentOpen] = useState(false);
	const [footnoteOpen, setFootnoteOpen] = useState(false);
	const [commentDraft, setCommentDraft] = useState('');
	const [footnoteDraft, setFootnoteDraft] = useState('');
	const savedRangeRef = useRef<{ from: number; to: number } | null>(null);
	const commentTextareaRef = useRef<HTMLTextAreaElement | null>(null);
	const footnoteTextareaRef = useRef<HTMLTextAreaElement | null>(null);
	const rafRef = useRef(0);

	const updatePosition = useCallback(() => {
		const saved = savedRangeRef.current;
		const useSavedRange = (commentOpen || footnoteOpen) && saved;
		if (!useSavedRange && !shouldShowFloatingToolbar(editor)) {
			setPos(null);
			return;
		}
		const from = useSavedRange ? saved!.from : editor.state.selection.from;
		const to = useSavedRange ? saved!.to : editor.state.selection.to;
		const domRect = posToDOMRect(editor.view, from, to);
		let top = domRect.top - APPROX_BAR_H - GAP;
		if (top < 4) {
			top = domRect.bottom + GAP;
		}
		const left = domRect.left + domRect.width / 2;
		setPos({ top, left });
	}, [editor, commentOpen, footnoteOpen]);

	const scheduleUpdate = useCallback(() => {
		cancelAnimationFrame(rafRef.current);
		rafRef.current = requestAnimationFrame(() => updatePosition());
	}, [updatePosition]);

	useEffect(() => {
		updatePosition();
		editor.on('selectionUpdate', scheduleUpdate);
		editor.on('update', scheduleUpdate);

		const scrollEl = editor.view.dom.closest('.writer-editor-scroll');
		scrollEl?.addEventListener('scroll', scheduleUpdate, { passive: true });
		window.addEventListener('resize', scheduleUpdate);

		return () => {
			cancelAnimationFrame(rafRef.current);
			editor.off('selectionUpdate', scheduleUpdate);
			editor.off('update', scheduleUpdate);
			scrollEl?.removeEventListener('scroll', scheduleUpdate);
			window.removeEventListener('resize', scheduleUpdate);
		};
	}, [editor, scheduleUpdate, updatePosition]);

	useEffect(() => {
		if (commentOpen) {
			queueMicrotask(() => commentTextareaRef.current?.focus());
		}
	}, [commentOpen]);

	useEffect(() => {
		if (footnoteOpen) {
			queueMicrotask(() => footnoteTextareaRef.current?.focus());
		}
	}, [footnoteOpen]);

	if (!pos) {
		return null;
	}

	const submitComment = () => {
		const r = savedRangeRef.current;
		const body = commentDraft.trim();
		if (!r || !body) {
			return;
		}
		editor.chain().focus().setTextSelection({ from: r.from, to: r.to }).run();
		const extracted = getSelectionForComment(editor, writerTurndown);
		if (!extracted) {
			window.alert(
				'Could not read the selection for this comment (empty or unsupported). Try selecting the text again.',
			);
			return;
		}
		onComment(body, extracted.selectionMarkdown, extracted.plainQuote);
		setCommentOpen(false);
		setCommentDraft('');
		savedRangeRef.current = null;
	};

	const submitFootnote = () => {
		const r = savedRangeRef.current;
		const body = footnoteDraft;
		if (!r) {
			return;
		}
		insertWriterFootnote(editor, { body, range: r });
		setFootnoteOpen(false);
		setFootnoteDraft('');
		savedRangeRef.current = null;
	};

	/** Parent preventDefault keeps TipTap selection; must skip for inputs or the textarea cannot focus. */
	const onToolbarMouseDown = (e: MouseEvent<HTMLDivElement>) => {
		const t = e.target as HTMLElement;
		if (
			t.closest(
				'textarea, input, select, [data-writer-comment-composer="true"], [data-writer-footnote-composer="true"]',
			)
		) {
			return;
		}
		e.preventDefault();
	};

	return (
		<div
			role="toolbar"
			aria-label="Selection formatting"
			style={{
				position: 'fixed',
				top: pos.top,
				left: pos.left,
				transform: 'translateX(-50%)',
				zIndex: 100_000,
				pointerEvents: 'auto',
			}}
			onMouseDown={onToolbarMouseDown}
		>
			<div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
				<div style={bar}>
					<Btn title="Bold" onClick={() => editor.chain().focus().toggleBold().run()}>
						<Bold size={16} strokeWidth={2} />
					</Btn>
					<Btn title="Italic" onClick={() => editor.chain().focus().toggleItalic().run()}>
						<Italic size={16} strokeWidth={2} />
					</Btn>
					<Btn title="Underline" onClick={() => editor.chain().focus().toggleUnderline().run()}>
						<Underline size={16} strokeWidth={2} />
					</Btn>
					<span style={sep} />
					<Btn
						title="Comment"
						onClick={() => {
							const { from, to } = editor.state.selection;
							savedRangeRef.current = { from, to };
							setFootnoteOpen(false);
							setCommentOpen(true);
						}}
					>
						<MessageSquare size={16} strokeWidth={2} />
					</Btn>
					{format === 'markdown' ? (
						<Btn
							title="Insert footnote — reference after selection; definition at end of document"
							onClick={() => {
								const { from, to } = editor.state.selection;
								savedRangeRef.current = { from, to };
								setCommentOpen(false);
								setFootnoteDraft('');
								setFootnoteOpen(true);
							}}
						>
							<Bookmark size={16} strokeWidth={2} />
						</Btn>
					) : null}
					<Btn title="Ask AI" onClick={onAskAi}>
						<Sparkles size={16} strokeWidth={2} />
					</Btn>
				</div>
				{commentOpen ? (
					<div
						data-writer-comment-composer="true"
						style={{
							...bar,
							flexDirection: 'column',
							alignItems: 'stretch',
							minWidth: 260,
							padding: 8,
						}}
						onMouseDown={e => e.stopPropagation()}
					>
						<label htmlFor="writer-comment-draft" style={{ fontSize: 11, marginBottom: 4 }}>
							Comment
						</label>
						<textarea
							ref={commentTextareaRef}
							id="writer-comment-draft"
							value={commentDraft}
							onChange={e => setCommentDraft(e.target.value)}
							rows={3}
							style={{
								resize: 'vertical',
								fontFamily: 'var(--vscode-font-family)',
								fontSize: 'var(--vscode-font-size)',
								color: 'var(--vscode-input-foreground)',
								background: 'var(--vscode-input-background)',
								border: '1px solid var(--vscode-input-border)',
								borderRadius: 4,
								padding: 6,
							}}
						/>
						<div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'flex-end' }}>
							<button
								type="button"
								onClick={() => {
									setCommentOpen(false);
									setCommentDraft('');
									savedRangeRef.current = null;
								}}
								style={{ cursor: 'pointer' }}
							>
								Cancel
							</button>
							<button type="button" onClick={() => submitComment()} style={{ cursor: 'pointer' }}>
								Add comment
							</button>
						</div>
					</div>
				) : null}
				{footnoteOpen ? (
					<div
						data-writer-footnote-composer="true"
						style={{
							...bar,
							flexDirection: 'column',
							alignItems: 'stretch',
							minWidth: 260,
							padding: 8,
						}}
						onMouseDown={e => e.stopPropagation()}
					>
						<label htmlFor="writer-footnote-draft" style={{ fontSize: 11, marginBottom: 4 }}>
							Footnote
						</label>
						<p style={{ margin: '0 0 6px', fontSize: 11, opacity: 0.85 }}>
							Text is added at the bottom of the document; you can edit or delete it there.
						</p>
						<textarea
							ref={footnoteTextareaRef}
							id="writer-footnote-draft"
							value={footnoteDraft}
							onChange={e => setFootnoteDraft(e.target.value)}
							rows={4}
							placeholder="Footnote text…"
							style={{
								resize: 'vertical',
								fontFamily: 'var(--vscode-font-family)',
								fontSize: 'var(--vscode-font-size)',
								color: 'var(--vscode-input-foreground)',
								background: 'var(--vscode-input-background)',
								border: '1px solid var(--vscode-input-border)',
								borderRadius: 4,
								padding: 6,
							}}
						/>
						<div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'flex-end' }}>
							<button
								type="button"
								onClick={() => {
									setFootnoteOpen(false);
									setFootnoteDraft('');
									savedRangeRef.current = null;
								}}
								style={{ cursor: 'pointer' }}
							>
								Cancel
							</button>
							<button type="button" onClick={() => submitFootnote()} style={{ cursor: 'pointer' }}>
								Add footnote
							</button>
						</div>
					</div>
				) : null}
			</div>
		</div>
	);
}
