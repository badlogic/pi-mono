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

# Or use the full command name
coding-agent
```

Once in the CLI, you can chat with the AI:

```
You: Create a simple Express server in src/server.ts
```

The agent will use its tools to read, write, and edit files as needed.

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

## Image Support

Send images to vision-capable models by providing file paths:

```
You: What is in this screenshot? /path/to/image.png
```

Supported formats: `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, `.bmp`, `.svg`

The image will be automatically encoded and sent with your message. Vision-capable models include:
- GPT-4o, GPT-4o-mini (OpenAI)
- Claude 3.5 Sonnet, Claude 3.5 Haiku (Anthropic)
- Gemini 2.5 Flash, Gemini 2.5 Pro (Google)

## Available Tools

The agent has access to four core tools for working with your codebase:

### read

Read file contents. Supports text files and images (jpg, png, gif, webp, bmp, svg). Images are sent as attachments. For text files, defaults to first 2000 lines. Use offset/limit parameters for large files. Lines longer than 2000 characters are truncated.

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

# Single message mode
pi "List all .ts files in src/"

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
