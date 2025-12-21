# Codex Tool (Experimental)

Invoke OpenAI Codex CLI headlessly from within pi-mono.

> **WARNING**: This is an experimental integration. Codex CLI output format may change without notice.

## Prerequisites

1. **Install Codex CLI:**

   ```bash
   npm install -g @openai/codex
   ```

2. **Login:**
   ```bash
   codex login
   ```

## Installation

The tool is auto-discovered from `~/.pi/agent/tools/codex-experimental/`:

```bash
# From pi-mono root
mkdir -p ~/.pi/agent/tools/codex-experimental
ln -sf "$(pwd)/packages/coding-agent/examples/custom-tools/codex-experimental/index.ts" \
  ~/.pi/agent/tools/codex-experimental/index.ts
```

## Usage

Within pi-mono, ask the model to use the codex tool:

```
Use codex to explain what packages/ai/src/types.ts does
```

```
Use codex to find all authentication-related code
```

### Allowing File Modifications

By default, Codex runs in **read-only** mode and cannot modify files.

To allow file modifications, explicitly specify `workspace-write`:

```
Use codex with sandbox workspace-write to refactor this function
```

> **CAUTION**: The `workspace-write` mode allows Codex to create, edit, and delete files in your workspace. Only use this when you trust the task and are prepared to review/revert changes.

## Parameters

| Parameter | Type                             | Default           | Description                            |
| --------- | -------------------------------- | ----------------- | -------------------------------------- |
| `prompt`  | string                           | (required)        | Task for Codex to execute              |
| `model`   | string                           | (Codex default)   | Model override (e.g., "o3", "o4-mini") |
| `sandbox` | "read-only" \| "workspace-write" | "read-only"       | Sandbox mode                           |
| `workDir` | string                           | current directory | Working directory                      |

## How It Works

1. Spawns `codex exec --json` as a subprocess
2. Streams JSONL events to the TUI as progress updates
3. Returns Codex's final message as the tool result
4. Handles Ctrl+C by killing the subprocess cleanly

## Limitations

| Feature             | This Tool     | Native Codex CLI  |
| ------------------- | ------------- | ----------------- |
| Streaming tokens    | Batch events  | Real-time         |
| Interactive prompts | Not supported | Full support      |
| Multi-turn in Codex | Single task   | Full conversation |
| Rich TUI            | Simplified    | Full Codex TUI    |

**Best for:** Occasional, targeted Codex calls without leaving pi-mono.  
**Not for:** Extended Codex sessions—use `codex` directly for those.

## Platform Notes

- **macOS/Linux**: Tested and working
- **Windows**: Best-effort support; signal handling may differ
