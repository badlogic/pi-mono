# Pi Reader Browser Extension

A cross-browser extension that provides an AI-powered reading assistant in a side panel (Chrome/Edge) or sidebar (Firefox), built with mini-lit components and Tailwind CSS v4.

## Browser Support

- **Chrome/Edge** - Uses Side Panel API (Manifest V3)
- **Firefox** - Uses Sidebar Action API (Manifest V2)
- **Opera** - Sidebar support (untested but should work with Firefox manifest)

## Architecture

### High-Level Overview

The extension is a full-featured AI chat interface that runs in your browser's side panel/sidebar. It can communicate with AI providers in two ways:

1. **Direct Mode** (default) - Calls AI provider APIs directly from the browser using API keys stored locally
2. **Proxy Mode** - Routes requests through a proxy server using an auth token

**Browser Adaptation:**
- **Chrome/Edge** - Side Panel API for dedicated panel UI, Manifest V3
- **Firefox** - Sidebar Action API for sidebar UI, Manifest V2
- **Page Content Access** - Uses `chrome.scripting.executeScript` to extract page text
- **Cross-browser APIs** - Uses `browser.*` (Firefox) and `chrome.*` (Chrome/Edge) via runtime detection

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
├── Components (reusable utilities)
│   └── components/
│       └── SandboxedIframe.ts    # Sandboxed HTML renderer with console capture
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
│   │   ├── KeyStore.ts           # Cross-browser API key storage
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
│   │   ├── browser-javascript.ts # Execute JS in current tab
│   │   ├── renderers/            # Custom tool UI renderers
│   │   │   ├── DefaultRenderer.ts    # Fallback for unknown tools
│   │   │   ├── CalculateRenderer.ts  # Calculator tool UI
│   │   │   ├── GetCurrentTimeRenderer.ts
│   │   │   └── BashRenderer.ts       # Bash command execution UI
│   │   └── artifacts/            # Artifact tools (HTML, Mermaid, etc.)
│   │       ├── ArtifactElement.ts    # Base class for artifacts
│   │       ├── HtmlArtifact.ts       # HTML artifact with sandboxed preview
│   │       └── MermaidArtifact.ts    # Mermaid diagram rendering
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
    ├── sandbox.html              # Sandboxed page for artifact HTML
    ├── sandbox.js                # Sandbox environment setup
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

- **User messages**: Edit `UserMessage` in [src/Messages.ts](src/Messages.ts)
- **Assistant messages**: Edit `AssistantMessage` in [src/Messages.ts](src/Messages.ts)
- **Tool call cards**: Edit `ToolMessage` in [src/Messages.ts](src/Messages.ts)
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
2. Add API key configuration in [src/dialogs/ApiKeysDialog.ts](src/dialogs/ApiKeysDialog.ts):
   - Add provider to `PROVIDERS` array
   - Add test model to `TEST_MODELS` object
3. Users can then select models via the model selector

**No code changes needed** - the extension auto-discovers all models from `@mariozechner/pi-ai`.

---

### "I want to modify the transport layer"

**Transport** determines how requests reach AI providers:

#### Direct Mode (Default)
- **File**: [src/state/transports/DirectTransport.ts](src/state/transports/DirectTransport.ts)
- **How it works**: Gets API keys from `KeyStore` → calls provider APIs directly
- **When to use**: Local development, no proxy server
- **Configuration**: API keys stored in Chrome local storage

#### Proxy Mode
- **File**: [src/state/transports/ProxyTransport.ts](src/state/transports/ProxyTransport.ts)
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

**System prompts** guide the AI's behavior. Change in [src/ChatPanel.ts](src/ChatPanel.ts):

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

**Attachment processing** happens in [src/utils/attachment-utils.ts](src/utils/attachment-utils.ts):

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

3. **Update accepted types** in [src/MessageEditor.ts](src/MessageEditor.ts):
   ```typescript
   acceptedTypes = "image/*,application/pdf,.myext,...";
   ```

4. **Optional: Add preview support** in [src/AttachmentOverlay.ts](src/AttachmentOverlay.ts)

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

Page content extraction is in [src/sidepanel.ts](src/sidepanel.ts):

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
- [src/state/transports/DirectTransport.ts](src/state/transports/DirectTransport.ts) - Transport implementation
- [src/state/KeyStore.ts](src/state/KeyStore.ts) - Cross-browser API key storage
- [src/dialogs/ApiKeysDialog.ts](src/dialogs/ApiKeysDialog.ts) - API key UI

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
See [src/state/transports/ProxyTransport.ts](src/state/transports/ProxyTransport.ts) for full event parsing logic.

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
│   ├── sidepanel.ts            # Main side panel app with hot reload
│   ├── sandbox.html            # Sandboxed page for artifact HTML rendering
│   └── sandbox.js              # Sandbox environment setup (console capture, helpers)
├── scripts/
│   ├── build.mjs               # esbuild bundler configuration
│   └── dev-server.mjs          # WebSocket server for hot reloading
├── manifest.chrome.json        # Chrome/Edge manifest (MV3)
├── manifest.firefox.json       # Firefox manifest (MV2)
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

### [src/sidepanel.ts](src/sidepanel.ts)
Main application logic:
- Extracts page content via `chrome.scripting.executeScript`
- Manages chat UI with mini-lit components
- Handles WebSocket connection for hot reload
- Direct AI API calls (no background worker needed)

### [src/app.css](src/app.css)
Tailwind v4 configuration:
- Imports Claude theme from mini-lit
- Uses `@source` directive to scan mini-lit components
- Compiled to `dist/app.css` during build

### [scripts/build.mjs](scripts/build.mjs)
Build configuration:
- Uses esbuild for fast TypeScript bundling
- Copies static files (HTML, manifest, icons, sandbox files)
- Supports watch mode for development
- Browser-specific builds (Chrome MV3, Firefox MV2)

### [scripts/dev-server.mjs](scripts/dev-server.mjs)
Hot reload server:
- WebSocket server on port 8765
- Watches `dist/` directory for changes
- Sends reload messages to connected clients

### [src/state/KeyStore.ts](src/state/KeyStore.ts)
Cross-browser API key storage:
- Detects browser environment (`browser.storage` vs `chrome.storage`)
- Stores API keys in local storage
- Used by DirectTransport for provider authentication

### [src/components/SandboxedIframe.ts](src/components/SandboxedIframe.ts)
Reusable sandboxed HTML renderer:
- Creates sandboxed iframe with `allow-scripts` and `allow-modals`
- Injects runtime scripts using TypeScript `.toString()` pattern
- Captures console logs and errors via `postMessage`
- Provides attachment helper functions to sandboxed content
- Emits `@console` and `@execution-complete` events

### [src/tools/artifacts/HtmlArtifact.ts](src/tools/artifacts/HtmlArtifact.ts)
HTML artifact renderer:
- Uses `SandboxedIframe` component for secure HTML preview
- Toggle between preview and code view
- Displays console logs and errors in collapsible panel
- Supports attachments (accessible via `listFiles()`, `readTextFile()`, etc.)

### [src/sandbox.html](src/sandbox.html) and [src/sandbox.js](src/sandbox.js)
Sandboxed page for artifact HTML:
- Declared in manifest `sandbox.pages` array
- Has permissive CSP allowing external scripts and `eval()`
- Currently used as fallback (most functionality moved to `SandboxedIframe`)
- Provides helper functions for file access and console capture

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

---

## Content Security Policy (CSP) Issues and Workarounds

Browser extensions face strict Content Security Policy restrictions that affect dynamic code execution. This section documents these limitations and the solutions implemented in this extension.

### Overview of CSP Restrictions

**Content Security Policy** prevents unsafe operations like `eval()`, `new Function()`, and inline scripts to protect against XSS attacks. Browser extensions have even stricter CSP rules than regular web pages.

### CSP in Extension Pages (Side Panel, Popup, Options)

**Problem:** Extension pages (like our side panel) cannot use `eval()` or `new Function()` due to manifest CSP restrictions.

**Chrome Manifest V3:**
```json
"content_security_policy": {
  "extension_pages": "script-src 'self'; object-src 'self'"
}
```
- `'unsafe-eval'` is **explicitly forbidden** in MV3 extension pages
- Attempting to add it causes extension load failure: `"Insecure CSP value "'unsafe-eval'" in directive 'script-src'"`

**Firefox Manifest V2:**
```json
"content_security_policy": "script-src 'self' 'wasm-unsafe-eval' ...; object-src 'self'"
```
- `'unsafe-eval'` is **forbidden** in Firefox MV2 `script-src`
- Only `'wasm-unsafe-eval'` is allowed (for WebAssembly)

**Impact on Tool Parameter Validation:**

The `@mariozechner/pi-ai` package uses AJV (Another JSON Schema Validator) to validate tool parameters. AJV compiles JSON schemas into validation functions using `new Function()`, which violates extension CSP.

**Solution:** Detect browser extension environment and disable AJV validation:

```typescript
// @packages/ai/src/utils/validation.ts
const isBrowserExtension = typeof globalThis !== "undefined" &&
  (globalThis as any).chrome?.runtime?.id !== undefined;

let ajv: any = null;
if (!isBrowserExtension) {
  try {
    ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
  } catch (e) {
    console.warn("AJV validation disabled due to CSP restrictions");
  }
}

export function validateToolArguments(tool: Tool, toolCall: ToolCall): any {
  // Skip validation in browser extension (CSP prevents AJV from working)
  if (!ajv || isBrowserExtension) {
    return toolCall.arguments;  // Trust the LLM
  }
  // ... normal validation
}
```

**Call chain:**
1. `@packages/ai/src/utils/validation.ts` - Validation logic
2. `@packages/ai/src/agent/agent-loop.ts` - Calls `validateToolArguments()` in `executeToolCalls()`
3. `@packages/browser-extension/src/state/transports/DirectTransport.ts` - Uses agent loop
4. `@packages/browser-extension/src/state/agent-session.ts` - Coordinates transport

**Result:** Tool parameter validation is **disabled in browser extensions**. We trust the LLM to generate valid parameters.

---

### CSP in Sandboxed Pages (HTML Artifacts)

**Problem:** HTML artifacts need to render user-generated HTML with external scripts (e.g., Chart.js, D3.js) and execute dynamic code.

**Solution:** Use sandboxed pages with permissive CSP.

#### How Sandboxed Pages Work

**Chrome Manifest V3:**
```json
{
  "sandbox": {
    "pages": ["sandbox.html"]
  },
  "content_security_policy": {
    "sandbox": "sandbox allow-scripts allow-modals; script-src 'self' 'unsafe-inline' 'unsafe-eval' https: http:; ..."
  }
}
```

**Firefox Manifest V2:**
- MV2 doesn't support `sandbox.pages` with external script hosts in CSP
- We switched to MV2 to whitelist CDN hosts in main CSP:
```json
{
  "content_security_policy": "script-src 'self' 'wasm-unsafe-eval' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://unpkg.com https://cdn.skypack.dev; ..."
}
```

#### SandboxedIframe Component

The [src/components/SandboxedIframe.ts](src/components/SandboxedIframe.ts) component provides a reusable way to render HTML artifacts:

**Key implementation details:**

1. **Runtime Script Injection:** Instead of relying on `sandbox.html`, we inject runtime scripts directly into the HTML using TypeScript `.toString()`:

```typescript
private injectRuntimeScripts(htmlContent: string): string {
  // Define runtime function in TypeScript with proper typing
  const runtimeFunction = function (artifactId: string, attachments: any[]) {
    // Console capture
    window.__artifactLogs = [];
    const originalConsole = { log: console.log, error: console.error, /* ... */ };

    ['log', 'error', 'warn', 'info'].forEach((method) => {
      console[method] = function (...args: any[]) {
        const text = args.map(arg => /* stringify */).join(' ');
        window.__artifactLogs.push({ type: method === 'error' ? 'error' : 'log', text });
        window.parent.postMessage({ type: 'console', method, text, artifactId }, '*');
        originalConsole[method].apply(console, args);
      };
    });

    // Error handlers
    window.addEventListener('error', (e: ErrorEvent) => { /* ... */ });
    window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => { /* ... */ });

    // Attachment helpers
    window.listFiles = () => attachments.map(/* ... */);
    window.readTextFile = (id) => { /* ... */ };
    window.readBinaryFile = (id) => { /* ... */ };
  };

  // Convert function to string and inject
  const runtimeScript = `
    <script>
    (${runtimeFunction.toString()})(${JSON.stringify(this.artifactId)}, ${JSON.stringify(this.attachments)});
    </script>
  `;

  // Inject at start of <head> or beginning of HTML
  return htmlContent.replace(/<head[^>]*>/i, (m) => `${m}${runtimeScript}`) || runtimeScript + htmlContent;
}
```

2. **Sandbox Attributes:** The iframe uses:
   - `sandbox="allow-scripts allow-modals"` - **NOT** `allow-same-origin`
   - Removing `allow-same-origin` prevents sandboxed content from bypassing the sandbox
   - `postMessage` still works without `allow-same-origin`

3. **Communication:** Parent window listens for messages from iframe:
   - `{type: "console", method, text, artifactId}` - Console logs
   - `{type: "execution-complete", logs, artifactId}` - Final logs after page load

4. **Usage in HtmlArtifact:**

```typescript
// src/tools/artifacts/HtmlArtifact.ts
render() {
  return html`
    <sandbox-iframe
      class="flex-1"
      .content=${this._content}
      .artifactId=${this.filename}
      .attachments=${this.attachments}
      @console=${this.handleConsoleEvent}
      @execution-complete=${this.handleExecutionComplete}
    ></sandbox-iframe>
  `;
}
```

**Files involved:**
- [src/components/SandboxedIframe.ts](src/components/SandboxedIframe.ts) - Reusable sandboxed iframe component
- [src/tools/artifacts/HtmlArtifact.ts](src/tools/artifacts/HtmlArtifact.ts) - Uses SandboxedIframe
- [src/sandbox.html](src/sandbox.html) - Fallback sandboxed page (mostly unused now)
- [src/sandbox.js](src/sandbox.js) - Sandbox environment (mostly unused now)
- [manifest.chrome.json](manifest.chrome.json) - Chrome MV3 sandbox CSP
- [manifest.firefox.json](manifest.firefox.json) - Firefox MV2 CDN whitelist

---

### CSP in Injected Tab Scripts (browser-javascript Tool)

**Problem:** The `browser-javascript` tool executes AI-generated JavaScript in the current tab. Many sites have strict CSP that blocks `eval()` and `new Function()`.

**Example - Gmail's CSP:**
```
script-src 'report-sample' 'nonce-...' 'unsafe-inline' 'strict-dynamic' https: http:;
require-trusted-types-for 'script';
```

Gmail uses **Trusted Types** (`require-trusted-types-for 'script'`) which blocks all string-to-code conversions, including:
- `eval(code)`
- `new Function(code)`
- `setTimeout(code)` (with string argument)
- Setting `innerHTML`, `outerHTML`, `<script>.src`, etc.

**Attempted Solutions:**

1. **Script Execution Worlds:** Chrome provides two worlds for `chrome.scripting.executeScript`:
   - `MAIN` - Runs in page context, subject to page CSP
   - `ISOLATED` - Runs in extension context, has permissive CSP

   **Current implementation uses `ISOLATED` world:**
   ```typescript
   // src/tools/browser-javascript.ts
   const results = await browser.scripting.executeScript({
     target: { tabId: tab.id },
     world: "ISOLATED",  // Permissive CSP
     func: (code: string) => {
       try {
         const asyncFunc = new Function(`return (async () => { ${code} })()`);
         return asyncFunc();
       } catch (error) {
         // ... error handling
       }
     },
     args: [args.code]
   });
   ```

   **Why ISOLATED world:**
   - Has permissive CSP (allows `eval()`, `new Function()`)
   - Can still access full DOM
   - Bypasses page CSP for the injected function itself

2. **Using `new Function()` instead of `eval()`:**
   - `new Function(code)` is slightly more permissive than `eval(code)`
   - But still blocked by Trusted Types policy

**Current Limitation:**

Even with `ISOLATED` world and `new Function()`, sites like Gmail with Trusted Types **still block execution**:

```
Error: Refused to evaluate a string as JavaScript because this document requires 'Trusted Type' assignment.
```

**Why it still fails:** The Trusted Types policy applies to the entire document, including isolated worlds. Any attempt to convert strings to code is blocked.

**Workaround Options:**

1. **Accept the limitation:** Document that `browser-javascript` won't work on sites with Trusted Types (Gmail, Google Docs, etc.)

2. **Modify page CSP via declarativeNetRequest API:**
   - Use `chrome.declarativeNetRequest` to strip `require-trusted-types-for` from response headers
   - Requires `declarativeNetRequest` permission
   - Needs an allowlist of sites (don't want to disable security everywhere)
   - **Implementation example:**
   ```typescript
   // In background.ts or new csp-modifier.ts
   chrome.declarativeNetRequest.updateDynamicRules({
     addRules: [{
       id: 1,
       priority: 1,
       action: {
         type: "modifyHeaders",
         responseHeaders: [
           { header: "content-security-policy", operation: "remove" },
           { header: "content-security-policy-report-only", operation: "remove" }
         ]
       },
       condition: {
         urlFilter: "*://mail.google.com/*",  // Example: Gmail
         resourceTypes: ["main_frame", "sub_frame"]
       }
     }],
     removeRuleIds: [1]  // Remove previous rule
   });
   ```

3. **Site-specific allowlist UI:**
   - Add settings dialog for CSP modification
   - User enables specific sites
   - Extension modifies CSP only for allowed sites
   - Clear warning about security implications

**Current Status:** The `browser-javascript` tool works on most sites but **fails on sites with Trusted Types** (Gmail, Google Workspace, some banking sites, etc.). The CSP modification approach is not currently implemented.

**Files involved:**
- [src/tools/browser-javascript.ts](src/tools/browser-javascript.ts) - Tab script injection tool
- [manifest.chrome.json](manifest.chrome.json) - Requires `scripting` and `activeTab` permissions
- (Future) `src/state/csp-modifier.ts` - Would implement declarativeNetRequest CSP modification

---

### Summary of CSP Issues and Solutions

| Scope | Problem | Solution | Limitations |
|-------|---------|----------|-------------|
| **Extension pages** (side panel) | Can't use `eval()` / `new Function()` | Detect extension environment, disable AJV validation | Tool parameters not validated, trust LLM output |
| **HTML artifacts** | Need to render dynamic HTML with external scripts | Use sandboxed pages with permissive CSP, `SandboxedIframe` component | Works well, no significant limitations |
| **Tab injection** | Sites with strict CSP block code execution | Use `ISOLATED` world with `new Function()` | Still blocked by Trusted Types, affects Gmail and similar sites |
| **Tab injection** (future) | Trusted Types blocking | Modify CSP via `declarativeNetRequest` with allowlist | Requires user opt-in, reduces site security |

### Best Practices for Extension Development

1. **Always detect extension environment** before using APIs that require CSP permissions
2. **Use sandboxed pages** for any user-generated HTML or untrusted content
3. **Inject runtime scripts via `.toString()`** instead of relying on sandbox.html (better control)
4. **Use `ISOLATED` world** for tab script execution when possible
5. **Document CSP limitations** for tools that inject code into tabs
6. **Consider CSP modification** only as last resort with explicit user consent

### Debugging CSP Issues

**Common error messages:**

1. **Extension pages:**
   ```
   Refused to evaluate a string as JavaScript because 'unsafe-eval' is not an allowed source of script
   ```
   → Don't use `eval()` / `new Function()` in extension pages, use sandboxed pages instead

2. **Sandboxed iframe:**
   ```
   Content Security Policy: The page's settings blocked an inline script (script-src)
   ```
   → Check iframe `sandbox` attribute (must include `allow-scripts`)
   → Check manifest sandbox CSP includes `'unsafe-inline'`

3. **Tab injection:**
   ```
   Refused to evaluate a string as JavaScript because this document requires 'Trusted Type' assignment
   ```
   → Site uses Trusted Types, `browser-javascript` tool won't work
   → Consider CSP modification with user consent

**Tools for debugging:**

- Chrome DevTools → Console (see CSP errors)
- Chrome DevTools → Network → Response Headers (see page CSP)
- `chrome://extensions/` → Inspect views: side panel (check extension page CSP)
- Firefox: `about:debugging` → Inspect (check console for CSP violations)

---

This CSP section should help both developers and LLMs understand the security constraints when working on extension features, especially those involving dynamic code execution or user-generated content.

## Known Bugs

- **PersistentStorageDialog**: Currently broken and commented out in sidepanel.ts. The dialog for requesting persistent storage does not work correctly and needs to be fixed.
