# pi

A terminal-based coding agent with multi-model support, mid-session model switching, and a simple CLI for headless coding tasks.

Works on Linux, macOS, and Windows (requires bash; see [Windows Setup](#windows-setup)).

## Table of Contents

- [Getting Started](#getting-started)
  - [Installation](#installation)
  - [Windows Setup](#windows-setup)
  - [API Keys & OAuth](#api-keys--oauth)
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
  - [Custom System Prompt](#custom-system-prompt)
  - [Custom Models and Providers](#custom-models-and-providers)
  - [Themes](#themes)
  - [Custom Slash Commands](#custom-slash-commands)
  - [Skills](#skills)
  - [Hooks](#hooks)
  - [Custom Tools](#custom-tools)
  - [Settings File](#settings-file)
- [CLI Reference](#cli-reference)
- [Tools](#tools)
- [Programmatic Usage](#programmatic-usage)
  - [SDK](#sdk)
  - [RPC Mode](#rpc-mode)
  - [HTML Export](#html-export)
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

### API Keys & OAuth

**Option 1: Auth file** (recommended)

Add API keys to `~/.pi/agent/auth.json`:

```json
{
  "anthropic": { "type": "api_key", "key": "sk-ant-..." },
  "openai": { "type": "api_key", "key": "sk-..." },
  "google": { "type": "api_key", "key": "..." }
}
```

**Option 2: Environment variables**

| Provider | Auth Key | Environment Variable |
|----------|--------------|---------------------|
| Anthropic | `anthropic` | `ANTHROPIC_API_KEY` |
| OpenAI | `openai` | `OPENAI_API_KEY` |
| Google | `google` | `GEMINI_API_KEY` |
| Mistral | `mistral` | `MISTRAL_API_KEY` |
| Groq | `groq` | `GROQ_API_KEY` |
| Cerebras | `cerebras` | `CEREBRAS_API_KEY` |
| xAI | `xai` | `XAI_API_KEY` |
| OpenRouter | `openrouter` | `OPENROUTER_API_KEY` |
| ZAI | `zai` | `ZAI_API_KEY` |

Auth file keys take priority over environment variables.

**OAuth Providers:**

Use `/login` to authenticate with subscription-based or free-tier providers:

| Provider | Models | Cost |
|----------|--------|------|
| Anthropic (Claude Pro/Max) | Claude models via your subscription | Subscription |
| GitHub Copilot | GPT-4o, Claude, Gemini via Copilot subscription | Subscription |
| Google Gemini CLI | Gemini 2.0/2.5 models | Free (Google account) |
| Google Antigravity | Gemini 3, Claude, GPT-OSS | Free (Google account) |

```bash
pi
/login  # Select provider, authorize in browser
```

**Note:** `/login` replaces any existing API key for that provider with OAuth credentials in `auth.json`.

**GitHub Copilot notes:**
- Press Enter for github.com, or enter your GitHub Enterprise Server domain
- If you get "model not supported" error, enable it in VS Code: Copilot Chat → model selector → select model → "Enable"

**Google providers notes:**
- Gemini CLI uses the production Cloud Code Assist endpoint (standard Gemini models)
- Antigravity uses a sandbox endpoint with access to Gemini 3, Claude (sonnet/opus thinking), and GPT-OSS models
- Both are free with any Google account, subject to rate limits

Credentials stored in `~/.pi/agent/auth.json`. Use `/logout` to clear.

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
| `/settings` | Open settings menu (thinking, theme, queue mode, toggles) |
| `/model` | Switch models mid-session (fuzzy search, arrow keys, Enter to select) |
| `/export [file]` | Export session to self-contained HTML |
| `/session` | Show session info: path, message counts, token usage, cost |
| `/hotkeys` | Show all keyboard shortcuts |
| `/changelog` | Display full version history |
| `/branch` | Create new conversation branch from a previous message |
| `/resume` | Switch to a different session (interactive selector) |
| `/login` | OAuth login for subscription-based models |
| `/logout` | Clear OAuth tokens |
| `/new` | Start a new session |
| `/copy` | Copy last agent message to clipboard |
| `/compact [instructions]` | Manually compact conversation context |

### Editor Features

**File reference (`@`):** Type `@` to fuzzy-search project files. Respects `.gitignore`.

**Path completion (Tab):** Complete relative paths, `../`, `~/`, etc.

**Drag & drop:** Drag files from your file manager into the terminal.

**Multi-line paste:** Pasted content is collapsed to `[paste #N <lines> lines]` but sent in full.

**Message queuing:** Submit messages while the agent is working. They queue and process based on queue mode (configurable via `/settings`). Press Escape to abort and restore queued messages to editor.

### Keyboard Shortcuts

**Navigation:**

| Key | Action |
|-----|--------|
| Arrow keys | Move cursor / browse history (Up when empty) |
| Option+Left/Right | Move by word |
| Ctrl+A / Home / Cmd+Left | Start of line |
| Ctrl+E / End / Cmd+Right | End of line |

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
| Ctrl+D | Exit (when editor is empty) |
| Ctrl+Z | Suspend to background (use `fg` in shell to resume) |
| Shift+Tab | Cycle thinking level |
| Ctrl+P / Shift+Ctrl+P | Cycle models forward/backward (scoped by `--models`) |
| Ctrl+L | Open model selector |
| Ctrl+O | Toggle tool output expansion |
| Ctrl+T | Toggle thinking block visibility |
| Ctrl+G | Edit message in external editor (`$VISUAL` or `$EDITOR`) |

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

**Attaching images:** Include image paths in your message:

```
You: What's in this screenshot? /path/to/image.png
```

Supported formats: `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`

**Inline rendering:** On terminals that support the Kitty graphics protocol (Kitty, Ghostty, WezTerm) or iTerm2 inline images, images in tool output are rendered inline. On unsupported terminals, a text placeholder is shown instead.

Toggle inline images via `/settings` or set `terminal.showImages: false` in settings.

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

**Automatic:** Enable via `/settings`. When enabled, triggers in two cases:
- **Overflow recovery**: LLM returns context overflow error. Compacts and auto-retries.
- **Threshold maintenance**: Context exceeds `contextWindow - reserveTokens` after a successful turn. Compacts without retry.

When disabled, neither case triggers automatic compaction (use `/compact` manually if needed).

**How it works:**
1. Cut point calculated to keep ~20k tokens of recent messages
2. Messages before cut point are summarized
3. Summary replaces old messages as "context handoff"
4. Previous compaction summaries chain into new ones

Compaction does not create a new session, but continues the existing one, with a marker in the `.jsonl` file that encodes the compaction point.

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

> **Note:** Compaction is lossy. The agent loses full conversation access afterward. Size tasks to avoid context limits when possible. For critical context, ask the agent to write a summary to a file, iterate on it until it covers everything, then start a new session with that file. The full session history is preserved in the JSONL file; use `/branch` to revisit any previous point.

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

### Custom System Prompt

Replace the default system prompt entirely by creating a `SYSTEM.md` file:

1. **Project-local:** `.pi/SYSTEM.md` (takes precedence)
2. **Global:** `~/.pi/agent/SYSTEM.md` (fallback)

This is useful when using pi as different types of agents across repos (coding assistant, personal assistant, domain-specific agent, etc.).

```markdown
You are a technical writing assistant. Help users write clear documentation.

Focus on:
- Concise explanations
- Code examples
- Proper formatting
```

The `--system-prompt` CLI flag overrides both files. Use `--append-system-prompt` to add to (rather than replace) the prompt.

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

> pi can help you create custom provider and model configurations.

### Themes

Built-in themes: `dark` (default), `light`. Auto-detected on first run.

Select theme via `/settings` or set in `~/.pi/agent/settings.json`.

**Custom themes:** Create `~/.pi/agent/themes/*.json`. Custom themes support live reload.

```bash
mkdir -p ~/.pi/agent/themes
cp $(npm root -g)/@mariozechner/pi-coding-agent/dist/theme/dark.json ~/.pi/agent/themes/my-theme.json
```

Select with `/settings`, then edit the file. Changes apply on save.

> See [Theme Documentation](docs/theme.md) on how to create custom themes in detail. Pi can help you create a new one.

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


### Skills

Skills are self-contained capability packages that the agent loads on-demand. Pi implements the [Agent Skills standard](https://agentskills.io/specification), warning about violations but remaining lenient.

A skill provides specialized workflows, setup instructions, helper scripts, and reference documentation for specific tasks. Skills are loaded when the agent decides a task matches the description, or when you explicitly ask to use one.

**Example use cases:**
- Web search and content extraction (Brave Search API)
- Browser automation via Chrome DevTools Protocol
- Google Calendar, Gmail, Drive integration
- PDF/DOCX processing and creation
- Speech-to-text transcription
- YouTube transcript extraction

**Skill locations:**
- Pi user: `~/.pi/agent/skills/**/SKILL.md` (recursive)
- Pi project: `.pi/skills/**/SKILL.md` (recursive)
- Claude Code: `~/.claude/skills/*/SKILL.md` and `.claude/skills/*/SKILL.md`
- Codex CLI: `~/.codex/skills/**/SKILL.md` (recursive)

**Format:**

```markdown
---
name: brave-search
description: Web search via Brave Search API. Use for documentation, facts, or web content.
---

# Brave Search

## Setup
\`\`\`bash
cd /path/to/brave-search && npm install
\`\`\`

## Usage
\`\`\`bash
./search.js "query"           # Basic search
./search.js "query" --content # Include page content
\`\`\`
```

- `name`: Required. Must match parent directory name. Lowercase, hyphens, max 64 chars.
- `description`: Required. Max 1024 chars. Determines when the skill is loaded.

**Disable skills:** `pi --no-skills` or set `skills.enabled: false` in settings.

> See [docs/skills.md](docs/skills.md) for details, examples, and links to skill repositories. pi can help you create new skills.

### Hooks

Hooks are TypeScript modules that extend pi's behavior by subscribing to lifecycle events. Use them to:

- **Block dangerous commands** (permission gates for `rm -rf`, `sudo`, etc.)
- **Checkpoint code state** (git stash at each turn, restore on `/branch`)
- **Protect paths** (block writes to `.env`, `node_modules/`, etc.)
- **Modify tool output** (filter or transform results before the LLM sees them)
- **Inject messages from external sources to wake up the agent** (file watchers, webhooks, CI systems)

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
  pi.on("session", async (event) => {
    if (event.reason !== "start") return;
    fs.watch("/tmp/trigger.txt", () => {
      const content = fs.readFileSync("/tmp/trigger.txt", "utf-8").trim();
      if (content) pi.send(content);
    });
  });
}
```

> See [Hooks Documentation](docs/hooks.md) for full API reference. pi can help you create new hooks

> See [examples/hooks/](examples/hooks/) for working examples including permission gates, git checkpointing, and path protection.

### Custom Tools

Custom tools let you extend the built-in toolset (read, write, edit, bash, ...) and are called by the LLM directly. They are TypeScript modules that define tools with optional custom TUI integration for getting user input and custom tool call and result rendering.

**Tool locations (auto-discovered):**
- Global: `~/.pi/agent/tools/*/index.ts`
- Project: `.pi/tools/*/index.ts`

**Explicit paths:**
- CLI: `--tool <path>` (any .ts file)
- Settings: `customTools` array in `settings.json`

**Quick example:**

```typescript
import { Type } from "@sinclair/typebox";
import type { CustomToolFactory } from "@mariozechner/pi-coding-agent";

const factory: CustomToolFactory = (pi) => ({
  name: "greet",
  label: "Greeting",
  description: "Generate a greeting",
  parameters: Type.Object({
    name: Type.String({ description: "Name to greet" }),
  }),

  async execute(toolCallId, params) {
    return {
      content: [{ type: "text", text: `Hello, ${params.name}!` }],
      details: { greeted: params.name },
    };
  },
});

export default factory;
```

**Features:**
- Access to `pi.cwd`, `pi.exec()`, `pi.ui` (select/confirm/input dialogs)
- Session lifecycle via `onSession` callback (for state reconstruction)
- Custom rendering via `renderCall()` and `renderResult()` methods
- Streaming results via `onUpdate` callback
- Abort handling via `signal` parameter
- Multiple tools from one factory (return an array)

> See [Custom Tools Documentation](docs/custom-tools.md) for the full API reference, TUI component guide, and examples. pi can help you create custom tools.

> See [examples/custom-tools/](examples/custom-tools/) for working examples including a todo list with session state management and a question tool with UI interaction.

### Settings File

Settings are loaded from two locations and merged:

1. **Global:** `~/.pi/agent/settings.json` - user preferences
2. **Project:** `<cwd>/.pi/settings.json` - project-specific overrides (version control friendly)

Project settings override global settings. For nested objects, individual keys merge. Settings changed via TUI (model, thinking level, etc.) are saved to global preferences only.

Global `~/.pi/agent/settings.json` stores persistent preferences:

```json
{
  "theme": "dark",
  "defaultProvider": "anthropic",
  "defaultModel": "claude-sonnet-4-20250514",
  "defaultThinkingLevel": "medium",
  "queueMode": "one-at-a-time",
  "shellPath": "C:\\path\\to\\bash.exe",
  "hideThinkingBlock": false,
  "collapseChangelog": false,
  "compaction": {
    "enabled": true,
    "reserveTokens": 16384,
    "keepRecentTokens": 20000
  },
  "skills": {
    "enabled": true
  },
  "retry": {
    "enabled": true,
    "maxRetries": 3,
    "baseDelayMs": 2000
  },
  "terminal": {
    "showImages": true
  },
  "hooks": ["/path/to/hook.ts"],
  "hookTimeout": 30000,
  "customTools": ["/path/to/tool.ts"]
}
```

| Setting | Description | Default |
|---------|-------------|---------|
| `theme` | Color theme name | auto-detected |
| `defaultProvider` | Default model provider | - |
| `defaultModel` | Default model ID | - |
| `defaultThinkingLevel` | Thinking level: `off`, `minimal`, `low`, `medium`, `high`, `xhigh` | - |
| `queueMode` | Message queue mode: `all` or `one-at-a-time` | `one-at-a-time` |
| `shellPath` | Custom bash path (Windows) | auto-detected |
| `hideThinkingBlock` | Hide thinking blocks in output (Ctrl+T to toggle) | `false` |
| `collapseChangelog` | Show condensed changelog after update | `false` |
| `compaction.enabled` | Enable auto-compaction | `true` |
| `compaction.reserveTokens` | Tokens to reserve before compaction triggers | `16384` |
| `compaction.keepRecentTokens` | Recent tokens to keep after compaction | `20000` |
| `skills.enabled` | Enable skills discovery | `true` |
| `retry.enabled` | Auto-retry on transient errors | `true` |
| `retry.maxRetries` | Maximum retry attempts | `3` |
| `retry.baseDelayMs` | Base delay for exponential backoff | `2000` |
| `terminal.showImages` | Render images inline (supported terminals) | `true` |
| `hooks` | Additional hook file paths | `[]` |
| `hookTimeout` | Timeout for hook operations (ms) | `30000` |
| `customTools` | Additional custom tool file paths | `[]` |

---

## CLI Reference

```bash
pi [options] [@files...] [messages...]
```

### Options

| Option | Description |
|--------|-------------|
| `--provider <name>` | Provider: `anthropic`, `openai`, `google`, `mistral`, `xai`, `groq`, `cerebras`, `openrouter`, `zai`, `github-copilot`, `google-gemini-cli`, `google-antigravity`, or custom |
| `--model <id>` | Model ID |
| `--api-key <key>` | API key (overrides environment) |
| `--system-prompt <text\|file>` | Custom system prompt (text or file path) |
| `--append-system-prompt <text\|file>` | Append to system prompt |
| `--mode <mode>` | Output mode: `text`, `json`, `rpc` (implies `--print`) |
| `--print`, `-p` | Non-interactive: process prompt and exit |
| `--no-session` | Don't save session |
| `--session <path>` | Use specific session file |
| `--session-dir <dir>` | Directory for session storage and lookup |
| `--continue`, `-c` | Continue most recent session |
| `--resume`, `-r` | Select session to resume |
| `--models <patterns>` | Comma-separated patterns for Ctrl+P cycling (e.g., `sonnet:high,haiku:low`) |
| `--tools <tools>` | Comma-separated tool list (default: `read,bash,edit,write`) |
| `--thinking <level>` | Thinking level: `off`, `minimal`, `low`, `medium`, `high` |
| `--hook <path>` | Load a hook file (can be used multiple times) |
| `--no-skills` | Disable skills discovery and loading |
| `--skills <patterns>` | Comma-separated glob patterns to filter skills (e.g., `git-*,docker`) |
| `--export <file> [output]` | Export session to HTML |
| `--help`, `-h` | Show help |
| `--version`, `-v` | Show version |

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

For adding new tools, see [Custom Tools](#custom-tools) in the Configuration section.

---

## Programmatic Usage

### SDK

For embedding pi in Node.js/TypeScript applications, use the SDK:

```typescript
import { createAgentSession, discoverAuthStorage, discoverModels, SessionManager } from "@mariozechner/pi-coding-agent";

const authStorage = discoverAuthStorage();
const modelRegistry = discoverModels(authStorage);

const { session } = await createAgentSession({
  sessionManager: SessionManager.inMemory(),
  authStorage,
  modelRegistry,
});

session.subscribe((event) => {
  if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
    process.stdout.write(event.assistantMessageEvent.delta);
  }
});

await session.prompt("What files are in the current directory?");
```

The SDK provides full control over:
- Model selection and thinking level
- System prompt (replace or modify)
- Tools (built-in subsets, custom tools)
- Hooks (inline or discovered)
- Skills, context files, slash commands
- Session persistence (`SessionManager`)
- Settings (`SettingsManager`)
- API key resolution and OAuth

**Philosophy:** "Omit to discover, provide to override." Omit an option and pi discovers from standard locations. Provide an option and your value is used.

> See [SDK Documentation](docs/sdk.md) for the full API reference. See [examples/sdk/](examples/sdk/) for working examples from minimal to full control.

### RPC Mode

For embedding pi from other languages or with process isolation:

```bash
pi --mode rpc --no-session
```

Send JSON commands on stdin:
```json
{"type":"prompt","message":"List all .ts files"}
{"type":"abort"}
```

> See [RPC Documentation](docs/rpc.md) for the full protocol.

### HTML Export

```bash
pi --export session.jsonl              # Auto-generated filename
pi --export session.jsonl output.html  # Custom filename
```

Works with both session files and streaming event logs from `--mode json`.

---

## Philosophy

Pi is opinionated about what it won't do. These are intentional design decisions to minimize context bloat and avoid anti-patterns.

**No MCP.** Build CLI tools with READMEs (see [Skills](#skills)). The agent reads them on demand. [Would you like to know more?](https://mariozechner.at/posts/2025-11-02-what-if-you-dont-need-mcp/)

**No sub-agents.** Spawn pi instances via tmux, or [build your own sub-agent tool](examples/custom-tools/subagent/) with [custom tools](#custom-tools). Full observability and steerability.

**No permission popups.** Security theater. Run in a container or build your own with [Hooks](#hooks).

**No plan mode.** Gather context in one session, write plans to file, start fresh for implementation.

**No built-in to-dos.** They confuse models. Use a TODO.md file, or [build your own](examples/custom-tools/todo/) with [custom tools](#custom-tools).

**No background bash.** Use tmux. Full observability, direct interaction.

Read the [blog post](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/) for the full rationale.

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

`/debug` (hidden) writes rendered lines with ANSI codes to `~/.pi/agent/pi-debug.log` for TUI debugging, as well as the last set of messages that were sent to the LLM.

For architecture and contribution guidelines, see [DEVELOPMENT.md](./DEVELOPMENT.md).

---

## License

MIT

## See Also

- [@mariozechner/pi-ai](https://www.npmjs.com/package/@mariozechner/pi-ai): Core LLM toolkit
- [@mariozechner/pi-agent](https://www.npmjs.com/package/@mariozechner/pi-agent): Agent framework
