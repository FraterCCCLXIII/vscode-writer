# VS Code Agents Instructions

This file provides instructions for AI coding agents working with the VS Code codebase.

For detailed project overview, architecture, coding guidelines, and validation steps, see the [Copilot Instructions](.github/copilot-instructions.md).

## Harper + Caret

The [Harper](https://github.com/FraterCCCLXIII/harper) grammar checker is linked as a **git submodule** at `harper/` and included in the [multi-root workspace](vscode-writer.code-workspace). Install the **Harper** VS Code extension (`elijah-potter.harper`) so grammar diagnostics run while editing Markdown in **Caret**: the custom editor updates the underlying `file` / `markdown` document, which Harper’s language server uses.

### Caret comments (Writer extension)

Review-style **comments** are **not** stored inside `.md` / `.rtf` files. They are persisted in the Writer extension’s **workspace state** under `writer.comments.v1` (see `extensions/writer/src/commentService.ts`). Each comment has a stable id, the file `resource` URI, body text, and an **anchor**: UTF-16 `start`/`end` plus a **quote** of the selected text at creation time. When the workspace document changes, anchors are **reconciled** against the current file text (exact match, line-ending variants, same span if text was rewritten in place, or a longest substring near the old span); unmatched comments are marked orphaned.

The **Comments** side bar (`extensions/writer/src/commentsViewProvider.ts` + `extensions/writer/webview-src/commentsPanel.tsx`) lists all comments; opening or focusing a comment uses **`vscode.openWith`** so the file opens in the **Caret** custom editor, not the default text editor. The Caret webview (`extensions/writer/webview-src/main.tsx`) receives comment metadata from the host, paints **inline highlights** via TipTap (`extensions/writer/webview-src/writerCommentHighlights.ts`), and syncs **active** comment state between the editor and the panel.

This differs from **footnotes**, which are part of the Markdown document (`[^id]` / definitions) and round-trip through the editor pipeline—see `extensions/writer/webview-src/writerFootnote.ts` and related files.

### Agent / programmatic comment & footnote

To add a comment or footnote **without** the floating toolbar, use the Writer commands `vscode.writer.addComment` and `vscode.writer.insertFootnote` (see `.agents/skills/caret-agent-actions/SKILL.md`). The Caret webview must be active; **addComment** requires a non-empty selection.
