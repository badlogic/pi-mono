# Code Task: Fix Kiro Provider Implementation Issues

## Overview
Fix code quality, testing, and documentation issues in the Kiro provider implementation to meet pi-mono contributor guidelines and code quality standards.

## Reference
- **AGENTS.md**: Code quality rules and provider requirements
- **CONTRIBUTING.md**: Contributor guidelines
- **Existing provider tests**: `packages/ai/test/*.test.ts`
- **Provider examples**: `packages/ai/src/providers/anthropic.ts`, `packages/ai/src/providers/openai-completions.ts`

---

## Task 1: Fix TypeScript Type Safety

**File**: `packages/ai/src/providers/kiro.ts`

**Problem**: 20+ instances of `any` type violate the rule "No `any` types unless absolutely necessary"

**Solution**: Add proper TypeScript interfaces after imports, before constants:

```typescript
// Kiro API type definitions
interface KiroImage {
	format: string;
	source: {
		bytes: string;
	};
}

interface KiroToolUse {
	name: string;
	toolUseId: string;
	input: Record<string, unknown>;
}

interface KiroToolResult {
	content: Array<{ text: string }>;
	status: "success" | "error";
	toolUseId: string;
}

interface KiroToolSpec {
	toolSpecification: {
		name: string;
		description: string;
		inputSchema: {
			json: Record<string, unknown>;
		};
	};
}

interface KiroUserInputMessageContext {
	toolResults?: KiroToolResult[];
	tools?: KiroToolSpec[];
}

interface KiroUserInputMessage {
	content: string;
	modelId: string;
	origin: "AI_EDITOR";
	images?: KiroImage[];
	userInputMessageContext?: KiroUserInputMessageContext;
}

interface KiroAssistantResponseMessage {
	content: string;
	toolUses?: KiroToolUse[];
}

interface KiroHistoryEntry {
	userInputMessage?: KiroUserInputMessage;
	assistantResponseMessage?: KiroAssistantResponseMessage;
}

interface KiroConversationState {
	chatTriggerType: "MANUAL";
	conversationId: string;
	currentMessage: {
		userInputMessage: KiroUserInputMessage;
	};
	history?: KiroHistoryEntry[];
}

interface KiroRequest {
	conversationState: KiroConversationState;
}

interface KiroContentEvent {
	type: "content";
	data: string;
}

interface KiroToolUseEvent {
	type: "toolUse";
	data: {
		name: string;
		toolUseId: string;
		input: string;
		stop?: boolean;
	};
}

interface KiroToolUseInputEvent {
	type: "toolUseInput";
	data: {
		input: string;
	};
}

interface KiroToolUseStopEvent {
	type: "toolUseStop";
	data: {
		stop: boolean;
	};
}

interface KiroContextUsageEvent {
	type: "contextUsage";
	data: {
		contextUsagePercentage: number;
	};
}

type KiroStreamEvent =
	| KiroContentEvent
	| KiroToolUseEvent
	| KiroToolUseInputEvent
	| KiroToolUseStopEvent
	| KiroContextUsageEvent;

interface KiroToolCall {
	toolUseId: string;
	name: string;
	input: string;
}
```

**Changes required**:
1. Replace `function convertImagesToKiro(images: ImageContent[]): any[]` → `KiroImage[]`
2. Replace `function sanitizeHistory(history: any[]): any[]` → `(history: KiroHistoryEntry[]): KiroHistoryEntry[]`
3. Replace `function extractToolUseIdsFromHistory(history: any[]): Set<string>` → `(history: KiroHistoryEntry[]): Set<string>`
4. Replace `function injectSyntheticToolCalls(history: any[]): any[]` → `(history: KiroHistoryEntry[]): KiroHistoryEntry[]`
5. Replace `function truncateHistory(history: any[], limit: number): any[]` → `(history: KiroHistoryEntry[], limit: number): KiroHistoryEntry[]`
6. Replace `function convertToolsToKiro(tools: Tool[]): any[]` → `KiroToolSpec[]`
7. Replace `function addPlaceholderTools(tools: any[], history: any[]): any[]` → `(tools: KiroToolSpec[], history: KiroHistoryEntry[]): KiroToolSpec[]`
8. Replace `function parseKiroEvents(buffer: string): { events: any[]; remaining: string }` → `{ events: KiroStreamEvent[]; remaining: string }`
9. Replace all inline `any` objects with proper types:
   - `const history: any[] = [];` → `const history: KiroHistoryEntry[] = [];`
   - `const uim: any = {` → `const uim: KiroUserInputMessage = {`
   - `const arm: any = { content: "" };` → `const arm: KiroAssistantResponseMessage = { content: "" };`
   - `const request: any = {` → `const request: KiroRequest = {`
   - `const ctx: any = {};` → `const ctx: KiroUserInputMessageContext = {};`
   - `const toolResults: any[] = [` → `const toolResults: KiroToolResult[] = [`
   - `const currentToolResults: any[] = [];` → `const currentToolResults: KiroToolResult[] = [];`
   - `const toolCalls: { toolUseId: string; name: string; input: string }[] = [];` → `const toolCalls: KiroToolCall[] = [];`
   - `let currentToolCall: { toolUseId: string; name: string; input: string } | null = null;` → `let currentToolCall: KiroToolCall | null = null;`

---

## Task 2: Remove Inline Import

**File**: `packages/ai/src/providers/kiro.ts`

**Problem**: Line 635-636 contains inline import and debug code:
```typescript
const fs = await import("fs");
fs.writeFileSync("/tmp/kiro-request.json", JSON.stringify(request, null, 2));
```

**Solution**: Remove these lines entirely (debug code should not be in production)

**Location**: Inside the `streamKiro` function, after `options?.onPayload?.(request);`

---

## Task 3: Add Required Tests

**Problem**: No tests added for Kiro provider

**Solution**: Add Kiro to all required test files

### 3.1 Stream Test
**File**: `packages/ai/test/stream.test.ts`

Add Kiro test case:
```typescript
test("kiro: claude-sonnet-4-5", async () => {
	const apiKey = process.env.KIRO_ACCESS_TOKEN;
	if (!apiKey) {
		console.log("Skipping kiro test (no KIRO_ACCESS_TOKEN)");
		return;
	}

	const result = await testStream({
		model: "claude-sonnet-4-5",
		prompt: "Say 'Hello from Kiro!' and nothing else.",
		apiKey,
	});

	expect(result.text.toLowerCase()).toContain("hello");
	expect(result.usage.totalTokens).toBeGreaterThan(0);
});
```

### 3.2 Tokens Test
**File**: `packages/ai/test/tokens.test.ts`

Add Kiro test case:
```typescript
test("kiro: claude-sonnet-4-5", async () => {
	const apiKey = process.env.KIRO_ACCESS_TOKEN;
	if (!apiKey) {
		console.log("Skipping kiro test (no KIRO_ACCESS_TOKEN)");
		return;
	}

	await testTokens({
		model: "claude-sonnet-4-5",
		apiKey,
	});
});
```

### 3.3 Abort Test
**File**: `packages/ai/test/abort.test.ts`

Add Kiro test case:
```typescript
test("kiro: claude-sonnet-4-5", async () => {
	const apiKey = process.env.KIRO_ACCESS_TOKEN;
	if (!apiKey) {
		console.log("Skipping kiro test (no KIRO_ACCESS_TOKEN)");
		return;
	}

	await testAbort({
		model: "claude-sonnet-4-5",
		apiKey,
	});
});
```

### 3.4 Empty Test
**File**: `packages/ai/test/empty.test.ts`

Add Kiro test case:
```typescript
test("kiro: claude-sonnet-4-5", async () => {
	const apiKey = process.env.KIRO_ACCESS_TOKEN;
	if (!apiKey) {
		console.log("Skipping kiro test (no KIRO_ACCESS_TOKEN)");
		return;
	}

	await testEmpty({
		model: "claude-sonnet-4-5",
		apiKey,
	});
});
```

### 3.5 Context Overflow Test
**File**: `packages/ai/test/context-overflow.test.ts`

Add Kiro test case:
```typescript
test("kiro: claude-sonnet-4-5", async () => {
	const apiKey = process.env.KIRO_ACCESS_TOKEN;
	if (!apiKey) {
		console.log("Skipping kiro test (no KIRO_ACCESS_TOKEN)");
		return;
	}

	await testContextOverflow({
		model: "claude-sonnet-4-5",
		apiKey,
	});
});
```

### 3.6 Image Limits Test
**File**: `packages/ai/test/image-limits.test.ts`

Add Kiro test case:
```typescript
test("kiro: claude-sonnet-4-5", async () => {
	const apiKey = process.env.KIRO_ACCESS_TOKEN;
	if (!apiKey) {
		console.log("Skipping kiro test (no KIRO_ACCESS_TOKEN)");
		return;
	}

	await testImageLimits({
		model: "claude-sonnet-4-5",
		apiKey,
	});
});
```

### 3.7 Unicode Surrogate Test
**File**: `packages/ai/test/unicode-surrogate.test.ts`

Add Kiro test case:
```typescript
test("kiro: claude-sonnet-4-5", async () => {
	const apiKey = process.env.KIRO_ACCESS_TOKEN;
	if (!apiKey) {
		console.log("Skipping kiro test (no KIRO_ACCESS_TOKEN)");
		return;
	}

	await testUnicodeSurrogate({
		model: "claude-sonnet-4-5",
		apiKey,
	});
});
```

### 3.8 Tool Call Without Result Test
**File**: `packages/ai/test/tool-call-without-result.test.ts`

Add Kiro test case:
```typescript
test("kiro: claude-sonnet-4-5", async () => {
	const apiKey = process.env.KIRO_ACCESS_TOKEN;
	if (!apiKey) {
		console.log("Skipping kiro test (no KIRO_ACCESS_TOKEN)");
		return;
	}

	await testToolCallWithoutResult({
		model: "claude-sonnet-4-5",
		apiKey,
	});
});
```

### 3.9 Image Tool Result Test
**File**: `packages/ai/test/image-tool-result.test.ts`

Add Kiro test case:
```typescript
test("kiro: claude-sonnet-4-5", async () => {
	const apiKey = process.env.KIRO_ACCESS_TOKEN;
	if (!apiKey) {
		console.log("Skipping kiro test (no KIRO_ACCESS_TOKEN)");
		return;
	}

	await testImageToolResult({
		model: "claude-sonnet-4-5",
		apiKey,
	});
});
```

### 3.10 Total Tokens Test
**File**: `packages/ai/test/total-tokens.test.ts`

Add Kiro test case:
```typescript
test("kiro: claude-sonnet-4-5", async () => {
	const apiKey = process.env.KIRO_ACCESS_TOKEN;
	if (!apiKey) {
		console.log("Skipping kiro test (no KIRO_ACCESS_TOKEN)");
		return;
	}

	await testTotalTokens({
		model: "claude-sonnet-4-5",
		apiKey,
	});
});
```

### 3.11 Cross-Provider Handoff Test
**File**: `packages/ai/test/cross-provider-handoff.test.ts`

Add Kiro test cases (at least one per model family):
```typescript
test("kiro claude-sonnet-4-5 -> anthropic claude-sonnet-4-5-20250514", async () => {
	const kiroKey = process.env.KIRO_ACCESS_TOKEN;
	const anthropicKey = process.env.ANTHROPIC_API_KEY;
	if (!kiroKey || !anthropicKey) {
		console.log("Skipping kiro->anthropic test (missing keys)");
		return;
	}

	await testCrossProviderHandoff({
		model1: "claude-sonnet-4-5",
		apiKey1: kiroKey,
		model2: "claude-sonnet-4-5-20250514",
		apiKey2: anthropicKey,
	});
});

test("anthropic claude-sonnet-4-5-20250514 -> kiro claude-sonnet-4-5", async () => {
	const anthropicKey = process.env.ANTHROPIC_API_KEY;
	const kiroKey = process.env.KIRO_ACCESS_TOKEN;
	if (!anthropicKey || !kiroKey) {
		console.log("Skipping anthropic->kiro test (missing keys)");
		return;
	}

	await testCrossProviderHandoff({
		model1: "claude-sonnet-4-5-20250514",
		apiKey1: anthropicKey,
		model2: "claude-sonnet-4-5",
		apiKey2: kiroKey,
	});
});
```

---

## Task 4: Update AI Package Documentation

**File**: `packages/ai/README.md`

**Location**: Add to the providers table and add a new section

### 4.1 Update Providers Table
Find the providers table and add:
```markdown
| kiro | AWS Kiro (CodeWhisperer) | Claude models via AWS | `KIRO_ACCESS_TOKEN` |
```

### 4.2 Add Kiro Section
Add after the Bedrock section:

```markdown
### Kiro (AWS CodeWhisperer)

Access Claude models through AWS Kiro (CodeWhisperer).

**Authentication**:
- Set `KIRO_ACCESS_TOKEN` environment variable
- Or use OAuth via `loginOAuth("kiro")` (AWS Builder ID)
- Or use kiro-cli credentials (automatically detected)

**Available Models**:
- `claude-sonnet-4-5` - Claude Sonnet 4.5
- `claude-sonnet-4-5-1m` - Claude Sonnet 4.5 (1M context)
- `claude-haiku-4-5` - Claude Haiku 4.5
- `claude-opus-4-5` - Claude Opus 4.5
- `claude-opus-4-6` - Claude Opus 4.6

**Options**:
```typescript
interface KiroOptions extends StreamOptions {
  region?: "us-east-1" | "us-west-2";  // Default: "us-east-1"
  thinkingEnabled?: boolean;            // Enable thinking mode
  thinkingBudgetTokens?: number;        // Thinking budget (default: 20000)
}
```

**Example**:
```typescript
import { stream, setKiroCredentials } from "@mariozechner/pi-ai";

// Option 1: Environment variable
process.env.KIRO_ACCESS_TOKEN = "your-token";

// Option 2: Set credentials programmatically
setKiroCredentials({
  accessToken: "your-token",
  region: "us-east-1"
});

// Stream with Kiro
for await (const event of stream("claude-sonnet-4-5", {
  messages: [{ role: "user", content: "Hello!" }]
})) {
  if (event.type === "text_delta") {
    process.stdout.write(event.delta);
  }
}
```

**OAuth Login**:
```typescript
import { loginOAuth } from "@mariozechner/pi-ai";

// Login with AWS Builder ID (device code flow)
const credentials = await loginOAuth("kiro", {
  onAuth: ({ url, instructions }) => {
    console.log(`Open: ${url}`);
    console.log(instructions);
  },
  onProgress: (message) => console.log(message)
});
```

**Kiro-CLI Integration**:
Pi automatically detects credentials from kiro-cli's SQLite database:
- macOS: `~/Library/Application Support/kiro-cli/data.sqlite3`
- Linux: `~/.local/share/kiro-cli/data.sqlite3`
- Windows: `%APPDATA%/kiro-cli/data.sqlite3`
```

---

## Task 5: Update Coding Agent Documentation

**File**: `packages/coding-agent/README.md`

**Location**: Add to the "Supported Providers" section and environment variables section

### 5.1 Update Supported Providers
Add to the providers list:
```markdown
- **Kiro** (AWS CodeWhisperer) - Claude models via AWS
```

### 5.2 Add Environment Variable Documentation
Find the environment variables section and add:
```markdown
- `KIRO_ACCESS_TOKEN` - Kiro access token (or use kiro-cli)
```

### 5.3 Add Kiro Setup Section
Add after the Bedrock setup section:

```markdown
#### Kiro (AWS CodeWhisperer)

**Option 1: Use kiro-cli (Recommended)**
```bash
# Install kiro-cli
npm install -g kiro-cli

# Login with AWS Builder ID or IAM Identity Center
kiro-cli auth login

# Pi automatically detects credentials
pi
```

**Option 2: Environment Variable**
```bash
export KIRO_ACCESS_TOKEN="your-token"
pi
```

**Option 3: OAuth Login**
```bash
# Login interactively
pi --login kiro

# Use Kiro models
pi --model claude-sonnet-4-5
```

**Available Models**:
- `claude-sonnet-4-5` (default)
- `claude-sonnet-4-5-1m` (1M context)
- `claude-haiku-4-5`
- `claude-opus-4-5`
- `claude-opus-4-6`
```

---

## Task 6: Update CHANGELOG

**File**: `packages/ai/CHANGELOG.md`

**Location**: Under `## [Unreleased]` section, in the `### Added` subsection

Add entry:
```markdown
- Added Kiro provider for accessing Claude models via AWS CodeWhisperer with OAuth support (AWS Builder ID) and kiro-cli integration
```

---

## Verification Steps

1. **Type Check**: Run `npm run check` - should pass with no errors
2. **Build**: Run `npm run build` in `packages/ai` - should succeed
3. **Tests**: Run `./test.sh` - Kiro tests should skip if no credentials, pass if credentials available
4. **Manual Test**: Test with valid Kiro credentials:
   ```typescript
   import { stream } from "@mariozechner/pi-ai";
   
   for await (const event of stream("claude-sonnet-4-5", {
     messages: [{ role: "user", content: "Hello!" }],
     apiKey: process.env.KIRO_ACCESS_TOKEN
   })) {
     console.log(event);
   }
   ```

---

## Notes

- All `any` types must be replaced with proper interfaces
- Debug code (fs write) must be removed
- Tests must gracefully skip when credentials are not available
- Documentation must include all authentication methods
- OAuth flow uses AWS Builder ID device code flow
- Kiro-cli integration reads from SQLite database automatically
