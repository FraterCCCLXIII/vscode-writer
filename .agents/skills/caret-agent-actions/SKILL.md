---
name: caret-agent-actions
description: "Add Caret (Writer) review comments or Markdown footnotes programmatically via VS Code commands. Use when the user or task requires leaving a Writer comment from an agent, inserting a footnote without the floating toolbar, or automating Caret with executeCommand."
metadata:
  allowed-tools: Bash(*)
---

# Caret: agent commands for comments and footnotes

Caret stores **comments** in extension workspace state (not in the `.md` file). **Footnotes** are part of the Markdown document. The Writer extension exposes two commands so an agent (or a keybinding) can trigger these actions **without** clicking the floating selection bar.

## Prerequisites

1. The target file is open in the **Caret** custom editor (`vscode.writer.editor`), not the default text editor. If needed: **Reopen Editor With… → Caret**.
2. The **Caret** webview must be focused (or the custom editor active) so selection/caret state is valid.
3. **Add comment:** requires a **non-empty text selection** in the editor when the command runs.
4. **Insert footnote:** only for **Markdown** (`.md`). Uses the **current caret** or **selection end** as the insertion point (same rules as the toolbar footnote control).

## Commands (VS Code)

Execute via **Command Palette**, **keybindings**, or **`vscode.commands.executeCommand`** from another extension.

### `vscode.writer.addComment`

**Arguments:** `{ body: string }` — the comment text (required).

**Example (JSON args in keybinding or API):**

```json
{ "body": "TODO: tighten this paragraph." }
```

**Programmatic:**

```ts
await vscode.commands.executeCommand('vscode.writer.addComment', {
  body: 'Review note for the selected span.',
});
```

If `body` is missing or empty, the extension shows a warning. If there is no selection, the webview reports a warning. If the file is not open in Caret, the extension shows a warning.

### `vscode.writer.insertFootnote`

**Arguments (optional):** `{ body?: string }` — footnote definition body. Omit or use `""` for the default placeholder text.

**Example:**

```json
{ "body": "Source: …" }
```

**Programmatic:**

```ts
await vscode.commands.executeCommand('vscode.writer.insertFootnote', {
  body: 'Citation or note text.',
});
```

For non-Markdown documents, the webview reports that footnotes are Markdown-only.

## Implementation notes (for maintainers)

- Host posts `agentAddComment` / `agentInsertFootnote` to the Caret webview; the webview reuses the same `commentAdd` pipeline as the selection bubble or calls `insertWriterFootnote`.
- Panel lookup: `extensions/writer/src/writerPanelRegistry.ts` maps document URI → `WebviewPanel`.
- Protocol: `extensions/writer/src/protocol.ts` (`ToWebview` / `FromWebview`).

## UI automation alternative

If you cannot call VS Code APIs (e.g. external E2E only), use the **launch** skill (`./.agents/skills/launch/SKILL.md`) with **agent-browser** to drive the Caret webview: select text, use the floating **Comment** or **Footnote** controls. Prefer the commands above when automation runs **inside** VS Code or via an extension.
