/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useRef, useState } from 'react';

type Props = {
	open: boolean;
	title?: string;
	onClose: () => void;
	/** Called with trimmed footnote body (may be empty — stored as placeholder). */
	onConfirm: (body: string) => void;
};

/**
 * Modal footnote composer for toolbar (and anywhere else that is not the selection bubble).
 */
export function FootnoteComposerModal({ open, title = 'Footnote', onClose, onConfirm }: Props) {
	const [draft, setDraft] = useState('');
	const taRef = useRef<HTMLTextAreaElement | null>(null);

	useEffect(() => {
		if (open) {
			setDraft('');
			queueMicrotask(() => taRef.current?.focus());
		}
	}, [open]);

	if (!open) {
		return null;
	}

	return (
		<div
			role="dialog"
			aria-modal="true"
			aria-labelledby="writer-fn-modal-title"
			style={{
				position: 'fixed',
				inset: 0,
				zIndex: 200_000,
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				background: 'color-mix(in srgb, var(--vscode-editor-background) 60%, transparent)',
				pointerEvents: 'auto',
			}}
			onMouseDown={e => {
				if (e.target === e.currentTarget) {
					onClose();
				}
			}}
		>
			<div
				style={{
					width: 'min(420px, 92vw)',
					padding: 16,
					borderRadius: 8,
					border: '1px solid var(--vscode-widget-border)',
					background: 'var(--vscode-editor-background)',
					boxShadow: '0 8px 32px var(--vscode-widget-shadow)',
				}}
				onMouseDown={e => e.stopPropagation()}
			>
				<h2 id="writer-fn-modal-title" style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 600 }}>
					{title}
				</h2>
				<p style={{ margin: '0 0 8px', fontSize: 12, opacity: 0.85 }}>
					Text is saved at the bottom of the document. You can edit or remove it there later.
				</p>
				<textarea
					ref={taRef}
					value={draft}
					onChange={e => setDraft(e.target.value)}
					rows={5}
					placeholder="Footnote text…"
					style={{
						width: '100%',
						boxSizing: 'border-box',
						resize: 'vertical',
						fontFamily: 'var(--vscode-font-family)',
						fontSize: 'var(--vscode-font-size)',
						color: 'var(--vscode-input-foreground)',
						background: 'var(--vscode-input-background)',
						border: '1px solid var(--vscode-input-border)',
						borderRadius: 4,
						padding: 8,
					}}
				/>
				<div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
					<button type="button" onClick={onClose} style={{ cursor: 'pointer' }}>
						Cancel
					</button>
					<button
						type="button"
						onClick={() => {
							onConfirm(draft);
							onClose();
						}}
						style={{ cursor: 'pointer' }}
					>
						Add footnote
					</button>
				</div>
			</div>
		</div>
	);
}
