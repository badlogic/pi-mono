# Authentication

Pi supports API keys (environment variables or auth file) and OAuth for subscription-based providers.

## Auth File

Store credentials in `~/.pi/agent/auth.json`:

```json
{
  "anthropic": { "type": "api_key", "key": "sk-ant-..." },
  "openai": { "type": "api_key", "key": "sk-..." },
  "google": { "type": "api_key", "key": "..." }
}
```

Auth file keys take priority over environment variables.

## Environment Variables

| Provider | Auth Key | Environment Variable |
|----------|----------|---------------------|
| Anthropic | `anthropic` | `ANTHROPIC_API_KEY` |
| OpenAI | `openai` | `OPENAI_API_KEY` |
| Azure OpenAI | `azure-openai` | `AZURE_OPENAI_API_KEY` |
| Google | `google` | `GEMINI_API_KEY` |
| Mistral | `mistral` | `MISTRAL_API_KEY` |
| Groq | `groq` | `GROQ_API_KEY` |
| Cerebras | `cerebras` | `CEREBRAS_API_KEY` |
| xAI | `xai` | `XAI_API_KEY` |
| OpenRouter | `openrouter` | `OPENROUTER_API_KEY` |
| Vercel AI Gateway | `vercel-ai-gateway` | `AI_GATEWAY_API_KEY` |
| ZAI | `zai` | `ZAI_API_KEY` |
| OpenCode Zen | `opencode` | `OPENCODE_API_KEY` |
| MiniMax | `minimax` | `MINIMAX_API_KEY` |
| MiniMax (China) | `minimax-cn` | `MINIMAX_CN_API_KEY` |

### Azure OpenAI

Requires additional configuration:

```bash
export AZURE_OPENAI_API_KEY=...
export AZURE_OPENAI_BASE_URL=https://your-resource.openai.azure.com
# or
export AZURE_OPENAI_RESOURCE_NAME=your-resource

# Optional
export AZURE_OPENAI_API_VERSION=2024-02-01
export AZURE_OPENAI_DEPLOYMENT_NAME_MAP=gpt-4=my-gpt4-deployment,gpt-4o=my-gpt4o
```

### Amazon Bedrock

```bash
# Option 1: AWS Profile
export AWS_PROFILE=your-profile-name

# Option 2: IAM Access Keys
export AWS_ACCESS_KEY_ID=AKIA...
export AWS_SECRET_ACCESS_KEY=...

# Option 3: Bearer Token
export AWS_BEARER_TOKEN_BEDROCK=...

# Optional region (defaults to us-east-1)
export AWS_REGION=us-east-1
```

Usage:
```bash
pi --provider amazon-bedrock --model us.anthropic.claude-sonnet-4-20250514-v1:0
```

See [Supported models in Amazon Bedrock](https://docs.aws.amazon.com/bedrock/latest/userguide/models-supported.html).

## OAuth Providers

Use `/login` in interactive mode to authenticate with subscription-based or free-tier providers:

| Provider | Models | Cost |
|----------|--------|------|
| Anthropic (Claude Pro/Max) | Claude models via subscription | Subscription |
| GitHub Copilot | GPT-4o, Claude, Gemini via Copilot | Subscription |
| Google Gemini CLI | Gemini 2.0/2.5 models | Free |
| Google Antigravity | Gemini 3, Claude, GPT-OSS | Free |
| OpenAI Codex (ChatGPT Plus/Pro) | Codex models via ChatGPT | Subscription |

```bash
pi
/login  # Select provider, authorize in browser
```

Use `/logout` to clear credentials.

### GitHub Copilot

- Press Enter for github.com, or enter your GitHub Enterprise Server domain
- If you get "model not supported" error, enable it in VS Code: Copilot Chat → model selector → select model → "Enable"

### Google Providers

- **Gemini CLI**: Production Cloud Code Assist endpoint with standard Gemini models
- **Antigravity**: Sandbox endpoint with Gemini 3, Claude (sonnet/opus thinking), and GPT-OSS
- Both are free with any Google account, subject to rate limits
- Paid Cloud Code Assist subscriptions: set `GOOGLE_CLOUD_PROJECT` or `GOOGLE_CLOUD_PROJECT_ID` env var

### OpenAI Codex

- Requires ChatGPT Plus/Pro subscription
- Prompt cache stored under `~/.pi/agent/cache/openai-codex/`
- Personal use only; for production, use the OpenAI Platform API

## Troubleshooting

**Port 1455 in use:** Close the conflicting process or paste the auth code/URL when prompted.

**Token expired / refresh failed:** Run `/login` again to refresh credentials.

**Usage limits (429):** Wait for the reset window; pi shows the approximate retry time.
