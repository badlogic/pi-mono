# Pi Reader Browser Extension

A cross-browser extension that provides an AI-powered reading assistant in a side panel (Chrome/Edge) or sidebar (Firefox), built with mini-lit components and Tailwind CSS v4.

## Browser Support

- **Chrome/Edge** - Uses Side Panel API (Manifest V3)
- **Firefox** - Uses Sidebar Action API (Manifest V3)
- **Opera** - Sidebar support (untested but should work with Firefox manifest)

## Architecture

### High-Level Overview

The extension is a full-featured AI chat interface that runs in your browser's side panel/sidebar. It can communicate with AI providers in two ways:

1. **Direct Mode** (default) - Calls AI provider APIs directly from the browser using API keys stored locally
2. **Proxy Mode** - Routes requests through a proxy server using an auth token

**Browser Adaptation:**
- **Chrome/Edge** - Side Panel API for dedicated panel UI
- **Firefox** - Sidebar Action API for sidebar UI
- **Page Content Access** - Uses `chrome.scripting.executeScript` to extract page text

### Core Architecture Layers

```
┌─────────────────────────────────────────────────────────────┐
│  UI Layer (sidepanel.ts)                                    │
│  ├─ Header (theme toggle, settings)                         │
│  └─ ChatPanel                                                │
│      └─ AgentInterface (main chat UI)                       │
│          ├─ MessageList (stable messages)                   │
│          ├─ StreamingMessageContainer (live updates)        │
│          └─ MessageEditor (input + attachments)             │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  State Layer (state/)                                        │
│  └─ AgentSession                                             │
│      ├─ Manages conversation state                          │
│      ├─ Coordinates transport                                │
│      └─ Handles tool execution                               │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  Transport Layer (state/transports/)                         │
│  ├─ DirectTransport (uses KeyStore for API keys)            │
│  └─ ProxyTransport (uses auth token + proxy server)         │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  AI Provider APIs / Proxy Server                             │
│  (Anthropic, OpenAI, Google, etc.)                          │
└─────────────────────────────────────────────────────────────┘
```

### Directory Structure by Responsibility

```
src/
├── UI Components (what users see)
│   ├── sidepanel.ts              # App entry point, header
│   ├── ChatPanel.ts              # Main chat container, creates AgentSession
│   ├── AgentInterface.ts         # Complete chat UI (messages + input)
│   ├── MessageList.ts            # Renders stable messages
│   ├── StreamingMessageContainer.ts  # Handles streaming updates
│   ├── Messages.ts               # Message components (user, assistant, tool)
│   ├── MessageEditor.ts          # Input field with attachments
│   ├── ConsoleBlock.ts           # Console-style output display
│   ├── AttachmentTile.ts         # Attachment preview thumbnails
│   ├── AttachmentOverlay.ts     # Full-screen attachment viewer
│   └── ModeToggle.ts             # Toggle between document/text view
│
├── Dialogs (modal interactions)
│   ├── dialogs/
│   │   ├── DialogBase.ts         # Base class for all dialogs
│   │   ├── ModelSelector.ts      # Select AI model
│   │   ├── ApiKeysDialog.ts      # Manage API keys (for direct mode)
│   │   └── PromptDialog.ts       # Simple text input dialog
│
├── State Management (business logic)
│   ├── state/
│   │   ├── agent-session.ts      # Core state manager (pub/sub pattern)
│   │   ├── KeyStore.ts           # API key storage (Chrome local storage)
│   │   └── transports/
│   │       ├── types.ts          # Transport interface definitions
│   │       ├── DirectTransport.ts   # Direct API calls
│   │       └── ProxyTransport.ts    # Proxy server calls
│
├── Tools (AI function calling)
│   ├── tools/
│   │   ├── types.ts              # ToolRenderer interface
│   │   ├── renderer-registry.ts  # Global tool renderer registry
│   │   ├── index.ts              # Tool exports and registration
│   │   └── renderers/            # Custom tool UI renderers
│   │       ├── DefaultRenderer.ts    # Fallback for unknown tools
│   │       ├── CalculateRenderer.ts  # Calculator tool UI
│   │       ├── GetCurrentTimeRenderer.ts
│   │       └── BashRenderer.ts       # Bash command execution UI
│
├── Utilities (shared helpers)
│   └── utils/
│       ├── attachment-utils.ts   # PDF, Office, image processing
│       ├── auth-token.ts         # Proxy auth token management
│       ├── format.ts             # Token usage, cost formatting
│       └── i18n.ts               # Internationalization (EN + DE)
│
└── Entry Points (browser integration)
    ├── background.ts             # Service worker (opens side panel)
    ├── sidepanel.html            # HTML entry point
    └── live-reload.ts            # Hot reload during development
```

---

## Common Development Tasks

### "I want to add a new AI tool"

**Tools** are functions the AI can call (e.g., calculator, web search, code execution). Here's how to add one:

#### 1. Define the Tool (use `@mariozechner/pi-ai`)

Tools come from the `@mariozechner/pi-ai` package. Use existing tools or create custom ones:

```typescript
// src/tools/my-custom-tool.ts
import type { AgentTool } from "@mariozechner/pi-ai";

export const myCustomTool: AgentTool = {
  name: "my_custom_tool",
  label: "My Custom Tool",
  description: "Does something useful",
  parameters: {
    type: "object",
    properties: {
      input: { type: "string", description: "Input parameter" }
    },
    required: ["input"]
  },
  execute: async (params) => {
    // Your tool logic here
    const result = processInput(params.input);
    return {
      output: result,
      details: { /* any structured data */ }
    };
  }
};
```

#### 2. Create a Custom Renderer (Optional)

Renderers control how the tool appears in the chat. If you don't create one, `DefaultRenderer` will be used.

```typescript
// src/tools/renderers/MyCustomRenderer.ts
import { html } from "@mariozechner/mini-lit";
import type { ToolResultMessage } from "@mariozechner/pi-ai";
import type { ToolRenderer } from "../types.js";

export class MyCustomRenderer implements ToolRenderer {
  renderParams(params: any, isStreaming?: boolean) {
    // Show tool call parameters (e.g., "Searching for: <query>")
    return html`
      <div class="text-sm text-muted-foreground">
        ${isStreaming ? "Processing..." : `Input: ${params.input}`}
      </div>
    `;
  }

  renderResult(params: any, result: ToolResultMessage) {
    // Show tool result (e.g., search results, calculation output)
    if (result.isError) {
      return html`<div class="text-destructive">${result.output}</div>`;
    }
    return html`
      <div class="text-sm">
        <div class="font-medium">Result:</div>
        <div>${result.output}</div>
      </div>
    `;
  }
}
```

**Renderer Tips:**
- Use `ConsoleBlock` for command output (see `BashRenderer.ts`)
- Use `<code-block>` for code/JSON (from `@mariozechner/mini-lit`)
- Use `<markdown-block>` for markdown content
- Check `isStreaming` to show loading states

#### 3. Register the Tool and Renderer

```typescript
// src/tools/index.ts
import { myCustomTool } from "./my-custom-tool.js";
import { MyCustomRenderer } from "./renderers/MyCustomRenderer.js";
import { registerToolRenderer } from "./renderer-registry.js";

// Register the renderer
registerToolRenderer("my_custom_tool", new MyCustomRenderer());

// Export the tool so ChatPanel can use it
export { myCustomTool };
```

#### 4. Add Tool to ChatPanel

```typescript
// src/ChatPanel.ts
import { myCustomTool } from "./tools/index.js";

// In AgentSession constructor:
this.session = new AgentSession({
  initialState: {
    tools: [calculateTool, getCurrentTimeTool, myCustomTool], // Add here
    // ...
  }
});
```

**File Locations:**
- Tool definition: `src/tools/my-custom-tool.ts`
- Tool renderer: `src/tools/renderers/MyCustomRenderer.ts`
- Registration: `src/tools/index.ts` (register renderer)
- Integration: `src/ChatPanel.ts` (add to tools array)

---

### "I want to change how messages are displayed"

**Message components** control how conversations appear:

- **User messages**: Edit `UserMessage` in `src/Messages.ts`
- **Assistant messages**: Edit `AssistantMessage` in `src/Messages.ts`
- **Tool call cards**: Edit `ToolMessage` in `src/Messages.ts`
- **Markdown rendering**: Comes from `@mariozechner/mini-lit` (can't customize easily)
- **Code blocks**: Comes from `@mariozechner/mini-lit` (can't customize easily)

**Example: Change user message styling**

```typescript
// src/Messages.ts - in UserMessage component
render() {
  return html`
    <div class="py-4 px-4 border-l-4 border-primary bg-primary/5">
      <!-- Your custom styling here -->
      <markdown-block .content=${content}></markdown-block>
    </div>
  `;
}
```

---

### "I want to add a new model provider"

Models come from `@mariozechner/pi-ai`. The package supports:
- `anthropic` (Claude)
- `openai` (GPT)
- `google` (Gemini)
- `groq`, `cerebras`, `xai`, `openrouter`, etc.

**To add a provider:**

1. Ensure `@mariozechner/pi-ai` supports it (check package docs)
2. Add API key configuration in `src/dialogs/ApiKeysDialog.ts`:
   - Add provider to `PROVIDERS` array
   - Add test model to `TEST_MODELS` object
3. Users can then select models via the model selector

**No code changes needed** - the extension auto-discovers all models from `@mariozechner/pi-ai`.

---

### "I want to modify the transport layer"

**Transport** determines how requests reach AI providers:

#### Direct Mode (Default)
- **File**: `src/state/transports/DirectTransport.ts`
- **How it works**: Gets API keys from `KeyStore` → calls provider APIs directly
- **When to use**: Local development, no proxy server
- **Configuration**: API keys stored in Chrome local storage

#### Proxy Mode
- **File**: `src/state/transports/ProxyTransport.ts`
- **How it works**: Gets auth token → sends request to proxy server → proxy calls providers
- **When to use**: Want to hide API keys, centralized auth, usage tracking
- **Configuration**: Auth token stored in localStorage, proxy URL hardcoded

**Switch transport mode in ChatPanel:**

```typescript
// src/ChatPanel.ts
this.session = new AgentSession({
  transportMode: "direct", // or "proxy"
  authTokenProvider: async () => getAuthToken(), // Only needed for proxy
  // ...
});
```

**Proxy Server Requirements:**
- Must accept POST to `/api/stream` endpoint
- Request format: `{ model, context, options }`
- Response format: SSE stream with delta events
- See `ProxyTransport.ts` for expected event types

**To add a new transport:**

1. Create `src/state/transports/MyTransport.ts`
2. Implement `AgentTransport` interface:
   ```typescript
   async *run(userMessage, cfg, signal): AsyncIterable<AgentEvent>
   ```
3. Register in `ChatPanel.ts` constructor

---

### "I want to change the system prompt"

**System prompts** guide the AI's behavior. Change in `ChatPanel.ts`:

```typescript
// src/ChatPanel.ts
this.session = new AgentSession({
  initialState: {
    systemPrompt: "You are a helpful AI assistant specialized in code review.",
    // ...
  }
});
```

Or make it dynamic:

```typescript
// Read from storage, settings dialog, etc.
const systemPrompt = await chrome.storage.local.get("system-prompt");
```

---

### "I want to add attachment support for a new file type"

**Attachment processing** happens in `src/utils/attachment-utils.ts`:

1. **Add file type detection** in `loadAttachment()`:
   ```typescript
   if (mimeType === "application/my-format" || fileName.endsWith(".myext")) {
     const { extractedText } = await processMyFormat(arrayBuffer, fileName);
     return { id, type: "document", fileName, mimeType, content, extractedText };
   }
   ```

2. **Add processor function**:
   ```typescript
   async function processMyFormat(buffer: ArrayBuffer, fileName: string) {
     // Extract text from your format
     const text = extractTextFromMyFormat(buffer);
     return { extractedText: `<myformat filename="${fileName}">\n${text}\n</myformat>` };
   }
   ```

3. **Update accepted types** in `MessageEditor.ts`:
   ```typescript
   acceptedTypes = "image/*,application/pdf,.myext,...";
   ```

4. **Optional: Add preview support** in `AttachmentOverlay.ts`

**Supported formats:**
- Images: All image/* (preview support)
- PDF: Text extraction + thumbnail generation
- Office: DOCX, PPTX, XLSX (text extraction)
- Text: .txt, .md, .json, .xml, etc.

---

### "I want to customize the UI theme"

The extension uses the **Claude theme** from `@mariozechner/mini-lit`. Colors are defined via CSS variables:

**Option 1: Override theme variables**
```css
/* src/app.css */
@layer base {
  :root {
    --primary: 210 100% 50%;  /* Custom blue */
    --radius: 0.5rem;
  }
}
```

**Option 2: Use a different mini-lit theme**
```css
/* src/app.css */
@import "@mariozechner/mini-lit/themes/default.css"; /* Instead of claude.css */
```

**Available variables:**
- `--background`, `--foreground` - Base colors
- `--card`, `--card-foreground` - Card backgrounds
- `--primary`, `--primary-foreground` - Primary actions
- `--muted`, `--muted-foreground` - Secondary elements
- `--accent`, `--accent-foreground` - Hover states
- `--destructive` - Error/delete actions
- `--border`, `--input` - Border colors
- `--radius` - Border radius

---

### "I want to add a new settings option"

Settings currently managed via dialogs. To add persistent settings:

#### 1. Create storage helpers

```typescript
// src/utils/config.ts (create this file)
export async function getMySetting(): Promise<string> {
  const result = await chrome.storage.local.get("my-setting");
  return result["my-setting"] || "default-value";
}

export async function setMySetting(value: string): Promise<void> {
  await chrome.storage.local.set({ "my-setting": value });
}
```

#### 2. Create or extend settings dialog

```typescript
// src/dialogs/SettingsDialog.ts (create this file, similar to ApiKeysDialog)
// Add UI for your setting
// Call getMySetting() / setMySetting() on save
```

#### 3. Open from header

```typescript
// src/sidepanel.ts - in settings button onClick
SettingsDialog.open();
```

#### 4. Use in ChatPanel

```typescript
// src/ChatPanel.ts
const mySetting = await getMySetting();
this.session = new AgentSession({
  initialState: { /* use mySetting */ }
});
```

---

### "I want to access the current page content"

Page content extraction is in `sidepanel.ts`:

```typescript
// Example: Get page text
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const results = await chrome.scripting.executeScript({
  target: { tabId: tab.id },
  func: () => document.body.innerText,
});
const pageText = results[0].result;
```

**To use in chat:**
1. Extract page content in `ChatPanel`
2. Add to system prompt or first user message
3. Or create a tool that reads page content

**Permissions required:**
- `activeTab` - Access current tab
- `scripting` - Execute scripts in pages
- Already configured in `manifest.*.json`

---

## Transport Modes Explained

### Direct Mode (Default)

**Flow:**
```
Browser Extension
  → KeyStore (get API key)
  → DirectTransport
  → Provider API (Anthropic/OpenAI/etc.)
  → Stream response back
```

**Pros:**
- No external dependencies
- Lower latency (direct connection)
- Works offline for API key management
- Full control over requests

**Cons:**
- API keys stored in browser (secure, but local)
- Each user needs their own API keys
- CORS restrictions (some providers may not work)
- Can't track usage centrally

**Setup:**
1. Open extension → Settings → Manage API Keys
2. Add keys for desired providers (Anthropic, OpenAI, etc.)
3. Select model and start chatting

**Files involved:**
- `src/state/transports/DirectTransport.ts` - Transport implementation
- `src/state/KeyStore.ts` - API key storage
- `src/dialogs/ApiKeysDialog.ts` - API key UI

---

### Proxy Mode

**Flow:**
```
Browser Extension
  → Auth Token (from localStorage)
  → ProxyTransport
  → Proxy Server (https://genai.mariozechner.at or custom)
  → Provider API
  → Stream response back through proxy
```

**Pros:**
- No API keys in browser
- Centralized auth/usage tracking
- Can implement rate limiting, quotas
- Custom logic server-side
- No CORS issues

**Cons:**
- Requires proxy server setup
- Additional network hop (latency)
- Dependency on proxy availability
- Need to manage auth tokens

**Setup:**
1. Get auth token from proxy server admin
2. Extension prompts for token on first use
3. Token stored in localStorage
4. Start chatting (proxy handles provider APIs)

**Proxy URL Configuration:**
Currently hardcoded in `ProxyTransport.ts`:
```typescript
const PROXY_URL = "https://genai.mariozechner.at";
```

To make configurable:
1. Add storage helper in `utils/config.ts`
2. Add UI in SettingsDialog
3. Pass to ProxyTransport constructor

**Proxy Server Requirements:**

The proxy server must implement:

**Endpoint:** `POST /api/stream`

**Request:**
```typescript
{
  model: Model,           // Provider + model ID
  context: Context,       // System prompt, messages, tools
  options: {
    temperature?: number,
    maxTokens?: number,
    reasoning?: string
  }
}
```

**Response:** SSE (Server-Sent Events) stream

**Event Types:**
```typescript
data: {"type":"start","partial":{...}}
data: {"type":"text_start","contentIndex":0}
data: {"type":"text_delta","contentIndex":0,"delta":"Hello"}
data: {"type":"text_end","contentIndex":0,"contentSignature":"..."}
data: {"type":"thinking_start","contentIndex":1}
data: {"type":"thinking_delta","contentIndex":1,"delta":"..."}
data: {"type":"toolcall_start","contentIndex":2,"id":"...","toolName":"..."}
data: {"type":"toolcall_delta","contentIndex":2,"delta":"..."}
data: {"type":"toolcall_end","contentIndex":2}
data: {"type":"done","reason":"stop","usage":{...}}
```

**Auth:** Bearer token in `Authorization` header

**Error Handling:**
- Return 401 for invalid auth → extension clears token and re-prompts
- Return 4xx/5xx with JSON: `{"error":"message"}`

**Reference Implementation:**
See `src/state/transports/ProxyTransport.ts` for full event parsing logic.

---

### Switching Between Modes

**At runtime** (in ChatPanel):
```typescript
const mode = await getTransportMode(); // "direct" or "proxy"
this.session = new AgentSession({
  transportMode: mode,
  authTokenProvider: mode === "proxy" ? async () => getAuthToken() : undefined,
  // ...
});
```

**Storage helpers** (create these):
```typescript
// src/utils/config.ts
export type TransportMode = "direct" | "proxy";

export async function getTransportMode(): Promise<TransportMode> {
  const result = await chrome.storage.local.get("transport-mode");
  return (result["transport-mode"] as TransportMode) || "direct";
}

export async function setTransportMode(mode: TransportMode): Promise<void> {
  await chrome.storage.local.set({ "transport-mode": mode });
}
```

**UI for switching** (create this):
```typescript
// src/dialogs/SettingsDialog.ts
// Radio buttons: ○ Direct (use API keys) / ○ Proxy (use auth token)
// On save: setTransportMode(), reload AgentSession
```

---

## Understanding mini-lit

Before working on the UI, read these files to understand the component library:

- `node_modules/@mariozechner/mini-lit/README.md` - Complete component documentation
- `node_modules/@mariozechner/mini-lit/llms.txt` - LLM-friendly component reference
- `node_modules/@mariozechner/mini-lit/dist/*.ts` - Source files for specific components

Key concepts:
- **Functional Components** - Stateless functions that return `TemplateResult` (Button, Badge, etc.)
- **Custom Elements** - Stateful LitElement classes (`<theme-toggle>`, `<markdown-block>`, etc.)
- **Reactive State** - Use `createState()` for reactive UI updates
- **Claude Theme** - We use the Claude theme from mini-lit

## Project Structure

```
packages/browser-extension/
├── src/
│   ├── app.css                 # Tailwind v4 entry point with Claude theme
│   ├── background.ts           # Service worker for opening side panel
│   ├── sidepanel.html          # Side panel HTML entry point
│   └── sidepanel.ts            # Main side panel app with hot reload
├── scripts/
│   ├── build.mjs               # esbuild bundler configuration
│   └── dev-server.mjs          # WebSocket server for hot reloading
├── manifest.chrome.json        # Chrome/Edge manifest
├── manifest.firefox.json       # Firefox manifest
├── icon-*.png                  # Extension icons
├── dist-chrome/                # Chrome build (git-ignored)
└── dist-firefox/               # Firefox build (git-ignored)
```

## Development Setup

### Prerequisites
1. Install dependencies from monorepo root:
   ```bash
   npm install
   ```

2. Build the extension:
   ```bash
   # Build for both browsers
   npm run build -w @mariozechner/pi-reader-extension

   # Or build for specific browser
   npm run build:chrome -w @mariozechner/pi-reader-extension
   npm run build:firefox -w @mariozechner/pi-reader-extension
   ```

3. Load the extension:

   **Chrome/Edge:**
   - Open `chrome://extensions/` or `edge://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select `packages/browser-extension/dist-chrome/`

   **Firefox:**
   - Open `about:debugging`
   - Click "This Firefox"
   - Click "Load Temporary Add-on"
   - Select any file in `packages/browser-extension/dist-firefox/`

### Development Workflow

1. **Start the dev server** (from monorepo root):
   ```bash
   # For Chrome development
   npm run dev -w @mariozechner/pi-reader-extension

   # For Firefox development
   npm run dev:firefox -w @mariozechner/pi-reader-extension
   ```

   This runs three processes in parallel:
   - **esbuild** - Watches and rebuilds TypeScript files
   - **Tailwind CSS v4** - Watches and rebuilds styles
   - **WebSocket server** - Watches dist/ and triggers extension reload

2. **Automatic reloading**:
   - Any change to source files triggers a rebuild
   - The WebSocket server detects dist/ changes
   - Side panel connects to `ws://localhost:8765`
   - Extension auto-reloads via `chrome.runtime.reload()`

3. **Open the side panel**:
   - Click the extension icon in Chrome toolbar
   - Or use Chrome's side panel button (top-right)

## Key Files

### `src/sidepanel.ts`
Main application logic:
- Extracts page content via `chrome.scripting.executeScript`
- Manages chat UI with mini-lit components
- Handles WebSocket connection for hot reload
- Direct AI API calls (no background worker needed)

### `src/app.css`
Tailwind v4 configuration:
- Imports Claude theme from mini-lit
- Uses `@source` directive to scan mini-lit components
- Compiled to `dist/app.css` during build

### `scripts/build.mjs`
Build configuration:
- Uses esbuild for fast TypeScript bundling
- Copies static files (HTML, manifest, icons)
- Supports watch mode for development

### `scripts/dev-server.mjs`
Hot reload server:
- WebSocket server on port 8765
- Watches `dist/` directory for changes
- Sends reload messages to connected clients

## Working with mini-lit Components

### Basic Usage
Read `../../mini-lit/llms.txt` and `../../mini-lit/README.md` in full. If in doubt, find the component in `../../mini-lit/src/` and read its source file in full.

### Tailwind Classes
All standard Tailwind utilities work, plus mini-lit's theme variables:
- `bg-background`, `text-foreground` - Theme-aware colors
- `bg-card`, `border-border` - Component backgrounds
- `text-muted-foreground` - Secondary text
- `bg-primary`, `text-primary-foreground` - Primary actions

## Troubleshooting

### Extension doesn't reload automatically
- Check WebSocket server is running (port 8765)
- Check console for connection errors
- Manually reload at `chrome://extensions/`

### Side panel doesn't open
- Check manifest permissions
- Ensure background service worker is loaded
- Try clicking extension icon directly

### Styles not updating
- Ensure Tailwind watcher is running
- Check `src/app.css` imports
- Clear Chrome extension cache

## Building for Production

```bash
npm run build -w @mariozechner/pi-reader-extension
```

This creates an optimized build in `dist/` without hot reload code.