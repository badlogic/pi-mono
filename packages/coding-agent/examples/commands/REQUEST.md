# Feature Request: Script-based Slash Commands

## Overview

Currently, slash commands in pi are `.md` files that inject text into the prompt. This request proposes extending the system to support `.ts` files that execute custom logic, enabling commands like `/qna` to be implemented as plugins rather than built into core.

## Motivation

The `/qna` command needs to:
1. Get the last assistant message text
2. Send it through an LLM to extract/reformat questions
3. Load the result into the editor for the user to fill in

This requires access to session state and UI that text injection cannot provide. Rather than adding every such command to core, we should enable users to write their own.

## Proposed Design

### 1. Script Command File Format

Commands are `.ts` files in the commands directory (same locations as `.md` files):
- `~/.pi/agent/commands/*.ts` (user global)
- `.pi/commands/*.ts` (project local)

```typescript
// ~/.pi/agent/commands/qna.ts
import type { ScriptCommandFactory } from "@mariozechner/pi-coding-agent";

const command: ScriptCommandFactory = (pi) => ({
  description: "Extract questions from last message into editor",
  
  async execute(args) {
    const modelId = args[0] || "claude-haiku-4-5";
    
    const lastText = pi.getLastAssistantText();
    if (!lastText) {
      pi.showError("No assistant messages yet.");
      return;
    }
    
    pi.showStatus(`Extracting questions using ${modelId}...`);
    
    const result = await pi.complete(lastText, {
      model: modelId,
      systemPrompt: "Extract questions and format as Q&A document...",
    });
    
    const formatted = result.content
      .filter(c => c.type === "text")
      .map(c => c.text)
      .join("");
    
    pi.setEditorText(formatted);
    pi.showStatus("Questions loaded into editor. Press Ctrl+G to edit.");
  },
});

export default command;
```

### 2. ToolAPI Interface

The API passed to script commands:

```typescript
interface ToolAPI {
  /** Current working directory */
  cwd: string;
  
  /** Execute a command */
  exec(command: string, args: string[], options?: ExecOptions): Promise<ExecResult>;
  
  /** UI methods for user interaction */
  ui: ToolUIContext;
  
  /** Whether UI is available */
  hasUI: boolean;
  
  /** Get text content of the last assistant message, or null if none */
  getLastAssistantText(): string | null;
  
  /** Set the editor text content */
  setEditorText(text: string): void;
  
  /** Get current editor text content */
  getEditorText(): string;
  
  /**
   * Make an LLM completion call.
   * Uses the session's model registry to resolve API keys.
   */
  complete(prompt: string, options?: CompleteOptions): Promise<AssistantMessage>;
  
  /** Show a status message in the UI */
  showStatus(message: string): void;
  
  /** Show an error message in the UI */
  showError(message: string): void;
  
  /** Copy text to clipboard */
  copyToClipboard(text: string): void;
}

interface CompleteOptions {
  /** Model ID (default: current session model) */
  model?: string;
  /** System prompt */
  systemPrompt?: string;
  /** Max tokens in response */
  maxTokens?: number;
  /** Abort signal */
  signal?: AbortSignal;
}
```

### 3. Loading and Discovery

Extend `slash-commands.ts` or create new `script-commands/` module:

1. Scan command directories for both `.md` and `.ts` files
2. Load `.ts` files using jiti (same as custom tools)
3. Return unified list with type indicator

```typescript
interface SlashCommand {
  name: string;
  description: string;
  source: string;  // "(user)", "(project)"
  type: "text" | "script";
  // For text commands:
  content?: string;
  // For script commands:
  execute?: (args: string[]) => Promise<void> | void;
  path?: string;
}
```

### 4. Execution Flow

In `interactive-mode.ts`, when handling `/command`:

```typescript
if (text.startsWith("/")) {
  const { name, args } = parseSlashCommand(text);
  const cmd = findCommand(name);
  
  if (cmd?.type === "script") {
    // Execute script command
    this.editor.setText("");
    await cmd.execute(args);
    return;
  } else if (cmd?.type === "text") {
    // Expand text command (existing behavior)
    const expanded = substituteArgs(cmd.content, args);
    // ... continue with expanded text
  }
}
```

### 5. API Implementation

The `ToolAPI` methods need to be wired up similar to how `ToolAPI` callbacks work:

1. Create the API object with placeholder methods in the loader
2. Call `setAPI(realApi)` when interactive mode initializes
3. The real API delegates to:
   - `session.getLastAssistantText()` 
   - `editor.setText()` / `editor.getText()`
   - `completeForCommand()` (similar to `completeForTool()` we prototyped)
   - `showStatus()` / `showError()` methods on InteractiveMode

## Implementation Steps

1. **Define types** in `src/core/script-commands/types.ts`:
   - `ToolAPI` interface
   - `CompleteOptions` interface  
   - `ScriptCommandFactory` type
   - `LoadedScriptCommand` interface

2. **Create loader** in `src/core/script-commands/loader.ts`:
   - Discover `.ts` files in command directories
   - Load using jiti with same aliases as custom tools
   - Return `ScriptCommandsLoadResult` with `setAPI()` callback

3. **Extend slash command loading** in `src/core/slash-commands.ts`:
   - Also scan for `.ts` files
   - Return unified command list with type indicator
   - Or keep separate and merge at usage site

4. **Wire up in main.ts**:
   - Load script commands alongside file commands
   - Pass to `runInteractiveMode()`

5. **Handle in interactive-mode.ts**:
   - Check for script commands in submit handler
   - Execute with proper API
   - Implement `ToolAPI` methods

6. **Export types** from package index for command authors

## Example Commands

### /qna - Extract questions for answering
See example at top of this document.

### /summarize - Summarize conversation
```typescript
const command: CommandFactory = (pi) => ({
  description: "Summarize the conversation so far",
  async execute() {
    const messages = pi.getMessages(); // might need this API too
    const result = await pi.complete("Summarize this conversation...", {
      model: "claude-haiku-4-5",
    });
    pi.setEditorText(result.content[0].text);
  },
});
```

### /fix - Fix code from last response  
```typescript
const command: CommandFactory = (pi) => ({
  description: "Extract and fix code from last response",
  async execute(args) {
    const instruction = args.join(" ") || "fix any issues";
    const lastText = pi.getLastAssistantText();
    // ... extract code blocks, send for fixing, put in editor
  },
});
```

## Alternatives Considered

1. **Extend ToolAPI instead**: Tools are LLM-invoked, commands are user-invoked. Different mental model and use cases.

2. **Built-in commands only**: Limits extensibility, bloats core with niche features.

3. **Shell scripts via `!`**: Loses access to session state, editor, model registry.

## Open Questions

1. Should script commands have access to the full message history, or just last assistant message?

2. Should there be a way to show a loading indicator during `execute()`? (The prototype showed a Loader component)

3. Should commands be able to trigger agent responses, or just manipulate the editor?

4. How to handle errors in script commands - show in chat or just notify?
