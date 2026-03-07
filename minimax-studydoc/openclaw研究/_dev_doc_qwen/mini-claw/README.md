# Mini-Claw

Minimal AI coding assistant powered by pi-mono concepts.

## Features

- **Multi-provider LLM support**: Anthropic (Claude) and OpenAI (GPT-4)
- **Core tools**: bash, read, write, edit, glob
- **Interactive CLI**: REPL mode with conversation history
- **Simple configuration**: JSON config or environment variables

## Installation

```bash
uv sync
```

## Quick Start

### 1. Initialize Configuration

```bash
uv run mini-claw --init-config
```

Or set environment variables:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
# or
export OPENAI_API_KEY=sk-...
```

### 2. Run Interactive Mode

```bash
uv run mini-claw
```

### 3. Run Single Command

```bash
uv run mini-claw "List all Python files"
uv run mini-claw "Create a hello.py file"
uv run mini-claw -w /path/to/project "Add tests to the project"
```

## Commands

In interactive mode:

- `/help` - Show help
- `/clear` - Clear conversation
- `/status` - Show configuration
- `/quit` - Exit

## Configuration

Config file location: `~/.mini-claw/config.json`

```json
{
  "provider": "anthropic",
  "api_key": "sk-ant-...",
  "model": "claude-sonnet-4-5-20250929",
  "workspace": "/path/to/workspace"
}
```

## Environment Variables

- `MINI_CLAW_API_KEY` - API key
- `MINI_CLAW_PROVIDER` - Provider (anthropic/openai)
- `MINI_CLAW_MODEL` - Model name
- `MINI_CLAW_WORKSPACE` - Workspace directory
- `ANTHROPIC_API_KEY` - Anthropic API key
- `OPENAI_API_KEY` - OpenAI API key

## Project Structure

```
miniclaw/
├── __init__.py      # Package init
├── config.py        # Configuration management
├── tools.py         # Core tools (bash, read, write, edit, glob)
├── llm.py           # LLM provider abstraction
├── agent.py         # Agent loop implementation
└── cli.py           # Command-line interface
```

## License

MIT
