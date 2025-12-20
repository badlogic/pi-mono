# Google Cloud Code Assist Provider Implementation Plan

## Overview
Add support for Gemini CLI / Antigravity authentication, which uses Google's Cloud Code Assist API (`cloudcode-pa.googleapis.com`) to access Gemini and Claude models through a unified gateway.

## References
- Antigravity API Spec: https://github.com/NoeFabris/opencode-antigravity-auth/blob/main/docs/ANTIGRAVITY_API_SPEC.md
- Gemini CLI Auth: https://github.com/jenslys/opencode-gemini-auth
- Antigravity Auth: https://github.com/NoeFabris/opencode-antigravity-auth

## Key Differences from Standard Google Provider
1. **Endpoint**: `cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse`
2. **Auth**: OAuth token (not API key)
3. **Request format**: Wrapped in `{ project, model, request: {...} }`
4. **Response format**: Wrapped in `{ response: {...} }` (needs unwrapping)
5. **Headers**: Requires `User-Agent`, `X-Goog-Api-Client`, `Client-Metadata`

## OAuth Details
- **Client ID**: `681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com`
- **Client Secret**: `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`
- **Redirect URI**: `http://localhost:8085/oauth2callback`
- **Scopes**: `cloud-platform`, `userinfo.email`, `userinfo.profile`
- **Token URL**: `https://oauth2.googleapis.com/token`
- **Auth URL**: `https://accounts.google.com/o/oauth2/v2/auth`

## Available Models
| Model ID | Type | Context | Output | Reasoning |
|----------|------|---------|--------|-----------|
| gemini-3-pro-high | Gemini | 1M | 64K | Yes |
| gemini-3-pro-low | Gemini | 1M | 64K | Yes |
| gemini-3-flash | Gemini | 1M | 64K | No |
| claude-sonnet-4-5 | Claude | 200K | 64K | No |
| claude-sonnet-4-5-thinking | Claude | 200K | 64K | Yes |
| claude-opus-4-5-thinking | Claude | 200K | 64K | Yes |
| gpt-oss-120b-medium | GPT-OSS | 128K | 32K | No |

All models support: text, image, pdf input; text output; cost is $0 (uses Google account quota)

---

## Implementation Steps

### Step 1: Update types.ts
File: `packages/ai/src/types.ts`

Add new API type:
```typescript
export type Api = "openai-completions" | "openai-responses" | "anthropic-messages" | "google-generative-ai" | "google-cloud-code-assist";
```

### Step 2: Create google-shared.ts
File: `packages/ai/src/providers/google-shared.ts`

Extract from `google.ts`:
- `convertMessages()` - convert internal messages to Gemini Content[] format
- `convertTools()` - convert tools to Gemini function declarations
- `mapToolChoice()` - map tool choice to Gemini enum
- `mapStopReason()` - map Gemini finish reason to our stop reason
- Shared types and imports

Make functions generic to work with both `google-generative-ai` and `google-cloud-code-assist` API types.

### Step 3: Update google.ts
File: `packages/ai/src/providers/google.ts`

- Import shared functions from `google-shared.ts`
- Remove extracted functions
- Keep: `createClient()`, `buildParams()`, `streamGoogle()`

### Step 4: Create google-cloud-code-assist.ts
File: `packages/ai/src/providers/google-cloud-code-assist.ts`

Implement:
```typescript
export interface GoogleCloudCodeAssistOptions extends StreamOptions {
  toolChoice?: "auto" | "none" | "any";
  thinking?: {
    enabled: boolean;
    budgetTokens?: number;
  };
  projectId?: string; // Google Cloud project ID
}

export const streamGoogleCloudCodeAssist: StreamFunction<"google-cloud-code-assist"> = (
  model: Model<"google-cloud-code-assist">,
  context: Context,
  options?: GoogleCloudCodeAssistOptions,
): AssistantMessageEventStream => {
  // Implementation
};
```

Key implementation details:
1. **Build request body**:
   ```json
   {
     "project": "{projectId}",
     "model": "{modelId}",
     "request": {
       "contents": [...],
       "systemInstruction": { "parts": [{ "text": "..." }] },
       "generationConfig": { ... },
       "tools": [...]
     }
   }
   ```

2. **Headers**:
   ```
   Authorization: Bearer {accessToken}
   Content-Type: application/json
   Accept: text/event-stream
   User-Agent: google-api-nodejs-client/9.15.1
   X-Goog-Api-Client: gl-node/22.17.0
   Client-Metadata: ideType=IDE_UNSPECIFIED,platform=PLATFORM_UNSPECIFIED,pluginType=GEMINI
   ```

3. **Endpoint**: `https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse`

4. **Parse SSE response**:
   - Each line: `data: {"response": {...}, "traceId": "..."}`
   - Extract `response` object, which has same structure as standard Gemini response
   - Handle thinking parts with `thought: true` and `thoughtSignature`

5. **Use shared functions** for message/tool conversion and stop reason mapping

### Step 5: Update stream.ts
File: `packages/ai/src/stream.ts`

Add case for new provider:
```typescript
import { streamGoogleCloudCodeAssist } from "./providers/google-cloud-code-assist.js";

// In the switch/case or if/else chain:
case "google-cloud-code-assist":
  return streamGoogleCloudCodeAssist(model, context, {
    ...options,
    // map reasoning to thinking config
  });
```

### Step 6: Update models.ts
File: `packages/ai/src/models.ts`

Add to `xhighSupportedModels` if applicable (check if any models support xhigh).

### Step 7: Add models to generate-models.ts
File: `packages/ai/scripts/generate-models.ts`

Add hardcoded models:
```typescript
const googleCloudCodeAssistModels: Model<"google-cloud-code-assist">[] = [
  {
    id: "gemini-3-pro-high",
    provider: "google-cloud-code-assist",
    api: "google-cloud-code-assist",
    name: "Gemini 3 Pro High",
    contextWindow: 1048576,
    maxOutputTokens: 65535,
    pricing: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    input: ["text", "image", "pdf"],
    output: ["text"],
    reasoning: true,
  },
  // ... other models
];
```

### Step 8: Update index.ts exports
File: `packages/ai/src/index.ts`

Export new provider:
```typescript
export { streamGoogleCloudCodeAssist, type GoogleCloudCodeAssistOptions } from "./providers/google-cloud-code-assist.js";
```

---

## Phase 2: OAuth Flow in coding-agent

### Step 9: Create google-cloud.ts OAuth handler
File: `packages/coding-agent/src/core/oauth/google-cloud.ts`

Implement:
```typescript
import { createHash, randomBytes } from "crypto";
import { createServer } from "http";
import { type OAuthCredentials, saveOAuthCredentials } from "./storage.js";

const CLIENT_ID = "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com";
const CLIENT_SECRET = "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";
const REDIRECT_URI = "http://localhost:8085/oauth2callback";
const SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export async function loginGoogleCloud(
  onAuth: (info: { url: string; instructions?: string }) => void,
  onProgress?: (message: string) => void,
): Promise<OAuthCredentials & { projectId?: string }> {
  // 1. Generate PKCE
  // 2. Start local server on port 8085
  // 3. Build auth URL and call onAuth
  // 4. Wait for callback with code
  // 5. Exchange code for tokens
  // 6. Discover/provision project via loadCodeAssist endpoint
  // 7. Return credentials with projectId
}

export async function refreshGoogleCloudToken(refreshToken: string): Promise<OAuthCredentials> {
  // Refresh token flow
}

// Project discovery
async function discoverProject(accessToken: string): Promise<string> {
  // Call /v1internal:loadCodeAssist to get project ID
  // Or /v1internal:onboardUser if needed
}
```

### Step 10: Update oauth/index.ts
File: `packages/coding-agent/src/core/oauth/index.ts`

- Add `"google-cloud"` to `SupportedOAuthProvider`
- Add to `getOAuthProviders()` list
- Add case in `login()` function
- Add case in `refreshToken()` function

### Step 11: Update oauth/storage.ts
File: `packages/coding-agent/src/core/oauth/storage.ts`

Extend `OAuthCredentials` to include optional `projectId`:
```typescript
export interface OAuthCredentials {
  type: "oauth";
  refresh: string;
  access: string;
  expires: number;
  enterpriseUrl?: string;
  projectId?: string;  // For Google Cloud
}
```

### Step 12: Update model-config.ts
File: `packages/coding-agent/src/core/model-config.ts`

Add logic to get API key for `google-cloud-code-assist` provider:
- Check for OAuth token via `getOAuthToken("google-cloud")`
- Return the access token as the "API key"

---

## Phase 3: Testing

### Manual Testing
1. Run `pi` and use `/login` to authenticate with Google
2. Select a google-cloud-code-assist model
3. Send a message and verify streaming works
4. Test tool calling
5. Test thinking models

### Verification Points
- [ ] OAuth flow completes successfully
- [ ] Token refresh works
- [ ] Streaming text works
- [ ] Thinking blocks are parsed correctly
- [ ] Tool calls work
- [ ] Tool results are sent correctly
- [ ] Error handling works (rate limits, auth errors)

---

## Notes

### systemInstruction Format
Must be object with parts, NOT plain string:
```json
{
  "systemInstruction": {
    "parts": [{ "text": "You are a helpful assistant." }]
  }
}
```

### Tool Name Rules
- Must start with letter or underscore
- Allowed: a-zA-Z0-9, underscores, dots, colons, dashes
- Max 64 chars
- No slashes or spaces

### Thinking Config
```json
{
  "generationConfig": {
    "thinkingConfig": {
      "thinkingBudget": 8000,
      "includeThoughts": true
    }
  }
}
```

### Response Unwrapping
SSE lines come as:
```
data: {"response": {...}, "traceId": "..."}
```
Need to extract `response` object which matches standard Gemini format.
