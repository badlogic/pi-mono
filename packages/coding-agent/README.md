<p align="center">
  <a href="https://shittycodingagent.ai">
    <img src="https://shittycodingagent.ai/logo.svg" alt="pi logo" width="128">
  </a>
</p>
<p align="center">
  <a href="https://discord.com/invite/nKXTsAcmbT"><img alt="Discord" src="https://img.shields.io/badge/discord-community-5865F2?style=flat-square&logo=discord&logoColor=white" /></a>
  <a href="https://www.npmjs.com/package/@mariozechner/pi-coding-agent"><img alt="npm" src="https://img.shields.io/npm/v/@mariozechner/pi-coding-agent?style=flat-square" /></a>
  <a href="https://github.com/badlogic/pi-mono/actions/workflows/ci.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/badlogic/pi-mono/ci.yml?style=flat-square&branch=main" /></a>
</p>

A terminal-based coding agent with multi-model support, mid-session model switching, and a simple CLI for headless coding tasks.

Works on Linux, macOS, and Windows (requires bash; see [Windows Setup](#windows-setup)).

## Table of Contents

- [Getting Started](#getting-started)
  - [Installation](#installation)
  - [Windows Setup](#windows-setup)
  - [Terminal Setup](#terminal-setup)
  - [API Keys & OAuth](#api-keys--oauth)
  - [Quick Start](#quick-start)
- [Usage](#usage)
  - [Slash Commands](#slash-commands)
  - [Editor Features](#editor-features)
  - [Keyboard Shortcuts](#keyboard-shortcuts)
  - [Custom Keybindings](#custom-keybindings)
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
  - [Settings File](#settings-file)
- [Customization](#customization)
  - [Themes](#themes)
  - [Prompt Templates](#prompt-templates)
  - [Skills](#skills)
  - [Extensions](#extensions)
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
cd pi-mono && npm install && npm run build
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

**Alias expansion:** Pi runs bash in non-interactive mode (`bash -c`), which doesn't expand aliases by default. To enable your shell aliases:

```json
// ~/.pi/agent/settings.json
{
  "shellCommandPrefix": "shopt -s expand_aliases\neval \"$(grep '^alias ' ~/.zshrc)\""
}
```

Adjust the path (`~/.zshrc`, `~/.bashrc`, etc.) to match your shell config.

### Terminal Setup

Pi uses the [Kitty keyboard protocol](https://sw.kovidgoyal.net/kitty/keyboard-protocol/) for reliable modifier key detection. Most modern terminals support this protocol, but some require configuration.

**Kitty, iTerm2:** Work out of the box.

**Ghostty:** Add to your Ghostty config (`~/.config/ghostty/config`):

```
keybind = alt+backspace=text:\x1b\x7f
keybind = shift+enter=text:\n
```

**wezterm:** Create `~/.wezterm.lua`:

```lua
local wezterm = require 'wezterm'
local config = wezterm.config_builder()
config.enable_kitty_keyboard = true
return config
```

**VS Code (Integrated Terminal):** Add to `keybindings.json` to enable `Shift+Enter` for multi-line input:

```json
{
  "key": "shift+enter",
  "command": "workbench.action.terminal.sendSequence",
  "args": { "text": "\u001b[13;2u" },
  "when": "terminalFocus"
}
```

**Windows Terminal:** Add to `settings.json` (Ctrl+Shift+, or Settings → Open JSON file):

```json
{
  "actions": [
    {
      "command": { "action": "sendInput", "input": "\u001b[13;2u" },
      "keys": "shift+enter"
    }
  ]
}
```

If you already have an `actions` array, add the object to it.

**IntelliJ IDEA (Integrated Terminal):** The built-in terminal has limited escape sequence support. Note that Shift+Enter cannot be distinguished from Enter in IntelliJ's terminal. If you want the hardware cursor visible, set `PI_HARDWARE_CURSOR=1` before running pi (disabled by default for compatibility). Consider using a dedicated terminal emulator for the best experience.

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
| Vercel AI Gateway | `vercel-ai-gateway` | `AI_GATEWAY_API_KEY` |
| ZAI | `zai` | `ZAI_API_KEY` |
| OpenCode Zen | `opencode` | `OPENCODE_API_KEY` |
| MiniMax | `minimax` | `MINIMAX_API_KEY` |
| MiniMax (China) | `minimax-cn` | `MINIMAX_CN_API_KEY` |

Auth file keys take priority over environment variables.

**OAuth Providers:**

Use `/login` to authenticate with subscription-based or free-tier providers:

| Provider | Models | Cost |
|----------|--------|------|
| Anthropic (Claude Pro/Max) | Claude models via your subscription | Subscription |
| GitHub Copilot | GPT-4o, Claude, Gemini via Copilot subscription | Subscription |
| Google Gemini CLI | Gemini 2.0/2.5 models | Free (Google account) |
| Google Antigravity | Gemini 3, Claude, GPT-OSS | Free (Google account) |
| OpenAI Codex (ChatGPT Plus/Pro) | Codex models via ChatGPT subscription | Subscription |

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
- Paid Cloud Code Assist subscriptions: set `GOOGLE_CLOUD_PROJECT` or `GOOGLE_CLOUD_PROJECT_ID` env var to your project ID

**OpenAI Codex notes:**
- Requires ChatGPT Plus/Pro OAuth (`/login openai-codex`)
- Prompt cache stored under `~/.pi/agent/cache/openai-codex/`
- Intended for personal use with your own subscription; not for resale or multi-user services. For production, use the OpenAI Platform API.

Credentials stored in `~/.pi/agent/auth.json`. Use `/logout` to clear.

**Troubleshooting (OAuth):**
- **Port 1455 in use:** Close the conflicting process or paste the auth code/URL when prompted.
- **Token expired / refresh failed:** Run `/login` again for the provider to refresh credentials.
- **Usage limits (429):** Wait for the reset window; pi will surface a friendly message with the approximate retry time.

**Amazon Bedrock:**

Amazon Bedrock supports multiple authentication methods:

```bash
# Option 1: AWS Profile (from ~/.aws/credentials)
export AWS_PROFILE=your-profile-name

# Option 2: IAM Access Keys
export AWS_ACCESS_KEY_ID=AKIA...
export AWS_SECRET_ACCESS_KEY=...

# Option 3: Bedrock API Key (bearer token)
export AWS_BEARER_TOKEN_BEDROCK=...

# Optional: Set region (defaults to us-east-1)
export AWS_REGION=us-east-1

pi --provider amazon-bedrock --model global.anthropic.claude-sonnet-4-5-20250929-v1:0
```

See [Supported foundation models in Amazon Bedrock](https://docs.aws.amazon.com/bedrock/latest/userguide/models-supported.html).

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
| `/settings` | Open settings menu (thinking, theme, message delivery modes, toggles) |
| `/model` | Switch models mid-session. Use `/model <search>` or `provider/model` to prefilter/disambiguate. |
| `/scoped-models` | Enable/disable models for Ctrl+P cycling |
| `/export [file]` | Export session to self-contained HTML |
| `/share` | Upload session as secret GitHub gist, get shareable URL (requires `gh` CLI) |
| `/session` | Show session info: path, message counts, token usage, cost |
| `/name <name>` | Set session display name (shown in session selector) |
| `/hotkeys` | Show all keyboard shortcuts |
| `/changelog` | Display full version history |
| `/tree` | Navigate session tree in-place (search, filter, label entries) |
| `/fork` | Create new conversation fork from a previous message |
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

**Message queuing:** Submit messages while the agent is working:
- **Enter** queues a *steering* message, delivered after current tool execution (interrupts remaining tools)
- **Alt+Enter** queues a *follow-up* message, delivered only after the agent finishes all work

Both modes are configurable via `/settings`: "one-at-a-time" delivers messages one by one waiting for responses, "all" delivers all queued messages at once. Press Escape to abort and restore queued messages to editor.

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
| Shift+Enter | New line (Ctrl+Enter on Windows Terminal) |
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
| Ctrl+V | Paste image from clipboard |
| Alt+Up | Restore queued messages to editor |

### Custom Keybindings

All keyboard shortcuts can be customized via `~/.pi/agent/keybindings.json`. Each action can be bound to one or more keys.

**Key format:** `modifier+key` where modifiers are `ctrl`, `shift`, `alt` and keys are:

- Letters: `a-z`
- Numbers: `0-9`
- Special keys: `escape`, `tab`, `enter`, `space`, `backspace`, `delete`, `home`, `end`, `up`, `down`, `left`, `right`
- Symbol keys: `` ` ``, `-`, `=`, `[`, `]`, `\`, `;`, `'`, `,`, `.`, `/`, `!`, `@`, `#`, `$`, `%`, `^`, `&`, `*`, `(`, `)`, `_`, `+`, `|`, `~`, `{`, `}`, `:`, `<`, `>`, `?`

**Configurable actions:**

| Action | Default | Description |
|--------|---------|-------------|
| `cursorUp` | `up` | Move cursor up |
| `cursorDown` | `down` | Move cursor down |
| `cursorLeft` | `left` | Move cursor left |
| `cursorRight` | `right` | Move cursor right |
| `cursorWordLeft` | `alt+left`, `ctrl+left` | Move cursor word left |
| `cursorWordRight` | `alt+right`, `ctrl+right` | Move cursor word right |
| `cursorLineStart` | `home`, `ctrl+a` | Move to line start |
| `cursorLineEnd` | `end`, `ctrl+e` | Move to line end |
| `deleteCharBackward` | `backspace` | Delete char backward |
| `deleteCharForward` | `delete` | Delete char forward |
| `deleteWordBackward` | `ctrl+w`, `alt+backspace` | Delete word backward |
| `deleteToLineStart` | `ctrl+u` | Delete to line start |
| `deleteToLineEnd` | `ctrl+k` | Delete to line end |
| `newLine` | `shift+enter` | Insert new line |
| `submit` | `enter` | Submit input |
| `tab` | `tab` | Tab/autocomplete |
| `interrupt` | `escape` | Interrupt operation |
| `clear` | `ctrl+c` | Clear editor |
| `exit` | `ctrl+d` | Exit (when empty) |
| `suspend` | `ctrl+z` | Suspend process |
| `cycleThinkingLevel` | `shift+tab` | Cycle thinking level |
| `cycleModelForward` | `ctrl+p` | Next model |
| `cycleModelBackward` | `shift+ctrl+p` | Previous model |
| `selectModel` | `ctrl+l` | Open model selector |
| `expandTools` | `ctrl+o` | Expand tool output |
| `toggleThinking` | `ctrl+t` | Toggle thinking |
| `externalEditor` | `ctrl+g` | Open external editor |
| `followUp` | `alt+enter` | Queue follow-up message |
| `dequeue` | `alt+up` | Restore queued messages to editor |
| `selectUp` | `up` | Move selection up in lists (session picker, model selector) |
| `selectDown` | `down` | Move selection down in lists |
| `selectConfirm` | `enter` | Confirm selection |
| `selectCancel` | `escape`, `ctrl+c` | Cancel selection |

**Example (Emacs-style):**

```json
{
  "cursorUp": ["up", "ctrl+p"],
  "cursorDown": ["down", "ctrl+n"],
  "cursorLeft": ["left", "ctrl+b"],
  "cursorRight": ["right", "ctrl+f"],
  "cursorWordLeft": ["alt+left", "alt+b"],
  "cursorWordRight": ["alt+right", "alt+f"],
  "deleteCharForward": ["delete", "ctrl+d"],
  "deleteCharBackward": ["backspace", "ctrl+h"],
  "newLine": ["shift+enter", "ctrl+j"]
}
```

**Example (Vim-style):**

```json
{
  "cursorUp": ["up", "alt+k"],
  "cursorDown": ["down", "alt+j"],
  "cursorLeft": ["left", "alt+h"],
  "cursorRight": ["right", "alt+l"],
  "cursorWordLeft": ["alt+left", "alt+b"],
  "cursorWordRight": ["alt+right", "alt+w"],
  "deleteCharBackward": ["backspace", "ctrl+h"],
  "deleteWordBackward": ["ctrl+w", "alt+backspace"]
}
```

**Example (symbol keys):**

```json
{
  "submit": ["enter", "ctrl+j"],
  "newLine": ["shift+enter", "ctrl+;"],
  "toggleThinking": "ctrl+/",
  "cycleModelForward": "ctrl+.",
  "cycleModelBackward": "ctrl+,",
  "interrupt": ["escape", "ctrl+`"]
}
```

> **Note:** Some `ctrl+symbol` combinations overlap with ASCII control characters due to terminal legacy behavior (e.g., `ctrl+[` is the same as Escape, `ctrl+M` is the same as Enter). These can still be used with `ctrl+shift+key` (e.g., `ctrl+shift+]`). See [Kitty keyboard protocol: legacy ctrl mapping of ASCII keys](https://sw.kovidgoyal.net/kitty/keyboard-protocol/#legacy-ctrl-mapping-of-ascii-keys) for all unsupported keys.

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

<output here>
```

Run multiple commands before prompting; all outputs are included together.

### Image Support

**Pasting images:** Press `Ctrl+V` to paste an image from your clipboard.

> **Note:** On macOS, pressing Cmd+C on an image file in Finder copies the file path, not the image contents. Use Preview or another image viewer to copy the actual image, or drag the file onto the terminal instead.

**Dragging images:** Drag image files onto the terminal to insert their path. On macOS, you can also drag the screenshot thumbnail (after Cmd+Shift+4) directly onto the terminal.

**Attaching images:** Include image paths in your message:

```
You: What's in this screenshot? /path/to/image.png
```

Supported formats: `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`

**Auto-resize:** Images larger than 2000x2000 pixels are automatically resized to fit within this limit for better compatibility with Anthropic models. The original dimensions are noted in the context so the model can map coordinates back if needed. Disable via `images.autoResize: false` in settings.

**Inline rendering:** On terminals that support the Kitty graphics protocol (Kitty, Ghostty, WezTerm) or iTerm2 inline images, images in tool output are rendered inline. On unsupported terminals, a text placeholder is shown instead.

Toggle inline images via `/settings` or set `terminal.showImages: false` in settings.

---

## Sessions

Sessions are stored as JSONL files with a **tree structure**. Each entry has an `id` and `parentId`, enabling in-place branching: navigate to any previous point with `/tree`, continue from there, and switch between branches while preserving all history in a single file.

See [docs/session.md](docs/session.md) for the file format and programmatic API.

### Session Management

Sessions auto-save to `~/.pi/agent/sessions/` organized by working directory.

```bash
pi --continue      # Continue most recent session
pi -c              # Short form

pi --resume        # Browse and select from past sessions (Tab to toggle Current Folder / All)
pi -r              # Short form

pi --no-session    # Ephemeral mode (don't save)

pi --session /path/to/file.jsonl  # Use specific session file
pi --session a8ec1c2a             # Resume by session ID (partial UUID)
```

**Resuming by session ID:** The `--session` flag accepts a session UUID (or prefix). Session IDs are visible in filenames under `~/.pi/agent/sessions/<project>/` (e.g., `2025-12-13T17-47-46-817Z_a8ec1c2a-5a5f-4699-88cb-03e7d3cb9292.jsonl`). The UUID is the part after the underscore. You can also search by session ID in the `pi -r` picker.

### Context Compaction

Long sessions can exhaust context windows. Compaction summarizes older messages while keeping recent ones.

**Manual:** `/compact` or `/compact Focus on the API changes`

**Automatic:** Enable via `/settings`. When enabled, triggers in two cases:
- **Overflow recovery**: LLM returns context overflow error. Compacts and auto-retries.
- **Threshold maintenance**: Context exceeds `contextWindow - reserveTokens` after a successful turn. Compacts without retry.

When disabled, neither case triggers automatic compaction (use `/compact` manually if needed).

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

> **Note:** Compaction is lossy. The agent loses full conversation access afterward. Size tasks to avoid context limits when possible. For critical context, ask the agent to write a summary to a file, iterate on it until it covers everything, then start a new session with that file. The full session history is preserved in the JSONL file; use `/tree` to revisit any previous point.

See [docs/compaction.md](docs/compaction.md) for how compaction works internally and how to customize it via extensions.

### Branching

**In-place navigation (`/tree`):** Navigate the session tree without creating new files. Select any previous point, continue from there, and switch between branches while preserving all history.

- Search by typing, page with ←/→
- Filter modes (Ctrl+O): default → no-tools → user-only → labeled-only → all
- Press `l` to label entries as bookmarks
- When switching branches, you're prompted whether to generate a summary of the abandoned branch (messages up to the common ancestor)

**Create new session (`/fork`):** Fork to a new session file:

1. Opens selector showing all your user messages
2. Select a message to fork from
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

Replace the default system prompt **entirely** by creating a `SYSTEM.md` file:

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

The `--system-prompt` CLI flag overrides both files.

### Appending to the System Prompt

To add instructions to the system prompt **without** replacing the default (preserving automatic loading of `AGENTS.md` context files, skills, and tools guidelines), create an `APPEND_SYSTEM.md` file:

1. **Project-local:** `.pi/APPEND_SYSTEM.md` (takes precedence)
2. **Global:** `~/.pi/agent/APPEND_SYSTEM.md` (fallback)

The `--append-system-prompt` CLI flag overrides both files.

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

**Supported APIs:** `openai-completions`, `openai-responses`, `openai-codex-responses`, `anthropic-messages`, `google-generative-ai`

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

**Overriding built-in providers:**

To route a built-in provider (anthropic, openai, google, etc.) through a proxy without redefining all models, just specify the `baseUrl`:

```json
{
  "providers": {
    "anthropic": {
      "baseUrl": "https://my-proxy.example.com/v1"
    }
  }
}
```

All built-in Anthropic models remain available with the new endpoint. Existing OAuth or API key auth continues to work.

To fully replace a built-in provider with custom models, include the `models` array:

```json
{
  "providers": {
    "anthropic": {
      "baseUrl": "https://my-proxy.example.com/v1",
      "apiKey": "ANTHROPIC_API_KEY",
      "api": "anthropic-messages",
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
| `supportsUsageInStreaming` | Whether provider supports `stream_options: { include_usage: true }`. Default: `true` |
| `maxTokensField` | Use `max_completion_tokens` or `max_tokens` |

**Live reload:** The file reloads each time you open `/model`. Edit during session; no restart needed.

**Model selection priority:**
1. CLI args (`--provider`, `--model`)
2. First from `--models` scope (new sessions only)
3. Restored from session (`--continue`, `--resume`)
4. Saved default from settings
5. First available model with valid API key

> pi can help you create custom provider and model configurations.

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
  "enabledModels": ["anthropic/*", "*gpt*", "gemini-2.5-pro:high"],
  "steeringMode": "one-at-a-time",
  "followUpMode": "one-at-a-time",
  "shellPath": "C:\\path\\to\\bash.exe",
  "shellCommandPrefix": "shopt -s expand_aliases",
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
  "images": {
    "autoResize": true,
    "blockImages": false
  },
  "extensions": ["/path/to/extension.ts"]
}
```

| Setting | Description | Default |
|---------|-------------|---------|
| `theme` | Color theme name | auto-detected |
| `defaultProvider` | Default model provider | - |
| `defaultModel` | Default model ID | - |
| `defaultThinkingLevel` | Thinking level: `off`, `minimal`, `low`, `medium`, `high`, `xhigh` | - |
| `enabledModels` | Model patterns for cycling. Supports glob patterns (`github-copilot/*`, `*sonnet*`) and fuzzy matching. Same as `--models` CLI flag | - |
| `steeringMode` | Steering message delivery: `all` or `one-at-a-time` | `one-at-a-time` |
| `followUpMode` | Follow-up message delivery: `all` or `one-at-a-time` | `one-at-a-time` |
| `shellPath` | Custom bash path (Windows) | auto-detected |
| `shellCommandPrefix` | Command prefix for bash (e.g., `shopt -s expand_aliases` for alias support) | - |
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
| `images.autoResize` | Auto-resize images to 2000x2000 max for better model compatibility | `true` |
| `images.blockImages` | Prevent images from being sent to LLM providers | `false` |
| `doubleEscapeAction` | Action for double-escape with empty editor: `tree` or `branch` | `tree` |
| `editorPaddingX` | Horizontal padding for input editor (0-3) | `0` |
| `extensions` | Additional extension file paths | `[]` |

---

## Customization

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

### Prompt Templates

Define reusable prompts as Markdown files:

**Locations:**
- Global: `~/.pi/agent/prompts/*.md`
- Project: `.pi/prompts/*.md`

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
- `$@` or `$ARGUMENTS` = all arguments joined (`Button onClick handler disabled support`)
- `${@:N}` = arguments from the Nth position onwards (1-indexed)
- `${@:N:L}` = `L` arguments starting from the Nth position

**Namespacing:** Subdirectories create prefixes. `.pi/prompts/frontend/component.md` → `/component (project:frontend)`


### Skills

Skills are self-contained capability packages that the agent loads on-demand. Pi implements the [Agent Skills standard](https://agentskills.io/specification), warning about violations but remaining lenient.

A skill provides specialized workflows, setup instructions, helper scripts, and reference documentation for specific tasks. Skills are loaded when the agent decides a task matches the description, or when you explicitly ask to use one. You can also invoke skills directly via `/skill:name` commands (e.g., `/skill:brave-search`).

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

### Extensions

Extensions are TypeScript modules that extend pi's behavior.

**Use cases:**
- **Custom tools** - Register tools callable by the LLM with custom UI and rendering
- **Custom commands** - Add `/commands` for users (e.g., `/deploy`, `/stats`)
- **Event interception** - Block tool calls, modify results, customize compaction
- **State persistence** - Store data in session, reconstruct on reload/fork
- **External integrations** - File watchers, webhooks, git checkpointing
- **Custom UI** - Full TUI control from tools, commands, or event handlers

**Locations:**
- Global: `~/.pi/agent/extensions/*.ts` or `~/.pi/agent/extensions/*/index.ts`
- Project: `.pi/extensions/*.ts` or `.pi/extensions/*/index.ts`
- CLI: `--extension <path>` or `-e <path>`

**Dependencies:** Extensions can have their own dependencies. Place a `package.json` next to the extension (or in a parent directory), run `npm install`, and imports are resolved via [jiti](https://github.com/unjs/jiti). See [examples/extensions/with-deps/](examples/extensions/with-deps/).

#### Custom Tools

Tools are functions the LLM can call. They appear in the system prompt and can have custom rendering.

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { Text } from "@mariozechner/pi-tui";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "deploy",
    label: "Deploy",
    description: "Deploy the application to production",
    parameters: Type.Object({
      environment: Type.String({ description: "Target environment" }),
    }),

    async execute(toolCallId, params, onUpdate, ctx, signal) {
      // Show progress via onUpdate
      onUpdate({ status: "Deploying..." });

      // Ask user for confirmation
      const ok = await ctx.ui.confirm("Deploy?", `Deploy to ${params.environment}?`);
      if (!ok) {
        return { content: [{ type: "text", text: "Cancelled" }], details: { cancelled: true } };
      }

      // Run shell commands
      const result = await ctx.exec("./deploy.sh", [params.environment], { signal });

      return {
        content: [{ type: "text", text: result.stdout }],
        details: { environment: params.environment, exitCode: result.exitCode },
      };
    },

    // Custom TUI rendering (optional)
    renderCall(args, theme) {
      return new Text(theme.bold("deploy ") + theme.fg("accent", args.environment), 0, 0);
    },
    renderResult(result, options, theme) {
      const ok = result.details?.exitCode === 0;
      return new Text(ok ? theme.fg("success", "✓ Deployed") : theme.fg("error", "✗ Failed"), 0, 0);
    },
  });
}
```

#### Custom Commands

Commands are user-invoked via `/name`. They can show custom UI, modify state, or trigger agent turns.

```typescript
export default function (pi: ExtensionAPI) {
  pi.registerCommand("stats", {
    description: "Show session statistics",
    handler: async (args, ctx) => {
      // Simple notification
      ctx.ui.notify(`${ctx.sessionManager.getEntries().length} entries`, "info");
    },
  });

  pi.registerCommand("todos", {
    description: "Interactive todo viewer",
    handler: async (args, ctx) => {
      // Full custom UI with keyboard handling
      await ctx.ui.custom((tui, theme, done) => {
        return {
          render(width) {
            return [
              theme.bold("Todos"),
              "- [ ] Item 1",
              "- [x] Item 2",
              "",
              theme.fg("dim", "Press Escape to close"),
            ];
          },
          handleInput(data) {
            if (matchesKey(data, "escape")) done();
          },
        };
      });
    },
  });
}
```

#### Event Interception

Subscribe to lifecycle events to block, modify, or observe agent behavior.

```typescript
export default function (pi: ExtensionAPI) {
  // Block dangerous commands
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName === "bash" && /rm -rf/.test(event.input.command as string)) {
      const ok = await ctx.ui.confirm("Dangerous!", "Allow rm -rf?");
      if (!ok) return { block: true, reason: "Blocked by user" };
    }
  });

  // Modify tool results
  pi.on("tool_result", async (event, ctx) => {
    if (event.toolName === "read") {
      // Redact secrets from file contents
      return { modifiedResult: event.result.replace(/API_KEY=\w+/g, "API_KEY=***") };
    }
  });

  // Custom compaction
  pi.on("session_before_compact", async (event, ctx) => {
    return { customSummary: "My custom summary of the conversation so far..." };
  });

  // Git checkpoint on each turn
  pi.on("turn_end", async (event, ctx) => {
    await ctx.exec("git", ["stash", "push", "-m", `pi-checkpoint-${Date.now()}`]);
  });
}
```

#### State Persistence

Store state in session entries that survive reload and work correctly with branching.

```typescript
export default function (pi: ExtensionAPI) {
  let counter = 0;

  // Reconstruct state from session history
  const reconstruct = (ctx) => {
    counter = 0;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "custom" && entry.customType === "my_counter") {
        counter = entry.data.value;
      }
    }
  };

  pi.on("session_start", async (e, ctx) => reconstruct(ctx));
  pi.on("session_fork", async (e, ctx) => reconstruct(ctx));
  pi.on("session_tree", async (e, ctx) => reconstruct(ctx));

  pi.registerCommand("increment", {
    handler: async (args, ctx) => {
      counter++;
      ctx.appendEntry("my_counter", { value: counter }); // Persisted in session
      ctx.ui.notify(`Counter: ${counter}`, "info");
    },
  });
}
```

#### Keyboard Shortcuts

Register custom keyboard shortcuts (shown in `/hotkeys`):

```typescript
export default function (pi: ExtensionAPI) {
  pi.registerShortcut("ctrl+shift+d", {
    description: "Deploy to production",
    handler: async (ctx) => {
      ctx.ui.notify("Deploying...", "info");
      await ctx.exec("./deploy.sh", []);
    },
  });
}
```

#### CLI Flags

Register custom CLI flags (parsed automatically, shown in `--help`):

```typescript
export default function (pi: ExtensionAPI) {
  pi.registerFlag("dry-run", {
    description: "Run without making changes",
    type: "boolean",
  });

  pi.on("tool_call", async (event, ctx) => {
    if (pi.getFlag("dry-run") && event.toolName === "write") {
      return { block: true, reason: "Dry run mode" };
    }
  });
}
```

#### Custom UI

Extensions have full TUI access via `ctx.ui`:

```typescript
// Simple prompts
const confirmed = await ctx.ui.confirm("Title", "Are you sure?");
const choice = await ctx.ui.select("Pick one", ["Option A", "Option B"]);
const text = await ctx.ui.input("Enter value");

// Notifications
ctx.ui.notify("Done!", "success"); // success, info, warning, error

// Status line (persistent in footer, multiple extensions can set their own)
ctx.ui.setStatus("my-ext", "Processing...");
ctx.ui.setStatus("my-ext", null); // Clear

// Widgets (above editor)
ctx.ui.setWidget("my-ext", ["Line 1", "Line 2"]);

// Custom footer (replaces built-in footer)
ctx.ui.setFooter((tui, theme) => ({
  render(width) { return [theme.fg("dim", "Custom footer")]; },
  invalidate() {},
}));
ctx.ui.setFooter(undefined); // Restore built-in footer

// Full custom component with keyboard handling
await ctx.ui.custom((tui, theme, done) => ({
  render(width) {
    return [
      theme.bold("My Component"),
      theme.fg("dim", "Press Escape to close"),
    ];
  },
  handleInput(data) {
    if (matchesKey(data, "escape")) done();
  },
}));
```

> See [docs/extensions.md](docs/extensions.md) for full API reference.
> See [docs/tui.md](docs/tui.md) for TUI components and custom rendering.
> See [examples/extensions/](examples/extensions/) for working examples.

---

## CLI Reference

```bash
pi [options] [@files...] [messages...]
```

### Options

| Option | Description |
|--------|-------------|
| `--provider <name>` | Provider: `anthropic`, `openai`, `openai-codex`, `google`, `google-vertex`, `amazon-bedrock`, `mistral`, `xai`, `groq`, `cerebras`, `openrouter`, `vercel-ai-gateway`, `zai`, `opencode`, `minimax`, `minimax-cn`, `github-copilot`, `google-gemini-cli`, `google-antigravity`, or custom |
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
| `--models <patterns>` | Comma-separated patterns for Ctrl+P cycling. Supports glob patterns (e.g., `anthropic/*`, `*sonnet*:high`) and fuzzy matching (e.g., `sonnet,haiku:low`) |
| `--no-tools` | Disable all built-in tools |
| `--tools <tools>` | Comma-separated tool list (default: `read,bash,edit,write`) |
| `--thinking <level>` | Thinking level: `off`, `minimal`, `low`, `medium`, `high` |
| `--extension <path>`, `-e` | Load an extension file (can be used multiple times) |
| `--no-extensions` | Disable extension discovery (explicit `-e` paths still work) |
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

# Limit to specific provider with glob pattern
pi --models "github-copilot/*"

# Read-only mode
pi --tools read,grep,find,ls -p "Review the architecture"

# Export session
pi --export session.jsonl output.html
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc. | API keys for providers (see [API Keys & OAuth](#api-keys--oauth)) |
| `PI_CODING_AGENT_DIR` | Override the agent config directory (default: `~/.pi/agent`) |
| `PI_SKIP_VERSION_CHECK` | Skip new version check at startup (useful for Nix or other package manager installs) |
| `VISUAL`, `EDITOR` | External editor for Ctrl+G (e.g., `vim`, `code --wait`) |

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

For adding new tools, see [Extensions](#extensions) in the Customization section.

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
- Extensions (discovered or via paths)
- Skills, context files, prompt templates
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

Works with session files.

---

## Philosophy

Pi is opinionated about what it won't do. These are intentional design decisions to minimize context bloat and avoid anti-patterns.

**No MCP.** Build CLI tools with READMEs (see [Skills](#skills)). The agent reads them on demand. [Would you like to know more?](https://mariozechner.at/posts/2025-11-02-what-if-you-dont-need-mcp/)

**No sub-agents.** Spawn pi instances via tmux, or [build your own sub-agent tool](examples/extensions/subagent/) with [Extensions](#extensions). Full observability and steerability.

**No permission popups.** Security theater. Run in a container or build your own with [Extensions](#extensions).

**No plan mode.** Gather context in one session, write plans to file, start fresh for implementation.

**No built-in to-dos.** They confuse models. Use a TODO.md file, or [build your own](examples/extensions/todo.ts) with [Extensions](#extensions).

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

---

## License

MIT

## See Also

- [@mariozechner/pi-ai](https://www.npmjs.com/package/@mariozechner/pi-ai): Core LLM toolkit
- [@mariozechner/pi-agent](https://www.npmjs.com/package/@mariozechner/pi-agent): Agent framework
- [@mariozechner/pi-tui](https://www.npmjs.com/package/@mariozechner/pi-tui): Terminal UI components
