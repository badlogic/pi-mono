# Provider Registration

Register or override model providers dynamically via `pi.registerProvider()`.

## New Provider with Custom Models

```typescript
pi.registerProvider("my-proxy", {
  baseUrl: "https://proxy.example.com",
  apiKey: "PROXY_API_KEY",  // env var name or literal
  api: "anthropic-messages",
  models: [
    {
      id: "claude-sonnet-4-20250514",
      name: "Claude 4 Sonnet (proxy)",
      reasoning: false,
      input: ["text", "image"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200000,
      maxTokens: 16384
    }
  ]
});
```

## Override Existing Provider URL

```typescript
pi.registerProvider("anthropic", {
  baseUrl: "https://proxy.example.com"
});
```

## OAuth Provider

Register a provider with OAuth support for `/login`:

```typescript
pi.registerProvider("corporate-ai", {
  baseUrl: "https://ai.corp.com",
  api: "openai-responses",
  models: [...],
  oauth: {
    name: "Corporate AI (SSO)",
    async login(callbacks) {
      // Custom OAuth flow
      callbacks.onAuth({ url: "https://sso.corp.com/..." });
      const code = await callbacks.onPrompt({ message: "Enter code:" });
      return { refresh: code, access: code, expires: Date.now() + 3600000 };
    },
    async refreshToken(credentials) {
      // Refresh logic
      return credentials;
    },
    getApiKey(credentials) {
      return credentials.access;
    }
  }
});
```

## Configuration Options

| Option | Type | Description |
|--------|------|-------------|
| `baseUrl` | `string` | API endpoint URL. Required when defining models. |
| `apiKey` | `string` | API key or environment variable name. Required when defining models (unless `oauth` provided). |
| `api` | `Api` | API type: `"anthropic-messages"`, `"openai-completions"`, `"openai-responses"`, etc. |
| `headers` | `Record<string, string>` | Custom headers to include in requests. |
| `authHeader` | `boolean` | If true, adds `Authorization: Bearer` header automatically. |
| `models` | `ProviderModelConfig[]` | Array of model definitions. If provided, replaces all existing models for this provider. |
| `oauth` | `OAuthConfig` | OAuth provider config for `/login` support. |
| `streamSimple` | `StreamSimpleFn` | Custom streaming implementation for non-standard APIs. |

## Model Definition

```typescript
{
  id: "claude-sonnet-4-20250514",           // Model ID
  name: "Claude 4 Sonnet",                  // Display name
  api: "anthropic-messages",                // Optional API type override
  reasoning: false,                         // Supports extended thinking?
  input: ["text", "image"],                 // Supported input types
  cost: { input: 0, output: 0, ... },       // Token costs (for tracking)
  contextWindow: 200000,                    // Max context size
  maxTokens: 16384,                         // Max output tokens
  headers: { ... },                         // Optional custom headers
  compat: { ... }                           // OpenAI compatibility settings
}
```

## Dynamic Provider Registration

Providers can be registered at extension load time:

```typescript
export default function (pi: ExtensionAPI) {
  // Register provider on load
  pi.registerProvider("my-provider", { ... });

  // Or register conditionally
  pi.on("session_start", async (event, ctx) => {
    const shouldUseProxy = await checkProxyConfig();
    if (shouldUseProxy) {
      pi.registerProvider("anthropic", {
        baseUrl: "https://proxy.example.com"
      });
    }
  });
}
```

See [custom-provider.md](../../packages/coding-agent/docs/custom-provider.md) for advanced topics including custom streaming APIs.
