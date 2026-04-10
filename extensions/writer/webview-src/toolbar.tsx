/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Editor } from '@tiptap/core';
import {
	Bold,
	CheckSquare,
	Code,
	Heading1,
	Heading2,
	Heading3,
	Italic,
	List,
	ListOrdered,
	Quote,
	Redo2,
	Strikethrough,
	Type,
	Underline,
	Undo2,
} from 'lucide-react';

type Props = {
	editor: Editor;
};

/** Sticky chrome: no horizontal padding here so the divider can span the full webview width. */
const shell: CSSProperties = {
	position: 'sticky',
	top: 0,
	zIndex: 40,
	width: '100%',
	flexShrink: 0,
	boxSizing: 'border-box',
	background: 'var(--vscode-editor-background)',
};

const toolbarRow: CSSProperties = {
	display: 'flex',
	minHeight: 48,
	maxWidth: '100%',
	flexWrap: 'wrap',
	alignItems: 'center',
	justifyContent: 'center',
	gap: 2,
	padding: '0 8px',
	boxSizing: 'border-box',
};

/** Separate block so the rule is never inset by row padding (edge-to-edge separator). */
const bottomRule: CSSProperties = {
	width: '100%',
	height: 1,
	flexShrink: 0,
	background: 'var(--vscode-editorWidget-border)',
};

const sep: CSSProperties = {
	width: 1,
	height: 24,
	margin: '0 4px',
	background: 'var(--vscode-editorWidget-border)',
	flexShrink: 0,
};

function iconBtn(active: boolean): CSSProperties {
	return {
		display: 'flex',
		height: 32,
		width: 32,
		flexShrink: 0,
		alignItems: 'center',
		justifyContent: 'center',
		border: 'none',
		borderRadius: 6,
		background: active ? 'var(--vscode-toolbar-hoverBackground)' : 'transparent',
		color: 'var(--vscode-editor-foreground)',
		cursor: 'pointer',
		transition: 'background-color 0.15s ease',
	};
}

function ToolbarIconButton({
	title,
	active,
	disabled,
	onClick,
	children,
}: {
	title: string;
	active?: boolean;
	disabled?: boolean;
	onClick: () => void;
	children: ReactNode;
}) {
	const [hover, setHover] = useState(false);
	const base = iconBtn(!!active || hover);
	return (
		<button
			type="button"
			title={title}
			disabled={disabled}
			onClick={onClick}
			onMouseEnter={() => setHover(true)}
			onMouseLeave={() => setHover(false)}
			style={{
				...base,
				opacity: disabled ? 0.4 : 1,
				pointerEvents: disabled ? 'none' : 'auto',
			}}
		>
			{children}
		</button>
	);
}

export function Toolbar({ editor }: Props) {
	const [headingOpen, setHeadingOpen] = useState(false);
	const headingWrapRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!headingOpen) {
			return;
		}
		const onDocDown = (e: MouseEvent) => {
			if (
				headingWrapRef.current &&
				e.target instanceof Node &&
				!headingWrapRef.current.contains(e.target)
			) {
				setHeadingOpen(false);
			}
		};
		document.addEventListener('mousedown', onDocDown);
		return () => document.removeEventListener('mousedown', onDocDown);
	}, [headingOpen]);

	const headingLabel = editor.isActive('heading', { level: 1 })
		? 'Heading 1'
		: editor.isActive('heading', { level: 2 })
			? 'Heading 2'
			: editor.isActive('heading', { level: 3 })
				? 'Heading 3'
				: 'Paragraph';

	const triggerStyle: CSSProperties = {
		...iconBtn(false),
		width: 'auto',
		minWidth: 32,
		padding: '0 8px',
		gap: 4,
		fontSize: 12,
		fontWeight: 400,
		color: 'var(--vscode-descriptionForeground, var(--vscode-editor-foreground))',
	};

	const menuStyle: CSSProperties = {
		position: 'absolute',
		top: '100%',
		left: 0,
		marginTop: 4,
		minWidth: 176,
		padding: '4px 0',
		borderRadius: 6,
		border: '1px solid var(--vscode-editorWidget-border)',
		background: 'var(--vscode-editor-background)',
		boxShadow: '0 4px 16px var(--vscode-widget-shadow)',
		zIndex: 50,
	};

	const menuItem: CSSProperties = {
		display: 'flex',
		alignItems: 'center',
		width: '100%',
		gap: 8,
		padding: '8px 12px',
		border: 'none',
		background: 'transparent',
		color: 'var(--vscode-editor-foreground)',
		fontSize: 13,
		textAlign: 'left',
		cursor: 'pointer',
	};

	const runHeading = useCallback(
		(fn: () => void) => {
			fn();
			setHeadingOpen(false);
		},
		[],
	);

	return (
		<div style={shell}>
			<div style={toolbarRow} role="toolbar" aria-label="Formatting">
				<div ref={headingWrapRef} style={{ position: 'relative' }}>
					<button
						type="button"
						style={triggerStyle}
						onClick={() => setHeadingOpen((o) => !o)}
						aria-expanded={headingOpen}
						aria-haspopup="menu"
					>
						<Type size={14} strokeWidth={2} />
						<span style={{ maxWidth: '7rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
							{headingLabel}
						</span>
					</button>
					{headingOpen ? (
						<div style={menuStyle} role="menu">
							<button
								type="button"
								role="menuitem"
								style={menuItem}
								onMouseDown={(e) => e.preventDefault()}
								onClick={() =>
									runHeading(() => editor.chain().focus().setParagraph().run())
								}
							>
								Paragraph
							</button>
							<button
								type="button"
								role="menuitem"
								style={menuItem}
								onMouseDown={(e) => e.preventDefault()}
								onClick={() =>
									runHeading(() =>
										editor.chain().focus().toggleHeading({ level: 1 }).run(),
									)
								}
							>
								<Heading1 size={16} strokeWidth={2} />
								Heading 1
							</button>
							<button
								type="button"
								role="menuitem"
								style={menuItem}
								onMouseDown={(e) => e.preventDefault()}
								onClick={() =>
									runHeading(() =>
										editor.chain().focus().toggleHeading({ level: 2 }).run(),
									)
								}
							>
								<Heading2 size={16} strokeWidth={2} />
								Heading 2
							</button>
							<button
								type="button"
								role="menuitem"
								style={menuItem}
								onMouseDown={(e) => e.preventDefault()}
								onClick={() =>
									runHeading(() =>
										editor.chain().focus().toggleHeading({ level: 3 }).run(),
									)
								}
							>
								<Heading3 size={16} strokeWidth={2} />
								Heading 3
							</button>
						</div>
					) : null}
				</div>

				<div style={sep} />

				<ToolbarIconButton
					title="Bold"
					active={editor.isActive('bold')}
					onClick={() => editor.chain().focus().toggleBold().run()}
				>
					<Bold size={16} strokeWidth={2} />
				</ToolbarIconButton>
				<ToolbarIconButton
					title="Italic"
					active={editor.isActive('italic')}
					onClick={() => editor.chain().focus().toggleItalic().run()}
				>
					<Italic size={16} strokeWidth={2} />
				</ToolbarIconButton>
				<ToolbarIconButton
					title="Underline"
					active={editor.isActive('underline')}
					onClick={() => editor.chain().focus().toggleUnderline().run()}
				>
					<Underline size={16} strokeWidth={2} />
				</ToolbarIconButton>
				<ToolbarIconButton
					title="Strikethrough"
					active={editor.isActive('strike')}
					onClick={() => editor.chain().focus().toggleStrike().run()}
				>
					<Strikethrough size={16} strokeWidth={2} />
				</ToolbarIconButton>
				<ToolbarIconButton
					title="Inline code"
					active={editor.isActive('code')}
					onClick={() => editor.chain().focus().toggleCode().run()}
				>
					<Code size={16} strokeWidth={2} />
				</ToolbarIconButton>

				<div style={sep} />

				<ToolbarIconButton
					title="Bullet list"
					active={editor.isActive('bulletList')}
					onClick={() => editor.chain().focus().toggleBulletList().run()}
				>
					<List size={16} strokeWidth={2} />
				</ToolbarIconButton>
				<ToolbarIconButton
					title="Numbered list"
					active={editor.isActive('orderedList')}
					onClick={() => editor.chain().focus().toggleOrderedList().run()}
				>
					<ListOrdered size={16} strokeWidth={2} />
				</ToolbarIconButton>
				<ToolbarIconButton
					title="Task list"
					active={editor.isActive('taskList')}
					onClick={() => editor.chain().focus().toggleTaskList().run()}
				>
					<CheckSquare size={16} strokeWidth={2} />
				</ToolbarIconButton>
				<ToolbarIconButton
					title="Quote"
					active={editor.isActive('blockquote')}
					onClick={() => editor.chain().focus().toggleBlockquote().run()}
				>
					<Quote size={16} strokeWidth={2} />
				</ToolbarIconButton>

				<div style={sep} />

				<ToolbarIconButton
					title="Undo"
					disabled={!editor.can().undo()}
					onClick={() => editor.chain().focus().undo().run()}
				>
					<Undo2 size={16} strokeWidth={2} />
				</ToolbarIconButton>
				<ToolbarIconButton
					title="Redo"
					disabled={!editor.can().redo()}
					onClick={() => editor.chain().focus().redo().run()}
				>
					<Redo2 size={16} strokeWidth={2} />
				</ToolbarIconButton>
			</div>
			<div style={bottomRule} aria-hidden="true" />
		</div>
	);
}
