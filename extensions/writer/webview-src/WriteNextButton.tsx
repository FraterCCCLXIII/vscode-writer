/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { posToDOMRect, type Editor } from '@tiptap/core';
import {
	useCallback,
	useEffect,
	useRef,
	useState,
	type CSSProperties,
} from 'react';

type Props = {
	editor: Editor;
	busy: boolean;
	streaming: boolean;
	error: string | null;
	status: string | null;
	inlineAiBusy: boolean;
	onTrigger: (beforeContext: string, afterContext: string) => void;
	onCancel: () => void;
	onAccept: () => void;
	onDiscard: () => void;
};

const IDLE_MS = 800;
const BEFORE_WORDS = 500;
const AFTER_WORDS = 200;

function extractContext(editor: Editor): { before: string; after: string } | null {
	const { from } = editor.state.selection;
	const doc = editor.state.doc;
	const full = doc.textBetween(0, doc.content.size, '\n', '\n');
	const cursorOffset = doc.textBetween(0, from, '\n', '\n').length;

	const beforeAll = full.slice(0, cursorOffset);
	const afterAll = full.slice(cursorOffset);

	const beforeWords = beforeAll.split(/\s+/).filter(Boolean);
	const afterWords = afterAll.split(/\s+/).filter(Boolean);

	const before = beforeWords.slice(-BEFORE_WORDS).join(' ');
	const after = afterWords.slice(0, AFTER_WORDS).join(' ');

	if (!before.trim() && !after.trim()) {
		return null;
	}
	return { before, after };
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
const modKey = isMac ? '\u2318' : 'Ctrl';

export function WriteNextButton({
	editor,
	busy,
	streaming,
	error,
	status,
	inlineAiBusy,
	onTrigger,
	onCancel,
	onAccept,
	onDiscard,
}: Props) {
	const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
	const [visible, setVisible] = useState(false);
	const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const rafRef = useRef(0);

	const isCollapsed = editor.state.selection.empty;
	const isActive = busy || streaming;

	const clearIdle = useCallback(() => {
		if (idleTimer.current !== null) {
			clearTimeout(idleTimer.current);
			idleTimer.current = null;
		}
	}, []);

	const updatePosition = useCallback(() => {
		if (!editor || editor.isDestroyed) {
			setPos(null);
			return;
		}
		const { from } = editor.state.selection;
		const domRect = posToDOMRect(editor.view, from, from);
		const top = domRect.top - 40;
		const left = domRect.left;
		setPos({ top, left });
	}, [editor]);

	const resetIdleTimer = useCallback(() => {
		clearIdle();
		if (isActive || inlineAiBusy || !editor.isEditable) {
			setVisible(false);
			return;
		}
		if (!editor.state.selection.empty) {
			setVisible(false);
			return;
		}
		idleTimer.current = setTimeout(() => {
			if (editor.state.selection.empty && editor.isEditable && !inlineAiBusy) {
				setVisible(true);
				updatePosition();
			}
		}, IDLE_MS);
	}, [editor, isActive, inlineAiBusy, clearIdle, updatePosition]);

	useEffect(() => {
		const onSelectionUpdate = () => {
			if (isActive) {
				updatePosition();
				return;
			}
			setVisible(false);
			resetIdleTimer();
		};
		const onUpdate = () => {
			if (!isActive) {
				setVisible(false);
				resetIdleTimer();
			}
		};

		editor.on('selectionUpdate', onSelectionUpdate);
		editor.on('update', onUpdate);

		const scrollEl = editor.view.dom.closest('.writer-editor-scroll');
		const onScroll = () => {
			cancelAnimationFrame(rafRef.current);
			rafRef.current = requestAnimationFrame(() => {
				if (visible || isActive) {
					updatePosition();
				}
			});
		};
		scrollEl?.addEventListener('scroll', onScroll, { passive: true });
		window.addEventListener('resize', onScroll);

		resetIdleTimer();

		return () => {
			editor.off('selectionUpdate', onSelectionUpdate);
			editor.off('update', onUpdate);
			scrollEl?.removeEventListener('scroll', onScroll);
			window.removeEventListener('resize', onScroll);
			clearIdle();
			cancelAnimationFrame(rafRef.current);
		};
	}, [editor, visible, isActive, resetIdleTimer, updatePosition, clearIdle]);

	const trigger = useCallback(() => {
		const ctx = extractContext(editor);
		if (!ctx) {
			return;
		}
		setVisible(true);
		updatePosition();
		onTrigger(ctx.before, ctx.after);
	}, [editor, onTrigger, updatePosition]);

	if (!pos) {
		return null;
	}

	if (!visible && !isActive) {
		return null;
	}

	if (!isCollapsed && !isActive) {
		return null;
	}

	const showButton = !isActive;
	const showActions = isActive;

	return (
		<div
			className="write-next-container"
			style={{
				position: 'absolute',
				top: pos.top,
				left: pos.left,
				zIndex: 60,
				pointerEvents: 'auto',
			}}
		>
			{showButton && (
				<button
					type="button"
					className="write-next-btn"
					onClick={trigger}
					style={btnStyle}
				>
					<WriteIcon />
					<span>Write</span>
					<kbd className="write-next-kbd" style={kbdStyle}>{modKey}+Return</kbd>
				</button>
			)}
			{showActions && (
				<div className="write-next-actions-bar" style={actionsBarStyle}>
					{error ? (
						<span style={{ color: 'var(--vscode-errorForeground)', fontSize: 12, marginRight: 8 }}>
							{error}
						</span>
					) : status && !streaming ? (
						<span style={{ fontSize: 12, opacity: 0.6, marginRight: 8 }}>
							{status}
						</span>
					) : busy ? (
						<span style={{ fontSize: 12, opacity: 0.6, marginRight: 8 }}>
							Writing...
						</span>
					) : null}
					{busy ? (
						<button type="button" className="write-next-action" style={actionBtnStyle} onClick={onCancel}>
							Stop
						</button>
					) : (
						<>
							<button type="button" className="write-next-action write-next-discard" style={actionBtnStyle} onClick={onDiscard}>
								Discard
							</button>
							<button
								type="button"
								className="write-next-action write-next-accept"
								style={{ ...actionBtnStyle, ...acceptBtnStyle }}
								onClick={onAccept}
							>
								Accept
							</button>
						</>
					)}
				</div>
			)}
		</div>
	);
}

export { extractContext };

function WriteIcon() {
	return (
		<svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ marginRight: 4 }}>
			<path
				d="M13.23 1h-1.46L3.52 9.25l1.46 1.46L13.23 2.46V1zM.5 14.5h15v1H.5v-1z"
				fill="currentColor"
			/>
		</svg>
	);
}

const btnStyle: CSSProperties = {
	display: 'inline-flex',
	alignItems: 'center',
	gap: 4,
	padding: '4px 10px 4px 8px',
	border: '1px solid var(--vscode-editorWidget-border)',
	borderRadius: 6,
	background: 'var(--vscode-editor-background)',
	color: 'var(--vscode-editor-foreground)',
	fontSize: 12,
	cursor: 'pointer',
	boxShadow: '0 2px 8px var(--vscode-widget-shadow)',
	whiteSpace: 'nowrap',
};

const kbdStyle: CSSProperties = {
	fontSize: 10,
	padding: '1px 4px',
	marginLeft: 4,
	border: '1px solid var(--vscode-editorWidget-border)',
	borderRadius: 3,
	background: 'var(--vscode-textBlockQuote-background)',
	opacity: 0.7,
};

const actionsBarStyle: CSSProperties = {
	display: 'inline-flex',
	alignItems: 'center',
	gap: 6,
	padding: '4px 8px',
	borderRadius: 6,
	border: '1px solid var(--vscode-editorWidget-border)',
	background: 'var(--vscode-editor-background)',
	boxShadow: '0 2px 8px var(--vscode-widget-shadow)',
	whiteSpace: 'nowrap',
};

const actionBtnStyle: CSSProperties = {
	padding: '3px 10px',
	border: '1px solid var(--vscode-editorWidget-border)',
	borderRadius: 4,
	background: 'transparent',
	color: 'var(--vscode-editor-foreground)',
	fontSize: 11,
	cursor: 'pointer',
};

const acceptBtnStyle: CSSProperties = {
	background: 'var(--vscode-button-background)',
	color: 'var(--vscode-button-foreground)',
	border: 'none',
};
