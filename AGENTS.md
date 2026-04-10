# VS Code Agents Instructions

This file provides instructions for AI coding agents working with the VS Code codebase.

For detailed project overview, architecture, coding guidelines, and validation steps, see the [Copilot Instructions](.github/copilot-instructions.md).

## Harper + Rich Writer

The [Harper](https://github.com/FraterCCCLXIII/harper) grammar checker is linked as a **git submodule** at `harper/` and included in the [multi-root workspace](vscode-writer.code-workspace). Install the **Harper** VS Code extension (`elijah-potter.harper`) so grammar diagnostics run while editing Markdown in **Rich Writer**: the custom editor updates the underlying `file` / `markdown` document, which Harper’s language server uses.
