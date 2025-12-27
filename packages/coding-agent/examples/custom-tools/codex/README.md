# Codex Tool

Use OpenAI Codex as a sub-agent with its own isolated context window.

Runs with full access and no approvals by default (equivalent to `codex --dangerously-bypass-approvals-and-sandbox`).

## Installation

1. Install the Codex SDK:
   ```bash
   npm install @openai/codex-sdk
   ```

2. Authenticate with Codex CLI (if not already):
   ```bash
   codex login
   ```

3. Enable the tool:
   ```bash
   pi --tool ./path/to/codex/index.ts
   ```

   Or add to your settings.json:
   ```json
   {
     "customTools": ["~/.pi/agent/tools/codex/index.ts"]
   }
   ```

## Usage

The LLM can invoke Codex as a sub-agent for tasks like:

- **Code review**: "Use codex to review the staged changes"
- **Complex analysis**: "Have codex analyze the authentication flow"
- **Refactoring**: "Ask codex to refactor the database module"

### Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `prompt` | string | required | The task to send to Codex |
| `model` | string | from config | Model to use (e.g., "gpt-4.1", "o3") |
| `sandboxMode` | string | "danger-full-access" | File access: "read-only", "workspace-write", "danger-full-access" |
| `reasoningEffort` | string | - | Reasoning effort: "minimal", "low", "medium", "high", "xhigh" |
| `cwd` | string | current dir | Working directory for Codex |
| `skipGitCheck` | boolean | true | Skip Git repository check |
| `networkAccess` | boolean | true | Enable network access |
| `webSearch` | boolean | false | Enable web search |

### Security

By default, Codex runs with **full access and no approval prompts** (like `--dangerously-bypass-approvals-and-sandbox`). This means:
- Codex can read and write any files
- Network access is enabled
- No approval prompts (runs fully autonomously)

For more restricted operation, set `sandboxMode: "read-only"` or `sandboxMode: "workspace-write"`.

## How It Works

1. The tool checks for authentication in `~/.codex/auth.json` (created by `codex login`)
2. It spawns a Codex session via the SDK (which runs the codex CLI as a subprocess)
3. Events are streamed in real-time as Codex works
4. The final response is returned to pi's LLM

## Authentication

The tool uses credentials from the Codex CLI - no additional configuration needed. Just run `codex login` once.

## Example

```
You: Review the changes in this PR using codex

[LLM uses the codex tool with prompt: "Review the staged git changes. Focus on bugs, security issues, and code quality."]

[codex tool executes, streaming output...]

Codex found 3 issues:
1. SQL injection vulnerability in user_service.ts
2. Missing error handling in api_handler.ts
3. Unused import in utils.ts
```
