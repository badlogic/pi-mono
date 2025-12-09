# pi

A terminal-based coding agent with multi-model support, mid-session model switching, and a simple CLI for headless coding tasks.

Works on Linux, macOS, and Windows (requires bash; see [Windows Setup](#windows-setup)).

## Table of Contents

- [Getting Started](#getting-started)
  - [Installation](#installation)
  - [Windows Setup](#windows-setup)
  - [API Keys](#api-keys)
  - [Quick Start](#quick-start)
- [Usage](#usage)
  - [Slash Commands](#slash-commands)
  - [Editor Features](#editor-features)
  - [Keyboard Shortcuts](#keyboard-shortcuts)
  - [Bash Mode](#bash-mode)
  - [Image Support](#image-support)
- [Sessions](#sessions)
  - [Session Management](#session-management)
  - [Context Compaction](#context-compaction)
  - [Branching](#branching)
- [Configuration](#configuration)
  - [Project Context Files](#project-context-files)
  - [Custom Models and Providers](#custom-models-and-providers)
  - [Themes](#themes)
  - [Custom Slash Commands](#custom-slash-commands)
  - [Hooks](#hooks)
  - [Settings File](#settings-file)
- [CLI Reference](#cli-reference)
- [Tools](#tools)
- [Programmatic Usage](#programmatic-usage)
- [Philosophy](#philosophy)
- [Development](#development)
- [License](#license)

---

## Getting Started

### Installation

**npm (recommended):**

```bash
npm install -g @mariozechner/pi-coding-agent
```

**Standalone binary:**

Download from [GitHub Releases](https://github.com/badlogic/pi-mono/releases):

| Platform | Archive |
|----------|---------|
| macOS Apple Silicon | `pi-darwin-arm64.tar.gz` |
| macOS Intel | `pi-darwin-x64.tar.gz` |
| Linux x64 | `pi-linux-x64.tar.gz` |
| Linux ARM64 | `pi-linux-arm64.tar.gz` |
| Windows x64 | `pi-windows-x64.zip` |

```bash
# macOS/Linux
tar -xzf pi-darwin-arm64.tar.gz
./pi

# Windows
unzip pi-windows-x64.zip
pi.exe
```

**macOS note:** The binary is unsigned. If blocked, run: `xattr -c ./pi`

**Build from source** (requires [Bun](https://bun.sh) 1.0+):

```bash
git clone https://github.com/badlogic/pi-mono.git
cd pi-mono && npm install
cd packages/coding-agent && npm run build:binary
./dist/pi
```

### Windows Setup

Pi requires a bash shell on Windows. Checked locations (in order):

1. Custom path from `~/.pi/agent/settings.json`
2. Git Bash (`C:\Program Files\Git\bin\bash.exe`)
3. `bash.exe` on PATH (Cygwin, MSYS2, WSL)

For most users, [Git for Windows](https://git-scm.com/download/win) is sufficient.

**Custom shell path:**

```json
// ~/.pi/agent/settings.json
{
  "shellPath": "C:\\cygwin64\\bin\\bash.exe"
}
```

### API Keys

Set the environment variable for your provider:

| Provider | Environment Variable |
|----------|---------------------|
| Anthropic | `ANTHROPIC_API_KEY` or `ANTHROPIC_OAUTH_TOKEN` |
| OpenAI | `OPENAI_API_KEY` |
| Google | `GEMINI_API_KEY` |
| Groq | `GROQ_API_KEY` |
| Cerebras | `CEREBRAS_API_KEY` |
| xAI | `XAI_API_KEY` |
| OpenRouter | `OPENROUTER_API_KEY` |
| ZAI | `ZAI_API_KEY` |

The `/model` command only shows models for providers with configured API keys.

**OAuth (Claude Pro/Max subscribers):**

```bash
pi
/login  # Select "Anthropic (Claude Pro/Max)", authorize in browser
```

Tokens stored in `~/.pi/agent/oauth.json` (mode 0600). Use `/logout` to clear.

### Quick Start

```bash
export ANTHROPIC_API_KEY=sk-ant-...
pi
```

Then chat:

```
You: Create a simple Express server in src/server.ts
```

The agent reads, writes, and edits files, and executes commands via bash.

---

## Usage

### Slash Commands

| Command | Description |
|---------|-------------|
| `/model` | Switch models mid-session (fuzzy search, arrow keys, Enter to select) |
| `/thinking` | Adjust thinking level for reasoning models (off/minimal/low/medium/high) |
| `/queue` | Set message queue mode: one-at-a-time (default) or all-at-once |
| `/export [file]` | Export session to self-contained HTML |
| `/session` | Show session info: path, message counts, token usage, cost |
| `/changelog` | Display full version history |
| `/branch` | Create new conversation branch from a previous message |
| `/resume` | Switch to a different session (interactive selector) |
| `/login` | OAuth login for subscription-based models |
| `/logout` | Clear OAuth tokens |
| `/clear` | Clear context and start fresh session |
| `/copy` | Copy last agent message to clipboard |
| `/compact [instructions]` | Manually compact conversation context |
| `/autocompact` | Toggle automatic context compaction |
| `/theme` | Select color theme |

### Editor Features

**File reference (`@`):** Type `@` to fuzzy-search project files. Respects `.gitignore`.

**Path completion (Tab):** Complete relative paths, `../`, `~/`, etc.

**Drag & drop:** Drag files from your file manager into the terminal.

**Multi-line paste:** Pasted content is collapsed to `[paste #N <lines> lines]` but sent in full.

**Message queuing:** Submit messages while the agent is working. They queue and process based on `/queue` mode. Press Escape to abort and restore queued messages to editor.

### Keyboard Shortcuts

**Navigation:**

| Key | Action |
|-----|--------|
| Arrow keys | Move cursor / browse history (Up when empty) |
| Option+Left/Right | Move by word |
| Ctrl+A / Home | Start of line |
| Ctrl+E / End | End of line |

**Editing:**

| Key | Action |
|-----|--------|
| Enter | Send message |
| Shift+Enter / Alt+Enter | New line (Ctrl+Enter on WSL) |
| Ctrl+W / Option+Backspace | Delete word backwards |
| Ctrl+U | Delete to start of line |
| Ctrl+K | Delete to end of line |

**Other:**

| Key | Action |
|-----|--------|
| Tab | Path completion / accept autocomplete |
| Escape | Cancel autocomplete / abort streaming |
| Ctrl+C | Clear editor (first) / exit (second) |
| Shift+Tab | Cycle thinking level |
| Ctrl+P | Cycle models (scoped by `--models`) |
| Ctrl+O | Toggle tool output expansion |
| Ctrl+T | Toggle thinking block visibility |

### Bash Mode

Prefix commands with `!` to execute them and add output to context:

```
!ls -la
!git status
!cat package.json | jq '.dependencies'
```

Output streams in real-time. Press Escape to cancel. Large outputs truncate at 2000 lines / 50KB.

The output becomes part of your next prompt, formatted as:

```
Ran `ls -la`
```
<output here>
```
```

Run multiple commands before prompting; all outputs are included together.

### Image Support

Include image paths in your message:

```
You: What's in this screenshot? /path/to/image.png
```

Supported: `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`

---

## Sessions

### Session Management

Sessions auto-save to `~/.pi/agent/sessions/` organized by working directory.

```bash
pi --continue      # Continue most recent session
pi -c              # Short form

pi --resume        # Browse and select from past sessions
pi -r              # Short form

pi --no-session    # Ephemeral mode (don't save)

pi --session /path/to/file.jsonl  # Use specific session file
```

### Context Compaction

Long sessions can exhaust context windows. Compaction summarizes older messages while keeping recent ones.

**Manual:** `/compact` or `/compact Focus on the API changes`

**Automatic:** Enable with `/autocompact`. When enabled, triggers in two cases:
- **Overflow recovery**: LLM returns context overflow error. Compacts and auto-retries.
- **Threshold maintenance**: Context exceeds `contextWindow - reserveTokens` after a successful turn. Compacts without retry.

When disabled, neither case triggers automatic compaction (use `/compact` manually if needed).

**How it works:**
1. Cut point calculated to keep ~20k tokens of recent messages
2. Messages before cut point are summarized
3. Summary replaces old messages as "context handoff"
4. Previous compaction summaries chain into new ones

**Configuration** (`~/.pi/agent/settings.json`):

```json
{
  "compaction": {
    "enabled": true,
    "reserveTokens": 16384,
    "keepRecentTokens": 20000
  }
}
```

> **Note:** Compaction is lossy. The agent loses full conversation access afterward. Size tasks to avoid context limits when possible. For critical context, ask the agent to write a summary to a file, then start a new session with that file. The full session history is preserved in the JSONL file; use `/branch` to revisit any previous point.

### Branching

Use `/branch` to explore alternative conversation paths:

1. Opens selector showing all your user messages
2. Select a message to branch from
3. Creates new session with history up to that point
4. Selected message placed in editor for modification

---

## Configuration

### Project Context Files

Pi loads `AGENTS.md` (or `CLAUDE.md`) files at startup in this order:

1. **Global:** `~/.pi/agent/AGENTS.md`
2. **Parent directories:** Walking up from current directory
3. **Current directory:** `./AGENTS.md`

Use these for:
- Project instructions and guidelines
- Common commands and workflows
- Architecture documentation
- Coding conventions
- Testing instructions

```markdown
# Common Commands
- npm run build: Build the project
- npm test: Run tests

# Code Style
- Use TypeScript strict mode
- Prefer async/await over promises
```

### Custom Models and Providers

Add custom models (Ollama, vLLM, LM Studio, etc.) via `~/.pi/agent/models.json`:

```json
{
  "providers": {
    "ollama": {
      "baseUrl": "http://localhost:11434/v1",
      "apiKey": "OLLAMA_API_KEY",
      "api": "openai-completions",
      "models": [
        {
          "id": "llama-3.1-8b",
          "name": "Llama 3.1 8B (Local)",
          "reasoning": false,
          "input": ["text"],
          "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0},
          "contextWindow": 128000,
          "maxTokens": 32000
        }
      ]
    }
  }
}
```

**Supported APIs:** `openai-completions`, `openai-responses`, `anthropic-messages`, `google-generative-ai`

**API key resolution:** The `apiKey` field is checked as environment variable name first, then used as literal value.

**API override:** Set `api` at provider level (default for all models) or model level (override per model).

**Custom headers:**

```json
{
  "providers": {
    "custom-proxy": {
      "baseUrl": "https://proxy.example.com/v1",
      "apiKey": "YOUR_API_KEY",
      "api": "anthropic-messages",
      "headers": {
        "User-Agent": "Mozilla/5.0 ...",
        "X-Custom-Auth": "token"
      },
      "models": [...]
    }
  }
}
```

**Authorization header:** Set `authHeader: true` to add `Authorization: Bearer <apiKey>` automatically.

**OpenAI compatibility (`compat` field):**

| Field | Description |
|-------|-------------|
| `supportsStore` | Whether provider supports `store` field |
| `supportsDeveloperRole` | Use `developer` vs `system` role |
| `supportsReasoningEffort` | Support for `reasoning_effort` parameter |
| `maxTokensField` | Use `max_completion_tokens` or `max_tokens` |

**Live reload:** The file reloads each time you open `/model`. Edit during session; no restart needed.

**Model selection priority:**
1. CLI args (`--provider`, `--model`)
2. First from `--models` scope (new sessions only)
3. Restored from session (`--continue`, `--resume`)
4. Saved default from settings
5. First available model with valid API key

### Themes

Built-in themes: `dark` (default), `light`. Auto-detected on first run.

```bash
/theme  # Interactive selector
```

**Custom themes:** Create `~/.pi/agent/themes/*.json`. Custom themes support live reload.

```bash
mkdir -p ~/.pi/agent/themes
cp $(npm root -g)/@mariozechner/pi-coding-agent/dist/theme/dark.json ~/.pi/agent/themes/my-theme.json
```

Select with `/theme`, then edit the file. Changes apply on save.

See [Theme Documentation](docs/theme.md) for all 44 color tokens.

**VS Code terminal fix:** Set `terminal.integrated.minimumContrastRatio` to `1` for accurate colors.

### Custom Slash Commands

Define reusable prompts as Markdown files:

**Locations:**
- Global: `~/.pi/agent/commands/*.md`
- Project: `.pi/commands/*.md`

**Format:**

```markdown
---
description: Review staged git changes
---
Review the staged changes (`git diff --cached`). Focus on:
- Bugs and logic errors
- Security issues
- Error handling gaps
```

Filename (without `.md`) becomes the command name. Description shown in autocomplete.

**Arguments:**

```markdown
---
description: Create a component
---
Create a React component named $1 with features: $@
```

Usage: `/component Button "onClick handler" "disabled support"`
- `$1` = `Button`
- `$@` = all arguments joined

**Namespacing:** Subdirectories create prefixes. `.pi/commands/frontend/component.md` → `/component (project:frontend)`

### Hooks

Hooks are TypeScript modules that extend pi's behavior by subscribing to lifecycle events. Use them to:

- **Block dangerous commands** (permission gates for `rm -rf`, `sudo`, etc.)
- **Checkpoint code state** (git stash at each turn, restore on `/branch`)
- **Protect paths** (block writes to `.env`, `node_modules/`, etc.)
- **Modify tool output** (filter or transform results before the LLM sees them)
- **Inject messages from external sources** (file watchers, webhooks, CI systems)

**Hook locations:**
- Global: `~/.pi/agent/hooks/*.ts`
- Project: `.pi/hooks/*.ts`
- CLI: `--hook <path>` (for debugging)

**Quick example** (permission gate):

```typescript
import type { HookAPI } from "@mariozechner/pi-coding-agent/hooks";

export default function (pi: HookAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName === "bash" && /sudo/.test(event.input.command as string)) {
      const ok = await ctx.ui.confirm("Allow sudo?", event.input.command as string);
      if (!ok) return { block: true, reason: "Blocked by user" };
    }
    return undefined;
  });
}
```

**Sending messages from hooks:**

Use `pi.send(text, attachments?)` to inject messages into the session. If the agent is streaming, the message is queued; otherwise a new agent loop starts immediately.

```typescript
import * as fs from "node:fs";
import type { HookAPI } from "@mariozechner/pi-coding-agent/hooks";

export default function (pi: HookAPI) {
  pi.on("session_start", async () => {
    fs.watch("/tmp/trigger.txt", () => {
      const content = fs.readFileSync("/tmp/trigger.txt", "utf-8").trim();
      if (content) pi.send(content);
    });
  });
}
```

See [Hooks Documentation](docs/hooks.md) for full API reference.

### Settings File

`~/.pi/agent/settings.json` stores persistent preferences:

```json
{
  "theme": "dark",
  "shellPath": "C:\\path\\to\\bash.exe",
  "queueMode": "one-at-a-time",
  "compaction": {
    "enabled": false,
    "reserveTokens": 16384,
    "keepRecentTokens": 20000
  }
}
```

---

## CLI Reference

```bash
pi [options] [@files...] [messages...]
```

### Options

| Option | Description |
|--------|-------------|
| `--provider <name>` | Provider: `anthropic`, `openai`, `google`, `xai`, `groq`, `cerebras`, `openrouter`, `zai`, or custom |
| `--model <id>` | Model ID |
| `--api-key <key>` | API key (overrides environment) |
| `--system-prompt <text\|file>` | Custom system prompt (text or file path) |
| `--append-system-prompt <text\|file>` | Append to system prompt |
| `--mode <mode>` | Output mode: `text`, `json`, `rpc` (implies `--print`) |
| `--print`, `-p` | Non-interactive: process prompt and exit |
| `--no-session` | Don't save session |
| `--session <path>` | Use specific session file |
| `--continue`, `-c` | Continue most recent session |
| `--resume`, `-r` | Select session to resume |
| `--models <patterns>` | Comma-separated patterns for Ctrl+P cycling (e.g., `sonnet:high,haiku:low`) |
| `--tools <tools>` | Comma-separated tool list (default: `read,bash,edit,write`) |
| `--thinking <level>` | Thinking level: `off`, `minimal`, `low`, `medium`, `high` |
| `--hook <path>` | Load a hook file (can be used multiple times) |
| `--export <file> [output]` | Export session to HTML |
| `--help`, `-h` | Show help |

### File Arguments

Include files with `@` prefix:

```bash
pi @prompt.md "Answer this"
pi @screenshot.png "What's in this image?"
pi @requirements.md @design.png "Implement this"
```

Text files wrapped in `<file name="path">content</file>`. Images attached as base64.

### Examples

```bash
# Interactive mode
pi

# Interactive with initial prompt
pi "List all .ts files in src/"

# Non-interactive
pi -p "List all .ts files in src/"

# With files
pi -p @code.ts "Review this code"

# JSON event stream
pi --mode json "List files"

# RPC mode (headless)
pi --mode rpc --no-session

# Continue session
pi -c "What did we discuss?"

# Specific model
pi --provider openai --model gpt-4o "Help me refactor"

# Model cycling with thinking levels
pi --models sonnet:high,haiku:low

# Read-only mode
pi --tools read,grep,find,ls -p "Review the architecture"

# Export session
pi --export session.jsonl output.html
```

---

## Tools

### Default Tools

| Tool | Description |
|------|-------------|
| `read` | Read file contents. Images sent as attachments. Text: first 2000 lines, lines truncated at 2000 chars. Use offset/limit for large files. |
| `write` | Write/overwrite file. Creates parent directories. |
| `edit` | Replace exact text in file. Must match exactly including whitespace. Fails if text appears multiple times or not found. |
| `bash` | Execute command. Returns stdout/stderr. Optional `timeout` parameter. |

### Read-Only Tools

Available via `--tools` flag:

| Tool | Description |
|------|-------------|
| `grep` | Search file contents (regex or literal). Respects `.gitignore`. |
| `find` | Search for files by glob pattern. Respects `.gitignore`. |
| `ls` | List directory contents. Includes dotfiles. |

Example: `--tools read,grep,find,ls` for code review without modification.

### Custom Tools

Pi relies on CLI tools invoked via bash rather than MCP. Create a tool with a README:

`~/agent-tools/screenshot/README.md`:
```markdown
# Screenshot Tool
Takes a screenshot of your main display.

## Usage
```bash
screenshot.sh
```
Returns the path to the saved PNG.
```

`~/agent-tools/screenshot/screenshot.sh`:
```bash
#!/bin/bash
screencapture -x /tmp/screenshot-$(date +%s).png
ls -t /tmp/screenshot-*.png | head -1
```

Usage: "Read ~/agent-tools/screenshot/README.md and take a screenshot"

Reference tool READMEs in `AGENTS.md` to make them automatically available.

---

## Programmatic Usage

### RPC Mode

For embedding pi in other applications:

```bash
pi --mode rpc --no-session
```

Send JSON commands on stdin:
```json
{"type":"prompt","message":"List all .ts files"}
{"type":"abort"}
```

See [RPC documentation](docs/rpc.md) for full protocol.

**Node.js/TypeScript:** Consider using `AgentSession` directly from `@mariozechner/pi-coding-agent` instead of subprocess. See [`src/core/agent-session.ts`](src/core/agent-session.ts) and [`src/modes/rpc/rpc-client.ts`](src/modes/rpc/rpc-client.ts).

### HTML Export

```bash
pi --export session.jsonl              # Auto-generated filename
pi --export session.jsonl output.html  # Custom filename
```

Works with both session files and streaming event logs from `--mode json`.

---

## Philosophy

Pi is opinionated about what it won't do. These are intentional design decisions.

### No MCP

Pi does not support MCP (Model Context Protocol). Instead, it relies on four core tools (read, write, edit, bash) and assumes the agent can invoke CLI tools or write them as needed.

CLI tools are simpler: any executable with a README works. No protocol overhead, no server management. The agent reads the README and uses bash.

See: [What if you don't need MCP?](https://mariozechner.at/posts/2025-11-02-what-if-you-dont-need-mcp/)

### No Sub-Agents

If the agent needs to delegate, it can spawn `pi` via bash or write a custom tool. Built-in sub-agents transfer context poorly; information gets lost or misrepresented. For parallel work, run multiple `pi` sessions in different terminals.

### No Built-in To-Dos

To-do lists confuse models more than they help. For task tracking, use a file:

```markdown
# TODO.md
- [x] Implement authentication
- [ ] Write API docs
```

### No Planning Mode

Tell the agent to think through problems without modifying files. For persistent plans, write to a file:

```markdown
# PLAN.md
## Goal
Refactor auth to support OAuth
## Current Step
Working on authorization endpoints
```

### No Permission System (YOLO Mode)

Pi runs with full filesystem access and no permission prompts. Why:
- Permission systems add friction while being easily circumvented
- Pre-checking for "dangerous" patterns causes latency and false positives

**Risks:**
- Can read, write, delete anything with your user privileges
- Prompt injection via files or command output can influence behavior

**Mitigations:**
- Run in a container if uncomfortable
- Don't use on systems with sensitive data you can't afford to lose

### No Background Bash

Use `tmux` or similar. Bonus: you can watch the agent interact with CLIs and intervene if needed.

---

## Development

### Forking / Rebranding

Configure via `package.json`:

```json
{
  "piConfig": {
    "name": "pi",
    "configDir": ".pi"
  }
}
```

Change `name`, `configDir`, and `bin` field for your fork. Affects CLI banner, config paths, and environment variable names.

### Path Resolution

Three execution modes: npm install, standalone binary, tsx from source.

**Always use `src/paths.ts`** for package assets:

```typescript
import { getPackageDir, getThemeDir } from "./paths.js";
```

Never use `__dirname` directly for package assets.

### Debug Command

`/debug` (hidden) writes rendered lines with ANSI codes to `~/.pi/agent/pi-debug.log` for TUI debugging.

For architecture and contribution guidelines, see [DEVELOPMENT.md](./DEVELOPMENT.md).

---

## License

MIT

## See Also

- [@mariozechner/pi-ai](https://www.npmjs.com/package/@mariozechner/pi-ai): Core LLM toolkit
- [@mariozechner/pi-agent](https://www.npmjs.com/package/@mariozechner/pi-agent): Agent framework
