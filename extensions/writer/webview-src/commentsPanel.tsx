/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

type CommentRow = {
	id: string;
	resource: string;
	label: string;
	body: string;
	createdAt: number;
	orphaned: boolean;
	quotePreview: string;
};

type VsCodeApi = { postMessage: (msg: unknown) => void };

function getApi(): VsCodeApi {
	const w = globalThis as unknown as { __writerCommentsApi?: VsCodeApi };
	if (!w.__writerCommentsApi) {
		throw new Error('VS Code API unavailable');
	}
	return w.__writerCommentsApi;
}

function groupByResource(rows: CommentRow[]): Map<string, CommentRow[]> {
	const m = new Map<string, CommentRow[]>();
	for (const r of rows) {
		const list = m.get(r.resource) ?? [];
		list.push(r);
		m.set(r.resource, list);
	}
	return m;
}

function CommentsApp() {
	const [comments, setComments] = useState<CommentRow[]>([]);
	const [activeCommentId, setActiveCommentId] = useState<string | null>(null);

	useEffect(() => {
		const onMsg = (e: MessageEvent) => {
			const d = e.data as { type?: string; comments?: CommentRow[]; activeCommentId?: string | null };
			if (d?.type === 'update' && Array.isArray(d.comments)) {
				setComments(d.comments);
				setActiveCommentId(typeof d.activeCommentId === 'string' ? d.activeCommentId : null);
			}
		};
		window.addEventListener('message', onMsg);
		return () => window.removeEventListener('message', onMsg);
	}, []);

	const api = getApi();
	const grouped = groupByResource(comments);
	const keys = [...grouped.keys()].sort((a, b) => {
		const la = grouped.get(a)?.[0]?.label ?? '';
		const lb = grouped.get(b)?.[0]?.label ?? '';
		return la.localeCompare(lb);
	});

	return (
		<div
			style={{ padding: '8px 10px 16px', boxSizing: 'border-box' }}
			onMouseDown={e => {
				if ((e.target as HTMLElement).closest('[data-writer-comment-row]')) {
					return;
				}
				api.postMessage({ type: 'clearActiveComment' });
			}}
		>
			{comments.length === 0 ? (
				<p style={{ opacity: 0.8, margin: '8px 0' }}>No comments yet. Select text in Caret and use the comment button.</p>
			) : null}
			{keys.map(resource => (
				<section key={resource} style={{ marginBottom: 16 }}>
					<div
						style={{
							fontSize: '11px',
							fontWeight: 600,
							textTransform: 'uppercase',
							opacity: 0.85,
							marginBottom: 6,
							cursor: 'pointer',
						}}
						role="button"
						tabIndex={0}
						onClick={() => api.postMessage({ type: 'open', resource })}
						onKeyDown={e => {
							if (e.key === 'Enter' || e.key === ' ') {
								e.preventDefault();
								api.postMessage({ type: 'open', resource });
							}
						}}
					>
						{grouped.get(resource)?.[0]?.label ?? resource}
					</div>
					<ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
						{(grouped.get(resource) ?? []).map(c => {
							const isActive = activeCommentId !== null && c.id === activeCommentId;
							return (
							<li
								data-writer-comment-row
								key={c.id}
								style={{
									border: isActive
										? '1px solid var(--vscode-focusBorder)'
										: '1px solid var(--vscode-widget-border)',
									borderRadius: 6,
									padding: '8px 10px',
									marginBottom: 8,
									background: isActive
										? 'var(--vscode-list-activeSelectionBackground)'
										: 'var(--vscode-editor-inactiveSelectionBackground)',
									color: isActive
										? 'var(--vscode-list-activeSelectionForeground, var(--vscode-foreground))'
										: undefined,
									boxShadow: isActive ? '0 0 0 1px color-mix(in srgb, var(--vscode-focusBorder) 40%, transparent)' : undefined,
									cursor: 'pointer',
								}}
								role="button"
								tabIndex={0}
								aria-selected={isActive}
								onClick={() => api.postMessage({ type: 'focusComment', id: c.id, resource: c.resource })}
								onKeyDown={e => {
									if (e.key === 'Enter' || e.key === ' ') {
										e.preventDefault();
										api.postMessage({ type: 'focusComment', id: c.id, resource: c.resource });
									}
								}}
							>
								<div style={{ fontSize: '12px', opacity: 0.9, marginBottom: 4 }}>{c.quotePreview || '(selection)'}</div>
								<div style={{ marginBottom: 6 }}>{c.body}</div>
								<div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
									{c.orphaned ? (
										<span style={{ fontSize: '11px', color: 'var(--vscode-errorForeground)' }}>Location unknown</span>
									) : null}
									<button
										type="button"
										style={{
											fontSize: '11px',
											cursor: 'pointer',
											background: 'transparent',
											border: 'none',
											color: 'var(--vscode-descriptionForeground)',
											padding: 0,
										}}
										onClick={e => {
											e.stopPropagation();
											api.postMessage({ type: 'remove', id: c.id });
										}}
									>
										Remove
									</button>
								</div>
							</li>
							);
						})}
					</ul>
				</section>
			))}
		</div>
	);
}

const el = document.getElementById('root');
if (el) {
	createRoot(el).render(<CommentsApp />);
}
