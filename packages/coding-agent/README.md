# pi

A radically simple and opinionated coding agent with multi-model support (including mid-session switching), a simple yet powerful CLI for headless coding tasks, and many creature comforts you might be used to from other coding agents.

Works on Linux, macOS, and Windows (barely tested, needs Git Bash running in the "modern" Windows Terminal).

## Installation

```bash
npm install -g @mariozechner/pi-coding-agent
```

## Quick Start

```bash
# Set your API key (see API Keys section)
export ANTHROPIC_API_KEY=sk-ant-...

# Start the interactive CLI
pi
```

Once in the CLI, you can chat with the AI:

```
You: Create a simple Express server in src/server.ts
```

The agent will use its tools to read, write, and edit files as needed, and execute commands via Bash.

## API Keys

The CLI supports multiple LLM providers. Set the appropriate environment variable for your chosen provider:

```bash
# Anthropic (Claude)
export ANTHROPIC_API_KEY=sk-ant-...
# Or use OAuth token (retrieved via: claude setup-token)
export ANTHROPIC_OAUTH_TOKEN=...

# OpenAI (GPT)
export OPENAI_API_KEY=sk-...

# Google (Gemini)
export GEMINI_API_KEY=...

# Groq
export GROQ_API_KEY=gsk_...

# Cerebras
export CEREBRAS_API_KEY=csk-...

# xAI (Grok)
export XAI_API_KEY=xai-...

# OpenRouter
export OPENROUTER_API_KEY=sk-or-...

# ZAI
export ZAI_API_KEY=...
```

If no API key is set, the CLI will prompt you to configure one on first run.

## Slash Commands

The CLI supports several commands to control its behavior:

### /model

Switch models mid-session. Opens an interactive selector where you can type to search (by provider or model name), use arrow keys to navigate, Enter to select, or Escape to cancel.

### /thinking

Adjust thinking/reasoning level for supported models (Claude Sonnet 4, GPT-5, Gemini 2.5). Opens an interactive selector where you can use arrow keys to navigate, Enter to select, or Escape to cancel.

### /export [filename]

Export the current session to a self-contained HTML file:

```
/export                          # Auto-generates filename
/export my-session.html          # Custom filename
```

The HTML file includes the full conversation with syntax highlighting and is viewable in any browser.

### /session

Show session information and statistics:

```
/session
```

Displays:
- Session file path and ID
- Message counts (user, assistant, total)
- Token usage (input, output, cache read/write, total)
- Total cost (if available)

## Editor Features

The interactive input editor includes several productivity features:

### Path Completion

Press **Tab** to autocomplete file and directory paths:
- Works with relative paths: `./src/` + Tab → complete files in src/
- Works with parent directories: `../../` + Tab → navigate up and complete
- Works with home directory: `~/Des` + Tab → `~/Desktop/`
- Use **Up/Down arrows** to navigate completion suggestions
- Press **Enter** to select a completion
- Shows matching files and directories as you type

### File Drag & Drop

Drag files from your OS file explorer (Finder on macOS, Explorer on Windows) directly onto the terminal. The file path will be automatically inserted into the editor. Works great with screenshots from macOS screenshot tool.

### Multi-line Paste

Paste multiple lines of text (e.g., code snippets, logs) and they'll be automatically coalesced into a compact `[paste #123 <N> lines]` reference in the editor. The full content is still sent to the model.

### Keyboard Shortcuts

- **Ctrl+K**: Delete current line
- **Ctrl+C**: Clear editor (first press) / Exit pi (second press)
- **Tab**: Path completion
- **Enter**: Send message
- **Shift+Enter**: Insert new line (multi-line input)
- **Arrow keys**: Move cursor
- **Ctrl+A** / **Home** / **Cmd+Left** (macOS): Jump to start of line
- **Ctrl+E** / **End** / **Cmd+Right** (macOS): Jump to end of line

## Project Context Files

The agent automatically loads context from `AGENT.md` or `CLAUDE.md` files at the start of new sessions (not when continuing/resuming). These files are loaded in hierarchical order to support both global preferences and monorepo structures.

### File Locations

Context files are loaded in this order:

1. **Global context**: `~/.pi/agent/AGENT.md` or `CLAUDE.md`
   - Applies to all your coding sessions
   - Great for personal coding preferences and workflows

2. **Parent directories** (top-most first down to current directory)
   - Walks up from current directory to filesystem root
   - Each directory can have its own `AGENT.md` or `CLAUDE.md`
   - Perfect for monorepos with shared context at higher levels

3. **Current directory**: Your project's `AGENT.md` or `CLAUDE.md`
   - Most specific context, loaded last
   - Overwrites or extends parent/global context

**File preference**: In each directory, `AGENT.md` is preferred over `CLAUDE.md` if both exist.

### What to Include

Context files are useful for:
- Project-specific instructions and guidelines
- Common bash commands and workflows
- Architecture documentation
- Coding conventions and style guides
- Dependencies and setup information
- Testing instructions
- Repository etiquette (branch naming, merge vs. rebase, etc.)

### Example

```markdown
# Common Commands
- npm run build: Build the project
- npm test: Run tests

# Code Style
- Use TypeScript strict mode
- Prefer async/await over promises

# Workflow
- Always run tests before committing
- Update CHANGELOG.md for user-facing changes
```

All context files are automatically included in the system prompt at session start, along with the current date/time and working directory. This ensures the AI has complete project context from the very first message.

## Image Support

Send images to vision-capable models by providing file paths:

```
You: What is in this screenshot? /path/to/image.png
```

Supported formats: `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`

The image will be automatically encoded and sent with your message. JPEG and PNG are supported across all vision models. Other formats may only be supported by some models.

## Session Management

Sessions are automatically saved in `~/.pi/agent/sessions/` organized by working directory. Each session is stored as a JSONL file with a unique timestamp-based ID.

To continue the most recent session:

```bash
pi --continue
# or
pi -c
```

To browse and select from past sessions:

```bash
pi --resume
# or
pi -r
```

This opens an interactive session selector where you can:
- Type to search through session messages
- Use arrow keys to navigate the list
- Press Enter to resume a session
- Press Escape to cancel

Sessions include all conversation messages, tool calls and results, model switches, and thinking level changes.

To run without saving a session (ephemeral mode):

```bash
pi --no-session
```

To use a specific session file instead of auto-generating one:

```bash
pi --session /path/to/my-session.jsonl
```

## CLI Options

```bash
pi [options] [messages...]
```

### Options

**--provider <name>**
Provider name. Available: `anthropic`, `openai`, `google`, `xai`, `groq`, `cerebras`, `openrouter`, `zai`. Default: `anthropic`

**--model <id>**
Model ID. Default: `claude-sonnet-4-5`

**--api-key <key>**
API key (overrides environment variables)

**--system-prompt <text|file>**
Custom system prompt. Can be:
- Inline text: `--system-prompt "You are a helpful assistant"`
- File path: `--system-prompt ./my-prompt.txt`

If the argument is a valid file path, the file contents will be used as the system prompt. Otherwise, the text is used directly. Project context files and datetime are automatically appended.

**--mode <mode>**
Output mode for non-interactive usage. Options:
- `text` (default): Output only the final assistant message text
- `json`: Stream all agent events as JSON (one event per line). Events are emitted by `@mariozechner/pi-agent` and include message updates, tool executions, and completions
- `rpc`: JSON mode plus stdin listener for headless operation. Send JSON commands on stdin: `{"type":"prompt","message":"..."}` or `{"type":"abort"}`. See [test/rpc-example.ts](test/rpc-example.ts) for a complete example

**--no-session**
Don't save session (ephemeral mode)

**--session <path>**
Use specific session file path instead of auto-generating one

**--continue, -c**
Continue the most recent session

**--resume, -r**
Select a session to resume (opens interactive selector)

**--help, -h**
Show help message

### Examples

```bash
# Start interactive mode
pi

# Single message mode (text output)
pi "List all .ts files in src/"

# JSON mode - stream all agent events
pi --mode json "List all .ts files in src/"

# RPC mode - headless operation (see test/rpc-example.ts)
pi --mode rpc --no-session
# Then send JSON on stdin:
# {"type":"prompt","message":"List all .ts files"}
# {"type":"abort"}

# Continue previous session
pi -c "What did we discuss?"

# Use different model
pi --provider openai --model gpt-4o "Help me refactor this code"
```

## Tools

### Built-in Tools

The agent has access to four core tools for working with your codebase:

**read**
Read file contents. Supports text files and images (jpg, png, gif, webp). Images are sent as attachments. For text files, defaults to first 2000 lines. Use offset/limit parameters for large files. Lines longer than 2000 characters are truncated.

**write**
Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.

**edit**
Edit a file by replacing exact text. The oldText must match exactly (including whitespace). Use this for precise, surgical edits. Returns an error if the text appears multiple times or isn't found.

**bash**
Execute a bash command in the current working directory. Returns stdout and stderr. Optionally accepts a `timeout` parameter (in seconds) - no default timeout.

### MCP & Adding Your Own Tools

**pi does and will not support MCP.** Instead, it relies on the four built-in tools above and assumes the agent can invoke pre-existing CLI tools or write them on the fly as needed.

**Here's the gist:**

1. Create a simple CLI tool (any language, any executable)
2. Write a concise README.md describing what it does and how to use it
3. Tell the agent to read that README

**Minimal example:**

`~/agent-tools/screenshot/README.md`:
```markdown
# Screenshot Tool

Takes a screenshot of your main display.

## Usage
```bash
screenshot.sh
```

Returns the path to the saved PNG file.
```

`~/agent-tools/screenshot/screenshot.sh`:
```bash
#!/bin/bash
screencapture -x /tmp/screenshot-$(date +%s).png
ls -t /tmp/screenshot-*.png | head -1
```

**In your session:**
```
You: Read ~/agent-tools/screenshot/README.md and use that tool to take a screenshot
```

The agent will read the README, understand the tool, and invoke it via bash as needed. If you need a new tool, ask the agent to write it for you.

You can also reference tool READMEs in your `AGENT.md` files to make them automatically available:
- Global: `~/.pi/agent/AGENT.md` - available in all sessions
- Project-specific: `./AGENT.md` - available in this project

**Real-world example:**

The [exa-search](https://github.com/badlogic/exa-search) tools provide web search capabilities via the Exa API. Built by the agent itself in ~2 minutes. Far from perfect, but functional. Just tell your agent: "Read ~/agent-tools/exa-search/README.md and search for X".

For a detailed walkthrough with more examples, and the reasons for and benefits of this decision, see: https://mariozechner.at/posts/2025-11-02-what-if-you-dont-need-mcp/

## Security (YOLO by default)

This agent runs in full YOLO mode and assumes you know what you're doing. It has unrestricted access to your filesystem and can execute any command without permission checks or safety rails.

**What this means:**
- No permission prompts for file operations or commands
- No pre-checking of bash commands for malicious content
- Full filesystem access - can read, write, or delete anything
- Can execute any command with your user privileges

**Why:**
- Permission systems add massive friction while being easily circumvented
- Pre-checking tools for "dangerous" patterns introduces latency, false positives, and is ineffective

**Prompt injection risks:**
- By default, pi has no web search or fetch tool
- However, it can use `curl` or read files from disk
- Both provide ample surface area for prompt injection attacks
- Malicious content in files or command outputs can influence behavior

**Mitigations:**
- Run pi inside a container if you're uncomfortable with full access
- Use a different tool if you need guardrails
- Don't use pi on systems with sensitive data you can't afford to lose
- Fork pi and add all of the above

This is how I want it to work and I'm not likely to change my stance on this.

Use at your own risk.

## Sub-Agents

**pi does not and will not support sub-agents as a built-in feature.** If the agent needs to delegate work, it can:

1. Spawn another instance of itself via the `pi` CLI command
2. Write a custom tool with a README.md that describes how to invoke pi for specific tasks

**Why no built-in sub-agents:**

Context transfer between agents is generally poor. Information gets lost, compressed, or misrepresented when passed through agent boundaries. Direct execution with full context is more effective than delegation with summarized context.

If you need parallel work on independent tasks, manually run multiple `pi` sessions in different terminal tabs. You're the orchestrator.

## To-Dos

**pi does not and will not support built-in to-dos.** In my experience, to-do lists generally confuse models more than they help.

If you need task tracking, make it stateful by writing to a file:

```markdown
# TODO.md

- [x] Implement user authentication
- [x] Add database migrations
- [ ] Write API documentation
- [ ] Add rate limiting
```

The agent can read and update this file as needed. Using checkboxes keeps track of what's done and what remains. Simple, visible, and under your control.

## Planning

**pi does not and will not have a built-in planning mode.** Telling the agent to think through a problem together with you, without modifying files or executing commands, is generally sufficient.

If you need persistent planning across sessions, write it to a file:

```markdown
# PLAN.md

## Goal
Refactor authentication system to support OAuth

## Approach
1. Research OAuth 2.0 flows
2. Design token storage schema
3. Implement authorization server endpoints
4. Update client-side login flow
5. Add tests

## Current Step
Working on step 3 - authorization endpoints
```

The agent can read, update, and reference the plan as it works. Unlike ephemeral planning modes that only exist within a session, file-based plans persist and can be versioned with your code.

## Background Bash

**pi does not and will not implement background bash execution.** Instead, tell the agent to use `tmux` or something like [tterminal-cp](https://mariozechner.at/posts/2025-08-15-mcp-vs-cli/). Bonus points: you can watch the agent interact with a CLI like a debugger and even intervene if necessary.

## Planned Features

Things that might happen eventually:

- **Custom/local models**: Support for Ollama, llama.cpp, vLLM, SGLang, LM Studio via JSON config file
- **Auto-compaction**: Currently, watch the context percentage at the bottom. When it approaches 80%, either:
  - Ask the agent to write a summary .md file you can load in a new session
  - Switch to a model with bigger context (e.g., Gemini) using `/model` and either continue with that model, or let it summarize the session to a .md file to be loaded in a new session
- **Message queuing**: Core engine supports it, just needs UI wiring
- **Better RPC mode docs**: It works, you'll figure it out (see `test/rpc-example.ts`)
- **Beter Markdown and tool call/result rendering**
- **Full details mode**: use `/export out.html` for now
- **More flicker than Claude Code**: One day...

## License

MIT

## See Also

- [@mariozechner/pi-ai](https://www.npmjs.com/package/@mariozechner/pi-ai): Core LLM toolkit with multi-provider support
- [@mariozechner/pi-agent](https://www.npmjs.com/package/@mariozechner/pi-agent): Agent framework with tool execution
