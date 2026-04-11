/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Editor } from '@tiptap/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { deleteWriterFootnote, scrollFootnoteDefIntoView } from './writerFootnote';

type PopoverState = {
	left: number;
	top: number;
	footnoteId: string;
	text: string;
};

type Props = {
	editor: Editor | null;
};

/**
 * Hover popover on footnote references: full text, jump to definition, remove.
 */
export function FootnoteHoverPopover({ editor }: Props) {
	const [pop, setPop] = useState<PopoverState | null>(null);
	const hideTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>();

	const clearHide = useCallback(() => {
		if (hideTimerRef.current !== undefined) {
			clearTimeout(hideTimerRef.current);
			hideTimerRef.current = undefined;
		}
	}, []);

	const scheduleHide = useCallback(() => {
		clearHide();
		hideTimerRef.current = setTimeout(() => setPop(null), 180);
	}, [clearHide]);

	const showForSup = useCallback(
		(sup: HTMLElement) => {
			if (!editor || editor.isDestroyed) {
				return;
			}
			const id = sup.getAttribute('data-footnote-id');
			if (!id) {
				return;
			}
			const def = editor.view.dom.querySelector(
				`p.writer-fn-def[data-footnote-id="${CSS.escape(id)}"]`,
			) as HTMLElement | null;
			const text =
				(def?.innerText ?? def?.textContent ?? '').replace(/\u00a0/g, ' ').trim() || '(empty)';
			const rect = sup.getBoundingClientRect();
			setPop({
				left: Math.max(8, Math.min(rect.left, window.innerWidth - 320)),
				top: rect.bottom + 6,
				footnoteId: id,
				text,
			});
		},
		[editor],
	);

	useEffect(() => {
		if (!editor || editor.isDestroyed) {
			return;
		}
		const root = editor.view.dom;

		const onMouseOver = (e: MouseEvent) => {
			const t = e.target as HTMLElement | null;
			const sup = t?.closest?.('sup.writer-fn-ref');
			if (sup && root.contains(sup)) {
				clearHide();
				showForSup(sup);
			}
		};

		const onMouseOut = (e: MouseEvent) => {
			const related = e.relatedTarget as HTMLElement | null;
			if (related?.closest?.('.writer-footnote-popover')) {
				clearHide();
				return;
			}
			const from = (e.target as HTMLElement | null)?.closest?.('sup.writer-fn-ref');
			if (!from || !root.contains(from)) {
				return;
			}
			if (related && (from === related || from.contains(related))) {
				return;
			}
			scheduleHide();
		};

		root.addEventListener('mouseover', onMouseOver);
		root.addEventListener('mouseout', onMouseOut);
		return () => {
			root.removeEventListener('mouseover', onMouseOver);
			root.removeEventListener('mouseout', onMouseOut);
			clearHide();
		};
	}, [editor, clearHide, scheduleHide, showForSup]);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				setPop(null);
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, []);

	if (!pop || !editor) {
		return null;
	}

	return (
		<div
			className="writer-footnote-popover"
			role="tooltip"
			style={{
				position: 'fixed',
				left: pop.left,
				top: pop.top,
				zIndex: 150_000,
				maxWidth: 320,
				padding: 10,
				borderRadius: 6,
				border: '1px solid var(--vscode-editorWidget-border)',
				background: 'var(--vscode-editor-background)',
				boxShadow: '0 6px 20px var(--vscode-widget-shadow)',
				fontSize: 12,
				lineHeight: 1.45,
				color: 'var(--vscode-editor-foreground)',
				pointerEvents: 'auto',
			}}
			onMouseEnter={clearHide}
			onMouseLeave={() => setPop(null)}
		>
			<div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginBottom: 8 }}>{pop.text}</div>
			<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
				<button
					type="button"
					style={{ cursor: 'pointer', fontSize: 11 }}
					onClick={() => {
						scrollFootnoteDefIntoView(editor, pop.footnoteId);
						setPop(null);
					}}
				>
					Go to footnote
				</button>
				<button
					type="button"
					style={{ cursor: 'pointer', fontSize: 11, color: 'var(--vscode-errorForeground)' }}
					onClick={() => {
						deleteWriterFootnote(editor, pop.footnoteId);
						setPop(null);
					}}
				>
					Remove footnote
				</button>
			</div>
		</div>
	);
}
