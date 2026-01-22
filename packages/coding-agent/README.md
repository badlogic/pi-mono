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

Pi is a minimal terminal coding harness. Adapt pi to your workflows, not the other way around, without having to fork and modify pi internals. Extend it with TypeScript [Extensions](#extensions), [Skills](#skills), [Prompt Templates](#prompt-templates), and [Themes](#themes). Put your extensions, skills, prompt templates, and themes in [Pi Packages](#pi-packages) and share them with others via npm or git.

Pi ships with powerful defaults but skips features like sub agents and plan mode. Instead, you can ask pi to build what you want or install a third party pi package that matches your workflow.

Pi runs in four modes: interactive, print or JSON, RPC for process integration, and an SDK for embedding in your own apps. See [clawdbot/clawdbot](https://github.com/clawdbot/clawdbot) for a real-world SDK integration.

## Table of Contents

- [Quick Start](#quick-start)
- [Providers & Models](#providers--models)
- [Interactive Mode](#interactive-mode)
  - [Editor](#editor)
  - [Commands](#commands)
  - [Keyboard Shortcuts](#keyboard-shortcuts)
  - [Message Queue](#message-queue)
- [Sessions](#sessions)
  - [Branching](#branching)
  - [Compaction](#compaction)
- [Settings](#settings)
- [Context Files](#context-files)
- [Customization](#customization)
  - [Prompt Templates](#prompt-templates)
  - [Skills](#skills)
  - [Extensions](#extensions)
  - [Themes](#themes)
  - [Pi Packages](#pi-packages)
- [Programmatic Usage](#programmatic-usage)
- [Philosophy](#philosophy)
- [CLI Reference](#cli-reference)

---

## Quick Start

```bash
npm install -g @mariozechner/pi-coding-agent
```

Authenticate with an API key:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
pi
```

Or use your existing subscription:

```bash
pi
/login  # Then select provider
```

Then just talk to pi. By default, pi gives the model four tools: `read`, `write`, `edit`, and `bash`. The model uses these to fulfill your requests. Add capabilities via [skills](#skills), [prompt templates](#prompt-templates), [extensions](#extensions), or [pi packages](#pi-packages).

**Platform notes:** [Windows](docs/windows.md) | [Terminal setup](docs/terminal-setup.md) | [Shell aliases](docs/shell-aliases.md)

---

## Providers & Models

For each built-in provider, pi maintains a list of tool-capable models, updated with every release. Authenticate via subscription (`/login`) or API key, then select any model from that provider via `/model` (or Ctrl+L).

**Subscriptions:**
- Anthropic Claude Pro/Max
- OpenAI ChatGPT Plus/Pro (Codex)
- GitHub Copilot
- Google Gemini CLI
- Google Antigravity

**API keys:**
- Anthropic
- OpenAI
- Azure OpenAI
- Google Gemini
- Google Vertex
- Amazon Bedrock
- Mistral
- Groq
- Cerebras
- xAI
- OpenRouter
- Vercel AI Gateway
- ZAI
- OpenCode Zen
- Hugging Face
- Kimi For Coding
- MiniMax

See [docs/providers.md](docs/providers.md) for detailed setup instructions.

**Custom providers & models:** Add providers via `~/.pi/agent/models.json` if they speak a supported API (OpenAI, Anthropic, Google). For custom APIs or OAuth, use extensions. See [docs/models.md](docs/models.md) and [docs/custom-provider.md](docs/custom-provider.md).

---

## Interactive Mode

<p align="center"><img src="docs/images/interactive-mode.png" alt="Interactive Mode" width="600"></p>

The interface from top to bottom:

- **Startup header** - Shows shortcuts (`/hotkeys` for all), loaded AGENTS.md files, prompt templates, skills, and extensions
- **Messages** - Your messages, assistant responses, tool calls and results, notifications, errors, and extension UI
- **Editor** - Where you type; border color indicates thinking level
- **Footer** - Working directory, session name, total token/cache usage, cost, context usage, current model

The editor can be temporarily replaced by other UI, like built-in `/settings` or custom UI from extensions (e.g., a Q&A tool that lets the user answer model questions in a structured format). [Extensions](#extensions) can also replace the editor, add widgets above/below it, a status line, custom footer, or overlays.

### Editor

| Feature | How |
|---------|-----|
| File reference | Type `@` to fuzzy-search project files |
| Path completion | Tab to complete paths |
| Multi-line | Shift+Enter (or Ctrl+Enter on Windows Terminal) |
| Images | Ctrl+V to paste, or drag onto terminal |
| Bash commands | `!command` runs and sends output to LLM, `!!command` runs without sending |

Standard editing keybindings for delete word, undo, etc. See [docs/keybindings.md](docs/keybindings.md).

### Commands

Type `/` in the editor to trigger commands. [Extensions](#extensions) can register custom commands, [skills](#skills) are available as `/skill:name`, and [prompt templates](#prompt-templates) expand via `/templatename`.

| Command | Description |
|---------|-------------|
| `/login`, `/logout` | OAuth authentication |
| `/model` | Switch models |
| `/scoped-models` | Enable/disable models for Ctrl+P cycling |
| `/settings` | Thinking level, theme, message delivery |
| `/resume` | Pick from previous sessions |
| `/new` | Start a new session |
| `/name <name>` | Set session display name |
| `/session` | Show session info (path, tokens, cost) |
| `/tree` | Jump to any point in the session and continue from there |
| `/fork` | Create a new session from the current branch |
| `/compact [prompt]` | Manually compact context, optional custom instructions |
| `/copy` | Copy last assistant message to clipboard |
| `/export [file]` | Export session to HTML file |
| `/share` | Upload as private GitHub gist with shareable HTML link |
| `/reload` | Reload extensions, skills, prompts, context files (themes hot-reload automatically) |
| `/hotkeys` | Show all keyboard shortcuts |
| `/changelog` | Display version history |
| `/quit`, `/exit` | Quit pi |

### Keyboard Shortcuts

See `/hotkeys` for the full list. Customize via `~/.pi/agent/keybindings.json`. See [docs/keybindings.md](docs/keybindings.md).

**Commonly used:**

| Key | Action |
|-----|--------|
| Ctrl+C | Clear editor |
| Ctrl+C twice | Quit |
| Escape | Cancel/abort |
| Escape twice | Open `/tree` |
| Ctrl+L | Open model selector |
| Ctrl+P / Shift+Ctrl+P | Cycle scoped models forward/backward |
| Shift+Tab | Cycle thinking level |
| Ctrl+O | Collapse/expand tool output |
| Ctrl+T | Collapse/expand thinking blocks |

### Message Queue

Submit messages while the agent is working:

- **Enter** queues a *steering* message, delivered after current tool execution (interrupts remaining tools)
- **Alt+Enter** queues a *follow-up* message, delivered only after the agent finishes all work
- **Escape** aborts and restores queued messages to editor
- **Alt+Up** retrieves queued messages back to editor

Configure delivery in [settings](docs/settings.md): `steeringMode` and `followUpMode` can be `"one-at-a-time"` (default, waits for response) or `"all"` (delivers all queued at once).
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
| `deleteWordForward` | `alt+d`, `alt+delete` | Delete word forward |
| `deleteToLineStart` | `ctrl+u` | Delete to line start |
| `deleteToLineEnd` | `ctrl+k` | Delete to line end |
| `yank` | `ctrl+y` | Paste most recently deleted text |
| `yankPop` | `alt+y` | Cycle through deleted text after pasting |
| `undo` | `ctrl+-` | Undo last edit |
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
| `toggleSessionNamedFilter` | `ctrl+n` | Toggle named-only filter in session picker (`/resume`) |
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

Sessions are stored as JSONL files with a tree structure. Each entry has an `id` and `parentId`, enabling in-place branching without creating new files. See [docs/session.md](docs/session.md) for file format.

### Management

Sessions auto-save to `~/.pi/agent/sessions/` organized by working directory.

```bash
pi -c                  # Continue most recent session
pi -r                  # Browse and select from past sessions
pi --no-session        # Ephemeral mode (don't save)
pi --session <path>    # Use specific session file or ID
```

In the `/resume` picker:
- `Ctrl+P` toggles display of the session `.jsonl` file path
- `Ctrl+N` toggles the named-only filter (configurable via `toggleSessionNamedFilter` in `keybindings.json`)
- `Ctrl+D` deletes the selected session (inline confirmation; uses `trash` if available and cannot delete the active session)

**Resuming by session ID:** The `--session` flag accepts a session UUID (or prefix). Session IDs are visible in filenames under `~/.pi/agent/sessions/<project>/` (e.g., `2025-12-13T17-47-46-817Z_a8ec1c2a-5a5f-4699-88cb-03e7d3cb9292.jsonl`). The UUID is the part after the underscore. You can also search by session ID in the `pi -r` picker.

### Branching

**`/tree`** - Navigate the session tree in-place. Select any previous point, continue from there, and switch between branches. All history preserved in a single file.

<p align="center"><img src="docs/images/tree-view.png" alt="Tree View" width="600"></p>

- Search by typing, page with ←/→
- Filter modes (Ctrl+O): default → no-tools → user-only → labeled-only → all
- Press `l` to label entries as bookmarks

**`/fork`** - Create a new session file from the current branch. Opens a selector, copies history up to the selected point, and places that message in the editor for modification.

### Compaction

Long sessions can exhaust context windows. Compaction summarizes older messages while keeping recent ones.

**Manual:** `/compact` or `/compact <custom instructions>`

**Automatic:** Enabled by default. Triggers on context overflow (recovers and retries) or when approaching the limit (proactive). Configure via `/settings` or `settings.json`.

Compaction is lossy. The full history remains in the JSONL file; use `/tree` to revisit. Customize compaction behavior via [extensions](#extensions). See [docs/compaction.md](docs/compaction.md) for internals.

---

## Settings

Use `/settings` to modify common options, or edit JSON files directly:

| Location | Scope |
|----------|-------|
| `~/.pi/agent/settings.json` | Global (all projects) |
| `.pi/settings.json` | Project (overrides global) |

See [docs/settings.md](docs/settings.md) for all options.

---

## Context Files

Pi loads `AGENTS.md` (or `CLAUDE.md`) at startup from:
- `~/.pi/agent/AGENTS.md` (global)
- Parent directories (walking up from cwd)
- Current directory

Use for project instructions, conventions, common commands. All matching files are concatenated.

### System Prompt

Replace the default system prompt with `.pi/SYSTEM.md` (project) or `~/.pi/agent/SYSTEM.md` (global). Append without replacing via `APPEND_SYSTEM.md`.

---

## Customization

### Prompt Templates

Reusable prompts as Markdown files. Type `/name` to expand.

```markdown
<!-- ~/.pi/agent/prompts/review.md -->
Review this code for bugs, security issues, and performance problems.
Focus on: {{focus}}
```

Place in `~/.pi/agent/prompts/`, `.pi/prompts/`, or a [pi package](#pi-packages) to share with others. See [docs/prompt-templates.md](docs/prompt-templates.md).

### Skills

On-demand capability packages following the [Agent Skills standard](https://agentskills.io). Invoke via `/skill:name` or let the agent load them automatically.

```markdown
<!-- ~/.pi/agent/skills/my-skill/SKILL.md -->
# My Skill
Use this skill when the user asks about X.

## Steps
1. Do this
2. Then that
```

Place in `~/.pi/agent/skills/`, `.pi/skills/`, or a [pi package](#pi-packages) to share with others. See [docs/skills.md](docs/skills.md).

### Extensions

<p align="center"><img src="docs/images/doom-extension.png" alt="Doom Extension" width="600"></p>

TypeScript modules that extend pi with custom tools, commands, keyboard shortcuts, event handlers, and UI components.

```typescript
export default function (pi: ExtensionAPI) {
  pi.registerTool({ name: "deploy", ... });
  pi.registerCommand("stats", { ... });
  pi.on("tool_call", async (event, ctx) => { ... });
}
```

**What's possible:**
- Custom tools (or replace built-in tools entirely)
- Sub-agents and plan mode
- Custom compaction and summarization
- Permission gates and path protection
- Custom editors and UI components
- Status lines, headers, footers
- Git checkpointing and auto-commit
- SSH and sandbox execution
- MCP server integration
- Make pi look like Claude Code
- Games while waiting (yes, Doom runs)
- ...anything you can dream up

Place in `~/.pi/agent/extensions/`, `.pi/extensions/`, or a [pi package](#pi-packages) to share with others. See [docs/extensions.md](docs/extensions.md) and [examples/extensions/](examples/extensions/).

### Themes

Built-in: `dark`, `light`. Themes hot-reload: modify the active theme file and pi immediately applies changes.

Place in `~/.pi/agent/themes/`, `.pi/themes/`, or a [pi package](#pi-packages) to share with others. See [docs/themes.md](docs/themes.md).

### Pi Packages

Bundle and share extensions, skills, prompts, and themes via npm or git. Find packages on [npmjs.com](https://www.npmjs.com/search?q=keywords%3Api-package) or [Discord](https://discord.com/channels/1456806362351669492/1457744485428629628).

> **Security:** Pi packages run with full system access. Extensions execute arbitrary code, and skills can instruct the model to perform any action including running executables. Review source code before installing third-party packages.

```bash
pi install npm:@foo/pi-tools
pi install npm:@foo/pi-tools@1.2.3      # pinned version
pi install git:github.com/user/repo
pi install git:github.com/user/repo@v1  # tag or commit
pi install https://github.com/user/repo
pi remove npm:@foo/pi-tools
pi list
pi update                               # skips pinned packages
pi config                               # enable/disable extensions, skills, prompts, themes
```

Packages install to `~/.pi/agent/git/` (git) or global npm. Use `-l` for project-local installs (`.pi/git/`, `.pi/npm/`).

Create a package by adding a `pi` key to `package.json`:

```json
{
  "name": "my-pi-package",
  "keywords": ["pi-package"],
  "pi": {
    "extensions": ["./extensions"],
    "skills": ["./skills"],
    "prompts": ["./prompts"],
    "themes": ["./themes"]
  }
}
```

Without a `pi` manifest, pi auto-discovers from conventional directories (`extensions/`, `skills/`, `prompts/`, `themes/`).

See [docs/packages.md](docs/packages.md).

---

## Programmatic Usage

### SDK

```typescript
import { AuthStorage, createAgentSession, ModelRegistry, SessionManager } from "@mariozechner/pi-coding-agent";

const { session } = await createAgentSession({
  sessionManager: SessionManager.inMemory(),
  authStorage: new AuthStorage(),
  modelRegistry: new ModelRegistry(authStorage),
});

await session.prompt("What files are in the current directory?");
```

See [docs/sdk.md](docs/sdk.md) and [examples/sdk/](examples/sdk/).

### RPC Mode

For non-Node.js integrations, use RPC mode over stdin/stdout:

```bash
pi --mode rpc
```

See [docs/rpc.md](docs/rpc.md) for the protocol.

---

## Philosophy

Pi is aggressively extensible so it doesn't have to dictate your workflow. Features that other tools bake in can be built with [extensions](#extensions), [skills](#skills), or installed from third-party [pi packages](#pi-packages). This keeps the core minimal while letting you shape pi to fit how you work.

**No MCP.** Build CLI tools with READMEs (see [Skills](#skills)), or build an extension that adds MCP support. [Why?](https://mariozechner.at/posts/2025-11-02-what-if-you-dont-need-mcp/)

**No sub-agents.** There's many ways to do this. Spawn pi instances via tmux, or build your own with [extensions](#extensions), or install a package that does it your way.

**No permission popups.** Run in a container, or build your own confirmation flow with [extensions](#extensions) inline with your environment and security requirements.

**No plan mode.** Write plans to files, or build it with [extensions](#extensions), or install a package.

**No built-in to-dos.** They confuse models. Use a TODO.md file, or build your own with [extensions](#extensions).

**No background bash.** Use tmux. Full observability, direct interaction.

Read the [blog post](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/) for the full rationale.

---

## CLI Reference

```bash
pi [options] [@files...] [messages...]
```

### Package Commands

```bash
pi install <source> [-l]    # Install package, -l for project-local
pi remove <source> [-l]     # Remove package
pi update [source]          # Update packages (skips pinned)
pi list                     # List installed packages
pi config                   # Enable/disable package resources
```

### Modes

| Flag | Description |
|------|-------------|
| (default) | Interactive mode |
| `-p`, `--print` | Print response and exit |
| `--mode json` | Output all events as JSON lines (see [docs/json.md](docs/json.md)) |
| `--mode rpc` | RPC mode for process integration (see [docs/rpc.md](docs/rpc.md)) |
| `--export <in> [out]` | Export session to HTML |

### Model Options

| Option | Description |
|--------|-------------|
| `--provider <name>` | Provider (anthropic, openai, google, etc.) |
| `--model <id>` | Model ID |
| `--api-key <key>` | API key (overrides env vars) |
| `--thinking <level>` | `off`, `minimal`, `low`, `medium`, `high`, `xhigh` |
| `--models <patterns>` | Comma-separated patterns for Ctrl+P cycling |
| `--list-models [search]` | List available models |

### Session Options

| Option | Description |
|--------|-------------|
| `-c`, `--continue` | Continue most recent session |
| `-r`, `--resume` | Browse and select session |
| `--session <path>` | Use specific session file or partial UUID |
| `--session-dir <dir>` | Custom session storage directory |
| `--no-session` | Ephemeral mode (don't save) |

### Tool Options

| Option | Description |
|--------|-------------|
| `--tools <list>` | Enable specific built-in tools (default: `read,bash,edit,write`) |
| `--no-tools` | Disable all built-in tools (extension tools still work) |

Available built-in tools: `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`

### Resource Options

| Option | Description |
|--------|-------------|
| `-e`, `--extension <source>` | Load extension from path, npm, or git (repeatable) |
| `--no-extensions` | Disable extension discovery |
| `--skill <path>` | Load skill (repeatable) |
| `--no-skills` | Disable skill discovery |
| `--prompt-template <path>` | Load prompt template (repeatable) |
| `--no-prompt-templates` | Disable prompt template discovery |
| `--theme <path>` | Load theme (repeatable) |
| `--no-themes` | Disable theme discovery |

Combine `--no-*` with explicit flags to load exactly what you need, ignoring settings.json (e.g., `--no-extensions -e ./my-ext.ts`).

### Other Options

| Option | Description |
|--------|-------------|
| `--system-prompt <text>` | Replace default prompt (context files and skills still appended) |
| `--append-system-prompt <text>` | Append to system prompt |
| `--verbose` | Force verbose startup |
| `-h`, `--help` | Show help |
| `-v`, `--version` | Show version |

### File Arguments

Prefix files with `@` to include in the message:

```bash
pi @prompt.md "Answer this"
pi -p @screenshot.png "What's in this image?"
pi @code.ts @test.ts "Review these files"
```

### Examples

```bash
# Interactive with initial prompt
pi "List all .ts files in src/"

# Non-interactive
pi -p "Summarize this codebase"

# Different model
pi --provider openai --model gpt-4o "Help me refactor"

# Limit model cycling
pi --models "claude-*,gpt-4o"

# Read-only mode
pi --tools read,grep,find,ls -p "Review the code"

# High thinking level
pi --thinking high "Solve this complex problem"
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `PI_CODING_AGENT_DIR` | Override config directory (default: `~/.pi/agent`) |
| `PI_SKIP_VERSION_CHECK` | Skip version check at startup |
| `PI_CACHE_RETENTION` | Set to `long` for extended prompt cache (Anthropic: 1h, OpenAI: 24h) |
| `VISUAL`, `EDITOR` | External editor for Ctrl+G |

---

## Contributing & Development

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for guidelines and [docs/development.md](docs/development.md) for setup, forking, and debugging.

---

## License

MIT

## See Also

- [@mariozechner/pi-ai](https://www.npmjs.com/package/@mariozechner/pi-ai): Core LLM toolkit
- [@mariozechner/pi-agent](https://www.npmjs.com/package/@mariozechner/pi-agent): Agent framework
- [@mariozechner/pi-tui](https://www.npmjs.com/package/@mariozechner/pi-tui): Terminal UI components
