/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isTextSelection, posToDOMRect, type Editor } from '@tiptap/core';
import { Bold, Italic, Sparkles, Underline } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

type Props = {
	editor: Editor;
	onAskAi: () => void;
};

const bar: CSSProperties = {
	display: 'flex',
	alignItems: 'center',
	gap: 2,
	padding: '4px 6px',
	borderRadius: 8,
	border: '1px solid var(--vscode-editorWidget-border, rgba(128,128,128,.35))',
	background: 'var(--vscode-editor-background)',
	boxShadow: '0 4px 12px rgba(0,0,0,.2)',
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
				background: hover ? 'var(--vscode-toolbar-hoverBackground, rgba(128,128,128,.2))' : 'transparent',
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
	background: 'var(--vscode-editorWidget-border, rgba(128,128,128,.35))',
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
export function SelectionBubbleMenu({ editor, onAskAi }: Props) {
	const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
	const rafRef = useRef(0);

	const updatePosition = useCallback(() => {
		if (!shouldShowFloatingToolbar(editor)) {
			setPos(null);
			return;
		}
		const { from, to } = editor.state.selection;
		const domRect = posToDOMRect(editor.view, from, to);
		let top = domRect.top - APPROX_BAR_H - GAP;
		if (top < 4) {
			top = domRect.bottom + GAP;
		}
		const left = domRect.left + domRect.width / 2;
		setPos({ top, left });
	}, [editor]);

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

	if (!pos) {
		return null;
	}

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
			onMouseDown={(e) => e.preventDefault()}
		>
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
				<Btn title="Ask AI" onClick={onAskAi}>
					<Sparkles size={16} strokeWidth={2} />
				</Btn>
			</div>
		</div>
	);
}
