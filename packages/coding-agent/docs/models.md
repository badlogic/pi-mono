# Custom Models

Add custom providers and models (Ollama, vLLM, LM Studio, proxies) via `~/.pi/agent/models.json`.

## Table of Contents

- [Minimal Example](#minimal-example)
- [Full Example](#full-example)
- [Supported APIs](#supported-apis)
- [Provider Configuration](#provider-configuration)
- [Model Configuration](#model-configuration)
- [Overriding Built-in Providers](#overriding-built-in-providers)
- [Per-model Overrides](#per-model-overrides)
- [OpenAI Compatibility](#openai-compatibility)

## Minimal Example

For local models (Ollama, LM Studio, vLLM), only `id` is required per model:

```json
{
  "providers": {
    "ollama": {
      "baseUrl": "http://localhost:11434/v1",
      "api": "openai-completions",
      "apiKey": "ollama",
      "models": [
        { "id": "llama3.1:8b" },
        { "id": "qwen2.5-coder:7b" }
      ]
    }
  }
}
```

The `apiKey` is required but Ollama ignores it, so any value works.

## Full Example

Override defaults when you need specific values:

```json
{
  "providers": {
    "ollama": {
      "baseUrl": "http://localhost:11434/v1",
      "api": "openai-completions",
      "apiKey": "ollama",
      "models": [
        {
          "id": "llama3.1:8b",
          "name": "Llama 3.1 8B (Local)",
          "reasoning": false,
          "input": ["text"],
          "contextWindow": 128000,
          "maxTokens": 32000,
          "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
        }
      ]
    }
  }
}
```

The file reloads each time you open `/model`. Edit during session; no restart needed.

## Supported APIs

| API | Description |
|-----|-------------|
| `openai-completions` | OpenAI Chat Completions (most compatible) |
| `openai-responses` | OpenAI Responses API |
| `anthropic-messages` | Anthropic Messages API |
| `google-generative-ai` | Google Generative AI |

Set `api` at provider level (default for all models) or model level (override per model).

## Provider Configuration

| Field | Description |
|-------|-------------|
| `baseUrl` | API endpoint URL |
| `api` | API type (see above) |
| `apiKey` | API key (see value resolution below) |
| `headers` | Custom headers (see value resolution below) |
| `authHeader` | Set `true` to add `Authorization: Bearer <apiKey>` automatically |
| `models` | Array of model configurations |
| `modelOverrides` | Per-model overrides for built-in models on this provider |

### Value Resolution

The `apiKey` and `headers` fields support three formats:

- **Shell command:** `"!command"` executes and uses stdout
  ```json
  "apiKey": "!security find-generic-password -ws 'anthropic'"
  "apiKey": "!op read 'op://vault/item/credential'"
  ```
- **Environment variable:** Uses the value of the named variable
  ```json
  "apiKey": "MY_API_KEY"
  ```
- **Literal value:** Used directly
  ```json
  "apiKey": "sk-..."
  ```

### Custom Headers

```json
{
  "providers": {
    "custom-proxy": {
      "baseUrl": "https://proxy.example.com/v1",
      "apiKey": "MY_API_KEY",
      "api": "anthropic-messages",
      "headers": {
        "x-portkey-api-key": "PORTKEY_API_KEY",
        "x-secret": "!op read 'op://vault/item/secret'"
      },
      "models": [...]
    }
  }
}
```

## Model Configuration

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `id` | Yes | — | Model identifier (passed to the API) |
| `name` | No | `id` | Display name in model selector |
| `api` | No | provider's `api` | Override provider's API for this model |
| `reasoning` | No | `false` | Supports extended thinking |
| `input` | No | `["text"]` | Input types: `["text"]` or `["text", "image"]` |
| `contextWindow` | No | `128000` | Context window size in tokens |
| `maxTokens` | No | `16384` | Maximum output tokens |
| `cost` | No | all zeros | `{"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0}` (per million tokens) |

## Overriding Built-in Providers

Route a built-in provider through a proxy without redefining models:

```json
{
  "providers": {
    "anthropic": {
      "baseUrl": "https://my-proxy.example.com/v1"
    }
  }
}
```

All built-in Anthropic models remain available. Existing OAuth or API key auth continues to work.

To merge custom models into a built-in provider, include the `models` array:

```json
{
  "providers": {
    "anthropic": {
      "baseUrl": "https://my-proxy.example.com/v1",
      "apiKey": "ANTHROPIC_API_KEY",
      "api": "anthropic-messages",
      "models": [...]
    }
  }
}
```

Merge semantics:
- Built-in models are kept.
- Custom models are upserted by `id` within the provider.
- If a custom model `id` matches a built-in model `id`, the custom model replaces that built-in model.
- If a custom model `id` is new, it is added alongside built-in models.

## Per-model Overrides

Use `modelOverrides` to customize specific built-in models without replacing the provider's full model list.

```json
{
  "providers": {
    "openrouter": {
      "modelOverrides": {
        "anthropic/claude-sonnet-4": {
          "name": "Claude Sonnet 4 (Bedrock Route)",
          "compat": {
            "openRouterRouting": {
              "only": ["amazon-bedrock"]
            }
          }
        }
      }
    }
  }
}
```

`modelOverrides` supports these fields per model: `name`, `reasoning`, `input`, `cost` (partial), `contextWindow`, `maxTokens`, `headers`, `compat`.

Behavior notes:
- `modelOverrides` are applied to built-in provider models.
- Unknown model IDs are ignored.
- You can combine provider-level `baseUrl`/`headers` with `modelOverrides`.
- If `models` is also defined for a provider, custom models are merged after built-in overrides. A custom model with the same `id` replaces the overridden built-in model entry.

## OpenAI Compatibility

For providers with partial OpenAI compatibility, use the `compat` field:

```json
{
  "providers": {
    "local-llm": {
      "baseUrl": "http://localhost:8080/v1",
      "api": "openai-completions",
      "compat": {
        "supportsUsageInStreaming": false,
        "maxTokensField": "max_tokens"
      },
      "models": [...]
    }
  }
}
```

| Field | Description |
|-------|-------------|
| `supportsStore` | Provider supports `store` field |
| `supportsDeveloperRole` | Use `developer` vs `system` role |
| `supportsReasoningEffort` | Support for `reasoning_effort` parameter |
| `supportsUsageInStreaming` | Supports `stream_options: { include_usage: true }` (default: `true`) |
| `maxTokensField` | Use `max_completion_tokens` or `max_tokens` |
| `openRouterRouting` | OpenRouter routing config passed to OpenRouter for model/provider selection |
| `vercelGatewayRouting` | Vercel AI Gateway routing config for provider selection (`only`, `order`) |

Example:

```json
{
  "providers": {
    "openrouter": {
      "baseUrl": "https://openrouter.ai/api/v1",
      "apiKey": "OPENROUTER_API_KEY",
      "api": "openai-completions",
      "models": [
        {
          "id": "openrouter/anthropic/claude-3.5-sonnet",
          "name": "OpenRouter Claude 3.5 Sonnet",
          "compat": {
            "openRouterRouting": {
              "order": ["anthropic"],
              "fallbacks": ["openai"]
            }
          }
        }
      ]
    }
  }
}
```

Vercel AI Gateway example:

```json
{
  "providers": {
    "vercel-ai-gateway": {
      "baseUrl": "https://ai-gateway.vercel.sh/v1",
      "apiKey": "AI_GATEWAY_API_KEY",
      "api": "openai-completions",
      "models": [
        {
          "id": "moonshotai/kimi-k2.5",
          "name": "Kimi K2.5 (Fireworks via Vercel)",
          "reasoning": true,
          "input": ["text", "image"],
          "cost": { "input": 0.6, "output": 3, "cacheRead": 0, "cacheWrite": 0 },
          "contextWindow": 262144,
          "maxTokens": 262144,
          "compat": {
            "vercelGatewayRouting": {
              "only": ["fireworks", "novita"],
              "order": ["fireworks", "novita"]
            }
          }
        }
      ]
    }
  }
}
```
