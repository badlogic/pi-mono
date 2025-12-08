# @mariozechner/pi-web-ui

Reusable web UI components for building AI chat interfaces powered by [@mariozechner/pi-ai](../ai).

 Built with [mini-lit](https://github.com/badlogic/mini-lit) web components and Tailwind CSS v4.

## Features

- Modern Chat Interface - Complete chat UI with message history, streaming responses, and tool execution
- Tool Support - Built-in renderers for calculator, bash, time, and custom tools
- Attachments - PDF, Office documents, images with preview and text extraction
- Artifacts - HTML, SVG, Markdown, and text artifact rendering with sandboxed execution
- Pluggable Transports - Direct API calls or proxy server support
- Platform Agnostic - Works in browser extensions, web apps, VS Code extensions, Electron apps
- TypeScript - Full type safety with TypeScript

## Installation

```bash
npm install @mariozechner/pi-web-ui
```

## Quick Start

See the [example](./example) directory for a complete working application.

```typescript
import { Agent, ChatPanel, ProviderTransport, AppStorage,
         SessionIndexedDBBackend, setAppStorage } from '@mariozechner/pi-web-ui';
import { getModel } from '@mariozechner/pi-ai';
import '@mariozechner/pi-web-ui/app.css';

// Set up storage
const storage = new AppStorage({
  sessions: new SessionIndexedDBBackend('my-app-sessions'),
});
setAppStorage(storage);

// Create transport
const transport = new ProviderTransport();

// Create agent
const agent = new Agent({
  initialState: {
    systemPrompt: 'You are a helpful assistant.',
    model: getModel('anthropic', 'claude-sonnet-4-5-20250929'),
    thinkingLevel: 'off',
    messages: [],
    tools: [],
  },
  transport,
});

// Create chat panel and attach agent
const chatPanel = new ChatPanel();
await chatPanel.setAgent(agent);

document.body.appendChild(chatPanel);
```

**Run the example:**

```bash
cd example
npm install
npm run dev
```

## Core Components

### ChatPanel

The main chat interface component. Displays messages, handles input, and coordinates with the Agent.

```typescript
import { ChatPanel, ApiKeyPromptDialog } from '@mariozechner/pi-web-ui';

const chatPanel = new ChatPanel();

// Optional: Handle API key prompts
chatPanel.onApiKeyRequired = async (provider: string) => {
  return await ApiKeyPromptDialog.prompt(provider);
};

// Attach an agent
await chatPanel.setAgent(agent);
```

### Agent

Core state manager that handles conversation state, tool execution, and streaming.

```typescript
import { Agent, ProviderTransport } from '@mariozechner/pi-web-ui';
import { getModel } from '@mariozechner/pi-ai';

const agent = new Agent({
  initialState: {
    model: getModel('anthropic', 'claude-sonnet-4-5-20250929'),
    systemPrompt: 'You are a helpful assistant.',
    thinkingLevel: 'off',
    messages: [],
    tools: [],
  },
  transport: new ProviderTransport(),
});

// Subscribe to events
agent.subscribe((event) => {
  if (event.type === 'state-update') {
    console.log('Messages:', event.state.messages);
  }
});

// Send a message
await agent.send('Hello!');
```

### AgentInterface

Lower-level chat interface for custom implementations. Used internally by ChatPanel.

```typescript
import { AgentInterface } from '@mariozechner/pi-web-ui';

const chat = new AgentInterface();
await chat.setAgent(agent);
```

## Transports

Transport layers handle communication with AI providers.

### ProviderTransport

The main transport that calls AI provider APIs using stored API keys.

```typescript
import { ProviderTransport } from '@mariozechner/pi-web-ui';

const transport = new ProviderTransport();

const agent = new Agent({
  initialState: { /* ... */ },
  transport,
});
```

### AppTransport

Alternative transport for proxying requests through a custom server.

```typescript
import { AppTransport } from '@mariozechner/pi-web-ui';

const transport = new AppTransport();

const agent = new Agent({
  initialState: { /* ... */ },
  transport,
});
```

## Tool Renderers

Customize how tool calls and results are displayed.

```typescript
import { registerToolRenderer, type ToolRenderer } from '@mariozechner/pi-web-ui';
import { html } from '@mariozechner/mini-lit';

const myRenderer: ToolRenderer = {
  renderParams(params, isStreaming) {
    return html`<div>Calling tool with: ${JSON.stringify(params)}</div>`;
  },

  renderResult(params, result) {
    return html`<div>Result: ${result.output}</div>`;
  }
};

registerToolRenderer('my_tool', myRenderer);
```

## Storage

The package provides flexible storage backends for API keys, settings, and session persistence.

### AppStorage

Central storage configuration for the application.

```typescript
import { AppStorage, setAppStorage, SessionIndexedDBBackend } from '@mariozechner/pi-web-ui';

const storage = new AppStorage({
  sessions: new SessionIndexedDBBackend('my-app-sessions'),
});

setAppStorage(storage);
```

### Available Backends

- `LocalStorageBackend` - Uses browser localStorage
- `IndexedDBBackend` - Uses IndexedDB for larger data
- `SessionIndexedDBBackend` - Specialized for session storage
- `WebExtensionStorageBackend` - For browser extensions using chrome.storage API

### Session Management

```typescript
import { getAppStorage } from '@mariozechner/pi-web-ui';

const storage = getAppStorage();

// Save session
await storage.sessions?.saveSession(sessionId, agentState, undefined, title);

// Load session
const sessionData = await storage.sessions?.loadSession(sessionId);

// List sessions
const sessions = await storage.sessions?.listSessions();
```

## Styling

The package includes pre-built Tailwind CSS with the Claude theme:

```typescript
import '@mariozechner/pi-web-ui/app.css';
```

Or customize with your own Tailwind config:

```css
@import '@mariozechner/mini-lit/themes/claude.css';
@tailwind base;
@tailwind components;
@tailwind utilities;
```

## Dialogs

The package includes several dialog components for common interactions.

### SettingsDialog

Settings dialog with tabbed interface for API keys, proxy configuration, etc.

```typescript
import { SettingsDialog, ApiKeysTab, ProxyTab } from '@mariozechner/pi-web-ui';

// Open settings with tabs
SettingsDialog.open([new ApiKeysTab(), new ProxyTab()]);
```

### SessionListDialog

Display and load saved sessions.

```typescript
import { SessionListDialog } from '@mariozechner/pi-web-ui';

SessionListDialog.open(async (sessionId) => {
  await loadSession(sessionId);
});
```

### ApiKeyPromptDialog

Prompt user for API key when needed.

```typescript
import { ApiKeyPromptDialog } from '@mariozechner/pi-web-ui';

const apiKey = await ApiKeyPromptDialog.prompt('anthropic');
```

### PersistentStorageDialog

Request persistent storage permission.

```typescript
import { PersistentStorageDialog } from '@mariozechner/pi-web-ui';

await PersistentStorageDialog.request();
```

## Platform Integration

### Browser Extension

```typescript
import { AppStorage, WebExtensionStorageBackend, Agent, ProviderTransport } from '@mariozechner/pi-web-ui';

const storage = new AppStorage({
  providerKeys: new WebExtensionStorageBackend(),
  settings: new WebExtensionStorageBackend(),
});
setAppStorage(storage);
```

### Web Application

```typescript
import { AppStorage, SessionIndexedDBBackend, setAppStorage } from '@mariozechner/pi-web-ui';

const storage = new AppStorage({
  sessions: new SessionIndexedDBBackend('my-app-sessions'),
});
setAppStorage(storage);
```

## Examples

- [example/](./example) - Complete web application with session management
- [sitegeist](https://github.com/badlogic/sitegeist) - Browser extension for AI-powered web navigation

## API Reference

See [src/index.ts](src/index.ts) for the full public API.

## Known Bugs

- **PersistentStorageDialog**: Currently broken and commented out in examples. The dialog for requesting persistent storage does not work correctly and needs to be fixed.

## License

MIT
