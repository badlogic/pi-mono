# Script Command Examples

Example script commands for pi-coding-agent.

Script commands are TypeScript files that define executable slash commands.
Unlike `.md` file commands that inject text, script commands run custom logic.

## Examples

### qna.ts
Extract questions from the last assistant message and format them for answering.

Demonstrates:
- `pi.getLastAssistantText()` to access conversation history
- `pi.complete()` to make LLM calls
- `pi.setEditorText()` to populate the editor with content

Use when the agent asks multiple questions you want to answer systematically.

## Usage

```bash
# Symlink to commands directory
ln -sf "$(pwd)/packages/coding-agent/examples/commands/qna.ts" ~/.pi/agent/commands/qna.ts

# Then in pi, type:
/qna
# Or with a specific model:
/qna claude-3-5-sonnet-latest
```

## Writing Script Commands

Script commands are TypeScript files that export a factory function:

```typescript
import type { ScriptCommandFactory } from "@mariozechner/pi-coding-agent";

const command: ScriptCommandFactory = (pi) => ({
  description: "Description shown in autocomplete",
  
  async execute(args) {
    // args is an array of space-separated arguments
    // e.g., "/mycommand foo bar" -> args = ["foo", "bar"]
    
    // Access the last assistant message
    const lastText = pi.getLastAssistantText();
    
    // Make an LLM call
    const result = await pi.complete(prompt, {
      model: "claude-haiku-4-5",  // optional
      systemPrompt: "...",
      maxTokens: 4096,
    });
    
    // Put text in the editor
    pi.setEditorText("Hello, world!");
    
    // Show messages
    pi.showStatus("Success!");
    pi.showError("Something went wrong");
    
    // Copy to clipboard
    pi.copyToClipboard(text);
  },
});

export default command;
```

## CommandAPI

The factory receives a `CommandAPI` object:

```typescript
interface CommandAPI {
  cwd: string;                              // Current working directory
  getLastAssistantText(): string | null;    // Last assistant message text
  setEditorText(text: string): void;        // Set editor content
  getEditorText(): string;                  // Get editor content
  complete(prompt: string, options?: CompleteOptions): Promise<AssistantMessage>;
  showStatus(message: string): void;        // Show status message
  showError(message: string): void;         // Show error message
  copyToClipboard(text: string): void;      // Copy to clipboard
}

interface CompleteOptions {
  model?: string;       // Model ID (default: current session model)
  systemPrompt?: string;
  maxTokens?: number;
  signal?: AbortSignal;
}
```

## Locations

Script commands are discovered from:

| Location | Scope |
|----------|-------|
| `~/.pi/agent/commands/*.ts` | Global (all projects) |
| `.pi/commands/*.ts` | Project-local |

Project commands override global commands with the same name.
