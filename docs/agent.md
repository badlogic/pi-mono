# Agent Architecture

## Executive Summary

This document proposes extracting the agent infrastructure from `@mariozechner/pi-web-ui` into two new packages:

1. **`@mariozechner/agent`** - General-purpose agent package with transport abstraction, state management, and attachment support
2. **`@mariozechner/coding-agent`** - Specialized coding agent built on the general agent, with file manipulation tools and session management

The new architecture will provide:
- **General agent core** with transport abstraction (ProviderTransport, AppTransport)
- **Reactive state management** with subscribe/emit pattern
- **Attachment support** (type definitions only - processing stays in consumers)
- **Message transformation** pipeline for filtering and adapting messages
- **Message queueing** for out-of-band message injection
- **Full abort support** throughout the execution pipeline
- **Event-driven API** for flexible UI integration
- **Clean separation** between agent logic and presentation layer
- **Coding-specific tools** (read, bash, edit, write) in a specialized package
- **Session management** for conversation persistence and resume capability

## Current Architecture Analysis

### Package Overview

```
pi-mono/
├── packages/ai/              # Core AI streaming (GOOD - keep as-is)
├── packages/web-ui/          # Web UI with embedded agent (EXTRACT core agent logic)
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

### packages/web-ui/src/agent - Web Agent

**Status:** ✅ KEEP AS-IS for now, will be replaced later after new packages are proven

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
  setSystemPrompt(v: string): void
  setModel(m: Model<any>): void
  setThinkingLevel(l: ThinkingLevel): void
  setTools(t: AgentTool<any>[]): void
  replaceMessages(ms: AppMessage[]): void
  appendMessage(m: AppMessage): void
  async queueMessage(m: AppMessage): Promise<void>
  clearMessages(): void
}
```

**Key Features (will be basis for new `@mariozechner/agent` package):**
- ✅ **Transport abstraction** (ProviderTransport for direct API, AppTransport for server-side proxy)
- ✅ **Attachment type definition** (id, type, fileName, mimeType, size, content, extractedText, preview)
- ✅ **Message transformation** pipeline (app messages → LLM messages, with filtering)
- ✅ **Reactive state** (subscribe/emit pattern for UI updates)
- ✅ **Message queueing** for injecting messages out-of-band during agent loop
- ✅ **Abort support** (AbortController per prompt)
- ✅ **State management** (systemPrompt, model, thinkingLevel, tools, messages, isStreaming, etc.)

**Strategy:**
1. Use this implementation as the **reference design** for `@mariozechner/agent`
2. Create new `@mariozechner/agent` package by copying/adapting this code
3. Keep web-ui using its own embedded agent until new package is proven stable
4. Eventually migrate web-ui to use `@mariozechner/agent` (Phase 2 of migration)
5. Document processing (PDF/DOCX/PPTX/Excel) stays in web-ui permanently

### packages/agent - OLD Implementation

**Status:** ⚠️ REMOVE COMPLETELY

**Why it should be removed:**
1. **Tightly coupled to OpenAI SDK** - Not provider-agnostic, hardcoded to OpenAI's API
2. **Outdated architecture** - Superseded by web-ui's better agent design
3. **Mixed concerns** - Agent logic + tool implementations + rendering all in one package
4. **Limited scope** - Cannot be reused across different UI implementations

**What to salvage before removal:**
1. **SessionManager** - Port to `@mariozechner/coding-agent` (JSONL-based session persistence)
2. **Tool implementations** - Adapt read, bash, edit, write tools for coding-agent
3. **Renderer abstractions** - Port TuiRenderer/ConsoleRenderer/JsonRenderer concepts to coding-agent-tui

**Action:** Delete this package entirely after extracting useful components to the new packages.

## Proposed Architecture

### Package Structure

```
pi-mono/
├── packages/ai/                          # [unchanged] Core streaming library
│
├── packages/agent/                       # [NEW] General-purpose agent
│   ├── src/
│   │   ├── agent.ts                      # Main Agent class
│   │   ├── types.ts                      # AgentState, AgentEvent, Attachment, etc.
│   │   ├── transports/
│   │   │   ├── types.ts                  # AgentTransport interface
│   │   │   ├── ProviderTransport.ts      # Direct API calls
│   │   │   ├── AppTransport.ts           # Server-side proxy
│   │   │   ├── proxy-types.ts            # Proxy event types
│   │   │   └── index.ts                  # Transport exports
│   │   └── index.ts                      # Public API
│   └── package.json
│
├── packages/coding-agent/                # [NEW] Coding-specific agent + CLI
│   ├── src/
│   │   ├── coding-agent.ts               # CodingAgent wrapper (uses @mariozechner/agent)
│   │   ├── session-manager.ts            # Session persistence (JSONL)
│   │   ├── tools/
│   │   │   ├── read-tool.ts              # Read files (with pagination)
│   │   │   ├── bash-tool.ts              # Shell execution
│   │   │   ├── edit-tool.ts              # File editing (old_string → new_string)
│   │   │   ├── write-tool.ts             # File creation/replacement
│   │   │   └── index.ts                  # Tool exports
│   │   ├── cli/
│   │   │   ├── index.ts                  # CLI entry point
│   │   │   ├── renderers/
│   │   │   │   ├── tui-renderer.ts       # Rich terminal UI
│   │   │   │   ├── console-renderer.ts   # Simple console output
│   │   │   │   └── json-renderer.ts      # JSONL output for piping
│   │   │   └── main.ts                   # CLI app logic
│   │   ├── types.ts                      # Public types
│   │   └── index.ts                      # Public API (agent + tools)
│   └── package.json                      # Exports both library + CLI binary
│
├── packages/web-ui/                      # [updated] Uses @mariozechner/agent
│   ├── src/
│   │   ├── utils/
│   │   │   └── attachment-utils.ts       # Document processing (keep here)
│   │   └── ...                           # Other web UI code
│   └── package.json                      # Now depends on @mariozechner/agent
│
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
                    │      agent          │  ← General agent (transports, state, attachments)
                    └──────────┬──────────┘
                               │ depends on
                               ↓
               ┌───────────────┴───────────────┐
               ↓                               ↓
    ┌─────────────────────┐         ┌─────────────────────┐
    │  @mariozechner/     │         │  @mariozechner/     │
    │   coding-agent      │         │     pi-web-ui       │
    │ (lib + CLI + tools) │         │ (+ doc processing)  │
    └─────────────────────┘         └─────────────────────┘
```

## Package: @mariozechner/agent

### Core Types

```typescript
export interface Attachment {
  id: string;
  type: "image" | "document";
  fileName: string;
  mimeType: string;
  size: number;
  content: string;        // base64 encoded (without data URL prefix)
  extractedText?: string; // For documents
  preview?: string;       // base64 image preview
}

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high";

// AppMessage abstraction - extends base LLM messages with app-specific features
export type UserMessageWithAttachments = UserMessage & { attachments?: Attachment[] };

// Extensible interface for custom app messages (via declaration merging)
// Apps can add their own message types:
// declare module "@mariozechner/agent" {
//   interface CustomMessages {
//     artifact: ArtifactMessage;
//     notification: NotificationMessage;
//   }
// }
export interface CustomMessages {
  // Empty by default - apps extend via declaration merging
}

// AppMessage: Union of LLM messages + attachments + custom messages
export type AppMessage =
  | AssistantMessage
  | UserMessageWithAttachments
  | ToolResultMessage
  | CustomMessages[keyof CustomMessages];

export interface AgentState {
  systemPrompt: string;
  model: Model<any>;
  thinkingLevel: ThinkingLevel;
  tools: AgentTool<any>[];
  messages: AppMessage[];      // Can include attachments + custom message types
  isStreaming: boolean;
  streamMessage: Message | null;
  pendingToolCalls: Set<string>;
  error?: string;
}

export type AgentEvent =
  | { type: "state-update"; state: AgentState }
  | { type: "started" }
  | { type: "completed" };
```

### AppMessage Abstraction

The `AppMessage` type is a key abstraction that extends base LLM messages with app-specific features while maintaining type safety and extensibility.

**Key Benefits:**
1. **Extends base messages** - Adds `attachments` field to `UserMessage` for file uploads
2. **Type-safe extensibility** - Apps can add custom message types via declaration merging
3. **Backward compatible** - Works seamlessly with base LLM messages from `@mariozechner/pi-ai`
4. **Message transformation** - Filters app-specific fields before sending to LLM

**Usage Example (Web UI):**
```typescript
import type { AppMessage } from "@mariozechner/agent";

// Extend with custom message type for artifacts
declare module "@mariozechner/agent" {
  interface CustomMessages {
    artifact: ArtifactMessage;
  }
}

interface ArtifactMessage {
  role: "artifact";
  action: "create" | "update" | "delete";
  filename: string;
  content?: string;
  title?: string;
  timestamp: string;
}

// Now AppMessage includes: AssistantMessage | UserMessageWithAttachments | ToolResultMessage | ArtifactMessage
const messages: AppMessage[] = [
  { role: "user", content: "Hello", attachments: [attachment] },
  { role: "assistant", content: [{ type: "text", text: "Hi!" }], /* ... */ },
  { role: "artifact", action: "create", filename: "test.ts", content: "...", timestamp: "..." }
];
```

**Usage Example (Coding Agent):**
```typescript
import type { AppMessage } from "@mariozechner/agent";

// Coding agent can extend with session metadata
declare module "@mariozechner/agent" {
  interface CustomMessages {
    session_metadata: SessionMetadataMessage;
  }
}

interface SessionMetadataMessage {
  role: "session_metadata";
  sessionId: string;
  timestamp: string;
  workingDirectory: string;
}
```

**Message Transformation:**

The `messageTransformer` function converts app messages to LLM-compatible messages, including handling attachments:

```typescript
function defaultMessageTransformer(messages: AppMessage[]): Message[] {
  return messages
    .filter((m) => {
      // Only keep standard LLM message roles
      return m.role === "user" || m.role === "assistant" || m.role === "toolResult";
    })
    .map((m) => {
      if (m.role === "user") {
        const { attachments, ...baseMessage } = m as any;

        // If no attachments, return as-is
        if (!attachments || attachments.length === 0) {
          return baseMessage as Message;
        }

        // Convert attachments to content blocks
        const content = Array.isArray(baseMessage.content)
          ? [...baseMessage.content]
          : [{ type: "text", text: baseMessage.content }];

        for (const attachment of attachments) {
          // Add image blocks for image attachments
          if (attachment.type === "image") {
            content.push({
              type: "image",
              data: attachment.content,
              mimeType: attachment.mimeType
            });
          }
          // Add text blocks for documents with extracted text
          else if (attachment.type === "document" && attachment.extractedText) {
            content.push({
              type: "text",
              text: attachment.extractedText
            });
          }
        }

        return { ...baseMessage, content } as Message;
      }
      return m as Message;
    });
}
```

This ensures that:
- Custom message types (like `artifact`, `session_metadata`) are filtered out
- Image attachments are converted to `ImageContent` blocks
- Document attachments with extracted text are converted to `TextContent` blocks
- The `attachments` field itself is stripped (replaced by proper content blocks)
- LLM receives only standard `Message` types from `@mariozechner/pi-ai`

### Agent Class

```typescript
export interface AgentOptions {
  initialState?: Partial<AgentState>;
  transport: AgentTransport;
  // Transform app messages to LLM-compatible messages before sending
  messageTransformer?: (messages: AppMessage[]) => Message[] | Promise<Message[]>;
}

export class Agent {
  constructor(opts: AgentOptions);

  get state(): AgentState;
  subscribe(fn: (e: AgentEvent) => void): () => void;

  // State mutators
  setSystemPrompt(v: string): void;
  setModel(m: Model<any>): void;
  setThinkingLevel(l: ThinkingLevel): void;
  setTools(t: AgentTool<any>[]): void;
  replaceMessages(ms: AppMessage[]): void;
  appendMessage(m: AppMessage): void;
  async queueMessage(m: AppMessage): Promise<void>;
  clearMessages(): void;

  // Main prompt method
  async prompt(input: string, attachments?: Attachment[]): Promise<void>;

  // Abort current operation
  abort(): void;
}
```

**Key Features:**
1. **Reactive state** - Subscribe to state updates for UI binding
2. **Transport abstraction** - Pluggable backends (direct API, proxy server, etc.)
3. **Message transformation** - Convert app-specific messages to LLM format
4. **Message queueing** - Inject messages during agent loop (for tool results, errors)
5. **Attachment support** - Type-safe attachment handling (processing is external)
6. **Abort support** - Cancel in-progress operations

### Transport Interface

```typescript
export interface AgentRunConfig {
  systemPrompt: string;
  tools: AgentTool<any>[];
  model: Model<any>;
  reasoning?: "low" | "medium" | "high";
  getQueuedMessages?: <T>() => Promise<QueuedMessage<T>[]>;
}

export interface AgentTransport {
  run(
    messages: Message[],
    userMessage: Message,
    config: AgentRunConfig,
    signal?: AbortSignal,
  ): AsyncIterable<AgentEvent>;
}
```

### ProviderTransport

```typescript
export class ProviderTransport implements AgentTransport {
  async *run(messages: Message[], userMessage: Message, cfg: AgentRunConfig, signal?: AbortSignal) {
    // Calls LLM providers directly using agentLoop from @mariozechner/pi-ai
    // Optionally routes through CORS proxy if configured
  }
}
```

### AppTransport

```typescript
export class AppTransport implements AgentTransport {
  constructor(proxyUrl: string);

  async *run(messages: Message[], userMessage: Message, cfg: AgentRunConfig, signal?: AbortSignal) {
    // Routes requests through app server with user authentication
    // Server manages API keys and usage tracking
  }
}
```

## Package: @mariozechner/coding-agent

### CodingAgent Class

```typescript
export interface CodingAgentOptions {
  systemPrompt: string;
  model: Model<any>;
  reasoning?: "low" | "medium" | "high";
  apiKey: string;
  workingDirectory?: string;
  sessionManager?: SessionManager;
}

export class CodingAgent {
  constructor(options: CodingAgentOptions);

  // Access underlying agent
  get agent(): Agent;

  // State accessors
  get state(): AgentState;
  subscribe(fn: (e: AgentEvent) => void): () => void;

  // Send a message to the agent
  async prompt(message: string, attachments?: Attachment[]): Promise<void>;

  // Abort current operation
  abort(): void;

  // Message management for session restoration
  replaceMessages(messages: AppMessage[]): void;
  getMessages(): AppMessage[];
}
```

**Key design decisions:**
1. **Wraps @mariozechner/agent** - Builds on the general agent package
2. **Pre-configured tools** - Includes read, bash, edit, write tools
3. **Session management** - Optional JSONL-based session persistence
4. **Working directory context** - All file operations relative to this directory
5. **Simple API** - Hides transport complexity, uses ProviderTransport by default

### Usage Example (TUI)

```typescript
import { CodingAgent } from "@mariozechner/coding-agent";
import { SessionManager } from "@mariozechner/coding-agent";
import { getModel } from "@mariozechner/pi-ai";

const session = new SessionManager({ continue: true });
const agent = new CodingAgent({
  systemPrompt: "You are a coding assistant...",
  model: getModel("openai", "gpt-4"),
  apiKey: process.env.OPENAI_API_KEY!,
  workingDirectory: process.cwd(),
  sessionManager: session,
});

// Restore previous session
if (session.hasData()) {
  agent.replaceMessages(session.getMessages());
}

// Subscribe to state changes
agent.subscribe((event) => {
  if (event.type === "state-update") {
    renderer.render(event.state);
  } else if (event.type === "completed") {
    session.save(agent.getMessages());
  }
});

// Send prompt
await agent.prompt("Fix the bug in server.ts");
```

### Usage Example (Web UI)

```typescript
import { Agent, ProviderTransport, Attachment } from "@mariozechner/agent";
import { getModel } from "@mariozechner/pi-ai";
import { loadAttachment } from "./utils/attachment-utils"; // Web UI keeps this

const agent = new Agent({
  transport: new ProviderTransport(),
  initialState: {
    systemPrompt: "You are a helpful assistant...",
    model: getModel("google", "gemini-2.5-flash"),
    thinkingLevel: "low",
    tools: [],
  },
});

// Subscribe to state changes for UI updates
agent.subscribe((event) => {
  if (event.type === "state-update") {
    updateUI(event.state);
  }
});

// Handle file upload and send prompt
const file = await fileInput.files[0];
const attachment = await loadAttachment(file); // Processes PDF/DOCX/etc
await agent.prompt("Analyze this document", [attachment]);
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
  messages: AppMessage[];       // Conversation history
}

export class SessionManager {
  constructor(options?: SessionManagerOptions);

  // Start a new session (writes metadata)
  startSession(config: CodingAgentConfig): void;

  // Append a message to the session (appends to JSONL)
  appendMessage(message: AppMessage): void;

  // Check if session has existing data
  hasData(): boolean;

  // Get full session data
  getData(): SessionData | null;

  // Get just the messages for agent restoration
  getMessages(): AppMessage[];

  // Get session file path
  getFilePath(): string;

  // Get session ID
  getId(): string;
}
```

**Session Storage Format (JSONL):**
```jsonl
{"type":"metadata","id":"uuid","timestamp":"2025-10-12T10:00:00Z","cwd":"/path","config":{...}}
{"type":"message","message":{"role":"user","content":"Fix the bug in server.ts"}}
{"type":"message","message":{"role":"assistant","content":[{"type":"text","text":"I'll help..."}],...}}
{"type":"message","message":{"role":"toolResult","toolCallId":"call_123","output":"..."}}
{"type":"message","message":{"role":"assistant","content":[{"type":"text","text":"Fixed!"}],...}}
```

**How it works:**
- First line is session metadata (id, timestamp, working directory, config)
- Each subsequent line is an `AppMessage` from `agent.state.messages`
- Messages are appended as they're added to the agent state (append-only)
- On session restore, read all message lines to reconstruct conversation history

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

## CLI Interface (included in @mariozechner/coding-agent)

The coding-agent package includes both a library and a CLI interface in one package.

### CLI Usage

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

### CLI Arguments

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

### Phase 1: Create General Agent Package
1. Create `packages/agent/` structure
2. **COPY** Agent class from web-ui/src/agent/agent.ts (don't extract yet)
3. Copy types (AgentState, AgentEvent, Attachment, DebugLogEntry, ThinkingLevel)
4. Copy transports (types.ts, ProviderTransport.ts, AppTransport.ts, proxy-types.ts)
5. Adapt code to work as standalone package
6. Write unit tests for Agent class
7. Write tests for both transports
8. Publish `@mariozechner/agent@0.1.0`
9. **Keep web-ui unchanged** - it continues using its embedded agent

### Phase 2: Create Coding Agent Package (with CLI)
1. Create `packages/coding-agent/` structure
2. Port SessionManager from old agent package
3. Implement ReadTool, BashTool, EditTool, WriteTool
4. Implement CodingAgent class (wraps @mariozechner/agent)
5. Implement CLI in `src/cli/` directory:
   - CLI entry point (index.ts)
   - TuiRenderer, ConsoleRenderer, JsonRenderer
   - Argument parsing
   - Interactive and single-shot modes
6. Write tests for tools and agent
7. Write integration tests for CLI
8. Publish `@mariozechner/coding-agent@0.1.0` (includes library + CLI binary)

### Phase 3: Prove Out New Packages
1. Use coding-agent (library + CLI) extensively
2. Fix bugs and iterate on API design
3. Gather feedback from real usage
4. Ensure stability and performance

### Phase 4: Migrate Web UI (OPTIONAL, later)
1. Once new `@mariozechner/agent` is proven stable
2. Update web-ui package.json to depend on `@mariozechner/agent`
3. Remove src/agent/agent.ts, src/agent/types.ts, src/agent/transports/
4. Keep src/utils/attachment-utils.ts (document processing)
5. Update imports to use `@mariozechner/agent`
6. Test that web UI still works correctly
7. Verify document attachments (PDF, DOCX, etc.) still work

### Phase 5: Cleanup
1. Deprecate/remove old `packages/agent/` package
2. Update all documentation
3. Create migration guide
4. Add examples for all use cases

### Phase 6: Future Enhancements
1. Build VS Code extension using `@mariozechner/coding-agent`
2. Add more tools (grep, find, glob, etc.) as optional plugins
3. Plugin system for custom tools
4. Parallel tool execution
5. Streaming tool output for long-running commands

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

### General Agent Package (`@mariozechner/agent`)
✅ **Transport abstraction** - Pluggable backends (ProviderTransport, AppTransport)
✅ **Reactive state** - Subscribe/emit pattern for UI binding
✅ **Message transformation** - Flexible pipeline for message filtering/adaptation
✅ **Message queueing** - Out-of-band message injection during agent loop
✅ **Attachment support** - Type-safe attachment handling (processing is external)
✅ **Abort support** - First-class cancellation with AbortController
✅ **Provider agnostic** - Works with any LLM provider via @mariozechner/pi-ai
✅ **Type-safe** - Full TypeScript with proper types

### Coding Agent Package (`@mariozechner/coding-agent`)
✅ **Builds on general agent** - Leverages transport abstraction and state management
✅ **Session persistence** - JSONL-based session storage and resume
✅ **Focused tools** - read, bash, edit, write (4 tools, no more)
✅ **Smart pagination** - 5000-line chunks with offset/limit for ReadTool
✅ **Working directory context** - All tools operate relative to project root
✅ **Simple API** - Hides complexity, easy to use
✅ **Testable** - Pure functions, mockable dependencies

### Key Architectural Insights
1. **Extract, don't rewrite** - The web-ui agent is well-designed; extract it into a general package
2. **Separation of concerns** - Document processing (PDF/DOCX/etc.) stays in web-ui, only type definitions move to general agent
3. **Layered architecture** - pi-ai → agent → coding-agent → coding-agent-tui
4. **Reusable across UIs** - Web UI and coding agent both use the same general agent package
5. **Pluggable transports** - Easy to add new backends (local API, proxy server, etc.)
6. **Attachment flexibility** - Type is defined centrally, processing is done by consumers
