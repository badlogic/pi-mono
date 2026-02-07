# Code Task: Add Kiro as an LLM Provider to Pi-Mono

## Overview
Integrate AWS Kiro (CodeWhisperer) as a new LLM provider in pi-mono, enabling access to Claude models (Sonnet 4.5, Haiku 4.5, Opus 4.5) through Kiro's API.

## Reference Implementation
- **Auth reference**: `/Users/mobrienv/Code/opencode-kiro-auth`
- **Pi providers**: `/Users/mobrienv/Code/pi-mono/packages/ai/src/providers/`

---

## Task 1: Define Kiro API Type

**File**: `packages/ai/src/types.ts`

Add `kiro` to the `Api` type union:
```typescript
export type Api = 
  | "anthropic-messages"
  | "openai-completions"
  | "openai-responses"
  | "bedrock-converse-stream"
  | "google-generative-ai"
  | "kiro"  // ADD THIS
```

---

## Task 2: Create Kiro Provider Implementation

**File**: `packages/ai/src/providers/kiro.ts` (new file)

```typescript
import { registerApiProvider } from "../api-registry"
import type { Model, Context, StreamFunction, AssistantMessageEventStream } from "../types"

const KIRO_ENDPOINT = "https://q.us-east-1.amazonaws.com/generateAssistantResponse"

interface KiroOptions {
  region?: "us-east-1" | "us-west-2"
}

interface KiroCredentials {
  accessToken: string
  refreshToken?: string
  expiresAt?: number
}

// Token storage (in-memory, can be persisted)
let credentials: KiroCredentials | null = null

export function setKiroCredentials(creds: KiroCredentials) {
  credentials = creds
}

export function getKiroCredentials(): KiroCredentials | null {
  return credentials
}

const stream: StreamFunction<"kiro", KiroOptions> = async function* (
  model: Model<"kiro">,
  context: Context,
  options?: KiroOptions
): AssistantMessageEventStream {
  if (!credentials?.accessToken) {
    yield { type: "error", error: new Error("Kiro credentials not set. Call setKiroCredentials() first.") }
    return
  }

  const region = options?.region ?? "us-east-1"
  const endpoint = `https://q.${region}.amazonaws.com/generateAssistantResponse`

  // Transform context messages to Kiro format
  const messages = context.messages.map(msg => ({
    role: msg.role,
    content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)
  }))

  const body = {
    conversationState: {
      conversationId: context.conversationId ?? crypto.randomUUID(),
      currentMessage: {
        userInputMessage: {
          content: messages[messages.length - 1]?.content ?? "",
          userInputMessageContext: {
            editorState: { cursorState: null }
          }
        }
      },
      chatTriggerType: "MANUAL",
      customizationArn: ""
    }
  }

  yield { type: "start" }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${credentials.accessToken}`,
        "x-amz-target": "AmazonQDeveloperStreamingService.GenerateAssistantResponse",
        "x-amzn-transcribe-session-id": crypto.randomUUID()
      },
      body: JSON.stringify(body),
      signal: context.abortSignal
    })

    if (!response.ok) {
      throw new Error(`Kiro API error: ${response.status} ${response.statusText}`)
    }

    const reader = response.body?.getReader()
    if (!reader) throw new Error("No response body")

    const decoder = new TextDecoder()
    let buffer = ""

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      
      // Parse streaming events (Kiro uses event-stream format)
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""

      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const event = JSON.parse(line)
          if (event.assistantResponseEvent?.content) {
            yield { type: "text_delta", text: event.assistantResponseEvent.content }
          }
        } catch {
          // Skip non-JSON lines
        }
      }
    }

    yield { type: "done" }
  } catch (error) {
    yield { type: "error", error: error instanceof Error ? error : new Error(String(error)) }
  }
}

// Simple stream wrapper
const streamSimple: StreamFunction<"kiro", KiroOptions> = stream

// Register the provider
registerApiProvider("kiro", { stream, streamSimple })

export { stream, streamSimple }
```

---

## Task 3: Add Kiro Models

**File**: `packages/ai/src/models.ts`

Add Kiro models to the registry:
```typescript
// Kiro models (Claude via AWS)
registerModel({
  id: "claude-sonnet-4-5-20250514",
  name: "Claude Sonnet 4.5 (Kiro)",
  api: "kiro",
  provider: "kiro",
  inputCostPer1M: 3.0,
  outputCostPer1M: 15.0,
  contextWindow: 200000,
  capabilities: ["tools", "vision", "streaming"]
})

registerModel({
  id: "claude-sonnet-4-5-20250514-thinking",
  name: "Claude Sonnet 4.5 Thinking (Kiro)",
  api: "kiro",
  provider: "kiro",
  inputCostPer1M: 3.0,
  outputCostPer1M: 15.0,
  contextWindow: 200000,
  capabilities: ["tools", "vision", "streaming", "thinking"]
})

registerModel({
  id: "claude-haiku-4-5-20250514",
  name: "Claude Haiku 4.5 (Kiro)",
  api: "kiro",
  provider: "kiro",
  inputCostPer1M: 0.8,
  outputCostPer1M: 4.0,
  contextWindow: 200000,
  capabilities: ["tools", "vision", "streaming"]
})

registerModel({
  id: "claude-opus-4-5-20250514",
  name: "Claude Opus 4.5 (Kiro)",
  api: "kiro",
  provider: "kiro",
  inputCostPer1M: 15.0,
  outputCostPer1M: 75.0,
  contextWindow: 200000,
  capabilities: ["tools", "vision", "streaming", "thinking"]
})
```

---

## Task 4: Register Kiro in Builtins

**File**: `packages/ai/src/providers/register-builtins.ts`

Add import:
```typescript
import "./kiro"
```

---

## Task 5: Add Kiro OAuth Support (Optional)

**File**: `packages/ai/src/utils/oauth/kiro.ts` (new file)

Implement AWS Builder ID OAuth flow based on opencode-kiro-auth:
- Device code flow via `https://oidc.{region}.amazonaws.com`
- Client registration with `kiro` scope
- Token refresh with encoded format: `{token}|{clientId}|{clientSecret}|{method}`

---

## Task 6: Add Environment Variable Support

**File**: `packages/ai/src/env-api-keys.ts`

Add Kiro to the env key mapping:
```typescript
case "kiro":
  return process.env.KIRO_ACCESS_TOKEN
```

---

## Verification Steps

1. Build the package: `npm run build` in `packages/ai`
2. Test import: `import { stream } from "./providers/kiro"`
3. Test model lookup: `getModel("kiro", "claude-sonnet-4-5-20250514")`
4. Test streaming with valid credentials

---

## Notes

- Kiro uses AWS-style authentication with Bearer tokens
- The API endpoint varies by region (us-east-1, us-west-2)
- Response format is event-stream with JSON payloads
- Consider adding kiro-cli database sync for seamless auth (see opencode-kiro-auth `cli-sync.ts`)
