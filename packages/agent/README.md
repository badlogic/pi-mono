# pi-agent

A general-purpose agent with tool calling and session persistence, modeled after Claude Code but extremely hackable and minimal. It comes with a built-in TUI (also modeled after Claude Code) for interactive use.

Everything is designed to be easy:
- Writing custom UIs on top of it (via JSON mode in any language or the TypeScript API)
- Using it for inference steps in deterministic programs (via JSON mode in any language or the TypeScript API)
- Providing your own system prompts and tools
- Working with various LLM providers or self-hosted LLMs

## Installation

```bash
npm install -g @mariozechner/pi-agent
```

This installs the `pi-agent` command globally.

## Quick Start

By default, pi-agent uses OpenAI's API with model `gpt-5-mini` and authenticates using the `OPENAI_API_KEY` environment variable. Any OpenAI-compatible endpoint works, including Ollama, vLLM, OpenRouter, Groq, Anthropic, etc.

```bash
# Single message
pi-agent "What is 2+2?"

# Multiple messages processed sequentially
pi-agent "What is 2+2?" "What about 3+3?"

# Interactive chat mode (no messages = interactive)
pi-agent

# Continue most recently modified session in current directory
pi-agent --continue "Follow up question"

# GPT-OSS via Groq (supports reasoning with both APIs)
pi-agent --base-url https://api.groq.com/openai/v1 --api-key $GROQ_API_KEY --model openai/gpt-oss-120b

# GLM 4.5 via OpenRouter
pi-agent --base-url https://openrouter.ai/api/v1 --api-key $OPENROUTER_API_KEY --model z-ai/glm-4.5

# Claude via Anthropic's OpenAI compatibility layer
# Note: No prompt caching or thinking content support. For full features, use the native Anthropic API.
# See: https://docs.anthropic.com/en/api/openai-sdk
pi-agent --base-url https://api.anthropic.com/v1 --api-key $ANTHROPIC_API_KEY --model claude-opus-4-1-20250805

# Gemini via Google AI (set GEMINI_API_KEY environment variable)
# Note: Gemini 2.5 models support reasoning with thinking content automatically configured
pi-agent --base-url https://generativelanguage.googleapis.com/v1beta/openai/ --api-key $GEMINI_API_KEY --model gemini-2.5-flash
```

## Usage Modes

### Single-Shot Mode
Process one or more messages and exit:
```bash
pi-agent "First question" "Second question"
```

### Interactive Mode
Start an interactive chat session:
```bash
pi-agent
```
- Type messages and press Enter to send
- Type `exit` or `quit` to end session
- Press Escape to interrupt while processing
- Press CTRL+C to clear the text editor
- Press CTRL+C twice quickly to exit

### JSON Mode
JSON mode enables programmatic integration by outputting events as JSONL (JSON Lines).

**Single-shot mode:** Outputs a stream of JSON events for each message, then exits.
```bash
pi-agent --json "What is 2+2?" "And the meaning of life?"
# Outputs: {"type":"session_start","sessionId":"bb6f0acb-80cf-4729-9593-bcf804431a53","model":"gpt-5-mini","api":"completions","baseURL":"https://api.openai.com/v1","systemPrompt":"You are a helpful assistant."} {"type":"user_message","text":"What is 2+2?"} {"type":"assistant_start"} {"type":"token_usage","inputTokens":314,"outputTokens":16,"totalTokens":330,"cacheReadTokens":0,"cacheWriteTokens":0} {"type":"assistant_message","text":"2 + 2 = 4"} {"type":"user_message","text":"And the meaning of life?"} {"type":"assistant_start"} {"type":"token_usage","inputTokens":337,"outputTokens":331,"totalTokens":668,"cacheReadTokens":0,"cacheWriteTokens":0} {"type":"assistant_message","text":"Short answer (pop-culture): 42.\n\nMore useful answers:\n- Philosophical...
```

**Interactive mode:** Accepts JSON commands via stdin and outputs JSON events to stdout.
```bash
# Start interactive JSON mode
pi-agent --json
# Now send commands via stdin

# Pipe one or more initial messages in
(echo '{"type": "message", "content": "What is 2+2?"}'; cat) | pi-agent --json
# Outputs: {"type":"session_start","sessionId":"bb64cfbe-dd52-4662-bd4a-0d921c332fd1","model":"gpt-5-mini","api":"completions","baseURL":"https://api.openai.com/v1","systemPrompt":"You are a helpful assistant."} {"type":"user_message","text":"What is 2+2?"} {"type":"assistant_start"} {"type":"token_usage","inputTokens":314,"outputTokens":16,"totalTokens":330,"cacheReadTokens":0,"cacheWriteTokens":0} {"type":"assistant_message","text":"2 + 2 = 4"}
```

Commands you can send via stdin in interactive JSON mode:
```json
{"type": "message", "content": "Your message here"}  // Send a message to the agent
{"type": "interrupt"}                                 // Interrupt current processing
```

## Configuration

### Command Line Options
```
--base-url <url>        API base URL (default: https://api.openai.com/v1)
--api-key <key>         API key (or set OPENAI_API_KEY env var)
--model <model>         Model name (default: gpt-4o-mini)
--api <type>            API type: "completions" or "responses" (default: completions)
--system-prompt <text>  System prompt (default: "You are a helpful assistant.")
--continue              Continue previous session
--json                  JSON mode
--help, -h              Show help message
```

### Environment Variables
- `OPENAI_API_KEY` - OpenAI API key (used if --api-key not provided)

## Session Persistence

Sessions are automatically saved to `~/.pi/sessions/` and include:
- Complete conversation history
- Tool call results
- Token usage statistics

Use `--continue` to resume the last session:
```bash
pi-agent "Start a story about a robot"
# ... later ...
pi-agent --continue "Continue the story"
```

## Tools

The agent includes built-in tools for file system operations:
- **read_file** - Read file contents
- **list_directory** - List directory contents
- **bash** - Execute shell commands
- **glob** - Find files by pattern
- **ripgrep** - Search file contents

These tools are automatically available when using the agent through the `pi` command for code navigation tasks.

## JSON Mode Events

When using `--json`, the agent outputs these event types:
- `session_start` - New session started with metadata
- `user_message` - User input
- `assistant_start` - Assistant begins responding
- `assistant_message` - Assistant's response
- `thinking` - Reasoning/thinking (for models that support it, requires `--api responses`)
- `tool_call` - Tool being called
- `tool_result` - Result from tool
- `token_usage` - Token usage statistics (includes `reasoningTokens` for models with reasoning)
- `error` - Error occurred
- `interrupted` - Processing was interrupted

**Note:**
- OpenAI's Chat Completions API (`--api completions`, the default) only returns reasoning token *counts* but not the actual thinking content. To see thinking events, use the Responses API with `--api responses` for supported models (o1, o3, gpt-5).
- Anthropic's OpenAI compatibility layer doesn't return thinking content. Use the native Anthropic API for full extended thinking features.
- Gemini 2.5 models automatically include thinking content when reasoning is detected - pi-agent handles the `extra_body` configuration for you.

The complete TypeScript type definition for `AgentEvent` can be found in [`src/agent.ts`](src/agent.ts#L6).

## Build an Interactive UI with JSON Mode
Build custom UIs in any language by spawning pi-agent in JSON mode and communicating via stdin/stdout.

```javascript
import { spawn } from 'child_process';
import { createInterface } from 'readline';

// Start the agent in JSON mode
const agent = spawn('pi-agent', ['--json']);

// Create readline interface for parsing JSONL output from agent
const agentOutput = createInterface({input: agent.stdout, crlfDelay: Infinity});

// Create readline interface for user input
const userInput = createInterface({input: process.stdin, output: process.stdout});

// State tracking
let isProcessing = false, lastUsage, isExiting = false;

// Handle each line of JSON output from agent
agentOutput.on('line', (line) => {
    try {
      const event = JSON.parse(line);

      // Handle all event types
      switch (event.type) {
        case 'session_start':
          console.log(`Session started (${event.model}, ${event.api}, ${event.baseURL})`);
          console.log('Press CTRL + C to exit');
          promptUser();
          break;

        case 'user_message':
          // Already shown in prompt, skip
          break;

        case 'assistant_start':
          isProcessing = true;
          console.log('\n[assistant]');
          break;

        case 'thinking':
          console.log(`[thinking]\n${event.text}\n`);
          break;

        case 'tool_call':
          console.log(`[tool] ${event.name}(${event.args.substring(0, 50)})\n`);
          break;

        case 'tool_result':
            const lines = event.result.split('\n');
            const truncated = lines.length - 5 > 0 ? `\n.  ... (${lines.length - 5} more lines truncated)` : '';
            console.log(`[tool result]\n${lines.slice(0, 5).join('\n')}${truncated}\n`);
          break;

        case 'assistant_message':
          console.log(event.text.trim());
          isProcessing = false;
          promptUser();
          break;

        case 'token_usage':
          lastUsage = event;
          break;

        case 'error':
          console.error('\n❌ Error:', event.message);
          isProcessing = false;
          promptUser();
          break;

        case 'interrupted':
          console.log('\n⚠️  Interrupted by user');
          isProcessing = false;
          promptUser();
          break;
      }
    } catch (e) {
      console.error('Failed to parse JSON:', line, e);
    }
});

// Send a message to the agent
function sendMessage(content) {
  agent.stdin.write(`${JSON.stringify({type: 'message', content: content})}\n`);
}

// Send interrupt signal
function interrupt() {
  agent.stdin.write(`${JSON.stringify({type: 'interrupt'})}\n`);
}

// Prompt for user input
function promptUser() {
  if (isExiting) return;

  if (lastUsage) {
    console.log(`\nin: ${lastUsage.inputTokens}, out: ${lastUsage.outputTokens}, cache read: ${lastUsage.cacheReadTokens}, cache write: ${lastUsage.cacheWriteTokens}`);
  }

  userInput.question('\n[user]\n> ', (answer) => {
    answer = answer.trim();
    if (answer) {
      sendMessage(answer);
    } else {
      promptUser();
    }
  });
}

// Handle Ctrl+C
process.on('SIGINT', () => {
  if (isProcessing) {
    interrupt();
  } else {
    agent.kill();
    process.exit(0);
  }
});

// Handle agent exit
agent.on('close', (code) => {
  isExiting = true;
  userInput.close();
  console.log(`\nAgent exited with code ${code}`);
  process.exit(code);
});

// Handle errors
agent.on('error', (err) => {
  console.error('Failed to start agent:', err);
  process.exit(1);
});

// Start the conversation
console.log('Pi Agent Interactive Chat');
```

## Reasoning

Pi-agent supports reasoning/thinking tokens for models that provide this capability:

### Supported Providers

| Provider | API | Reasoning Tokens | Thinking Content | Notes |
|----------|-----|------------------|------------------|-------|
| OpenAI (o1, o3) | Responses | ✅ | ✅ | Full support via `reasoning` events |
| OpenAI (o1, o3) | Chat Completions | ✅ | ❌ | Token counts only, no content |
| OpenAI (gpt-5) | Responses | ✅ | ⚠️ | Model returns empty summaries |
| OpenAI (gpt-5) | Chat Completions | ✅ | ❌ | Token counts only |
| Groq (gpt-oss) | Responses | ✅ | ❌ | No reasoning.summary support |
| Groq (gpt-oss) | Chat Completions | ✅ | ✅ | Via `reasoning_format: "parsed"` |
| Gemini 2.5 | Chat Completions | ✅ | ✅ | Via `extra_body.google.thinking_config` |
| Anthropic | OpenAI Compat | ❌ | ❌ | Not supported in compatibility layer |
| OpenRouter | Various | ✅ | ✅ | Model-dependent, see provider docs |

### Usage Examples

```bash
# OpenAI o1/o3 - see thinking content with Responses API
pi-agent --api responses --model o1-mini "Explain quantum computing"

# Groq gpt-oss - reasoning with Chat Completions
pi-agent --base-url https://api.groq.com/openai/v1 --api-key $GROQ_API_KEY \
  --model openai/gpt-oss-120b "Complex math problem"

# Gemini 2.5 - thinking content automatically configured
pi-agent --base-url https://generativelanguage.googleapis.com/v1beta/openai/ \
  --api-key $GEMINI_API_KEY --model gemini-2.5-flash "Think step by step"

# OpenRouter - supports various reasoning models
pi-agent --base-url https://openrouter.ai/api/v1 --api-key $OPENROUTER_API_KEY \
  --model "qwen/qwen3-235b-a22b-thinking-2507" "Complex reasoning task"
```

### JSON Mode Events

When reasoning is active, you'll see:
- `reasoning` events with thinking text (when available)
- `token_usage` events include `reasoningTokens` field
- Console/TUI show reasoning tokens with ⚡ symbol

### Technical Details

The agent automatically:
- Detects provider from base URL
- Tests model reasoning support on first use (cached)
- Adjusts request parameters per provider:
  - OpenAI: `reasoning_effort` (minimal/low)
  - Groq: `reasoning_format: "parsed"`
  - Gemini: `extra_body.google.thinking_config`
  - OpenRouter: `reasoning` object with `effort` field
- Parses provider-specific response formats:
  - Gemini: Extracts from `<thought>` tags
  - Groq: Uses `message.reasoning` field
  - OpenRouter: Uses `message.reasoning` field
  - OpenAI: Uses standard `reasoning` events

## Architecture

The agent is built with:
- **agent.ts** - Core Agent class and API functions
- **cli.ts** - CLI entry point, argument parsing, and JSON mode handler
- **args.ts** - Custom typed argument parser
- **session-manager.ts** - Session persistence
- **tools/** - Tool implementations
- **renderers/** - Output formatters (console, TUI, JSON)

## Development

### Running from Source

```bash
# Run directly with npx tsx - no build needed
npx tsx src/cli.ts "What is 2+2?"

# Interactive TUI mode
npx tsx src/cli.ts

# JSON mode for programmatic use
echo '{"type":"message","content":"list files"}' | npx tsx src/cli.ts --json
```

### Testing

The agent supports three testing modes:

#### 1. Test UI/Renderers (non-interactive mode)
```bash
# Test console renderer output and metrics
npx tsx src/cli.ts "list files in /tmp" 2>&1 | tail -5
# Verify: ↑609 ↓610 ⚒ 1 (tokens and tool count)

# Test TUI renderer (with stdin)
echo "list files" | npx tsx src/cli.ts 2>&1 | grep "⚒"
```

#### 2. Test Model Behavior (JSON mode)
```bash
# Extract metrics for model comparison
echo '{"type":"message","content":"write fibonacci in Python"}' | \
  npx tsx src/cli.ts --json --model gpt-4o-mini 2>&1 | \
  jq -s '[.[] | select(.type=="token_usage")] | last'

# Compare models: tokens used, tool calls made, quality
for model in "gpt-4o-mini" "gpt-4o"; do
  echo "Testing $model:"
  echo '{"type":"message","content":"fix syntax errors in: prnt(hello)"}' | \
    npx tsx src/cli.ts --json --model $model 2>&1 | \
    jq -r 'select(.type=="token_usage" or .type=="tool_call" or .type=="assistant_message")'
done
```

#### 3. LLM-as-Judge Testing
```bash
# Capture output from different models and evaluate with another LLM
TASK="write a Python function to check if a number is prime"

# Get response from model A
RESPONSE_A=$(echo "{\"type\":\"message\",\"content\":\"$TASK\"}" | \
  npx tsx src/cli.ts --json --model gpt-4o-mini 2>&1 | \
  jq -r '.[] | select(.type=="assistant_message") | .text')

# Judge the response
echo "{\"type\":\"message\",\"content\":\"Rate this code (1-10): $RESPONSE_A\"}" | \
  npx tsx src/cli.ts --json --model gpt-4o 2>&1 | \
  jq -r '.[] | select(.type=="assistant_message") | .text'
```

## Use as a Library

```typescript
import { Agent, ConsoleRenderer } from '@mariozechner/pi-agent';

const agent = new Agent({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: 'https://api.openai.com/v1',
  model: 'gpt-5-mini',
  api: 'completions',
  systemPrompt: 'You are a helpful assistant.'
}, new ConsoleRenderer());

await agent.ask('What is 2+2?');
```