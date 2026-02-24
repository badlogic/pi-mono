# Pi Monorepo: Hands-On Tutorials

A set of progressive tutorials to take you from zero to hero in the pi-mono codebase. Each tutorial builds on the previous one. Read the referenced source files as you go — tracing real code is the fastest way to learn.

---

## Tutorial 1: Orientation & Dev Workflow

**Goal:** Build, run, and navigate the project confidently.

### 1.1 Understand the workspace

The monorepo uses **npm workspaces** with 7 packages. Open the root `package.json` and find the `workspaces` field — it points to `packages/*`. Each subdirectory is an independently publishable npm package under the `@mariozechner` scope.

**Exercise:** Run this to see all packages and their versions:

```bash
npm ls --depth=0
```

### 1.2 The build pipeline

The build order matters because packages depend on each other. In `package.json`, find the `build` script:

```
tui → ai → agent → coding-agent → mom → web-ui → pods
```

`tui` builds first because it has no internal dependencies. `ai` is next. `agent` depends on `ai`. And so on up the chain.

**Exercise:** Build everything:

```bash
npm run build
```

Watch the output. Each package compiles with `tsgo` (a Go-based TypeScript compiler). Note how fast it is compared to `tsc`.

### 1.3 Type checking and linting

The project uses **Biome** (not ESLint/Prettier) for formatting and linting, and TypeScript in strict mode for type checking.

**Exercise:** Run the full check:

```bash
npm run check
```

This runs `biome check` (formatting + lint rules) then `tsc --noEmit` (type checking without output). If you ever modify code, run this before committing.

### 1.4 Key configuration files

Read these files and understand what each controls:

| File | Purpose |
|------|---------|
| `tsconfig.base.json` | Shared compiler options: ES2022 target, Node16 module resolution, strict mode |
| `tsconfig.json` | Extends base, adds path aliases (`@mariozechner/pi-ai` → `packages/ai/src`) |
| `biome.json` | Formatting rules: tabs, 120-char line width, specific lint rules |
| `AGENTS.md` | Development rules: no dynamic imports, no `any`, understand your code |

**Exercise:** Open `tsconfig.json` and find the `paths` section. These aliases let you import between packages during development without building first — TypeScript resolves directly to source files.

### 1.5 Running pi from source

**Exercise:**

```bash
./pi-test.sh
```

This runs the coding agent CLI directly from TypeScript source. Try typing a message and watch the agent respond. Press `Ctrl+C` to exit.

---

## Tutorial 2: Terminal UI Library (`pi-tui`)

**Goal:** Understand how pi renders to the terminal.

### 2.1 The component model

Every TUI component implements one core interface:

```typescript
interface Component {
    render(width: number): string[]  // Returns array of lines
    handleInput?(input: string): boolean  // Optional input handling
    invalidate?(): void  // Mark as needing re-render
}
```

A component takes a width and returns lines of text (with ANSI escape codes for color/style). The framework handles diffing and only sending changed lines to the terminal.

**Start reading:** `packages/tui/src/index.ts` — this is the public API surface.

### 2.2 Core components

Read each of these files in order:

**Box** (`packages/tui/src/box.ts`):
- A container with padding and background color
- Wraps a child component
- Caches rendered output for performance

**Text** (`packages/tui/src/text.ts`):
- Multi-line text with word wrapping
- Preserves ANSI escape codes across wraps
- Also caches output

**Exercise:** Trace how `Box` renders: it calls `this.child.render(innerWidth)`, then adds padding lines above/below and padding characters left/right. Note the cache invalidation logic.

### 2.3 The Editor

`packages/tui/src/editor.ts` is the largest component (~65KB). It powers the input field in the interactive CLI.

Key features to trace:
- **Grapheme-aware cursor**: Uses `Intl.Segmenter` to handle emoji and combining characters correctly
- **Kill ring**: Emacs-style clipboard history (Ctrl+K to kill, Ctrl+Y to yank)
- **Undo/redo**: Full undo stack for text changes
- **Autocomplete**: Slash commands (`/`) and file references (`@`)
- **Bracketed paste**: Detects large pastes and collapses them to `[paste #1 +123 lines]`

**Exercise:** Search for `handleInput` in editor.ts. Trace what happens when the user presses `Enter` — follow the code path from keystroke to text insertion.

### 2.4 Markdown rendering

`packages/tui/src/markdown.ts` converts Markdown to styled terminal output using the `marked` library.

Key pattern — the **theme system**:

```typescript
interface MarkdownTheme {
    heading(text: string, level: 1|2|3|4|5|6): string
    code(code: string, lang?: string): string
    bold(text: string): string
    italic(text: string): string
    link(text: string, href: string): string
    // ... more methods
}
```

Each theme method takes plain text and returns ANSI-styled text. The renderer walks the Markdown AST and calls theme methods for each node.

**Exercise:** Find where code blocks are rendered. Notice how it supports optional syntax highlighting via a `highlightCode(code, lang?)` callback.

### 2.5 Differential rendering

`packages/tui/src/tui.ts` is the rendering engine.

The key insight: instead of clearing the screen and redrawing everything (which causes flicker), the engine:

1. Renders all components to an array of lines
2. Compares each line with the previous frame
3. Only sends ANSI escape sequences to move the cursor and overwrite changed lines

**Exercise:** Find the rendering loop in `tui.ts`. Look for where it compares old lines to new lines. This is how pi achieves smooth, flicker-free terminal output.

### 2.6 Terminal management

`packages/tui/src/terminal.ts` handles low-level terminal operations:
- Raw mode (character-by-character input instead of line-buffered)
- Resize event handling
- Kitty keyboard protocol (for enhanced modifier key detection)
- Cursor positioning and visibility

**Key concept:** The `CURSOR_MARKER` (`\x1b_pi:c\x07`) is an APC escape sequence that marks where the hardware cursor should go. The renderer finds this marker and positions the real terminal cursor there (needed for IME input).

---

## Tutorial 3: The LLM Layer (`pi-ai`)

**Goal:** Understand how pi talks to 20+ LLM providers through a single API.

### 3.1 Core types

**Start reading:** `packages/ai/src/types.ts`

The most important types:

```typescript
// A message in the conversation
interface Message {
    role: "user" | "assistant"
    content: (TextBlock | ImageBlock | ToolCallBlock | ToolResultBlock | ThinkingBlock)[]
}

// Options for streaming
interface StreamOptions {
    model: Model
    system?: string
    messages: Message[]
    tools?: Tool[]
    // ... temperature, maxTokens, etc.
}

// What stream() returns
interface StreamResult {
    message: Message          // The assembled response
    inputTokens: number
    outputTokens: number
    cost: number
    durationMs: number
}
```

**Exercise:** Read through the content block types (`TextBlock`, `ToolCallBlock`, etc.). Notice how tool calls are part of the message content, not a separate field — this is how pi handles interleaved text and tool calls.

### 3.2 The provider registry

**Read:** `packages/ai/src/api-registry.ts`

Providers register themselves via:

```typescript
registerApiProvider(name: string, provider: ApiProvider)
```

An `ApiProvider` implements the actual streaming logic for one LLM service.

**Read:** `packages/ai/src/providers/register-builtins.ts`

This file imports and registers every built-in provider. Trace the imports to see the full list: Anthropic, OpenAI (completions + responses), Google (Generative AI, Vertex, Gemini CLI), Azure, Bedrock, Mistral, Groq, Cerebras, xAI, and more.

### 3.3 Model resolution

**Read:** `packages/ai/src/models.ts`

The key function is `getModel()`:

```typescript
const model = getModel("claude-sonnet-4-20250514")
// Returns: { id, provider, api, contextWindow, maxOutputTokens, ... }
```

It searches through `models.generated.ts` (an auto-generated catalog of known models) and matches by ID. The returned `Model` object includes the API provider, pricing info, and capabilities.

**Exercise:** Open `packages/ai/src/models.generated.ts` (it's large — ~323KB). Search for a model you know (e.g., `claude-sonnet`). See how each entry is structured with pricing, context window size, and provider info.

### 3.4 The streaming pipeline

**Read:** `packages/ai/src/stream.ts` — **this is the most important file in pi-ai.**

Trace `stream()` step by step:

1. Resolve the API provider from the model
2. Call `provider.stream(options)` to get an `AssistantMessageEventStream`
3. Iterate over events: `text_delta`, `toolcall_start`, `toolcall_delta`, `toolcall_end`, `thinking_*`, etc.
4. Assemble the final `Message` from the events
5. Calculate token counts and cost
6. Return `StreamResult`

The `complete()` function is just `stream()` with streaming disabled — it collects everything and returns the final result.

**Exercise:** Find the event processing loop in `stream()`. List all event types it handles. Then read `packages/ai/src/utils/event-stream.ts` to see the `AssistantMessageEventStream` class that providers emit.

### 3.5 Reading a provider implementation

**Read:** `packages/ai/src/providers/anthropic.ts`

This is the cleanest provider to study. Trace the flow:

1. **Request construction**: Convert `StreamOptions` → Anthropic API format (system prompt, messages, tools)
2. **Message transformation**: User/assistant messages → Anthropic's `MessageParam` format
3. **Streaming**: Call `client.messages.stream()`, listen to SSE events
4. **Event mapping**: Map Anthropic events (`content_block_start`, `content_block_delta`, etc.) → pi's standardized events (`text_delta`, `toolcall_delta`, etc.)
5. **Thinking support**: Handle extended thinking blocks (Claude's chain-of-thought)

**Exercise:** Now read `packages/ai/src/providers/openai-responses.ts` and compare. Notice:
- Different request format (OpenAI Responses API vs Anthropic Messages API)
- Different event names
- Different tool call handling (OpenAI sends tool calls as separate items)
- Same output: `AssistantMessageEventStream` with identical event types

This is the power of the abstraction — different inputs, same output.

### 3.6 Cross-provider message transformation

**Read:** `packages/ai/src/providers/transform-messages.ts`

When you switch models mid-conversation (e.g., from Claude to GPT-4), messages from the old model need to be transformed. Key problems solved:

- **Thinking blocks**: OpenAI's encrypted reasoning gets stripped; Anthropic thinking blocks convert to text for non-Anthropic models
- **Tool call IDs**: OpenAI uses 450+ char IDs; Anthropic requires `[a-zA-Z0-9_-]{1,64}`. The transformer normalizes them.
- **Orphaned tool calls**: If a tool call exists without a matching result, synthetic empty results are inserted

**Exercise:** Find the function that handles thinking block conversion. Trace what happens to a Claude thinking block when the conversation is replayed on an OpenAI model.

### 3.7 Partial JSON parsing for streaming

**Read:** `packages/ai/src/utils/json-parse.ts`

During streaming, tool call arguments arrive as partial JSON:

```
{"file_path": "/home/us    ← incomplete!
```

The `parseStreamingJson()` function:
1. Tries `JSON.parse()` first (fast path for complete JSON)
2. Falls back to the `partial-json` library which can handle unclosed strings, objects, arrays
3. Returns `{}` if all parsing fails

This enables the UI to show tool arguments in real-time as they stream in.

### 3.8 Tool argument validation

**Read:** `packages/ai/src/utils/validation.ts`

After streaming completes, tool arguments are validated against their TypeBox schema:

```typescript
const result = validateToolCall(tools, toolCall)
// result.tool = matched tool (or undefined)
// result.errors = validation errors (if any)
```

Uses **AJV** (Another JSON Schema Validator) with type coercion enabled — so `"123"` (string) automatically becomes `123` (number) if the schema expects a number.

**Exercise:** Find the AJV configuration. Note the `coerceTypes: true` option and how it handles browser CSP restrictions.

---

## Tutorial 4: The Agent Engine (`pi-agent-core`)

**Goal:** Understand how raw LLM calls become a tool-using agent.

### 4.1 Agent types

**Read:** `packages/agent/src/types.ts`

Key types:

```typescript
// A tool the agent can use
interface AgentTool<T = any> {
    name: string
    description: string
    schema: TSchema               // TypeBox schema for arguments
    execute(args: T): Promise<ToolResult>
}

// Agent state
interface AgentState {
    messages: AgentMessage[]
    isRunning: boolean
    abortController: AbortController
}

// Events emitted during execution
type AgentEvent =
    | { type: "message_start" }
    | { type: "text_delta"; text: string }
    | { type: "toolcall_start"; name: string }
    | { type: "toolcall_delta"; args: string }
    | { type: "toolcall_end" }
    | { type: "tool_result"; result: ToolResult }
    | { type: "message_end" }
    | { type: "error"; error: Error }

// Thinking level control
type ThinkingLevel = "none" | "low" | "medium" | "high"
```

### 4.2 The agent loop

**Read:** `packages/agent/src/agent-loop.ts` — **the second most important file in the repo.**

The core loop is:

```
1. Send messages to LLM (via pi-ai's stream())
2. Get response with text and/or tool calls
3. If response contains tool calls:
   a. Execute each tool
   b. Append tool results to messages
   c. Go to step 1
4. If response is text-only:
   → Done. Return the response.
```

**Exercise:** Find the `agentLoop()` function. Trace:
- How it calls `stream()` from pi-ai
- How it detects tool calls in the response
- How it executes tools and collects results
- The loop condition that decides whether to call the LLM again

Key detail: `agentLoopContinue()` resumes an existing loop (e.g., after the user provides more input mid-execution).

### 4.3 The Agent class

**Read:** `packages/agent/src/agent.ts`

The `Agent` class wraps the agent loop with stateful management:

```typescript
const agent = new Agent({
    model: getModel("claude-sonnet-4-20250514"),
    system: "You are a helpful assistant.",
    tools: [readTool, writeTool, bashTool],
    onEvent: (event) => { /* update UI */ }
})

// Send a message
await agent.send("Read the file at /tmp/test.txt")

// Interrupt the current execution
agent.steer("Actually, read /tmp/other.txt instead")

// Queue a follow-up
agent.followUp("Now summarize what you read")
```

Key features:
- **Steering**: Interrupt a running tool execution and redirect the agent
- **Follow-ups**: Queue messages to send after the current loop completes
- **Event subscriptions**: Register callbacks for real-time UI updates

**Exercise:** Read how `steer()` works. It aborts the current request via `AbortController`, then re-enters the loop with the new message prepended.

### 4.4 Stream proxy

**Read:** `packages/agent/src/proxy.ts`

`streamProxy()` enables running the agent on a backend and streaming events to a frontend (browser, mobile app, etc.). It serializes `AgentEvent`s as newline-delimited JSON over an HTTP response stream.

---

## Tutorial 5: The Coding Agent (`pi-coding-agent`)

**Goal:** Understand the full product — CLI, tools, sessions, and modes.

### 5.1 Entry point and CLI bootstrap

**Read:** `packages/coding-agent/src/cli.ts` → `packages/coding-agent/src/main.ts`

`cli.ts` is a thin wrapper that imports `main.ts`. The main function:

1. Parses CLI arguments (`src/cli/args.ts`)
2. Resolves configuration (`src/config.ts`)
3. Selects the run mode (interactive, print, or RPC)
4. Creates an `AgentSession` and launches the mode

**Exercise:** Read `src/cli/args.ts`. Find the argument definitions. Notice how `-p` (print mode), `--rpc`, and `--model` are handled.

### 5.2 Configuration system

**Read:** `packages/coding-agent/src/config.ts`

Key paths:
- **Package dir**: Where pi is installed (auto-detected for npm, pnpm, yarn, bun)
- **User config**: `~/.pi/agent/` — auth, settings, sessions, extensions
- **Project config**: `.pi/` in the current working directory — project-specific prompts, extensions, skills

The `detectInstallMethod()` function is interesting — it determines how pi was installed to generate correct update instructions.

### 5.3 AgentSession — the central orchestrator

**Read:** `packages/coding-agent/src/core/agent-session.ts` — **the third most important file.**

`AgentSession` ties everything together:

1. Creates an `Agent` (from pi-agent-core) with the coding tools
2. Manages the model registry and settings
3. Handles session persistence (save/load/branch/fork)
4. Manages context compaction when the window fills up
5. Loads extensions and skills
6. Provides the SDK API (`createAgentSession()`)

**Exercise:** Find where tools are registered. Trace how the `read` tool is created and passed to the `Agent`. Notice the `convertToLlm` option that transforms internal message types to LLM-compatible format.

### 5.4 Tools deep-dive

Each tool follows the same pattern:

```typescript
// 1. Define the schema with TypeBox
const ReadSchema = Type.Object({
    file_path: Type.String({ description: "Absolute path to the file" }),
    offset: Type.Optional(Type.Number({ description: "Line to start from" })),
    limit: Type.Optional(Type.Number({ description: "Number of lines" })),
})

// 2. Implement the execute function
async function executeRead(args: Static<typeof ReadSchema>, progress): Promise<ToolResult> {
    // Read the file, format output, return result
}

// 3. Register as an AgentTool
const readTool: AgentTool = {
    name: "read",
    description: "Read a file from the filesystem",
    schema: ReadSchema,
    execute: executeRead,
}
```

**Read each tool:**

| Tool | File | What to notice |
|------|------|----------------|
| `read` | `src/core/tools/read.ts` | Line numbering, offset/limit, image detection |
| `write` | `src/core/tools/write.ts` | File creation, directory creation, content writing |
| `edit` | `src/core/tools/edit.ts` | String replacement with uniqueness check, `replace_all` mode |
| `bash` | `src/core/tools/bash.ts` | Command execution, timeout handling, output truncation |
| `grep` | `src/core/tools/grep.ts` | Ripgrep integration, output modes, glob filtering |
| `find` | `src/core/tools/find.ts` | File pattern matching |
| `ls` | `src/core/tools/ls.ts` | Directory listing |

**Exercise:** Read `edit.ts` carefully. The edit tool requires `old_string` to be unique in the file — find where this uniqueness check happens and what error message is returned if it fails.

### 5.5 Session management

**Read:** `packages/coding-agent/src/core/session-manager.ts`

Sessions are stored as **append-only entry sequences**, not full state snapshots. Entry types:

- **Header**: Session metadata (model, creation time)
- **Message**: User or assistant messages
- **File**: File contents at a point in time
- **Model change**: When the user switches models mid-session
- **Thinking level**: When thinking depth is changed
- **Compaction**: Summarized context replacing older messages

Key feature — **branching**: At any point you can branch a session, creating a fork that shares history up to that point but diverges afterward. This enables "what if" exploration.

**Exercise:** Find the `save()` and `load()` methods. Trace how a session is reconstructed from entries on load.

### 5.6 Context compaction

**Read:** `packages/coding-agent/src/core/compaction/`

When the conversation exceeds the model's context window, pi doesn't just truncate — it **summarizes**. The compaction system:

1. Detects when token usage approaches the limit
2. Selects older messages to summarize
3. Sends them to the LLM with a summarization prompt
4. Replaces the originals with a compact summary
5. Saves the compaction as a session entry (so it's persistent)

**Exercise:** Find the compaction trigger threshold. How close to the context limit does pi wait before compacting?

### 5.7 Modes

**Interactive mode** (`src/modes/interactive/interactive-mode.ts`):
- Full TUI experience with the editor, message history, tool output
- This is the default when you run `pi` with no arguments
- ~8000 lines — the largest single file. Don't try to read it all at once. Focus on:
  - How messages are rendered (search for `renderMessage`)
  - How tool calls are displayed (search for `renderToolCall`)
  - How the editor is integrated (search for `Editor`)

**Print mode** (`src/modes/print-mode.ts`):
- Single-shot: send prompt → get response → exit
- Two formats: `text` (just the final response) or `json` (event stream as NDJSON)
- Used for scripting and pipelines: `pi -p "explain this code" < file.ts`

**RPC mode** (`src/modes/rpc/rpc-mode.ts`):
- JSON over stdin/stdout protocol
- Commands: `{"type": "prompt", "text": "...", "id": "..."}`
- Responses: `{"id": "...", "type": "response", "success": true, "data": {...}}`
- Events streamed as NDJSON between command and response
- Used by `pi-mom` (Slack bot) and IDE integrations

**Exercise:** Write a script that uses print mode:

```bash
echo "What is 2 + 2?" | ./pi-test.sh -p text
```

Then try JSON mode and observe the event stream:

```bash
echo "What is 2 + 2?" | ./pi-test.sh -p json
```

---

## Tutorial 6: Extensions & Skills

**Goal:** Learn the plugin system and how to extend pi.

### 6.1 Extension architecture

**Read:** `packages/coding-agent/src/core/extensions/`

Extensions are TypeScript files loaded from `.pi/extensions/` (project-level) or `~/.pi/agent/extensions/` (user-level).

An extension receives a `pi` object with registration methods:

```typescript
// .pi/extensions/my-extension.ts

pi.registerCommand("hello", {
    description: "Say hello",
    handler: async (_args, ctx) => {
        ctx.addMessage({ role: "user", content: "Hello from my extension!" })
    }
})

pi.on("before_agent_start", async (event, ctx) => {
    // Runs before every agent invocation
    console.log("Agent is starting...")
})

pi.on("session_start", async (event, ctx) => {
    // Runs when a new session begins
})

pi.on("session_switch", async (event, ctx) => {
    // Runs when switching between sessions
})
```

### 6.2 Real extension examples

Study the built-in extensions in `.pi/extensions/`:

**`diff.ts`** — Adds a `/diff` command:
- Runs `git diff` to get staged/unstaged changes
- Presents files in a `SelectList` UI
- User picks files, changes are added to context
- Shows how to use TUI components inside an extension

**`files.ts`** — Adds a `/files` command:
- Tracks all files read (R), written (W), and edited (E) during the session
- Shows operation badges next to each file
- Good example of session event tracking

**`tps.ts`** — Tokens-per-second counter:
- Hooks into streaming events to calculate throughput
- Displays cache hit statistics
- Shows how to observe agent events without modifying behavior

**`prompt-url-widget.ts`** — GitHub URL handler:
- Detects GitHub PR URLs in user input
- Fetches PR metadata via `gh` CLI
- Auto-sets session name from PR title
- Shows how to preprocess user input

**Exercise:** Create a minimal extension:

```typescript
// .pi/extensions/timestamp.ts
pi.registerCommand("now", {
    description: "Show current timestamp",
    handler: async (_args, ctx) => {
        ctx.addMessage({
            role: "assistant",
            content: `Current time: ${new Date().toISOString()}`
        })
    }
})
```

### 6.3 Skills (prompt templates)

**Read:** `packages/coding-agent/src/core/skills.ts`

Skills are Markdown files with YAML frontmatter, stored in `.pi/skills/`:

```markdown
---
description: Review a pull request
---
Review the pull request at $@. Check for:
- Code quality issues
- Missing tests
- Security concerns
- Documentation gaps
```

The `$@` placeholder is replaced with whatever the user types after the skill name. Skills appear as slash commands in the editor autocomplete.

**Exercise:** Look at the real skills in `.pi/prompts/`:
- `pr.md` — PR review workflow
- `cl.md` — Changelog audit
- `is.md` — Issue analysis

Notice how they define multi-step workflows entirely in natural language.

### 6.4 Themes

Themes customize the TUI appearance. They're TypeScript files in `.pi/themes/` that export color and style definitions.

The built-in themes live in `packages/coding-agent/src/modes/interactive/theme/`.

**Exercise:** Read a theme file. Notice how it defines colors for: user messages, assistant messages, tool calls, errors, borders, highlights, etc.

---

## Tutorial 7: The Ecosystem Packages

**Goal:** Understand how the core is consumed by higher-level applications.

### 7.1 `pi-mom` — Slack bot

**Read:** `packages/mom/src/main.ts`

`pi-mom` is a Slack bot that delegates messages to pi. Architecture:

1. Connects to Slack via **Socket Mode** (WebSocket, no public URL needed)
2. Receives messages from Slack channels/DMs
3. Spawns pi-coding-agent in **RPC mode** (JSON over stdin/stdout)
4. Forwards user messages → pi, streams pi responses → Slack
5. Supports the Anthropic Sandbox Runtime for isolated execution

**Key insight:** This is the simplest consumer of pi's RPC mode. Study it to understand the RPC protocol in practice.

**Exercise:** Trace a message from Slack receipt to pi invocation. Find where the RPC command `{"type": "prompt", "text": "..."}` is sent.

### 7.2 `pi-web-ui` — Web components

**Read:** `packages/web-ui/src/index.ts`

A set of web components (using mini-lit, a Lit-compatible framework) for building AI chat interfaces in the browser.

Key components:
- **Chat UI**: Message history, streaming responses
- **Tool execution UI**: Show tool calls and results inline
- **Document attachments**: PDF, DOCX, XLSX, PPTX extraction
- **Artifacts**: Render HTML, SVG, Markdown in sandboxed iframes
- **JavaScript REPL**: Execute JS in the browser

**Architecture pattern:** The web UI consumes `pi-ai` directly (not through the agent layer) — it manages its own conversation state. This shows how to use the LLM layer without the full agent stack.

**Exercise:** Read `packages/web-ui/src/tools/extract-document.ts`. See how it converts uploaded PDFs and Office documents to text for LLM consumption.

### 7.3 `pi-pods` — GPU deployment CLI

**Read:** `packages/pods/src/cli.js`

A CLI for deploying and managing vLLM instances on GPU pods. This is operational tooling rather than agent code.

Key capabilities:
- SSH into GPU pods
- Install and configure vLLM
- Launch models with specified GPU allocation
- Test the resulting OpenAI-compatible API endpoint
- Monitor deployment health

**Exercise:** Read `packages/pods/src/models.json` to see which models are pre-configured for deployment.

---

## Tutorial 8: End-to-End Trace

**Goal:** Follow a single user message through every layer of the stack.

This is the capstone exercise. Trace this path through the code:

### The journey of "Read /tmp/test.txt"

1. **Terminal input** (`pi-tui`):
   - User types in the `Editor` component
   - `handleInput()` processes each keystroke
   - On Enter, the text is extracted

2. **Interactive mode** (`pi-coding-agent/modes/interactive`):
   - Receives the text from the editor
   - Creates a user `AgentMessage`
   - Calls `agentSession.send(message)`

3. **AgentSession** (`pi-coding-agent/core/agent-session.ts`):
   - Appends the message to history
   - Saves to session file
   - Calls `agent.send(message)`

4. **Agent** (`pi-agent-core/agent.ts`):
   - Enters the agent loop

5. **Agent loop** (`pi-agent-core/agent-loop.ts`):
   - Assembles context: system prompt + messages + tools
   - Calls `stream()` from pi-ai

6. **Stream** (`pi-ai/stream.ts`):
   - Resolves the model's API provider
   - Calls `provider.stream(options)`

7. **Provider** (e.g., `pi-ai/providers/anthropic.ts`):
   - Transforms messages to Anthropic format
   - Calls `client.messages.stream()`
   - Maps SSE events to `AssistantMessageEventStream`

8. **Back in agent loop**:
   - Response contains a `toolcall` for the `read` tool with `{"file_path": "/tmp/test.txt"}`
   - Executes `readTool.execute({file_path: "/tmp/test.txt"})`

9. **Read tool** (`pi-coding-agent/core/tools/read.ts`):
   - Reads the file from disk
   - Formats with line numbers
   - Returns `ToolResult` with file contents

10. **Agent loop continues**:
    - Appends tool result to messages
    - Calls `stream()` again
    - LLM sees the file contents and generates a text response
    - No more tool calls → loop ends

11. **Back through the stack**:
    - `Agent` emits events → `AgentSession` saves → Interactive mode renders

**Exercise:** Set breakpoints (or add `console.log`) at each of these 11 points. Send a message and watch the logs flow through the entire stack in order.

---

## Quick Reference: The 5 Most Important Files

When in doubt, re-read these:

| # | File | Why |
|---|------|-----|
| 1 | `packages/ai/src/stream.ts` | How every LLM call works |
| 2 | `packages/agent/src/agent-loop.ts` | How agents use tools |
| 3 | `packages/coding-agent/src/core/agent-session.ts` | How it all comes together |
| 4 | `packages/ai/src/providers/anthropic.ts` | How a provider is implemented |
| 5 | `packages/coding-agent/src/core/tools/edit.ts` | How a tool is implemented |

Master these five files and you understand the spine of pi.
