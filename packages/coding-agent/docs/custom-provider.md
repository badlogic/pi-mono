# Custom Providers

Extensions can register custom model providers via `pi.registerProvider()`. This enables:

- **Proxies** - Route requests through corporate proxies or API gateways
- **Custom endpoints** - Use self-hosted or private model deployments
- **OAuth/SSO** - Add authentication flows for enterprise providers
- **Custom APIs** - Implement streaming for non-standard LLM APIs

## Table of Contents

- [Quick Reference](#quick-reference)
- [Override Existing Provider](#override-existing-provider)
- [Register New Provider](#register-new-provider)
- [OAuth Support](#oauth-support)
- [Custom Streaming API](#custom-streaming-api)
- [Config Reference](#config-reference)
- [Model Definition Reference](#model-definition-reference)

## Quick Reference

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  // Override baseUrl for existing provider
  pi.registerProvider("anthropic", {
    baseUrl: "https://proxy.example.com"
  });

  // Register new provider with models
  pi.registerProvider("my-provider", {
    baseUrl: "https://api.example.com",
    apiKey: "MY_API_KEY",
    api: "openai-completions",
    models: [
      {
        id: "my-model",
        name: "My Model",
        reasoning: false,
        input: ["text", "image"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 4096
      }
    ]
  });
}
```

## Override Existing Provider

The simplest use case: redirect an existing provider through a proxy.

```typescript
// All Anthropic requests now go through your proxy
pi.registerProvider("anthropic", {
  baseUrl: "https://proxy.example.com"
});

// Add custom headers to OpenAI requests
pi.registerProvider("openai", {
  headers: {
    "X-Custom-Header": "value"
  }
});

// Both baseUrl and headers
pi.registerProvider("google", {
  baseUrl: "https://ai-gateway.corp.com/google",
  headers: {
    "X-Corp-Auth": "CORP_AUTH_TOKEN"  // env var or literal
  }
});
```

When only `baseUrl` and/or `headers` are provided (no `models`), all existing models for that provider are preserved with the new endpoint.

## Register New Provider

To add a completely new provider, specify `models` along with the required configuration.

```typescript
pi.registerProvider("my-llm", {
  baseUrl: "https://api.my-llm.com/v1",
  apiKey: "MY_LLM_API_KEY",  // env var name or literal value
  api: "openai-completions",  // which streaming API to use
  models: [
    {
      id: "my-llm-large",
      name: "My LLM Large",
      reasoning: true,        // supports extended thinking
      input: ["text", "image"],
      cost: {
        input: 3.0,           // $/million tokens
        output: 15.0,
        cacheRead: 0.3,
        cacheWrite: 3.75
      },
      contextWindow: 200000,
      maxTokens: 16384
    },
    {
      id: "my-llm-small",
      name: "My LLM Small",
      reasoning: false,
      input: ["text"],
      cost: { input: 0.25, output: 1.25, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 8192
    }
  ]
});
```

When `models` is provided, it **replaces** all existing models for that provider.

### API Types

The `api` field determines which streaming implementation is used:

| API | Use for |
|-----|---------|
| `anthropic-messages` | Anthropic Claude API and compatibles |
| `openai-completions` | OpenAI Chat Completions API and compatibles |
| `openai-responses` | OpenAI Responses API |
| `azure-openai-responses` | Azure OpenAI Responses API |
| `openai-codex-responses` | OpenAI Codex Responses API |
| `google-generative-ai` | Google Generative AI API |
| `google-gemini-cli` | Google Cloud Code Assist API |
| `google-vertex` | Google Vertex AI API |
| `bedrock-converse-stream` | Amazon Bedrock Converse API |

Most OpenAI-compatible providers work with `openai-completions`. Use `compat` for quirks:

```typescript
models: [{
  id: "custom-model",
  // ...
  compat: {
    supportsDeveloperRole: false,      // use "system" instead of "developer"
    supportsReasoningEffort: false,    // disable reasoning_effort param
    maxTokensField: "max_tokens",      // instead of "max_completion_tokens"
    requiresToolResultName: true,      // tool results need name field
    requiresMistralToolIds: true       // tool IDs must be 9 alphanumeric chars
  }
}]
```

### Auth Header

If your provider expects `Authorization: Bearer <key>` but doesn't use a standard API, set `authHeader: true`:

```typescript
pi.registerProvider("custom-api", {
  baseUrl: "https://api.example.com",
  apiKey: "MY_API_KEY",
  authHeader: true,  // adds Authorization: Bearer header
  api: "openai-completions",
  models: [...]
});
```

## OAuth Support

Add OAuth/SSO authentication that integrates with `/login`:

```typescript
import type { OAuthCredentials, OAuthLoginCallbacks } from "@mariozechner/pi-ai";

pi.registerProvider("corporate-ai", {
  baseUrl: "https://ai.corp.com/v1",
  api: "openai-responses",
  models: [
    {
      id: "corp-claude",
      name: "Corporate Claude",
      reasoning: true,
      input: ["text", "image"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200000,
      maxTokens: 16384
    }
  ],
  oauth: {
    name: "Corporate AI (SSO)",

    async login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
      // Option 1: Browser-based OAuth
      callbacks.onAuth({ url: "https://sso.corp.com/authorize?..." });

      // Option 2: Device code flow
      callbacks.onDeviceCode({
        userCode: "ABCD-1234",
        verificationUri: "https://sso.corp.com/device"
      });

      // Option 3: Prompt for token/code
      const code = await callbacks.onPrompt({ message: "Enter SSO code:" });

      // Exchange for tokens (your implementation)
      const tokens = await exchangeCodeForTokens(code);

      return {
        refresh: tokens.refreshToken,
        access: tokens.accessToken,
        expires: Date.now() + tokens.expiresIn * 1000
      };
    },

    async refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
      const tokens = await refreshAccessToken(credentials.refresh);
      return {
        refresh: tokens.refreshToken ?? credentials.refresh,
        access: tokens.accessToken,
        expires: Date.now() + tokens.expiresIn * 1000
      };
    },

    getApiKey(credentials: OAuthCredentials): string {
      return credentials.access;
    },

    // Optional: modify models based on user's subscription
    modifyModels(models, credentials) {
      // e.g., update baseUrl based on user's region
      const region = decodeRegionFromToken(credentials.access);
      return models.map(m => ({
        ...m,
        baseUrl: `https://${region}.ai.corp.com/v1`
      }));
    }
  }
});
```

After registration, users can authenticate via `/login corporate-ai`.

### OAuthLoginCallbacks

The `callbacks` object provides three ways to authenticate:

```typescript
interface OAuthLoginCallbacks {
  // Open URL in browser (for OAuth redirects)
  onAuth(params: { url: string }): void;

  // Show device code (for device authorization flow)
  onDeviceCode(params: { userCode: string; verificationUri: string }): void;

  // Prompt user for input (for manual token entry)
  onPrompt(params: { message: string }): Promise<string>;
}
```

### OAuthCredentials

Credentials are persisted in `~/.pi/agent/auth.json`:

```typescript
interface OAuthCredentials {
  refresh: string;   // Refresh token (for refreshToken())
  access: string;    // Access token (returned by getApiKey())
  expires: number;   // Expiration timestamp in milliseconds
}
```

## Custom Streaming API

For providers with non-standard APIs, implement `streamSimple`:

```typescript
import type {
  AssistantMessageEventStream,
  Context,
  Model,
  SimpleStreamOptions,
  Api
} from "@mariozechner/pi-ai";
import { createAssistantMessageEventStream } from "@mariozechner/pi-ai";

pi.registerProvider("custom-llm", {
  baseUrl: "https://api.custom-llm.com",
  apiKey: "CUSTOM_LLM_KEY",
  api: "custom-llm-api",  // your custom API identifier
  models: [
    {
      id: "custom-model",
      name: "Custom Model",
      reasoning: false,
      input: ["text"],
      cost: { input: 1.0, output: 2.0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 32000,
      maxTokens: 4096
    }
  ],

  streamSimple(
    model: Model<Api>,
    context: Context,
    options?: SimpleStreamOptions
  ): AssistantMessageEventStream {
    return createAssistantMessageEventStream(async function* (signal) {
      // Convert context to your API format
      const messages = context.messages.map(m => ({
        role: m.role,
        content: typeof m.content === "string"
          ? m.content
          : m.content.filter(c => c.type === "text").map(c => c.text).join("")
      }));

      // Make streaming request
      const response = await fetch(`${model.baseUrl}/chat`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${options?.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: model.id,
          messages,
          stream: true
        }),
        signal
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      // Yield start event
      yield { type: "start" };

      // Parse SSE stream
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let contentIndex = 0;
      let textStarted = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") continue;

          const chunk = JSON.parse(data);
          const delta = chunk.choices?.[0]?.delta?.content;

          if (delta) {
            if (!textStarted) {
              yield { type: "text_start", contentIndex };
              textStarted = true;
            }
            yield { type: "text_delta", contentIndex, delta };
          }
        }
      }

      if (textStarted) {
        yield { type: "text_end", contentIndex };
      }

      // Yield usage if available
      yield {
        type: "usage",
        usage: {
          input: 0,      // fill from response if available
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
        }
      };

      // Yield done
      yield { type: "done", reason: "stop" };
    });
  }
});
```

### Event Types

Your generator must yield events in this order:

1. `{ type: "start" }` - Stream started
2. Content events (repeatable, in order):
   - `{ type: "text_start", contentIndex }` - Text block started
   - `{ type: "text_delta", contentIndex, delta }` - Text chunk
   - `{ type: "text_end", contentIndex }` - Text block ended
   - `{ type: "thinking_start", contentIndex }` - Thinking block started
   - `{ type: "thinking_delta", contentIndex, delta }` - Thinking chunk
   - `{ type: "thinking_end", contentIndex }` - Thinking block ended
   - `{ type: "toolcall_start", contentIndex }` - Tool call started
   - `{ type: "toolcall_delta", contentIndex, delta }` - Tool call JSON chunk
   - `{ type: "toolcall_end", contentIndex, toolCall }` - Tool call ended
3. `{ type: "usage", usage }` - Token usage (optional but recommended)
4. `{ type: "done", reason }` or `{ type: "error", error }` - Stream ended

### Reasoning Support

For models with extended thinking, yield thinking events:

```typescript
if (chunk.thinking) {
  if (!thinkingStarted) {
    yield { type: "thinking_start", contentIndex: thinkingIndex };
    thinkingStarted = true;
  }
  yield { type: "thinking_delta", contentIndex: thinkingIndex, delta: chunk.thinking };
}
```

### Tool Calls

For function calling support, yield tool call events:

```typescript
if (chunk.tool_calls) {
  for (const tc of chunk.tool_calls) {
    if (tc.index !== currentToolIndex) {
      if (currentToolIndex >= 0) {
        yield {
          type: "toolcall_end",
          contentIndex: currentToolIndex,
          toolCall: {
            type: "toolCall",
            id: currentToolId,
            name: currentToolName,
            arguments: JSON.parse(currentToolArgs)
          }
        };
      }
      currentToolIndex = tc.index;
      currentToolId = tc.id;
      currentToolName = tc.function.name;
      currentToolArgs = "";
      yield { type: "toolcall_start", contentIndex: tc.index };
    }
    if (tc.function.arguments) {
      currentToolArgs += tc.function.arguments;
      yield { type: "toolcall_delta", contentIndex: tc.index, delta: tc.function.arguments };
    }
  }
}
```

## Config Reference

```typescript
interface ProviderConfig {
  /** API endpoint URL. Required when defining models. */
  baseUrl?: string;

  /** API key or environment variable name. Required when defining models (unless oauth). */
  apiKey?: string;

  /** API type for streaming. Required at provider or model level when defining models. */
  api?: Api;

  /** Custom streaming implementation for non-standard APIs. */
  streamSimple?: (
    model: Model<Api>,
    context: Context,
    options?: SimpleStreamOptions
  ) => AssistantMessageEventStream;

  /** Custom headers to include in requests. Values can be env var names. */
  headers?: Record<string, string>;

  /** If true, adds Authorization: Bearer header with the resolved API key. */
  authHeader?: boolean;

  /** Models to register. If provided, replaces all existing models for this provider. */
  models?: ProviderModelConfig[];

  /** OAuth provider for /login support. */
  oauth?: {
    name: string;
    login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials>;
    refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials>;
    getApiKey(credentials: OAuthCredentials): string;
    modifyModels?(models: Model<Api>[], credentials: OAuthCredentials): Model<Api>[];
  };
}
```

## Model Definition Reference

```typescript
interface ProviderModelConfig {
  /** Model ID (e.g., "claude-sonnet-4-20250514"). */
  id: string;

  /** Display name (e.g., "Claude 4 Sonnet"). */
  name: string;

  /** API type override for this specific model. */
  api?: Api;

  /** Whether the model supports extended thinking. */
  reasoning: boolean;

  /** Supported input types. */
  input: ("text" | "image")[];

  /** Cost per million tokens (for usage tracking). */
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };

  /** Maximum context window size in tokens. */
  contextWindow: number;

  /** Maximum output tokens. */
  maxTokens: number;

  /** Custom headers for this specific model. */
  headers?: Record<string, string>;

  /** OpenAI compatibility settings for openai-completions API. */
  compat?: {
    supportsStore?: boolean;
    supportsDeveloperRole?: boolean;
    supportsReasoningEffort?: boolean;
    supportsUsageInStreaming?: boolean;
    maxTokensField?: "max_completion_tokens" | "max_tokens";
    requiresToolResultName?: boolean;
    requiresAssistantAfterToolResult?: boolean;
    requiresThinkingAsText?: boolean;
    requiresMistralToolIds?: boolean;
    thinkingFormat?: "openai" | "zai";
  };
}
```
