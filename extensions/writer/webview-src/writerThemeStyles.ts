/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Rich editor styles sourced from VS Code webview theme variables (workbench color theme).
 * See src/vs/workbench/contrib/webview/browser/themeing.ts — all registered theme colors are
 * exposed as --vscode-* on the webview document.
 */
export const WRITER_THEME_STYLES = `
.writer-editor-scroll {
	scrollbar-color: var(--vscode-scrollbarSlider-background) transparent;
}
.writer-editor-scroll::-webkit-scrollbar {
	width: 10px;
	height: 10px;
}
.writer-editor-scroll::-webkit-scrollbar-thumb {
	background: var(--vscode-scrollbarSlider-background);
	border-radius: 5px;
}
.writer-editor-scroll::-webkit-scrollbar-thumb:hover {
	background: var(--vscode-scrollbarSlider-hoverBackground);
}

.ProseMirror {
	outline: none;
	min-height: 200px;
	line-height: 1.65;
	color: var(--vscode-editor-foreground);
	caret-color: var(--vscode-editor-foreground);
}
.ProseMirror::selection,
.ProseMirror *::selection {
	background: var(--vscode-editor-selectionBackground);
	color: var(--vscode-editor-selectionForeground, var(--vscode-editor-foreground));
}

/* LSP / Harper diagnostics bridged from host (see writerDiagnostics.ts) */
.writer-lint-error,
.writer-lint-warning,
.writer-lint-info,
.writer-lint-hint {
	text-decoration: underline wavy;
	text-underline-offset: 2px;
}
.writer-lint-error {
	text-decoration-color: var(--vscode-editorError-foreground, #f14c4c);
}
.writer-lint-warning {
	text-decoration-color: var(--vscode-editorWarning-foreground, #cca700);
}
.writer-lint-info {
	text-decoration-color: var(--vscode-editorInfo-foreground, #3794ff);
}
.writer-lint-hint {
	text-decoration-color: var(--vscode-editorHint-foreground, var(--vscode-descriptionForeground));
}

.ProseMirror p { margin: 0.5em 0; }
.ProseMirror h1 { font-size: 1.75em; margin: 0.6em 0 0.3em; font-weight: 600; color: var(--vscode-editor-foreground); }
.ProseMirror h2 { font-size: 1.4em; margin: 0.6em 0 0.3em; font-weight: 600; color: var(--vscode-editor-foreground); }
.ProseMirror h3 { font-size: 1.15em; margin: 0.6em 0 0.3em; font-weight: 600; color: var(--vscode-editor-foreground); }

.ProseMirror ul:not(.writer-task-list),
.ProseMirror ol {
	padding-left: 1.5em;
}
.ProseMirror li::marker {
	color: var(--vscode-editor-foreground);
}

.ProseMirror blockquote {
	border-left: 3px solid var(--vscode-editorWidget-border);
	margin-left: 0;
	padding-left: 1em;
	color: var(--vscode-editor-foreground);
}

.ProseMirror sup.writer-fn-ref {
	font-size: 0.8em;
	vertical-align: super;
}
.ProseMirror sup.writer-fn-ref a {
	color: var(--vscode-textLink-foreground);
	text-decoration: none;
}
.ProseMirror p.writer-fn-def {
	margin-top: 1.25em;
	padding-top: 0.5em;
	border-top: 1px solid var(--vscode-editorWidget-border);
	font-size: 0.95em;
	color: var(--vscode-descriptionForeground);
}

.ProseMirror code {
	background: var(--vscode-textCodeBlock-background);
	padding: 0.1em 0.35em;
	border-radius: 4px;
	font-size: 0.9em;
	color: var(--vscode-editor-foreground);
}
.ProseMirror pre {
	background: var(--vscode-textCodeBlock-background);
	padding: 12px;
	border-radius: 6px;
	overflow-x: auto;
	color: var(--vscode-editor-foreground);
	border: 1px solid var(--vscode-editorWidget-border);
}

.ProseMirror a {
	color: var(--vscode-textLink-foreground);
	text-decoration-color: var(--vscode-textLink-foreground);
}
.ProseMirror a:hover {
	color: var(--vscode-textLink-activeForeground);
}
.ProseMirror a:focus-visible {
	outline: 1px solid var(--vscode-focusBorder);
	outline-offset: 2px;
}

.ProseMirror hr {
	border: none;
	border-top: 1px solid var(--vscode-editorWidget-border);
	margin: 1em 0;
}

.ProseMirror img {
	max-width: 100%;
	height: auto;
}

.ProseMirror .tableWrapper {
	overflow-x: auto;
	margin: 0.75em 0;
}
.ProseMirror table {
	border-collapse: collapse;
	width: 100%;
	table-layout: fixed;
}
.ProseMirror th,
.ProseMirror td {
	border: 1px solid var(--vscode-editorWidget-border);
	padding: 6px 10px;
	vertical-align: top;
	min-width: 4em;
}
.ProseMirror th {
	background: var(--vscode-editor-inactiveSelectionBackground, var(--vscode-textCodeBlock-background));
	font-weight: 600;
}
.ProseMirror .column-resize-handle {
	background-color: var(--vscode-focusBorder);
}

/* TipTap placeholder — data-placeholder on empty block nodes */
.ProseMirror p.is-editor-empty:first-child::before {
	content: attr(data-placeholder);
	float: left;
	height: 0;
	pointer-events: none;
	color: var(--vscode-input-placeholderForeground, var(--vscode-descriptionForeground));
}

.writer-task-list { list-style: none; padding-left: 0.25rem; }
.writer-task-item { display: flex; gap: 0.5rem; align-items: flex-start; margin: 0.75rem 0; }
.writer-task-item label { flex: 1; }
.writer-task-item input[type="checkbox"] {
	accent-color: var(--vscode-focusBorder);
	margin-top: 0.2em;
}

.ProseMirror:not(.dragging) .ProseMirror-selectednode {
	outline: none !important;
	background-color: color-mix(in srgb, var(--vscode-focusBorder) 18%, transparent);
	transition: background-color 0.2s;
}

/* ProseMirror drop cursor — theme color overrides inline color from the plugin */
.ProseMirror-dropcursor-block {
	border-top-color: var(--vscode-focusBorder) !important;
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
	background-color: transparent;
	background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10' fill='%23808080'%3E%3Cpath d='M3,2 C2.44771525,2 2,1.55228475 2,1 C2,0.44771525 2.44771525,0 3,0 C3.55228475,0 4,0.44771525 4,1 C4,1.55228475 3.55228475,2 3,2 Z M3,6 C2.44771525,6 2,5.55228475 2,5 C2,4.44771525 2.44771525,4 3,4 C3.55228475,4 4,4.44771525 4,5 C4,5.55228475 3.55228475,6 3,6 Z M3,10 C2.44771525,10 2,9.55228475 2,9 C2,8.44771525 2.44771525,8 3,8 C3.55228475,8 4,8.44771525 4,9 C4,9.55228475 3.55228475,10 3,10 Z M7,2 C6.44771525,2 6,1.55228475 6,1 C6,0.44771525 6.44771525,0 7,0 C7.55228475,0 8,0.44771525 8,1 C8,1.55228475 7.55228475,2 7,2 Z M7,6 C6.44771525,6 6,5.55228475 6,5 C6,4.44771525 6.44771525,4 7,4 C7.55228475,4 8,4.44771525 8,5 C8,5.55228475 7.55228475,6 7,6 Z M7,10 C6.44771525,10 6,9.55228475 6,9 C6,8.44771525 6.44771525,8 7,8 C7.55228475,8 8,8.44771525 8,9 C8,9.55228475 7.55228475,10 7,10 Z'/%3E%3C/svg%3E");
	background-repeat: no-repeat;
	background-position: center;
	background-size: calc(0.5em + 0.375rem) calc(0.5em + 0.375rem);
}
.drag-handle:hover {
	background-color: color-mix(in srgb, var(--vscode-toolbar-hoverBackground) 80%, transparent);
}
.drag-handle:active {
	cursor: grabbing;
	background-color: color-mix(in srgb, var(--vscode-toolbar-hoverBackground) 100%, transparent);
}
.drag-handle.hide {
	opacity: 0;
	pointer-events: none;
}
`;
