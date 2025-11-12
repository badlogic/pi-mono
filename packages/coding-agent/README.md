# @mariozechner/coding-agent

Interactive CLI coding assistant powered by multiple LLM providers. Chat with AI models that can read files, execute commands, and make precise edits to your codebase.

**Note**: This tool can modify your filesystem. Use with caution in production environments.

## Installation

```bash
npm install -g @mariozechner/coding-agent
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

Place an `AGENT.md` or `CLAUDE.md` file in your project root to provide context to the AI. The contents will be automatically included at the start of new sessions (not when continuing/resuming sessions).

This is useful for:
- Project-specific instructions and guidelines
- Architecture documentation
- Coding conventions and style guides
- Dependencies and setup information

The file is injected as a user message at the beginning of each new session, ensuring the AI has project context without modifying the system prompt.

## Image Support

Send images to vision-capable models by providing file paths:

```
You: What is in this screenshot? /path/to/image.png
```

Supported formats: `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`

The image will be automatically encoded and sent with your message. JPEG and PNG are supported across all vision models. Other formats may only be supported by some models.

## Available Tools

The agent has access to four core tools for working with your codebase:

### read

Read file contents. Supports text files and images (jpg, png, gif, webp). Images are sent as attachments. For text files, defaults to first 2000 lines. Use offset/limit parameters for large files. Lines longer than 2000 characters are truncated.

### write

Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.

### edit

Edit a file by replacing exact text. The oldText must match exactly (including whitespace). Use this for precise, surgical edits. Returns an error if the text appears multiple times or isn't found.

### bash

Execute a bash command in the current working directory. Returns stdout and stderr. Commands run with a 30 second timeout.

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

**--system-prompt <text>**
Custom system prompt (overrides default coding assistant prompt)

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

## License

MIT

## See Also

- [@mariozechner/pi-ai](https://www.npmjs.com/package/@mariozechner/pi-ai): Core LLM toolkit with multi-provider support
- [@mariozechner/pi-agent](https://www.npmjs.com/package/@mariozechner/pi-agent): Agent framework with tool execution
