# @mariozechner/pi-web-ui

Reusable web UI components for building AI chat interfaces powered by [@mariozechner/pi-ai](../ai).

Built with [mini-lit](https://github.com/mariozechner/mini-lit) web components and Tailwind CSS v4.

## Features

- 🎨 **Modern Chat Interface** - Complete chat UI with message history, streaming responses, and tool execution
- 🔧 **Tool Support** - Built-in renderers for calculator, bash, time, and custom tools
- 📎 **Attachments** - PDF, Office documents, images with preview and text extraction
- 🎭 **Artifacts** - HTML, SVG, Markdown, and text artifact rendering with sandboxed execution
- 🔌 **Pluggable Transports** - Direct API calls or proxy server support
- 🌐 **Platform Agnostic** - Works in browser extensions, web apps, VS Code extensions, Electron apps
- 🎯 **TypeScript** - Full type safety with TypeScript

## Installation

```bash
npm install @mariozechner/pi-web-ui
```

## Quick Start

See the [example](./example) directory for a complete working application.

```typescript
import { ChatPanel } from '@mariozechner/pi-web-ui';
import { calculateTool, getCurrentTimeTool } from '@mariozechner/pi-ai';
import '@mariozechner/pi-web-ui/app.css';

// Create a chat panel
const chatPanel = new ChatPanel();
chatPanel.systemPrompt = 'You are a helpful assistant.';
chatPanel.additionalTools = [calculateTool, getCurrentTimeTool];

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

The main chat interface component. Manages agent sessions, model selection, and conversation flow.

```typescript
import { ChatPanel } from '@mariozechner/pi-web-ui';

const panel = new ChatPanel({
  initialModel: 'anthropic/claude-sonnet-4-20250514',
  systemPrompt: 'You are a helpful assistant.',
  transportMode: 'direct', // or 'proxy'
});
```

### AgentInterface

Lower-level chat interface for custom implementations.

```typescript
import { AgentInterface } from '@mariozechner/pi-web-ui';

const chat = new AgentInterface();
chat.session = myAgentSession;
```

## State Management

### AgentSession

Manages conversation state, tool execution, and streaming.

```typescript
import { AgentSession, DirectTransport } from '@mariozechner/pi-web-ui';
import { getModel, calculateTool, getCurrentTimeTool } from '@mariozechner/pi-ai';

const session = new AgentSession({
  initialState: {
    model: getModel('anthropic', 'claude-3-5-haiku-20241022'),
    systemPrompt: 'You are a helpful assistant.',
    tools: [calculateTool, getCurrentTimeTool],
    messages: [],
  },
  transportMode: 'direct',
});

// Subscribe to state changes
session.subscribe((state) => {
  console.log('Messages:', state.messages);
  console.log('Streaming:', state.streaming);
});

// Send a message
await session.send('What is 25 * 18?');
```

### Transports

Transport layers handle communication with AI providers.

#### DirectTransport

Calls AI provider APIs directly from the browser using API keys stored locally.

```typescript
import { DirectTransport, KeyStore } from '@mariozechner/pi-web-ui';

// Set API keys
const keyStore = new KeyStore();
await keyStore.setKey('anthropic', 'sk-ant-...');
await keyStore.setKey('openai', 'sk-...');

// Use direct transport (default)
const session = new AgentSession({
  transportMode: 'direct',
  // ...
});
```

#### ProxyTransport

Routes requests through a proxy server using auth tokens.

```typescript
import { ProxyTransport, setAuthToken } from '@mariozechner/pi-web-ui';

// Set auth token
setAuthToken('your-auth-token');

// Use proxy transport
const session = new AgentSession({
  transportMode: 'proxy',
  // ...
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

## Artifacts

Render rich content with sandboxed execution.

```typescript
import { artifactTools } from '@mariozechner/pi-web-ui';
import { getModel } from '@mariozechner/pi-ai';

const session = new AgentSession({
  initialState: {
    tools: [...artifactTools],
    // ...
  }
});

// AI can now create HTML artifacts, SVG diagrams, etc.
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

## Platform Integration

### Browser Extension

```typescript
import { ChatPanel, KeyStore } from '@mariozechner/pi-web-ui';

// Use chrome.storage for persistence
const keyStore = new KeyStore({
  get: async (key) => {
    const result = await chrome.storage.local.get(key);
    return result[key];
  },
  set: async (key, value) => {
    await chrome.storage.local.set({ [key]: value });
  }
});
```

### Web Application

```typescript
import { ChatPanel } from '@mariozechner/pi-web-ui';

// Uses localStorage by default
const panel = new ChatPanel();
document.querySelector('#app').appendChild(panel);
```

### VS Code Extension

```typescript
import { AgentSession, DirectTransport } from '@mariozechner/pi-web-ui';

// Custom storage using VS Code's globalState
const storage = {
  get: async (key) => context.globalState.get(key),
  set: async (key, value) => context.globalState.update(key, value)
};
```

## Examples

See the [browser-extension](../browser-extension) package for a complete implementation example.

## API Reference

See [src/index.ts](src/index.ts) for the full public API.

## License

MIT
