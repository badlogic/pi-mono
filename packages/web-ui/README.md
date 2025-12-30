# @mariozechner/pi-web-ui

Reusable web UI components for building AI chat interfaces powered by [@mariozechner/pi-ai](../ai) and [@mariozechner/pi-agent-core](../agent).

Built with [mini-lit](https://github.com/badlogic/mini-lit) web components and Tailwind CSS v4.

## Features

- Modern Chat Interface: Complete chat UI with message history, streaming responses, and tool execution
- Tool Support: Built-in renderers for common tools plus custom tool rendering
- Attachments: PDF, Office documents, images with preview and text extraction
- Artifacts: HTML, SVG, Markdown, and text artifact rendering with sandboxed execution
- CORS Proxy Support: Automatic proxy handling for browser environments
- Platform Agnostic: Works in browser extensions, web apps, VS Code extensions, Electron apps
- TypeScript: Full type safety

## Installation

```bash
npm install @mariozechner/pi-web-ui @mariozechner/pi-agent-core @mariozechner/pi-ai
```

## Quick Start

See the [example](./example) directory for a complete working application.

```typescript
import { Agent } from '@mariozechner/pi-agent-core';
import { getModel } from '@mariozechner/pi-ai';
import {
  ChatPanel,
  AppStorage,
  IndexedDBStorageBackend,
  ProviderKeysStore,
  SessionsStore,
  SettingsStore,
  setAppStorage,
  defaultConvertToLlm,
} from '@mariozechner/pi-web-ui';
import '@mariozechner/pi-web-ui/app.css';

// Set up storage
const settings = new SettingsStore();
const providerKeys = new ProviderKeysStore();
const sessions = new SessionsStore();

const backend = new IndexedDBStorageBackend({
  dbName: 'my-app',
  version: 1,
  stores: [settings.getConfig(), providerKeys.getConfig(), sessions.getConfig()],
});

settings.setBackend(backend);
providerKeys.setBackend(backend);
sessions.setBackend(backend);

const storage = new AppStorage(settings, providerKeys, sessions, undefined, backend);
setAppStorage(storage);

// Create agent
const agent = new Agent({
  initialState: {
    systemPrompt: 'You are a helpful assistant.',
    model: getModel('anthropic', 'claude-sonnet-4-5-20250929'),
    thinkingLevel: 'off',
    messages: [],
    tools: [],
  },
  convertToLlm: defaultConvertToLlm,
});

// Create chat panel and attach agent
const chatPanel = new ChatPanel();
await chatPanel.setAgent(agent, {
  onApiKeyRequired: async (provider) => {
    // Prompt user for API key
    return await ApiKeyPromptDialog.prompt(provider);
  },
});

document.body.appendChild(chatPanel);
```

**Run the example:**

```bash
cd example
npm install
npm run dev
```

## Architecture

The web-ui package provides UI components that work with the `Agent` class from `@mariozechner/pi-agent-core`. The Agent handles:

- Conversation state management
- LLM streaming via `streamFn`
- Tool execution
- Event emission

The web-ui provides:

- `ChatPanel` / `AgentInterface`: UI components that subscribe to Agent events
- `defaultConvertToLlm`: Message transformer for web-ui custom message types
- Storage backends for API keys, sessions, and settings
- CORS proxy utilities for browser environments

## Core Components

### ChatPanel

High-level chat interface with artifacts panel support.

```typescript
import { ChatPanel, ApiKeyPromptDialog } from '@mariozechner/pi-web-ui';

const chatPanel = new ChatPanel();
await chatPanel.setAgent(agent, {
  onApiKeyRequired: async (provider) => ApiKeyPromptDialog.prompt(provider),
  onBeforeSend: async () => { /* pre-send hook */ },
  onCostClick: () => { /* cost display clicked */ },
  toolsFactory: (agent, agentInterface, artifactsPanel, runtimeProvidersFactory) => {
    // Return additional tools
    return [createJavaScriptReplTool()];
  },
});
```

### AgentInterface

Lower-level chat interface for custom layouts (used internally by ChatPanel).

```typescript
import { AgentInterface } from '@mariozechner/pi-web-ui';

const chat = document.createElement('agent-interface') as AgentInterface;
chat.session = agent;
chat.enableAttachments = true;
chat.enableModelSelector = true;
chat.onApiKeyRequired = async (provider) => { /* ... */ };
```

### Agent (from pi-agent-core)

The Agent class is imported from `@mariozechner/pi-agent-core`:

```typescript
import { Agent } from '@mariozechner/pi-agent-core';
import { defaultConvertToLlm } from '@mariozechner/pi-web-ui';

const agent = new Agent({
  initialState: {
    model: getModel('anthropic', 'claude-sonnet-4-5-20250929'),
    systemPrompt: 'You are helpful.',
    thinkingLevel: 'off',
    messages: [],
    tools: [],
  },
  convertToLlm: defaultConvertToLlm,
});

// Subscribe to events
agent.subscribe((event) => {
  switch (event.type) {
    case 'agent_start':
    case 'agent_end':
    case 'message_start':
    case 'message_update':
    case 'message_end':
    case 'turn_start':
    case 'turn_end':
      // Handle events
      break;
  }
});

// Send a message
await agent.prompt('Hello!');

// Or with custom message type
await agent.prompt({
  role: 'user-with-attachments',
  content: 'Check this image',
  attachments: [imageAttachment],
  timestamp: Date.now(),
});
```

## Message Types

### UserMessageWithAttachments

Custom message type for user messages with file attachments:

```typescript
import { isUserMessageWithAttachments, type UserMessageWithAttachments } from '@mariozechner/pi-web-ui';

const message: UserMessageWithAttachments = {
  role: 'user-with-attachments',
  content: 'Analyze this document',
  attachments: [pdfAttachment, imageAttachment],
  timestamp: Date.now(),
};
```

### ArtifactMessage

For session persistence of created artifacts:

```typescript
import { isArtifactMessage, type ArtifactMessage } from '@mariozechner/pi-web-ui';

const artifact: ArtifactMessage = {
  role: 'artifact',
  artifactId: 'chart-1',
  type: 'html',
  title: 'Sales Chart',
  content: '<div>...</div>',
  timestamp: new Date().toISOString(),
};
```

### Custom Message Types

Extend `CustomAgentMessages` from pi-agent-core:

```typescript
// Define your custom message
interface SystemNotificationMessage {
  role: 'system-notification';
  message: string;
  level: 'info' | 'warning' | 'error';
  timestamp: string;
}

// Register with pi-agent-core's type system
declare module '@mariozechner/pi-agent-core' {
  interface CustomAgentMessages {
    'system-notification': SystemNotificationMessage;
  }
}

// Register a renderer
registerMessageRenderer('system-notification', {
  render: (msg) => html`<div class="notification">${msg.message}</div>`,
});

// Extend convertToLlm to handle your type
function myConvertToLlm(messages: AgentMessage[]): Message[] {
  const processed = messages.map((m) => {
    if (m.role === 'system-notification') {
      return { role: 'user', content: `<system>${m.message}</system>`, timestamp: Date.now() };
    }
    return m;
  });
  return defaultConvertToLlm(processed);
}
```

## Message Transformer

The `convertToLlm` function transforms app messages to LLM-compatible format:

```typescript
import { defaultConvertToLlm, convertAttachments } from '@mariozechner/pi-web-ui';

// defaultConvertToLlm handles:
// - UserMessageWithAttachments → user message with content blocks
// - ArtifactMessage → filtered out (UI-only)
// - Standard messages (user, assistant, toolResult) → passed through

// For custom types, wrap defaultConvertToLlm:
const agent = new Agent({
  convertToLlm: (messages) => {
    const processed = messages.map(m => {
      // Handle your custom types
      return m;
    });
    return defaultConvertToLlm(processed);
  },
});
```

## CORS Proxy

Browser environments may need a CORS proxy for certain providers:

```typescript
import {
  createStreamFn,
  shouldUseProxyForProvider,
  applyProxyIfNeeded,
  isCorsError,
} from '@mariozechner/pi-web-ui';

// AgentInterface automatically sets up proxy support if using AppStorage
// For manual setup:
agent.streamFn = createStreamFn(async () => {
  const enabled = await storage.settings.get<boolean>('proxy.enabled');
  return enabled ? await storage.settings.get<string>('proxy.url') : undefined;
});
```

Providers requiring proxy:
- `zai`: Always requires proxy
- `anthropic`: Only OAuth tokens (`sk-ant-oat-*`) require proxy

## Tool Renderers

Customize how tool calls are displayed:

```typescript
import { registerToolRenderer, type ToolRenderer } from '@mariozechner/pi-web-ui';
import { html } from 'lit';

const myRenderer: ToolRenderer = {
  renderParams(params, isStreaming) {
    return html`<div>Calling with: ${JSON.stringify(params)}</div>`;
  },
  renderResult(params, result) {
    return html`<div>Result: ${result.output}</div>`;
  },
};

registerToolRenderer('my_tool', myRenderer);
```

## Storage

### AppStorage

Central storage configuration:

```typescript
import {
  AppStorage,
  IndexedDBStorageBackend,
  ProviderKeysStore,
  SessionsStore,
  SettingsStore,
  CustomProvidersStore,
  setAppStorage,
  getAppStorage,
} from '@mariozechner/pi-web-ui';

// Create stores
const settings = new SettingsStore();
const providerKeys = new ProviderKeysStore();
const sessions = new SessionsStore();
const customProviders = new CustomProvidersStore();

// Create backend
const backend = new IndexedDBStorageBackend({
  dbName: 'my-app',
  version: 1,
  stores: [
    settings.getConfig(),
    providerKeys.getConfig(),
    sessions.getConfig(),
    customProviders.getConfig(),
  ],
});

// Wire stores to backend
settings.setBackend(backend);
providerKeys.setBackend(backend);
sessions.setBackend(backend);
customProviders.setBackend(backend);

// Create and set app storage
const storage = new AppStorage(settings, providerKeys, sessions, customProviders, backend);
setAppStorage(storage);

// Access anywhere
const storage = getAppStorage();
await storage.providerKeys.set('anthropic', 'sk-...');
await storage.sessions.save(sessionData, metadata);
```

## Dialogs

### SettingsDialog

```typescript
import { SettingsDialog, ProvidersModelsTab, ProxyTab } from '@mariozechner/pi-web-ui';

SettingsDialog.open([new ProvidersModelsTab(), new ProxyTab()]);
```

### SessionListDialog

```typescript
import { SessionListDialog } from '@mariozechner/pi-web-ui';

SessionListDialog.open(
  async (sessionId) => { /* load session */ },
  (deletedId) => { /* handle deletion */ },
);
```

### ApiKeyPromptDialog

```typescript
import { ApiKeyPromptDialog } from '@mariozechner/pi-web-ui';

const success = await ApiKeyPromptDialog.prompt('anthropic');
```

## Styling

Import the pre-built CSS:

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

## Examples

- [example/](./example) - Complete web application with sessions, artifacts, and custom messages
- [sitegeist](https://github.com/badlogic/sitegeist) - Browser extension using pi-web-ui

## Known Bugs

- **PersistentStorageDialog**: Currently broken and commented out in examples

## License

MIT
