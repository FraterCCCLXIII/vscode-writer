# Caret (Writer Extension)

Caret is a custom Markdown and RTF editor for VS Code, built on [TipTap](https://tiptap.dev/) (ProseMirror). It provides a Notion-style rich text experience inside the editor with features like inline AI, footnotes, review comments, and AI-powered writing continuation.

## Write Next

Write Next is an AI-powered feature that continues writing at the cursor position, matching the style and tone of the surrounding text.

### How to trigger

- **Keyboard:** Press `Cmd+Return` (Mac) or `Ctrl+Return` (Windows/Linux) with a collapsed caret (no selection).
- **Button:** After the caret is idle for ~800ms, a floating "Write" button appears above the cursor. Click it to trigger.

### How it works

When triggered, Write Next sends a request to the extension host which orchestrates an LLM call using the `vscode.lm` API (e.g., GitHub Copilot). The model receives:

1. **Cursor context** -- approximately 500 words before the cursor and 200 words after, extracted from the TipTap document.
2. **Workspace file tree** -- a listing of all `.md`, `.rtf`, and `.txt` files in the workspace (up to 100), included directly in the prompt so the model knows what reference material is available.
3. **Two on-demand tools** the model can call before writing:
   - `read_file` -- reads the contents of a specific workspace file (truncated to 4000 characters by default). The model uses this to pull in outlines, research notes, character sheets, chapter drafts, or any other reference material it identifies from the file tree.
   - `search_workspace` -- performs a case-insensitive keyword search across all workspace documents, returning the top 5 matching snippets with surrounding context. The model uses this when a file name alone is not enough to locate relevant information.

### Context-gathering flow

The model autonomously decides whether to use tools based on the content:

- **Simple/casual text** (e.g., a journal entry, a README): the model skips tools entirely and writes directly. No extra latency.
- **Text referencing specific topics, characters, or facts** (e.g., a novel chapter mentioning a character's backstory, a research paper citing specific findings): the model calls `read_file` or `search_workspace` to gather relevant context, then writes an informed continuation.

```
User triggers Write Next
        |
        v
Extension host gathers workspace file tree
        |
        v
LLM receives: prompt + file tree + cursor context + tools
        |
        v
   Model decides:
   /            \
  v              v
No tools       Calls read_file / search_workspace
needed         (1-5 rounds, typically 0-1)
  |              |
  v              v
Streams text inline as ghost text at the cursor
        |
        v
User sees inline ghost text: Accept / Discard / Stop
```

Tool-calling rounds are capped at 5 to prevent runaway loops. In practice, 0 or 1 rounds are typical.

### UX flow

1. The "Write" button appears above the cursor (or the user presses the hotkey).
2. If the model is gathering context via tools, a status message is shown in a small action bar (e.g., "Reading research/sources.md..." or "Searching for 'character name'...").
3. As the model generates text, it appears **inline** at the cursor position as semi-transparent "ghost text" -- the text is inserted directly into the document.
4. The user can:
   - **Accept** -- keeps the ghost text and removes the ghost styling (text becomes permanent).
   - **Discard** -- deletes the ghost text and returns to normal editing.
   - **Stop** -- cancels the generation mid-stream.

### Architecture

- **Webview** (`WriteNextButton.tsx`, `main.tsx`): handles UI, caret positioning, idle detection, inline ghost text insertion, and the accept/discard action bar. Communicates with the extension host via `postMessage`.
- **Protocol** (`protocol.ts`): defines message types -- `writeNextRequest`/`writeNextCancel` (webview to host) and `writeNextDelta`/`writeNextDone`/`writeNextError`/`writeNextStatus` (host to webview).
- **Extension host** (`writerEditorProvider.ts`): orchestrates the LLM call, manages the tool-use loop, fulfills tool calls against the workspace filesystem, and streams results back to the webview.

The webview has no knowledge of the RAG/tool-calling logic. It only sees delta/done/error/status messages.

## Other Features

- **Inline AI** (`InlineAiPanel.tsx`): selection-based AI rewriting -- select text, describe what you want, and the AI replaces it.
- **Footnotes** (`writerFootnote.ts`): Markdown footnote support with inline references, hover popovers, and dynamic reordering.
- **Review Comments** (`writerCommentHighlights.ts`, `commentService.ts`): document-level review comments stored in workspace state with inline highlights and a side panel.
- **Rich Editing**: tables, task lists, drag handles, image paste/drop, text alignment, and full Markdown round-tripping.
