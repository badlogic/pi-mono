# TUI renderer environment variables for preview lines

This document describes environment variables that control how many lines the TUI tool renderer shows when previewing tool output (bash/read/write). These variables provide convenient user-level defaults; component-level settings take precedence when available.

Variables
- `PI_BASH_PREVIEW_LINES`
  - Description: Number of lines to show when previewing output from the `bash` tool.
  - Default: `5` lines.

- `PI_READ_PREVIEW_LINES`
  - Description: Number of lines to show when previewing output from the `read` tool.
  - Default: `10` lines.

- `PI_WRITE_PREVIEW_LINES`
  - Description: Number of lines to show when previewing content passed to the `write` tool.
  - Default: `10` lines.

Behavior and validation

- The renderer first checks a component-level `previewLines` value (when provided by the caller). If present, that value takes precedence.
- If no component-level value is set, the renderer looks for the tool-specific environment variable (for example `PI_BASH_PREVIEW_LINES`).
- If an environment variable is undefined, null, or an empty string, the renderer ignores it and uses the appropriate default.
- Only integer values strictly greater than `0` and less than `Number.MAX_SAFE_INTEGER` are accepted from environment variables. Non-numeric values, `0`, negative numbers, or values >= `Number.MAX_SAFE_INTEGER` are ignored and the default is used instead.

Examples

Set the bash preview lines for the current session:

```bash
export PI_BASH_PREVIEW_LINES=20
```

Persist these in your shell config (`~/.bashrc`, `~/.zshrc`, etc.) to keep them across sessions.

Caution

- These environment variables affect only the preview display count, not the underlying data. They are intended to improve readability basedcon user preference in the TUI and are safe to change.
- Do not set values to `0` expecting an "unlimited" behavior; `0` is considered invalid and the default will be used. If a very large value is required, set an appropriately large positive integer (but keep in mind `Number.MAX_SAFE_INTEGER` is the upper bound).
