# Coding Agent Architecture

## Executive Summary

This document proposes extracting the agent infrastructure from `@mariozechner/pi-web-ui` and `@mariozechner/pi-agent` into a new headless coding agent package that can be reused across multiple UI implementations (TUI, VS Code extension, web interface).

The new architecture will provide:
- **Headless agent core** with file manipulation tools (read, bash, edit, write)
- **Session management** for conversation persistence and resume capability
- **Full abort support** throughout the execution pipeline
- **Event-driven API** for flexible UI integration
- **Clean separation** between agent logic and presentation layer

## Current Architecture Analysis

### Package Overview

```
pi-mono/
├── packages/ai/              # Core AI streaming (GOOD - keep as-is)
├── packages/web-ui/          # Web UI with agent (GOOD - keep separate)
├── packages/agent/           # OLD - needs to be replaced
├── packages/tui/             # Terminal UI lib (GOOD - low-level primitives)
├── packages/proxy/           # CORS proxy (unrelated)
└── packages/pods/            # GPU deployment tool (unrelated)
```

### packages/ai - Core Streaming Library

**Status:** ✅ Solid foundation, keep as-is

**Architecture:**
```typescript
agentLoop(
  prompt: UserMessage,
  context: AgentContext,
  config: AgentLoopConfig,
  signal?: AbortSignal
): EventStream<AgentEvent>
```

**Key Features:**
- Event-driven streaming (turn_start, message_*, tool_execution_*, turn_end, agent_end)
- Tool execution with validation
- Signal-based cancellation
- Message queue for injecting out-of-band messages
- Preprocessor support for message transformation

**Events:**
```typescript
type AgentEvent =
  | { type: "agent_start" }
  | { type: "turn_start" }
  | { type: "message_start"; message: Message }
  | { type: "message_update"; assistantMessageEvent: AssistantMessageEvent; message: AssistantMessage }
  | { type: "message_end"; message: Message }
  | { type: "tool_execution_start"; toolCallId: string; toolName: string; args: any }
  | { type: "tool_execution_end"; toolCallId: string; toolName: string; result: AgentToolResult<any> | string; isError: boolean }
  | { type: "turn_end"; message: AssistantMessage; toolResults: ToolResultMessage[] }
  | { type: "agent_end"; messages: Message[] }
```

**Tool Interface:**
```typescript
interface AgentTool<TParameters extends TSchema = TSchema, TDetails = any> extends Tool<TParameters> {
  label: string;  // Human-readable name for UI
  execute: (
    toolCallId: string,
    params: Static<TParameters>,
    signal?: AbortSignal
  ) => Promise<AgentToolResult<TDetails>>;
}

interface AgentToolResult<T> {
  output: string;   // Text sent to LLM
  details: T;       // Structured data for UI rendering
}
```

### packages/web-ui/agent - Web Agent

**Status:** ✅ Good for web use cases, keep separate

**Architecture:**
```typescript
class Agent {
  constructor(opts: {
    initialState?: Partial<AgentState>;
    debugListener?: (entry: DebugLogEntry) => void;
    transport: AgentTransport;
    messageTransformer?: (messages: AppMessage[]) => Message[];
  })

  async prompt(input: string, attachments?: Attachment[]): Promise<void>
  abort(): void
  subscribe(fn: (e: AgentEvent) => void): () => void
}
```

**Key Features:**
- **Transport abstraction** (ProviderTransport for direct API, AppTransport for server-side)
- **Attachment handling** (images, documents with text extraction)
- **Message transformation** (app messages → LLM messages)
- **Reactive state** (subscribe pattern for UI updates)
- **Message queue** for injecting tool results/errors asynchronously

**Why it's different from coding agent:**
- Browser-specific concerns (CORS, attachments)
- Transport layer for flexible API routing
- Tied to web UI state management
- Supports rich media attachments

### packages/agent - OLD Implementation

**Status:** ⚠️ MUST BE REPLACED

**Architecture:**
```typescript
class Agent {
  constructor(
    config: AgentConfig,
    renderer?: AgentEventReceiver,
    sessionManager?: SessionManager
  )

  async ask(userMessage: string): Promise<void>
  interrupt(): void
  setEvents(events: AgentEvent[]): void
}
```

**Problems:**
1. **Tightly coupled to OpenAI SDK** (not provider-agnostic)
2. **Hardcoded tools** (read, list, bash, glob, rg)
3. **Mixed concerns** (agent logic + tool implementations in same package)
4. **No separation** between core loop and UI rendering
5. **Two API paths** (completions vs responses) with branching logic

**Good parts to preserve:**
1. **SessionManager** - JSONL-based session persistence
2. **Event receiver pattern** - Clean UI integration
3. **Abort support** - Proper signal handling
4. **Renderer abstraction** (ConsoleRenderer, TuiRenderer, JsonRenderer)

**Tools implemented:**
- `read`: Read file contents (1MB limit with truncation)
- `list`: List directory contents
- `bash`: Execute shell command with abort support
- `glob`: Find files matching glob pattern
- `rg`: Run ripgrep search

## Proposed Architecture

### Package Structure

```
pi-mono/
├── packages/ai/                          # [unchanged] Core streaming
├── packages/coding-agent/                # [NEW] Headless coding agent
│   ├── src/
│   │   ├── agent.ts                      # Main agent class
│   │   ├── session-manager.ts            # Session persistence
│   │   ├── tools/
│   │   │   ├── read-tool.ts              # Read files (with pagination)
│   │   │   ├── bash-tool.ts              # Shell execution
│   │   │   ├── edit-tool.ts              # File editing (old_string → new_string)
│   │   │   ├── write-tool.ts             # File creation/replacement
│   │   │   └── index.ts                  # Tool exports
│   │   └── types.ts                      # Public types
│   └── package.json
│
├── packages/coding-agent-tui/            # [NEW] Terminal interface
│   ├── src/
│   │   ├── cli.ts                        # CLI entry point
│   │   ├── renderers/
│   │   │   ├── tui-renderer.ts           # Rich terminal UI
│   │   │   ├── console-renderer.ts       # Simple console output
│   │   │   └── json-renderer.ts          # JSONL output for piping
│   │   └── main.ts                       # App logic
│   └── package.json
│
├── packages/web-ui/                      # [unchanged] Web UI keeps its own agent
└── packages/tui/                         # [unchanged] Low-level terminal primitives
```

### Dependency Graph

```
┌─────────────────────┐
│   @mariozechner/    │
│      pi-ai          │  ← Core streaming, tool interface
└──────────┬──────────┘
           │ depends on
           ↓
┌─────────────────────┐
│  @mariozechner/     │
│   coding-agent      │  ← Headless agent + file tools
└──────────┬──────────┘
           │ depends on
           ↓
    ┌──────────┬──────────┐
    ↓          ↓          ↓
┌────────┐ ┌───────┐ ┌────────┐
│ TUI    │ │ VSCode│ │ Web UI │
│ Client │ │  Ext  │ │ (own)  │
└────────┘ └───────┘ └────────┘
```

## Package: @mariozechner/coding-agent

### Core Agent Class

```typescript
export interface CodingAgentConfig {
  systemPrompt: string;
  model: Model<any>;
  reasoning?: "low" | "medium" | "high";
  apiKey: string;
}

export interface CodingAgentOptions {
  config: CodingAgentConfig;
  sessionManager?: SessionManager;
  workingDirectory?: string;
}

export class CodingAgent {
  constructor(options: CodingAgentOptions);

  // Send a message to the agent
  async prompt(message: string, signal?: AbortSignal): AsyncIterable<AgentEvent>;

  // Restore from session events (for --continue mode)
  setMessages(messages: Message[]): void;

  // Get current message history
  getMessages(): Message[];
}
```

**Key design decisions:**
1. **AsyncIterable instead of callbacks** - More flexible for consumers
2. **Signal per prompt** - Each prompt() call accepts its own AbortSignal
3. **No internal state management** - Consumers handle UI state
4. **Simple message management** - Get/set for session restoration

### Usage Example (TUI)

```typescript
import { CodingAgent } from "@mariozechner/coding-agent";
import { SessionManager } from "@mariozechner/coding-agent";

const session = new SessionManager({ continue: true });
const agent = new CodingAgent({
  config: {
    systemPrompt: "You are a coding assistant...",
    model: getModel("openai", "gpt-4"),
    apiKey: process.env.OPENAI_API_KEY!,
  },
  sessionManager: session,
  workingDirectory: process.cwd(),
});

// Restore previous session
if (session.hasData()) {
  agent.setMessages(session.getMessages());
}

// Send prompt with abort support
const controller = new AbortController();
for await (const event of agent.prompt("Fix the bug in server.ts", controller.signal)) {
  switch (event.type) {
    case "message_update":
      renderer.updateAssistant(event.message);
      break;
    case "tool_execution_start":
      renderer.showTool(event.toolName, event.args);
      break;
    case "tool_execution_end":
      renderer.showToolResult(event.toolName, event.result);
      break;
  }
}
```

### Session Manager

```typescript
export interface SessionManagerOptions {
  continue?: boolean;           // Resume most recent session
  directory?: string;            // Custom session directory
}

export interface SessionMetadata {
  id: string;
  timestamp: string;
  cwd: string;
  config: CodingAgentConfig;
}

export interface SessionData {
  metadata: SessionMetadata;
  messages: Message[];          // Conversation history
  totalUsage: TokenUsage;       // Aggregated token usage
}

export class SessionManager {
  constructor(options?: SessionManagerOptions);

  // Start a new session (writes metadata)
  startSession(config: CodingAgentConfig): void;

  // Log an event (appends to JSONL)
  appendEvent(event: AgentEvent): void;

  // Check if session has existing data
  hasData(): boolean;

  // Get full session data
  getData(): SessionData | null;

  // Get just the messages for agent restoration
  getMessages(): Message[];

  // Get session file path
  getFilePath(): string;

  // Get session ID
  getId(): string;
}
```

**Session Storage Format (JSONL):**
```jsonl
{"type":"session","id":"uuid","timestamp":"2025-10-12T10:00:00Z","cwd":"/path","config":{...}}
{"type":"event","timestamp":"2025-10-12T10:00:01Z","event":{"type":"turn_start"}}
{"type":"event","timestamp":"2025-10-12T10:00:02Z","event":{"type":"message_start",...}}
{"type":"event","timestamp":"2025-10-12T10:00:03Z","event":{"type":"message_end",...}}
```

**Session File Naming:**
```
~/.pi/sessions/--path-to-project--/
  2025-10-12T10-00-00-000Z_uuid.jsonl
  2025-10-12T11-30-00-000Z_uuid.jsonl
```

### Tool: BashTool

```typescript
export interface BashToolDetails {
  command: string;
  exitCode: number;
  duration: number;  // milliseconds
}

export const bashToolSchema = Type.Object({
  command: Type.String({ description: "Shell command to execute" }),
});

export class BashTool implements AgentTool<typeof bashToolSchema, BashToolDetails> {
  name = "bash";
  label = "Execute Shell Command";
  description = "Execute a bash command in the working directory";
  parameters = bashToolSchema;

  constructor(private workingDirectory: string);

  async execute(
    toolCallId: string,
    params: { command: string },
    signal?: AbortSignal
  ): Promise<AgentToolResult<BashToolDetails>> {
    // Spawn child process with signal support
    // Capture stdout/stderr
    // Handle 1MB output limit with truncation
    // Return structured result
  }
}
```

**Key Features:**
- Abort support via signal → child process kill
- 1MB output limit (prevents memory exhaustion)
- Exit code tracking
- Working directory context

**Output Format:**
```typescript
{
  output: "stdout:\n<content>\nstderr:\n<content>\nexit code: 0",
  details: {
    command: "npm test",
    exitCode: 0,
    duration: 1234
  }
}
```

### Tool: ReadTool

```typescript
export interface ReadToolDetails {
  filePath: string;
  totalLines: number;
  linesRead: number;
  offset: number;
  truncated: boolean;
}

export const readToolSchema = Type.Object({
  file_path: Type.String({ description: "Path to file to read (relative or absolute)" }),
  offset: Type.Optional(Type.Number({
    description: "Line number to start reading from (1-indexed). Omit to read from beginning.",
    minimum: 1
  })),
  limit: Type.Optional(Type.Number({
    description: "Maximum number of lines to read. Omit to read entire file (max 5000 lines).",
    minimum: 1,
    maximum: 5000
  })),
});

export class ReadTool implements AgentTool<typeof readToolSchema, ReadToolDetails> {
  name = "read";
  label = "Read File";
  description = "Read file contents. For files >5000 lines, use offset and limit to read in chunks.";
  parameters = readToolSchema;

  constructor(private workingDirectory: string);

  async execute(
    toolCallId: string,
    params: { file_path: string; offset?: number; limit?: number },
    signal?: AbortSignal
  ): Promise<AgentToolResult<ReadToolDetails>> {
    // Resolve file path (relative to workingDirectory)
    // Count total lines in file
    // If no offset/limit: read up to 5000 lines, warn if truncated
    // If offset/limit: read specified range
    // Format with line numbers (using cat -n style)
    // Return content + metadata
  }
}
```

**Key Features:**
- **Full file read**: Up to 5000 lines (warns LLM if truncated)
- **Ranged read**: Specify offset + limit for large files
- **Line numbers**: Output formatted like `cat -n` (1-indexed)
- **Abort support**: Can cancel during large file reads
- **Metadata**: Total line count, lines read, truncation status

**Output Format (full file):**
```typescript
{
  output: `     1  import { foo } from './foo';
     2  import { bar } from './bar';
     3
     4  export function main() {
     5    console.log('hello');
     6  }`,
  details: {
    filePath: "src/main.ts",
    totalLines: 6,
    linesRead: 6,
    offset: 0,
    truncated: false
  }
}
```

**Output Format (large file, truncated):**
```typescript
{
  output: `WARNING: File has 10000 lines, showing first 5000. Use offset and limit parameters to read more.

     1  import { foo } from './foo';
     2  import { bar } from './bar';
     ...
  5000  const x = 42;`,
  details: {
    filePath: "src/large.ts",
    totalLines: 10000,
    linesRead: 5000,
    offset: 0,
    truncated: true
  }
}
```

**Output Format (ranged read):**
```typescript
{
  output: `  1000  function middleware() {
  1001    return (req, res, next) => {
  1002      console.log('middleware');
  1003      next();
  1004    };
  1005  }`,
  details: {
    filePath: "src/server.ts",
    totalLines: 10000,
    linesRead: 6,
    offset: 1000,
    truncated: false
  }
}
```

**Error Cases:**
- File not found → error
- Offset > total lines → error
- Binary file detected → error (suggest using bash tool)

**Usage Examples in System Prompt:**
```
To read a large file:
1. read(file_path="src/large.ts") // Gets first 5000 lines + total count
2. If truncated, read remaining chunks:
   read(file_path="src/large.ts", offset=5001, limit=5000)
   read(file_path="src/large.ts", offset=10001, limit=5000)
```

### Tool: EditTool

```typescript
export interface EditToolDetails {
  filePath: string;
  oldString: string;
  newString: string;
  matchCount: number;
  linesChanged: number;
}

export const editToolSchema = Type.Object({
  file_path: Type.String({ description: "Path to file to edit (relative or absolute)" }),
  old_string: Type.String({ description: "Exact string to find and replace" }),
  new_string: Type.String({ description: "String to replace with" }),
});

export class EditTool implements AgentTool<typeof editToolSchema, EditToolDetails> {
  name = "edit";
  label = "Edit File";
  description = "Find and replace exact string in a file";
  parameters = editToolSchema;

  constructor(private workingDirectory: string);

  async execute(
    toolCallId: string,
    params: { file_path: string; old_string: string; new_string: string },
    signal?: AbortSignal
  ): Promise<AgentToolResult<EditToolDetails>> {
    // Resolve file path (relative to workingDirectory)
    // Read file contents
    // Find old_string (must be exact match)
    // Replace with new_string
    // Write file back
    // Return stats
  }
}
```

**Key Features:**
- Exact string matching (no regex)
- Safe atomic writes (write temp → rename)
- Abort support (cancel before write)
- Match validation (error if old_string not found)
- Line-based change tracking

**Output Format:**
```typescript
{
  output: "Replaced 1 occurrence in src/server.ts (3 lines changed)",
  details: {
    filePath: "src/server.ts",
    oldString: "const port = 3000;",
    newString: "const port = process.env.PORT || 3000;",
    matchCount: 1,
    linesChanged: 3
  }
}
```

**Error Cases:**
- File not found → error
- old_string not found → error
- Multiple matches for old_string → error (ambiguous)
- File changed during operation → error (race condition)

### Tool: WriteTool

```typescript
export interface WriteToolDetails {
  filePath: string;
  size: number;
  isNew: boolean;
}

export const writeToolSchema = Type.Object({
  file_path: Type.String({ description: "Path to file to create/overwrite" }),
  content: Type.String({ description: "Full file contents to write" }),
});

export class WriteTool implements AgentTool<typeof writeToolSchema, WriteToolDetails> {
  name = "write";
  label = "Write File";
  description = "Create a new file or completely replace existing file contents";
  parameters = writeToolSchema;

  constructor(private workingDirectory: string);

  async execute(
    toolCallId: string,
    params: { file_path: string; content: string },
    signal?: AbortSignal
  ): Promise<AgentToolResult<WriteToolDetails>> {
    // Resolve file path
    // Check if file exists (track isNew)
    // Create parent directories if needed
    // Write content atomically
    // Return stats
  }
}
```

**Key Features:**
- Creates parent directories automatically
- Safe atomic writes
- Abort support
- No size limits (trust LLM context limits)

**Output Format:**
```typescript
{
  output: "Created new file src/utils/helper.ts (142 bytes)",
  details: {
    filePath: "src/utils/helper.ts",
    size: 142,
    isNew: true
  }
}
```

## Package: @mariozechner/coding-agent-tui

### CLI Interface

```bash
# Interactive mode (default)
coding-agent

# Continue previous session
coding-agent --continue

# Single-shot mode
coding-agent "Fix the TypeScript errors"

# Multiple prompts
coding-agent "Add validation" "Write tests"

# Custom model
coding-agent --model openai/gpt-4 --api-key $KEY

# JSON output (for piping)
coding-agent --json < prompts.jsonl > results.jsonl
```

### Arguments

```typescript
{
  "base-url": string;        // API endpoint
  "api-key": string;         // API key (or env var)
  "model": string;           // Model identifier
  "system-prompt": string;   // System prompt
  "continue": boolean;       // Resume session
  "json": boolean;           // JSONL I/O mode
  "help": boolean;           // Show help
}
```

### Renderers

**TuiRenderer** - Rich terminal UI
- Real-time streaming output
- Syntax highlighting for code
- Tool execution indicators
- Progress spinners
- Token usage stats
- Keyboard shortcuts (Ctrl+C to abort)

**ConsoleRenderer** - Simple console output
- Plain text output
- No ANSI codes
- Good for logging/CI

**JsonRenderer** - JSONL output
- One JSON object per line
- Each line is a complete event
- For piping/processing

### JSON Mode Example

Input (stdin):
```jsonl
{"type":"message","content":"List all TypeScript files"}
{"type":"interrupt"}
{"type":"message","content":"Count the files"}
```

Output (stdout):
```jsonl
{"type":"turn_start","timestamp":"..."}
{"type":"message_start","message":{...}}
{"type":"tool_execution_start","toolCallId":"...","toolName":"bash","args":"{...}"}
{"type":"tool_execution_end","toolCallId":"...","result":"..."}
{"type":"message_end","message":{...}}
{"type":"turn_end"}
{"type":"interrupted"}
{"type":"message_start","message":{...}}
...
```

## Integration Patterns

### VS Code Extension

```typescript
import { CodingAgent, SessionManager } from "@mariozechner/coding-agent";
import * as vscode from "vscode";

class CodingAgentProvider {
  private agent: CodingAgent;
  private outputChannel: vscode.OutputChannel;

  constructor() {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
    const session = new SessionManager({
      directory: path.join(workspaceRoot, ".vscode", "agent-sessions")
    });

    this.agent = new CodingAgent({
      config: {
        systemPrompt: "You are a coding assistant...",
        model: getModel("openai", "gpt-4"),
        apiKey: vscode.workspace.getConfiguration("codingAgent").get("apiKey")!,
      },
      sessionManager: session,
      workingDirectory: workspaceRoot,
    });

    this.outputChannel = vscode.window.createOutputChannel("Coding Agent");
  }

  async executePrompt(prompt: string) {
    const cancellation = new vscode.CancellationTokenSource();

    // Convert VS Code cancellation to AbortSignal
    const controller = new AbortController();
    cancellation.token.onCancellationRequested(() => controller.abort());

    for await (const event of this.agent.prompt(prompt, controller.signal)) {
      switch (event.type) {
        case "message_update":
          this.outputChannel.appendLine(event.message.content[0].text);
          break;
        case "tool_execution_start":
          vscode.window.showInformationMessage(`Running: ${event.toolName}`);
          break;
        case "tool_execution_end":
          if (event.isError) {
            vscode.window.showErrorMessage(`Tool failed: ${event.result}`);
          }
          break;
      }
    }
  }
}
```

### Headless Server/API

```typescript
import { CodingAgent } from "@mariozechner/coding-agent";
import express from "express";

const app = express();

app.post("/api/prompt", async (req, res) => {
  const { prompt, sessionId } = req.body;

  const agent = new CodingAgent({
    config: {
      systemPrompt: "...",
      model: getModel("openai", "gpt-4"),
      apiKey: process.env.OPENAI_API_KEY!,
    },
    workingDirectory: `/tmp/workspaces/${sessionId}`,
  });

  // Stream SSE
  res.setHeader("Content-Type", "text/event-stream");

  const controller = new AbortController();
  req.on("close", () => controller.abort());

  for await (const event of agent.prompt(prompt, controller.signal)) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  res.end();
});

app.listen(3000);
```

## Migration Plan

### Phase 1: Extract Core Package
1. Create `packages/coding-agent/` structure
2. Port SessionManager from old agent package
3. Implement BashTool, EditTool, WriteTool
4. Implement CodingAgent class using pi-ai/agentLoop
5. Write tests for each tool
6. Write integration tests

### Phase 2: Build TUI
1. Create `packages/coding-agent-tui/`
2. Port TuiRenderer from old agent package
3. Port ConsoleRenderer, JsonRenderer
4. Implement CLI argument parsing
5. Implement interactive and single-shot modes
6. Test session resume functionality

### Phase 3: Update Dependencies
1. Update web-ui if needed (should be unaffected)
2. Deprecate old agent package
3. Update documentation
4. Update examples

### Phase 4: Future Enhancements
1. Build VS Code extension
2. Add more tools (grep, find, etc.) as optional
3. Plugin system for custom tools
4. Parallel tool execution

## Open Questions & Decisions

### 1. Should EditTool support multiple replacements?

**Option A:** Error on multiple matches (current proposal)
- Forces explicit, unambiguous edits
- LLM must be precise with context
- Safer (no accidental mass replacements)

**Option B:** Replace all matches
- More convenient for bulk changes
- Risk of unintended replacements
- Need `replace_all: boolean` flag

**Decision:** Start with Option A, add replace_all flag if needed.

### 2. ReadTool line limit and pagination strategy?

**Decision:** 5000 line default limit with offset/limit pagination

**Rationale:**
- **5000 lines** balances context vs token usage (typical file fits in one read)
- **Line-based pagination** is intuitive for LLM (matches how humans think about code)
- **cat -n format** with line numbers helps LLM reference specific lines in edits
- **Automatic truncation warning** teaches LLM to paginate when needed

**Alternative considered:** Byte-based limits (rejected - harder for LLM to reason about)

**System prompt guidance:**
```
When reading large files:
1. First read without offset/limit to get total line count
2. If truncated, calculate chunks: ceil(totalLines / 5000)
3. Read each chunk with appropriate offset
```

### 3. Should ReadTool handle binary files?

**Decision:** Error on binary files with helpful message

**Error message:**
```
Error: Cannot read binary file 'dist/app.js'. Use bash tool if you need to inspect: bash(command="file dist/app.js") or bash(command="xxd dist/app.js | head")
```

**Rationale:**
- Binary files are rarely useful to LLM
- Clear error message teaches LLM to use appropriate tools
- Prevents token waste on unreadable content

**Binary detection:** Check for null bytes in first 8KB (same strategy as `git diff`)

### 4. Should EditTool support regex?

**Current proposal:** No regex, exact string match only

**Pros of exact match:**
- Simple implementation
- No regex escaping issues
- Clear error messages
- Safer (no accidental broad matches)

**Cons:**
- Less powerful
- Multiple edits needed for patterns

**Decision:** Exact match only. LLM can use bash/sed for complex patterns.

### 5. Working directory enforcement?

**Question:** Should tools be sandboxed to workingDirectory?

**Option A:** Enforce sandbox (only access files under workingDirectory)
- Safer
- Prevents accidental system file edits
- Clear boundaries

**Option B:** Allow any path
- More flexible
- LLM can edit config files, etc.
- User's responsibility to review

**Decision:** Start with Option B (no sandbox). Add `--sandbox` flag later if needed.

### 6. Tool output size limits?

**Current proposal:**
- ReadTool: 5000 line limit per read (paginate for more)
- BashTool: 1MB truncation
- EditTool: No limit (reasonable file sizes expected)
- WriteTool: No limit (LLM context limited)

**Alternative:** Enforce global 1MB limit on all tool outputs

**Decision:** Per-tool limits. ReadTool and BashTool need it most.

### 7. How to handle long-running bash commands?

**Question:** Should BashTool stream output or wait for completion?

**Option A:** Wait for completion (current proposal)
- Simpler implementation
- Full output available for LLM
- Blocks until done

**Option B:** Stream output
- Better UX (show progress)
- More complex (need to handle partial output)
- LLM sees final output only

**Decision:** Wait for completion initially. Add streaming later if needed.

### 8. Package naming alternatives?

**Current proposal:**
- `@mariozechner/coding-agent` (core)
- `@mariozechner/coding-agent-tui` (TUI)

**Alternatives:**
- `@mariozechner/file-agent` / `@mariozechner/file-agent-tui`
- `@mariozechner/dev-agent` / `@mariozechner/dev-agent-tui`
- `@mariozechner/pi-code` / `@mariozechner/pi-code-tui`

**Decision:** `coding-agent` is clear and specific to the use case.

## Summary

This architecture provides:

✅ **Headless core** - Clean separation between agent logic and UI
✅ **Reusable** - Same agent for TUI, VS Code, web, APIs
✅ **Composable** - Build on pi-ai primitives
✅ **Abortable** - First-class cancellation support
✅ **Session persistence** - Resume conversations seamlessly
✅ **Focused tools** - read, bash, edit, write (4 tools, no more)
✅ **Smart pagination** - 5000-line chunks with offset/limit
✅ **Type-safe** - Full TypeScript with schema validation
✅ **Testable** - Pure functions, mockable dependencies

The key insight is to **keep web-ui's agent separate** (it has different concerns) while creating a **new focused coding agent** for file manipulation workflows that can be shared across non-web interfaces.
