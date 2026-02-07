# Code Task: Reimplement Kiro as Custom Provider

## Context
Per issue #1342, the maintainer wants Kiro implemented as a **custom provider** instead of being built into `@pi/ai`. This allows it to be distributed separately as an NPM package or git repo.

## Goals
1. Remove Kiro from built-in providers in `@pi/ai`
2. Create standalone `pi-provider-kiro` package
3. Implement using `pi.registerProvider()` API with OAuth support
4. Make it installable via `/package add` command

## Part 1: Remove Kiro from Built-in Providers

### Files to modify in `packages/ai/`:

1. **`src/providers/kiro.ts`** - DELETE
2. **`src/providers/kiro-thinking-parser.ts`** - DELETE  
3. **`src/utils/oauth/kiro.ts`** - DELETE
4. **`src/providers/register-builtins.ts`** - Remove kiro registration
5. **`src/utils/oauth/index.ts`** - Remove kiro OAuth export
6. **`src/types.ts`** - Remove "kiro" from Api type union
7. **`src/env-api-keys.ts`** - Remove kiro env key handling
8. **`src/models.generated.ts`** - Remove kiro models (will be regenerated)
9. **`src/models.ts`** - Remove kiro-specific logic
10. **`scripts/generate-models.ts`** - Remove kiro model generation

### Files to modify in `packages/coding-agent/`:

1. **`src/core/model-resolver.ts`** - Remove kiro default model
2. **`src/core/auth-storage.ts`** - Already generic, no changes needed
3. **`README.md`** - Remove kiro setup instructions
4. **`docs/providers.md`** - Remove kiro documentation
5. **`src/cli/args.ts`** - Remove KIRO_ACCESS_TOKEN env var docs

### Test files to modify in `packages/ai/test/`:

Remove kiro from all test files:
- `abort.test.ts`
- `context-overflow.test.ts`
- `cross-provider-handoff.test.ts`
- `empty.test.ts`
- `image-tool-result.test.ts`
- `stream.test.ts`
- `tokens.test.ts`
- `tool-call-without-result.test.ts`
- `total-tokens.test.ts`
- `unicode-surrogate.test.ts`

### Update CHANGELOG

**`packages/ai/CHANGELOG.md`:**
- Remove the "Added Kiro provider" entry from Unreleased
- Add "Removed Kiro provider (now available as custom provider package)" to Breaking Changes

## Part 2: Create Custom Provider Package

### Package structure:

```
pi-provider-kiro/
├── package.json
├── tsconfig.json
├── README.md
├── src/
│   ├── index.ts              # Main extension entry point
│   ├── kiro-provider.ts      # Stream implementation
│   ├── kiro-oauth.ts         # OAuth implementation
│   ├── kiro-thinking-parser.ts  # Thinking parser
│   └── models.ts             # Model definitions
└── test/
    └── kiro.test.ts          # Basic tests
```

### `package.json`:

```json
{
  "name": "pi-provider-kiro",
  "version": "1.0.0",
  "description": "Kiro (Amazon Q Developer) provider for pi coding agent",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "keywords": ["pi", "pi-extension", "kiro", "amazon-q", "llm"],
  "peerDependencies": {
    "@mariozechner/pi-coding-agent": ">=0.52.0",
    "@mariozechner/pi-ai": ">=0.52.0"
  },
  "devDependencies": {
    "@mariozechner/pi-coding-agent": "^0.52.0",
    "@mariozechner/pi-ai": "^0.52.0",
    "typescript": "^5.7.3"
  },
  "scripts": {
    "build": "tsc",
    "prepublishOnly": "npm run build"
  },
  "files": ["dist", "README.md"],
  "repository": {
    "type": "git",
    "url": "https://github.com/mikeyobrien/pi-provider-kiro.git"
  },
  "author": "Mikey O'Brien",
  "license": "MIT"
}
```

### `src/index.ts`:

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { kiroOAuth } from "./kiro-oauth.js";
import { kiroModels } from "./models.js";
import { streamKiro } from "./kiro-provider.js";

export default function (pi: ExtensionAPI) {
  pi.registerProvider("kiro", {
    api: "kiro",
    models: kiroModels,
    oauth: kiroOAuth,
    streamSimple: streamKiro
  });
}
```

### `src/models.ts`:

Export the model definitions (copy from current `models.generated.ts` kiro models):

```typescript
import type { ProviderModelConfig } from "@mariozechner/pi-coding-agent";

export const kiroModels: ProviderModelConfig[] = [
  {
    id: "auto",
    name: "Auto",
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 8192
  },
  {
    id: "claude-haiku-4-5",
    name: "Claude 4.5 Haiku",
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 1.0, output: 5.0, cacheRead: 0.1, cacheWrite: 1.25 },
    contextWindow: 200000,
    maxTokens: 8192
  },
  // ... rest of models
];
```

### `src/kiro-oauth.ts`:

Copy OAuth implementation from current `packages/ai/src/utils/oauth/kiro.ts` and adapt:

```typescript
import type { OAuthCredentials, OAuthLoginCallbacks } from "@mariozechner/pi-ai";

export const kiroOAuth = {
  name: "Kiro (AWS Builder ID)",

  async login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
    // Copy loginKiroBuilderID implementation
  },

  async refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
    // Copy refreshKiroToken implementation
  },

  getApiKey(credentials: OAuthCredentials): string {
    return credentials.access;
  },

  getCliToken(): string | undefined {
    // Copy getKiroCliToken implementation
  }
};
```

### `src/kiro-provider.ts`:

Copy streaming implementation from current `packages/ai/src/providers/kiro.ts` and adapt:

```typescript
import type {
  AssistantMessageEventStream,
  Context,
  Model,
  SimpleStreamOptions
} from "@mariozechner/pi-ai";
import { createAssistantMessageEventStream, calculateCost } from "@mariozechner/pi-ai";

export function streamKiro(
  model: Model<any>,
  context: Context,
  options?: SimpleStreamOptions
): AssistantMessageEventStream {
  // Copy streamKiro implementation
}
```

### `src/kiro-thinking-parser.ts`:

Copy thinking parser from current `packages/ai/src/providers/kiro-thinking-parser.ts`

### `README.md`:

```markdown
# pi-provider-kiro

Kiro (Amazon Q Developer) provider for [pi coding agent](https://pi.dev).

## Installation

```bash
/package add pi-provider-kiro
```

Or manually:

```bash
npm install pi-provider-kiro
```

Then add to your `~/.pi/agent/settings.json`:

```json
{
  "extensions": {
    "packages": ["pi-provider-kiro"]
  }
}
```

## Authentication

Login with AWS Builder ID:

```bash
/login kiro
```

This will open a browser for OAuth authentication. You can sign in with:
- Google
- GitHub  
- AWS credentials

Credentials are automatically refreshed and stored securely.

### kiro-cli Integration

If you have [kiro-cli](https://kiro.dev/cli/) installed, pi will automatically use those credentials as a fallback.

## Available Models

- Claude 4.5 Haiku
- Claude 4 Sonnet, 4.5 Sonnet, 4.5 Sonnet 1M
- Claude 4.5 Opus, 4.6 Opus
- Qwen3 Coder 480B

## Extended Thinking

Kiro supports extended thinking mode for compatible models:

```bash
/model claude-opus-4-6-thinking
```

## License

MIT
```

## Part 3: Testing

1. Build the custom provider package
2. Test installation via `/package add`
3. Test OAuth login flow
4. Test model selection and streaming
5. Test thinking mode
6. Test kiro-cli fallback

## Part 4: Publishing

1. Create GitHub repo: `mikeyobrien/pi-provider-kiro`
2. Publish to NPM: `npm publish`
3. Submit to pi.dev/packages (if desired)

## Acceptance Criteria

- [ ] Kiro completely removed from `@pi/ai` built-in providers
- [ ] All tests pass without kiro
- [ ] Custom provider package builds successfully
- [ ] OAuth login works via `/login kiro`
- [ ] Models are selectable and streaming works
- [ ] Thinking mode works for compatible models
- [ ] kiro-cli fallback works
- [ ] Package installable via `/package add pi-provider-kiro`
- [ ] Documentation is clear and complete

## Notes

- The custom provider approach keeps the core lean
- Users who need Kiro can easily install it
- Easier to maintain and update independently
- Can be published to NPM for discoverability
