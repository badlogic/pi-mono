# Porting Plan: genai-workshop-new Chat System to Browser Extension

## Executive Summary

Port the complete chat interface, message rendering, streaming, tool execution, and transport system from `genai-workshop-new/src/app` to the browser extension. The goal is to provide a full-featured AI chat interface with:

1. **Multiple transport options**: Direct API calls OR proxy-based calls
2. **Full message rendering**: Text, thinking blocks, tool calls, attachments, images
3. **Streaming support**: Real-time message streaming with proper batching
4. **Tool execution and rendering**: Extensible tool system with custom renderers
5. **Session management**: State management with persistence
6. **Debug capabilities**: Optional debug view for development

## Current State Analysis

### Already Ported to Browser Extension
- ✅ `AttachmentTile.ts` - Display attachment thumbnails
- ✅ `AttachmentOverlay.ts` - Full-screen attachment viewer
- ✅ `MessageEditor.ts` - Input field with attachment support
- ✅ `utils/attachment-utils.ts` - PDF, Office, image processing
- ✅ `utils/i18n.ts` - Internationalization
- ✅ `dialogs/ApiKeysDialog.ts` - API key management
- ✅ `dialogs/ModelSelector.ts` - Model selection dialog
- ✅ `state/KeyStore.ts` - API key storage

### Available in @mariozechner/mini-lit Package
- ✅ `CodeBlock` - Syntax-highlighted code display
- ✅ `MarkdownBlock` - Markdown rendering
- ✅ `Button`, `Input`, `Select`, `Textarea`, etc. - UI components
- ✅ `ThemeToggle` - Dark/light mode
- ✅ `Dialog` - Base dialog component

### Needs to Be Ported

#### Core Chat System
1. **AgentInterface.ts** (325 lines)
   - Main chat interface container
   - Manages scrolling, auto-scroll behavior
   - Coordinates MessageList, StreamingMessageContainer, MessageEditor
   - Displays usage stats
   - Handles session lifecycle

2. **MessageList.ts** (78 lines)
   - Renders stable (non-streaming) messages
   - Uses `repeat()` directive for efficient rendering
   - Maps tool results by call ID
   - Renders user and assistant messages

3. **Messages.ts** (286 lines)
   - **UserMessage component**: Displays user messages with attachments
   - **AssistantMessage component**: Displays assistant messages with text, thinking, tool calls
   - **ToolMessage component**: Displays individual tool invocations with debug view
   - **ToolMessageDebugView component**: Shows tool call args and results
   - **AbortedMessage component**: Shows aborted requests

4. **StreamingMessageContainer.ts** (95 lines)
   - Manages streaming message updates
   - Batches updates using `requestAnimationFrame` for performance
   - Shows loading indicator during streaming
   - Handles immediate updates for clearing

5. **ConsoleBlock.ts** (62 lines)
   - Console-style output display
   - Auto-scrolling to bottom
   - Copy button functionality
   - Used by tool renderers

#### State Management

6. **state/agent-session.ts** (282 lines)
   - **AgentSession class**: Core state management
   - Manages conversation state: messages, model, tools, system prompt, thinking level
   - Implements pub/sub pattern for state updates
   - Handles message preprocessing (e.g., extracting text from documents)
   - Coordinates transport for sending messages
   - Collects debug information
   - Event types: `state-update`, `error-no-model`, `error-no-api-key`
   - Methods:
     - `prompt(input, attachments)` - Send user message
     - `setModel()`, `setSystemPrompt()`, `setThinkingLevel()`, `setTools()`
     - `appendMessage()`, `replaceMessages()`, `clearMessages()`
     - `abort()` - Cancel ongoing request
     - `subscribe(fn)` - Listen to state changes

7. **state/session-store.ts** (needs investigation)
   - Session persistence to IndexedDB
   - Load/save conversation history
   - Multiple session management

#### Transport Layer

8. **state/transports/types.ts** (17 lines)
   - `AgentTransport` interface
   - `AgentRunConfig` interface
   - Defines contract for transport implementations

9. **state/transports/proxy-transport.ts** (54 lines)
   - **LocalTransport class** (misleadingly named - actually proxy)
   - Calls proxy server via `streamSimpleProxy`
   - Passes auth token from KeyStore
   - Yields events from `agentLoop()`

10. **NEW: state/transports/direct-transport.ts** (needs creation)
    - **DirectTransport class**
    - Calls provider APIs directly using API keys from KeyStore
    - Uses `@mariozechner/pi-ai`'s `agentLoop()` directly
    - No auth token needed

11. **utils/proxy-client.ts** (285 lines)
    - `streamSimpleProxy()` function
    - Fetches from `/api/stream` endpoint
    - Parses SSE (Server-Sent Events) stream
    - Reconstructs partial messages from delta events
    - Handles abort signals
    - Maps proxy events to `AssistantMessageEvent`
    - Detects unauthorized and clears auth token

12. **NEW: utils/config.ts** (needs creation)
    - Transport configuration
    - Proxy URL configuration
    - Storage key: `transport-mode` ("direct" | "proxy")
    - Storage key: `proxy-url` (default: configurable)

#### Tool System

13. **tools/index.ts** (40 lines)
    - Exports tool functions from `@mariozechner/pi-ai`
    - Registers default tool renderers
    - Exports `renderToolParams()` and `renderToolResult()`
    - Re-exports tool implementations

14. **tools/types.ts** (needs investigation)
    - `ToolRenderer` interface
    - Contracts for custom tool renderers

15. **tools/renderer-registry.ts** (19 lines)
    - Global registry: `Map<string, ToolRenderer>`
    - `registerToolRenderer(name, renderer)` function
    - `getToolRenderer(name)` function

16. **tools/renderers/DefaultRenderer.ts** (1162 chars)
    - Fallback renderer for unknown tools
    - Renders params as JSON
    - Renders results as JSON or text

17. **tools/renderers/CalculateRenderer.ts** (1677 chars)
    - Custom renderer for calculate tool
    - Shows expression and result

18. **tools/renderers/GetCurrentTimeRenderer.ts** (1328 chars)
    - Custom renderer for time tool
    - Shows timezone and formatted time

19. **tools/renderers/BashRenderer.ts** (1500 chars)
    - Custom renderer for bash tool
    - Uses ConsoleBlock for output

20. **tools/javascript-repl.ts** (needs investigation)
    - JavaScript REPL tool implementation
    - May need adaptation for browser environment

21. **tools/web-search.ts** (needs investigation)
    - Web search tool implementation
    - Check if compatible with browser extension

22. **tools/sleep.ts** (needs investigation)
    - Simple sleep/delay tool

#### Utilities

23. **utils/format.ts** (needs investigation)
    - `formatUsage()` - Format token usage and costs
    - Other formatting utilities

24. **utils/auth-token.ts** (21 lines)
    - `getAuthToken()` - Prompt for proxy auth token
    - `clearAuthToken()` - Remove from storage
    - Uses PromptDialog for input

25. **dialogs/PromptDialog.ts** (needs investigation)
    - Simple text input dialog
    - Used for auth token entry

#### Debug/Development

26. **DebugView.ts** (needs investigation)
    - Debug panel showing request/response details
    - ChatML formatting
    - SSE event stream
    - Timing information (TTFT, total time)
    - Optional feature for development

#### NOT Needed

- ❌ `demos/` folder - All demo files (ignore)
- ❌ `mini/` folder - All UI components (use @mariozechner/mini-lit instead)
- ❌ `admin/ProxyAdmin.ts` - Proxy server admin (not needed in extension)
- ❌ `CodeBlock.ts` - Available in @mariozechner/mini-lit
- ❌ `MarkdownBlock.ts` - Available in @mariozechner/mini-lit
- ❌ `ScatterPlot.ts` - Demo visualization
- ❌ `tools/artifacts.ts` - Artifact tool (demo feature)
- ❌ `tools/bash-mcp-server.ts` - MCP integration (not feasible in browser)
- ❌ `AttachmentTileList.ts` - Likely superseded by MessageEditor integration

---

## Detailed Porting Tasks

### Phase 1: Core Message Rendering (Foundation)

#### Task 1.1: Port ConsoleBlock
**File**: `src/ConsoleBlock.ts`
**Dependencies**: mini-lit icons
**Actions**:
1. Copy `ConsoleBlock.ts` to browser extension
2. Update imports to use `@mariozechner/mini-lit`
3. Replace icon imports with lucide icons:
   - `iconCheckLine` → `Check`
   - `iconFileCopy2Line` → `Copy`
4. Update i18n strings:
   - Add "console", "Copy output", "Copied!" to i18n.ts

**Verification**: Render `<console-block content="test output"></console-block>`

#### Task 1.2: Port Messages.ts (User, Assistant, Tool Components)
**File**: `src/Messages.ts`
**Dependencies**: ConsoleBlock, formatUsage, tool rendering
**Actions**:
1. Copy `Messages.ts` to browser extension
2. Update imports:
   - `Button` from `@mariozechner/mini-lit`
   - `formatUsage` from utils
   - Icons from lucide (ToolsLine, Loader4Line, BugLine)
3. Add new type: `AppMessage` (already have partial in extension)
4. Components to register:
   - `user-message`
   - `assistant-message`
   - `tool-message`
   - `tool-message-debug`
   - `aborted-message`
5. Update i18n strings:
   - "Error:", "Request aborted", "Call", "Result", "(no result)", "Waiting for tool result…", "Call was aborted; no result."
6. Guard all custom element registrations

**Verification**:
- Render user message with text and attachments
- Render assistant message with text, thinking, tool calls
- Render tool message in pending, success, error states

#### Task 1.3: Port MessageList
**File**: `src/MessageList.ts`
**Dependencies**: Messages.ts
**Actions**:
1. Copy `MessageList.ts` to browser extension
2. Update imports
3. Uses `repeat()` directive from lit - ensure it's available
4. Register `message-list` element with guard

**Verification**: Render a list of mixed user/assistant/tool messages

#### Task 1.4: Port StreamingMessageContainer
**File**: `src/StreamingMessageContainer.ts`
**Dependencies**: Messages.ts
**Actions**:
1. Copy `StreamingMessageContainer.ts` to browser extension
2. Update imports
3. Register `streaming-message-container` element with guard
4. Test batching behavior with rapid updates

**Verification**:
- Stream messages update smoothly
- Cursor blinks during streaming
- Immediate clear works correctly

---

### Phase 2: Tool System

#### Task 2.1: Port Tool Types and Registry
**Files**: `src/tools/types.ts`, `src/tools/renderer-registry.ts`
**Actions**:
1. Read `tools/types.ts` to understand `ToolRenderer` interface
2. Copy both files to `src/tools/`
3. Create registry as singleton

**Verification**: Can register and retrieve renderers

#### Task 2.2: Port Tool Renderers
**Files**: All `src/tools/renderers/*.ts`
**Actions**:
1. Copy `DefaultRenderer.ts`
2. Copy `CalculateRenderer.ts`
3. Copy `GetCurrentTimeRenderer.ts`
4. Copy `BashRenderer.ts`
5. Update all to use `@mariozechner/mini-lit` and lucide icons
6. Ensure all use ConsoleBlock where needed

**Verification**: Test each renderer with sample tool calls

#### Task 2.3: Port Tool Implementations
**Files**: `src/tools/javascript-repl.ts`, `src/tools/web-search.ts`, `src/tools/sleep.ts`
**Actions**:
1. Read each file to assess browser compatibility
2. Port `sleep.ts` (should be trivial)
3. Port `javascript-repl.ts` - may need `new Function()` or eval
4. Port `web-search.ts` - check if it uses fetch or needs adaptation
5. Update `tools/index.ts` to register all renderers and export tools

**Verification**: Test each tool execution in browser context

---

### Phase 3: Transport Layer

#### Task 3.1: Port Transport Types
**File**: `src/state/transports/types.ts`
**Actions**:
1. Copy file to `src/state/transports/`
2. Verify types align with pi-ai package

**Verification**: Types compile correctly

#### Task 3.2: Port Proxy Client
**File**: `src/utils/proxy-client.ts`
**Dependencies**: auth-token.ts
**Actions**:
1. Copy `proxy-client.ts` to `src/utils/`
2. Update `streamSimpleProxy()` to use configurable proxy URL
3. Read proxy URL from config (default: user-configurable)
4. Update error messages for i18n
5. Add i18n strings: "Proxy error: {status} {statusText}", "Proxy error: {error}", "Auth token is required for proxy transport"

**Verification**: Can connect to proxy server with auth token

#### Task 3.3: Port Proxy Transport
**File**: `src/state/transports/proxy-transport.ts`
**Actions**:
1. Copy file to `src/state/transports/`
2. Rename `LocalTransport` to `ProxyTransport` for clarity
3. Update to use `streamSimpleProxy` from proxy-client
4. Integrate with KeyStore for auth token

**Verification**: Can send message through proxy

#### Task 3.4: Create Direct Transport
**File**: `src/state/transports/direct-transport.ts` (NEW)
**Actions**:
1. Create new `DirectTransport` class implementing `AgentTransport`
2. Use `agentLoop()` from `@mariozechner/pi-ai` directly
3. Integrate with KeyStore to get API keys per provider
4. Pass API key in options to `agentLoop()`
5. Handle `no-api-key` errors by triggering ApiKeysDialog

**Example Implementation**:
```typescript
import { agentLoop, type AgentContext, type PromptConfig, type UserMessage } from "@mariozechner/pi-ai";
import { keyStore } from "../../KeyStore.js";
import type { AgentRunConfig, AgentTransport } from "./types.js";

export class DirectTransport implements AgentTransport {
  constructor(
    private readonly getMessages: () => Promise<Message[]>,
  ) {}

  async *run(userMessage: Message, cfg: AgentRunConfig, signal?: AbortSignal) {
    // Get API key from KeyStore
    const apiKey = await keyStore.getKey(cfg.model.provider);
    if (!apiKey) {
      throw new Error("no-api-key");
    }

    const context: AgentContext = {
      systemPrompt: cfg.systemPrompt,
      messages: await this.getMessages(),
      tools: cfg.tools,
    };

    const pc: PromptConfig = {
      model: cfg.model,
      reasoning: cfg.reasoning,
      apiKey, // Direct API key
    };

    // Yield events from agentLoop
    for await (const ev of agentLoop(userMessage as unknown as UserMessage, context, pc, signal)) {
      yield ev;
    }
  }
}
```

**Verification**: Can send message directly to provider APIs

#### Task 3.5: Create Transport Configuration
**File**: `src/utils/config.ts` (NEW)
**Actions**:
1. Create transport mode storage: "direct" | "proxy"
2. Create proxy URL storage with default
3. Create getters/setters:
   - `getTransportMode()` / `setTransportMode()`
   - `getProxyUrl()` / `setProxyUrl()`
4. Store in chrome.storage.local

**Example**:
```typescript
export type TransportMode = "direct" | "proxy";

export async function getTransportMode(): Promise<TransportMode> {
  const result = await chrome.storage.local.get("transport-mode");
  return (result["transport-mode"] as TransportMode) || "direct";
}

export async function setTransportMode(mode: TransportMode): Promise<void> {
  await chrome.storage.local.set({ "transport-mode": mode });
}

export async function getProxyUrl(): Promise<string> {
  const result = await chrome.storage.local.get("proxy-url");
  return result["proxy-url"] || "https://genai.mariozechner.at";
}

export async function setProxyUrl(url: string): Promise<void> {
  await chrome.storage.local.set({ "proxy-url": url });
}
```

**Verification**: Can read/write transport config

---

### Phase 4: State Management

#### Task 4.1: Port Utilities
**File**: `src/utils/format.ts`
**Actions**:
1. Read file to identify all formatting functions
2. Copy `formatUsage()` function
3. Copy any other utilities needed by AgentSession
4. Update imports

**Verification**: Test formatUsage with sample usage data

#### Task 4.2: Port Auth Token Utils
**File**: `src/utils/auth-token.ts`
**Dependencies**: PromptDialog
**Actions**:
1. Copy file to `src/utils/`
2. Update to use chrome.storage.local
3. Will need PromptDialog (next task)

**Verification**: Can prompt for and store auth token

#### Task 4.3: Port/Create PromptDialog
**File**: `src/dialogs/PromptDialog.ts`
**Actions**:
1. Read genai-workshop-new version
2. Adapt to use `@mariozechner/mini-lit` Dialog
3. Create simple input dialog similar to ApiKeysDialog
4. Add `PromptDialog.ask(title, message, defaultValue, isPassword)` static method

**Verification**: Can prompt for text input

#### Task 4.4: Port Agent Session
**File**: `src/state/agent-session.ts`
**Dependencies**: Transports, formatUsage, auth-token, DebugView types
**Actions**:
1. Copy `agent-session.ts` to `src/state/`
2. Update imports:
   - ProxyTransport from `./transports/proxy-transport.js`
   - DirectTransport from `./transports/direct-transport.js`
   - Types from pi-ai
   - KeyStore, auth-token utils
3. Modify constructor to accept transport mode
4. Create transport based on mode:
   - "proxy" → ProxyTransport
   - "direct" → DirectTransport
5. Update to use chrome.storage for persistence
6. Add `ThinkingLevel` type
7. Add `AppMessage` type extension for attachments

**Key modifications**:
```typescript
constructor(opts: AgentSessionOptions & { transportMode?: TransportMode } = {
  authTokenProvider: async () => getAuthToken()
}) {
  // ... existing state init ...

  const mode = opts.transportMode || await getTransportMode();

  if (mode === "proxy") {
    this.transport = new ProxyTransport(
      async () => this.preprocessMessages(),
      opts.authTokenProvider
    );
  } else {
    this.transport = new DirectTransport(
      async () => this.preprocessMessages()
    );
  }
}
```

**Verification**:
- Create session with direct transport, send message
- Create session with proxy transport, send message
- Test abort functionality
- Test state subscription

---

### Phase 5: Main Interface Integration

#### Task 5.1: Port AgentInterface
**File**: `src/AgentInterface.ts`
**Dependencies**: Everything above
**Actions**:
1. Copy `AgentInterface.ts` to `src/`
2. Update all imports to use ported components
3. Register `agent-interface` custom element with guard
4. Update icons to lucide
5. Add i18n strings:
   - "No session available", "No session set", "Hide debug view", "Show debug view"
6. Properties:
   - `session` (external AgentSession)
   - `enableAttachments`
   - `enableModelSelector`
   - `enableThinking`
   - `showThemeToggle`
   - `showDebugToggle`
7. Methods:
   - `setInput(text, attachments)`
   - `sendMessage(input, attachments)`

**Verification**: Full chat interface works end-to-end

#### Task 5.2: Integrate into ChatPanel
**File**: `src/ChatPanel.ts`
**Actions**:
1. Remove current chat implementation
2. Create AgentSession instance
3. Render `<agent-interface>` with session
4. Configure:
   - `enableAttachments={true}`
   - `enableModelSelector={true}`
   - `enableThinking={true}`
   - `showThemeToggle={false}` (already in header)
   - `showDebugToggle={false}` (optional)
5. Remove old MessageEditor integration (now inside AgentInterface)
6. Set system prompt (optional)
7. Set default tools (optional - calculateTool, getCurrentTimeTool)

**Example**:
```typescript
import { AgentSession } from "./state/agent-session.js";
import "./AgentInterface.js";
import { calculateTool, getCurrentTimeTool } from "./tools/index.js";

@customElement("chat-panel")
export class ChatPanel extends LitElement {
  @state() private session!: AgentSession;

  override async connectedCallback() {
    super.connectedCallback();

    // Create session
    this.session = new AgentSession({
      initialState: {
        systemPrompt: "You are a helpful AI assistant.",
        tools: [calculateTool, getCurrentTimeTool],
      },
      authTokenProvider: async () => getAuthToken(),
      transportMode: await getTransportMode(),
    });
  }

  override render() {
    return html`
      <agent-interface
        .session=${this.session}
        .enableAttachments=${true}
        .enableModelSelector=${true}
        .enableThinking=${true}
        .showThemeToggle=${false}
        .showDebugToggle=${true}
      ></agent-interface>
    `;
  }
}
```

**Verification**: Full extension works with chat interface

#### Task 5.3: Create Settings Dialog
**File**: `src/dialogs/SettingsDialog.ts` (NEW)
**Actions**:
1. Create dialog extending DialogBase
2. Sections:
   - **Transport Mode**: Radio buttons for "Direct" | "Proxy"
   - **Proxy URL**: Input field (only shown if proxy mode)
   - **API Keys**: Button to open ApiKeysDialog
3. Save settings to config utils

**UI Layout**:
```
┌─────────────────────────────────────┐
│ Settings                    [x]     │
├─────────────────────────────────────┤
│                                     │
│ Transport Mode                      │
│ ○ Direct (use API keys)             │
│ ● Proxy (use auth token)            │
│                                     │
│ Proxy URL                           │
│ [https://genai.mariozechner.at   ] │
│                                     │
│ [Manage API Keys...]                │
│                                     │
│                    [Cancel] [Save]  │
└─────────────────────────────────────┘
```

**Verification**: Can toggle transport mode and set proxy URL

#### Task 5.4: Update Header
**File**: `src/sidepanel.ts`
**Actions**:
1. Change settings button to open SettingsDialog (not ApiKeysDialog directly)
2. SettingsDialog should have button to open ApiKeysDialog

**Verification**: Settings accessible from header

---

### Phase 6: Optional Features

#### Task 6.1: Port DebugView (Optional)
**File**: `src/DebugView.ts`
**Actions**:
1. Read full file to understand functionality
2. Copy to `src/`
3. Update imports
4. Format ChatML, SSE events, timing info
5. Add to AgentInterface when `showDebugToggle={true}`

**Verification**: Debug view shows request/response details

#### Task 6.2: Port Session Store (Optional)
**File**: `src/utils/session-db.ts` or `src/state/session-store.ts`
**Actions**:
1. Read file to understand IndexedDB usage
2. Create IndexedDB schema for sessions
3. Implement save/load/list/delete operations
4. Add to AgentInterface or ChatPanel
5. Add UI for switching sessions

**Verification**: Can save and load conversation history

#### Task 6.3: Add System Prompt Editor (Optional)
**Actions**:
1. Create dialog or expandable textarea
2. Allow editing session.state.systemPrompt
3. Add to settings or main interface

**Verification**: Can customize system prompt

---

## File Mapping Reference

### Source → Destination

| Source File | Destination File | Status | Dependencies |
|------------|------------------|--------|--------------|
| `app/ConsoleBlock.ts` | `src/ConsoleBlock.ts` | ⭕ New | mini-lit, lucide |
| `app/Messages.ts` | `src/Messages.ts` | ⭕ New | ConsoleBlock, formatUsage, tools |
| `app/MessageList.ts` | `src/MessageList.ts` | ⭕ New | Messages.ts |
| `app/StreamingMessageContainer.ts` | `src/StreamingMessageContainer.ts` | ⭕ New | Messages.ts |
| `app/AgentInterface.ts` | `src/AgentInterface.ts` | ⭕ New | All message components |
| `app/state/agent-session.ts` | `src/state/agent-session.ts` | ⭕ New | Transports, formatUsage |
| `app/state/transports/types.ts` | `src/state/transports/types.ts` | ⭕ New | pi-ai |
| `app/state/transports/proxy-transport.ts` | `src/state/transports/proxy-transport.ts` | ⭕ New | proxy-client |
| N/A | `src/state/transports/direct-transport.ts` | ⭕ New | pi-ai, KeyStore |
| `app/utils/proxy-client.ts` | `src/utils/proxy-client.ts` | ⭕ New | auth-token |
| N/A | `src/utils/config.ts` | ⭕ New | chrome.storage |
| `app/utils/format.ts` | `src/utils/format.ts` | ⭕ New | None |
| `app/utils/auth-token.ts` | `src/utils/auth-token.ts` | ⭕ New | PromptDialog |
| `app/tools/types.ts` | `src/tools/types.ts` | ⭕ New | None |
| `app/tools/renderer-registry.ts` | `src/tools/renderer-registry.ts` | ⭕ New | types.ts |
| `app/tools/renderers/DefaultRenderer.ts` | `src/tools/renderers/DefaultRenderer.ts` | ⭕ New | mini-lit |
| `app/tools/renderers/CalculateRenderer.ts` | `src/tools/renderers/CalculateRenderer.ts` | ⭕ New | mini-lit |
| `app/tools/renderers/GetCurrentTimeRenderer.ts` | `src/tools/renderers/GetCurrentTimeRenderer.ts` | ⭕ New | mini-lit |
| `app/tools/renderers/BashRenderer.ts` | `src/tools/renderers/BashRenderer.ts` | ⭕ New | ConsoleBlock |
| `app/tools/javascript-repl.ts` | `src/tools/javascript-repl.ts` | ⭕ New | pi-ai |
| `app/tools/web-search.ts` | `src/tools/web-search.ts` | ⭕ New | pi-ai |
| `app/tools/sleep.ts` | `src/tools/sleep.ts` | ⭕ New | pi-ai |
| `app/tools/index.ts` | `src/tools/index.ts` | ⭕ New | All tools |
| `app/dialogs/PromptDialog.ts` | `src/dialogs/PromptDialog.ts` | ⭕ New | mini-lit |
| N/A | `src/dialogs/SettingsDialog.ts` | ⭕ New | config, ApiKeysDialog |
| `app/DebugView.ts` | `src/DebugView.ts` | ⭕ Optional | highlight.js |
| `app/utils/session-db.ts` | `src/utils/session-db.ts` | ⭕ Optional | IndexedDB |

### Already in Extension

| File | Status | Notes |
|------|--------|-------|
| `src/MessageEditor.ts` | ✅ Exists | May need minor updates |
| `src/AttachmentTile.ts` | ✅ Exists | Complete |
| `src/AttachmentOverlay.ts` | ✅ Exists | Complete |
| `src/utils/attachment-utils.ts` | ✅ Exists | Complete |
| `src/dialogs/ModelSelector.ts` | ✅ Exists | May need integration check |
| `src/dialogs/ApiKeysDialog.ts` | ✅ Exists | Complete |
| `src/state/KeyStore.ts` | ✅ Exists | Complete |

---

## Critical Implementation Notes

### 1. Custom Element Registration Guards

ALL custom elements must use registration guards to prevent duplicate registration errors:

```typescript
// Instead of @customElement decorator
export class MyComponent extends LitElement {
  // ... component code ...
}

// At end of file
if (!customElements.get("my-component")) {
  customElements.define("my-component", MyComponent);
}
```

### 2. Import Path Updates

When porting, update ALL imports:

**From genai-workshop-new**:
```typescript
import { Button } from "./mini/Button.js";
import { iconLoader4Line } from "./mini/icons.js";
```

**To browser extension**:
```typescript
import { Button } from "@mariozechner/mini-lit";
import { Loader2 } from "lucide";
import { icon } from "@mariozechner/mini-lit";
// Use: icon(Loader2, "md")
```

### 3. Icon Mapping

| genai-workshop | lucide | Usage |
|----------------|--------|-------|
| `iconLoader4Line` | `Loader2` | `icon(Loader2, "sm")` |
| `iconToolsLine` | `Wrench` | `icon(Wrench, "md")` |
| `iconBugLine` | `Bug` | `icon(Bug, "sm")` |
| `iconCheckLine` | `Check` | `icon(Check, "sm")` |
| `iconFileCopy2Line` | `Copy` | `icon(Copy, "sm")` |

### 4. Chrome Extension APIs

Replace browser APIs where needed:
- `localStorage` → `chrome.storage.local`
- `fetch("/api/...")` → `fetch(proxyUrl + "/api/...")`
- No direct filesystem access

### 5. Transport Mode Configuration

Ensure AgentSession can be created with either transport:

```typescript
// Direct mode (uses API keys from KeyStore)
const session = new AgentSession({
  transportMode: "direct",
  authTokenProvider: async () => undefined, // not needed
});

// Proxy mode (uses auth token)
const session = new AgentSession({
  transportMode: "proxy",
  authTokenProvider: async () => getAuthToken(),
});
```

### 6. i18n Strings to Add

All UI strings must be in i18n.ts with English and German translations:

```typescript
// Messages.ts
"Error:", "Request aborted", "Call", "Result", "(no result)",
"Waiting for tool result…", "Call was aborted; no result."

// ConsoleBlock.ts
"console", "Copy output", "Copied!"

// AgentInterface.ts
"No session available", "No session set", "Hide debug view", "Show debug view"

// Transport errors
"Proxy error: {status} {statusText}", "Proxy error: {error}",
"Auth token is required for proxy transport"

// Settings
"Settings", "Transport Mode", "Direct (use API keys)",
"Proxy (use auth token)", "Proxy URL", "Manage API Keys"
```

### 7. TypeScript Configuration

The extension uses `useDefineForClassFields: false` in tsconfig.base.json. Ensure all ported components are compatible.

### 8. Build Verification Steps

After each phase:
1. Run `npm run check` - TypeScript compilation
2. Run `npm run build:chrome` - Chrome extension build
3. Run `npm run build:firefox` - Firefox extension build
4. Load extension in browser and test functionality
5. Check console for errors

### 9. Proxy URL Configuration

Default proxy URL should be configurable but default to:
```typescript
const DEFAULT_PROXY_URL = "https://genai.mariozechner.at";
```

Users should be able to change this in settings for self-hosted proxies.

---

## Testing Checklist

### Phase 1: Message Rendering
- [ ] User messages display with text
- [ ] User messages display with attachments
- [ ] Assistant messages display with text
- [ ] Assistant messages display with thinking blocks
- [ ] Assistant messages display with tool calls
- [ ] Tool messages show pending state with spinner
- [ ] Tool messages show completed state with results
- [ ] Tool messages show error state
- [ ] Tool messages show aborted state
- [ ] Console blocks render output
- [ ] Console blocks auto-scroll
- [ ] Console blocks copy to clipboard

### Phase 2: Tool System
- [ ] Calculate tool renders expression and result
- [ ] Time tool renders timezone and formatted time
- [ ] Bash tool renders output in console block
- [ ] JavaScript REPL tool executes code
- [ ] Web search tool fetches results
- [ ] Sleep tool delays execution
- [ ] Custom tool renderers can be registered
- [ ] Unknown tools use default renderer
- [ ] Tool debug view shows call args and results

### Phase 3: Transport Layer
- [ ] Proxy transport connects to server
- [ ] Proxy transport handles auth token
- [ ] Proxy transport streams messages
- [ ] Proxy transport reconstructs partial messages
- [ ] Proxy transport handles abort
- [ ] Proxy transport handles errors
- [ ] Direct transport uses API keys from KeyStore
- [ ] Direct transport calls provider APIs directly
- [ ] Direct transport handles missing API key
- [ ] Direct transport streams messages
- [ ] Direct transport handles abort
- [ ] Transport mode can be switched
- [ ] Proxy URL can be configured

### Phase 4: State Management
- [ ] AgentSession manages conversation state
- [ ] AgentSession sends messages
- [ ] AgentSession receives streaming updates
- [ ] AgentSession handles tool execution
- [ ] AgentSession handles errors
- [ ] AgentSession can be aborted
- [ ] AgentSession persists state
- [ ] AgentSession supports multiple sessions
- [ ] System prompt can be set
- [ ] Model can be selected
- [ ] Thinking level can be adjusted
- [ ] Tools can be configured
- [ ] Usage stats are tracked

### Phase 5: Main Interface
- [ ] AgentInterface displays messages
- [ ] AgentInterface handles scrolling
- [ ] AgentInterface enables auto-scroll
- [ ] AgentInterface shows usage stats
- [ ] AgentInterface integrates MessageEditor
- [ ] AgentInterface integrates ModelSelector
- [ ] AgentInterface shows thinking toggle
- [ ] Settings dialog opens
- [ ] Settings dialog saves transport mode
- [ ] Settings dialog saves proxy URL
- [ ] Settings dialog opens API keys dialog
- [ ] Header settings button works

### Phase 6: Optional Features
- [ ] Debug view shows request details
- [ ] Debug view shows response details
- [ ] Debug view shows timing info
- [ ] Debug view formats ChatML
- [ ] Sessions can be saved
- [ ] Sessions can be loaded
- [ ] Sessions can be listed
- [ ] Sessions can be deleted
- [ ] System prompt can be edited

---

## Dependencies to Install

```bash
# If not already installed
npm install highlight.js  # For DebugView (optional)
```

---

## Estimated Complexity

| Phase | Files | LOC (approx) | Complexity | Time Estimate |
|-------|-------|--------------|------------|---------------|
| Phase 1 | 5 | ~800 | Medium | 4-6 hours |
| Phase 2 | 10 | ~400 | Low-Medium | 3-4 hours |
| Phase 3 | 6 | ~600 | High | 6-8 hours |
| Phase 4 | 5 | ~500 | Medium-High | 5-7 hours |
| Phase 5 | 4 | ~400 | Medium | 4-5 hours |
| Phase 6 | 3 | ~400 | Low | 2-3 hours |
| **TOTAL** | **33** | **~3100** | - | **24-33 hours** |

---

## Success Criteria

The port is complete when:

1. ✅ User can send messages with text and attachments
2. ✅ Messages stream in real-time with proper rendering
3. ✅ Tool calls execute and display results
4. ✅ Both direct and proxy transports work
5. ✅ Settings can be configured and persisted
6. ✅ Usage stats are tracked and displayed
7. ✅ Extension works in both Chrome and Firefox
8. ✅ All TypeScript types compile without errors
9. ✅ No console errors in normal operation
10. ✅ UI is responsive and performs well

---

## Notes for New Session

If starting a new session, key context:

1. **Extension structure**: Browser extension in `packages/browser-extension/`
2. **Source codebase**: `genai-workshop-new/src/app/`
3. **UI framework**: LitElement with `@mariozechner/mini-lit` package
4. **AI package**: `@mariozechner/pi-ai` for LLM interactions
5. **Icons**: Using lucide instead of custom icon set
6. **i18n**: All UI strings must be in i18n.ts (English + German)
7. **Storage**: chrome.storage.local for all persistence
8. **TypeScript**: `useDefineForClassFields: false` required
9. **Custom elements**: Must use registration guards
10. **Build**: `npm run build:chrome` and `npm run build:firefox`

**Critical files to reference**:
- `packages/browser-extension/tsconfig.json` - TS config
- `packages/browser-extension/src/utils/i18n.ts` - i18n strings
- `packages/browser-extension/src/state/KeyStore.ts` - API key storage
- `packages/browser-extension/src/dialogs/ApiKeysDialog.ts` - API key UI
- `genai-workshop-new/src/app/AgentInterface.ts` - Reference implementation
- `genai-workshop-new/src/app/state/agent-session.ts` - State management reference

**Key architectural decisions**:
- Single AgentSession per chat
- Transport is pluggable (direct or proxy)
- Tools are registered in a global registry
- Message rendering is separated: stable (MessageList) vs streaming (StreamingMessageContainer)
- All components use light DOM (`createRenderRoot() { return this; }`)
