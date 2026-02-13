# Plan: Utilizing Local LLM Models Instead of Cloud Models in pi-mono

## Executive Summary

pi-mono (the `pi` coding agent) already has significant infrastructure for local LLM support — the `openai-completions` API backend handles any OpenAI-compatible server, the `~/.pi/agent/models.json` config allows custom provider definitions, the web-ui package has Ollama/LM Studio/vLLM/llama.cpp auto-discovery, and the `pods` package manages GPU pod deployments with vLLM. However, the coding agent CLI itself lacks auto-discovery, the tool-calling pipeline has no resilience against weaker local models, compaction targets cloud-model context windows, and there is no guidance or first-class workflow for running the full agent loop against local models.

This plan covers what needs to change — and what can stay the same — to make local LLMs a first-class, reliable experience in pi-mono.

---

## Table of Contents

1. [Current State Analysis](#1-current-state-analysis)
2. [Target Local Model Backends](#2-target-local-model-backends)
3. [Phase 1: CLI Auto-Discovery for Local Models](#3-phase-1-cli-auto-discovery-for-local-models)
4. [Phase 2: Robust Tool Calling for Local Models](#4-phase-2-robust-tool-calling-for-local-models)
5. [Phase 3: Context Window & Compaction Tuning](#5-phase-3-context-window--compaction-tuning)
6. [Phase 4: Local Model Compatibility Layer](#6-phase-4-local-model-compatibility-layer)
7. [Phase 5: Recommended Model Profiles](#7-phase-5-recommended-model-profiles)
8. [Phase 6: Ollama-Native Provider (Optional)](#8-phase-6-ollama-native-provider-optional)
9. [Phase 7: Testing & Validation](#9-phase-7-testing--validation)
10. [Phase 8: Documentation & Onboarding](#10-phase-8-documentation--onboarding)
11. [Risk Assessment](#11-risk-assessment)
12. [Appendix: Reference Architecture](#12-appendix-reference-architecture)

---

## 1. Current State Analysis

### What Already Works

| Capability | Status | Location |
|---|---|---|
| OpenAI-compatible API streaming | Full support | `packages/ai/src/providers/openai-completions.ts` |
| Custom provider config (`models.json`) | Full support | `packages/coding-agent/src/core/model-registry.ts` |
| Web-UI auto-discovery (Ollama, LM Studio, vLLM, llama.cpp) | Full support | `packages/web-ui/src/utils/model-discovery.ts` |
| GPU pod management with vLLM | Full support | `packages/pods/` |
| Extension-based custom providers | Full support | `packages/coding-agent/src/core/model-registry.ts` → `registerProvider()` |
| Partial JSON parsing for streaming tool calls | Full support | `packages/ai/src/utils/json-parse.ts` |
| Cross-provider message transformation | Full support | `packages/ai/src/providers/transform-messages.ts` |
| Reasoning field detection (`reasoning_content`, `reasoning`, `reasoning_text`) | Full support | `openai-completions.ts:205-218` |
| Qwen thinking format (`enable_thinking`) | Full support | `openai-completions.ts:432` |
| Compat overrides for provider quirks | Full support | `OpenAICompletionsCompat` in `types.ts:219-246` |

### What's Missing or Needs Work

| Gap | Impact | Priority |
|---|---|---|
| No auto-discovery in CLI (coding-agent) | Users must manually configure `models.json` | High |
| No tool-call repair/retry for local models | Weaker models produce malformed tool calls, causing agent loop failures | High |
| Compaction thresholds assume large context windows (128K+) | Local models often have 8K-32K context; compaction triggers too late | High |
| No compat presets for common local models | Each user must figure out `thinkingFormat`, `maxTokensField`, etc. | Medium |
| No model capability filtering in CLI | Agent assigns tools to models that can't use them properly | Medium |
| No connection-test or health-check for local endpoints | Silent failures when Ollama/vLLM isn't running | Medium |
| No fallback chain (local → cloud) | Can't gracefully degrade when local model fails | Low |
| No token counting for local models | Usage tracking inaccurate (some local servers don't report usage) | Low |

### Key Architecture Constraints

1. **All providers funnel through `openai-completions` API** — Ollama, vLLM, llama.cpp, and LM Studio all expose `/v1/chat/completions`. No new API backend is needed.

2. **The `streamOpenAICompletions` function already handles provider quirks** via the `OpenAICompletionsCompat` config. Local models need their own compat entries.

3. **The agent loop (`packages/agent/src/agent-loop.ts`) is model-agnostic** — it calls `streamSimple()` and processes tool calls generically. Changes here would benefit all models.

4. **The `ModelRegistry` class merges built-in and custom models** — custom models from `models.json` override built-in models with the same provider+id. Auto-discovered local models can use this same merge mechanism.

---

## 2. Target Local Model Backends

### Tier 1 — Full Support (tool calling works out of the box)

| Backend | Default URL | Tool Calling | Reasoning | Notes |
|---|---|---|---|---|
| **Ollama** | `http://localhost:11434` | Via `--tool-call-parser` or native | Qwen3 `enable_thinking` | Most popular for local dev. Filters for `tools` capability. |
| **vLLM** | `http://localhost:8000` | Via `--enable-auto-tool-choice --tool-call-parser <parser>` | Model-dependent | Best for GPU pods. Already supported by `packages/pods`. |
| **LM Studio** | `http://localhost:1234` | SDK reports `trainedForToolUse` | Limited | Easy GUI setup. WebSocket SDK for discovery. |

### Tier 2 — Partial Support (may need workarounds)

| Backend | Default URL | Tool Calling | Notes |
|---|---|---|---|
| **llama.cpp** server | `http://localhost:8080` | Grammar-constrained output | Reasoning via `reasoning_content` field already handled. |
| **text-generation-webui** | `http://localhost:5000` | OpenAI-compatible extension | Needs `--extensions openai` flag. |

### Recommended Local Models for Coding Agent Use

| Model | Parameters | Context | Tool Calling | VRAM Required | Quality Tier |
|---|---|---|---|---|---|
| Qwen 2.5 Coder 32B Instruct | 32B | 32K | Hermes parser | ~20GB (Q4) / ~36GB (FP16) | Good |
| Qwen 3 Coder 30B A3B Instruct | 30B (3B active MoE) | 32K-262K | `qwen3_coder` parser | ~20GB (Q4) / ~60GB (FP16) | Very Good |
| DeepSeek Coder V2 Lite Instruct | 16B (2.4B active) | 128K | Native | ~10GB (Q4) | Decent |
| Llama 3.1 70B Instruct | 70B | 128K | Native | ~40GB (Q4) | Good |
| Mistral/Devstral Small 24B | 24B | 32K | Native | ~15GB (Q4) | Good |

---

## 3. Phase 1: CLI Auto-Discovery for Local Models

### Goal

Bring the web-ui's auto-discovery capabilities into the coding-agent CLI, so running `pi` with a local Ollama/vLLM server "just works" without manual `models.json` configuration.

### Implementation

#### 3.1 Create `packages/coding-agent/src/core/local-discovery.ts`

Port the discovery logic from `packages/web-ui/src/utils/model-discovery.ts` into a Node.js-compatible module (the web-ui version uses browser APIs and the `ollama/browser` import).

```typescript
// Pseudo-structure
export interface LocalProviderConfig {
  type: "ollama" | "vllm" | "lmstudio" | "llama.cpp";
  baseUrl: string;
  name: string;
}

const DEFAULT_PROVIDERS: LocalProviderConfig[] = [
  { type: "ollama",    baseUrl: "http://localhost:11434", name: "ollama-local" },
  { type: "vllm",      baseUrl: "http://localhost:8000",  name: "vllm-local" },
  { type: "lmstudio",  baseUrl: "http://localhost:1234",  name: "lmstudio-local" },
  { type: "llama.cpp", baseUrl: "http://localhost:8080",  name: "llamacpp-local" },
];

export async function discoverLocalModels(
  providers?: LocalProviderConfig[],
  timeoutMs?: number,
): Promise<DiscoveredModel[]> { ... }
```

Key behaviors:
- Probe each default URL with a short timeout (2s) to detect running servers
- For Ollama: use the `ollama` npm package (Node.js version, not browser) to call `ollama.list()` then `ollama.show()` per model, filtering for `tools` capability
- For vLLM/llama.cpp: HTTP GET to `/v1/models`
- For LM Studio: use `@lmstudio/sdk` WebSocket connection
- Set `provider` to the local provider name (e.g., `"ollama-local"`)
- Set `api` to `"openai-completions"` for all
- Set `cost` to `{ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }`
- Auto-detect `reasoning` capability (Qwen3's `thinking` capability flag in Ollama)
- Set appropriate `compat` overrides per model family (see Phase 4)

#### 3.2 Integrate into `ModelRegistry`

Add a `discoverLocal()` method to `ModelRegistry` that runs discovery and merges results:

```typescript
class ModelRegistry {
  async discoverLocal(options?: { timeout?: number }): Promise<DiscoveredModel[]> {
    const discovered = await discoverLocalModels(undefined, options?.timeout);
    // Register as a special "local" provider group
    // Merge into this.models (local models don't override cloud models with same ID)
    return discovered;
  }
}
```

#### 3.3 Hook into CLI Startup

In `packages/coding-agent/src/index.ts` (or the interactive mode entry point), run auto-discovery on startup:

- Run discovery in the background (non-blocking) with a 3s timeout
- If local models are found and no cloud API keys are configured, auto-select the best local model
- Show discovered local models in the model selector (Ctrl+L / `/model`)
- Cache discovery results for the session (re-discover on `/model refresh` or similar command)

#### 3.4 Settings for Discovery

Add to `settings-manager.ts`:

```json
{
  "localDiscovery": {
    "enabled": true,
    "providers": [
      { "type": "ollama", "baseUrl": "http://localhost:11434" }
    ],
    "autoSelect": true
  }
}
```

### Files Modified

| File | Change |
|---|---|
| `packages/coding-agent/src/core/local-discovery.ts` | **New file** — discovery logic |
| `packages/coding-agent/src/core/model-registry.ts` | Add `discoverLocal()` method |
| `packages/coding-agent/src/core/settings-manager.ts` | Add `localDiscovery` settings |
| `packages/coding-agent/src/modes/interactive/interactive-mode.ts` | Call discovery on startup |
| `packages/coding-agent/package.json` | Add `ollama` dependency (Node.js version) |

---

## 4. Phase 2: Robust Tool Calling for Local Models

### Problem

Local models (especially smaller ones) frequently produce malformed tool calls:
- Invalid JSON in arguments (missing quotes, trailing commas, unescaped strings)
- Tool names with slight variations (e.g., `read_File` instead of `read_file`)
- Missing required arguments
- Tool call format embedded in text output instead of structured `tool_calls` field
- Multiple tool calls merged into a single malformed call

The current `parseStreamingJson()` in `packages/ai/src/utils/json-parse.ts` handles incomplete JSON during streaming via `partial-json`, but doesn't repair structurally invalid JSON after streaming completes.

### Implementation

#### 4.1 Create `packages/agent/src/tool-call-repair.ts`

A repair module that runs after the LLM response is complete:

```typescript
export interface RepairResult {
  repaired: boolean;
  toolCalls: ToolCall[];
  warnings: string[];
}

export function repairToolCalls(
  message: AssistantMessage,
  availableTools: Tool[],
): RepairResult { ... }
```

Repair strategies (applied in order):

1. **JSON repair** — Use `jsonrepair` (npm package) to fix common JSON issues (trailing commas, missing quotes, single quotes, unescaped control chars)
2. **Tool name fuzzy matching** — If tool name doesn't exactly match any registered tool, find the closest match by Levenshtein distance (threshold: 2 edits). E.g., `read_File` → `read_file`
3. **Missing argument defaults** — For required arguments that have obvious defaults (e.g., `encoding` defaults to `"utf-8"`), inject them
4. **Text-embedded tool calls** — Scan the text output for patterns like ` ```json\n{"name": "read_file", ...}\n``` ` and extract as structured tool calls
5. **Argument type coercion** — If a number argument is provided as a string (`"42"` → `42`), coerce it based on the tool's TypeBox schema

#### 4.2 Integrate into Agent Loop

In `packages/agent/src/agent-loop.ts`, after `streamAssistantResponse()` returns the `AssistantMessage`:

```typescript
// After getting the message
const toolCalls = message.content.filter(c => c.type === "toolCall");
if (toolCalls.length > 0 && config.repairToolCalls !== false) {
  const repairResult = repairToolCalls(message, context.tools);
  if (repairResult.repaired) {
    // Replace tool calls in message content
    // Emit repair event for logging/UI
    stream.push({ type: "tool_repair", warnings: repairResult.warnings });
  }
}
```

#### 4.3 Retry on Tool Call Failure

Add a retry mechanism to the agent loop for when tool execution fails due to argument validation errors:

```typescript
// In AgentLoopConfig
interface AgentLoopConfig {
  // ... existing fields
  maxToolRetries?: number;  // Default: 2 for local models, 0 for cloud
}
```

When a tool call fails validation:
1. Send the error back to the LLM as a tool result with `isError: true`
2. Include the exact validation error message and the tool's parameter schema
3. Let the LLM retry (up to `maxToolRetries` times)

#### 4.4 Validate Tool Arguments Before Execution

The existing `validateToolArguments()` in `packages/ai` validates against TypeBox schemas. Ensure this runs before `ToolExecutor.execute()` and produces clear error messages that the LLM can act on.

### Files Modified

| File | Change |
|---|---|
| `packages/agent/src/tool-call-repair.ts` | **New file** — repair logic |
| `packages/agent/src/agent-loop.ts` | Add repair step after LLM response, retry logic |
| `packages/agent/src/types.ts` | Add `maxToolRetries` and `repairToolCalls` to `AgentLoopConfig` |
| `packages/agent/package.json` | Add `jsonrepair` dependency |

---

## 5. Phase 3: Context Window & Compaction Tuning

### Problem

The compaction system in `packages/coding-agent/src/core/compaction/compaction.ts` triggers based on the model's `contextWindow` field. Cloud models typically have 128K-200K tokens, but local models may have 8K-32K. The current system:

1. Uses the model's `contextWindow` to determine when to compact
2. Summarizes via the same model (which may be too small for good summarization)
3. Doesn't account for the overhead of tool definitions in the context

With small context windows, the agent may need to compact after just 2-3 tool calls, losing critical context about the task.

### Implementation

#### 5.1 Aggressive Compaction Presets

Add compaction presets to `settings-manager.ts` that activate based on context window size:

```typescript
interface CompactionPreset {
  triggerRatio: number;      // Compact when usage hits this % of context window
  summaryMaxTokens: number;  // Max tokens for the summary
  preserveRecentTurns: number; // Always keep N most recent turns uncompacted
  summaryModel?: string;     // Use a different model for summarization (optional)
}

const COMPACTION_PRESETS = {
  small:  { triggerRatio: 0.60, summaryMaxTokens: 1024, preserveRecentTurns: 2 },  // 8K-16K
  medium: { triggerRatio: 0.70, summaryMaxTokens: 2048, preserveRecentTurns: 4 },  // 16K-64K
  large:  { triggerRatio: 0.80, summaryMaxTokens: 4096, preserveRecentTurns: 6 },  // 64K+
};
```

#### 5.2 Tool Definition Budget

Calculate the token cost of tool definitions and subtract from available context:

```typescript
function estimateToolDefinitionTokens(tools: Tool[]): number {
  // Rough estimate: serialize tool schemas to JSON, divide by 4 (avg chars per token)
  const serialized = JSON.stringify(tools);
  return Math.ceil(serialized.length / 4);
}
```

Adjust the compaction trigger to account for this overhead, since local models with 8K context may spend 2K-3K tokens just on tool definitions.

#### 5.3 Tool Definition Pruning

For very small context windows (<16K tokens), implement dynamic tool pruning:

- Start with the full tool set
- If context is tight, remove tools the LLM hasn't used in the last N turns
- Always keep core tools (`read_file`, `edit_file`, `bash`, `write_file`)
- Restore pruned tools when the LLM asks for them or context frees up after compaction

#### 5.4 Summary Model Override

Allow using a different (possibly cloud) model for summarization:

```json
{
  "compaction": {
    "summaryModel": "anthropic/claude-3.5-haiku",
    "summaryProvider": "anthropic"
  }
}
```

This lets users run the agent with a local model but use a cheap cloud model for high-quality compaction summaries.

### Files Modified

| File | Change |
|---|---|
| `packages/coding-agent/src/core/compaction/compaction.ts` | Add presets, tool budget awareness |
| `packages/coding-agent/src/core/compaction/utils.ts` | Add `estimateToolDefinitionTokens()` |
| `packages/coding-agent/src/core/settings-manager.ts` | Add compaction preset settings |
| `packages/coding-agent/src/core/agent-session.ts` | Wire preset selection based on model context window |

---

## 6. Phase 4: Local Model Compatibility Layer

### Problem

Different local models require different `OpenAICompletionsCompat` settings. The current auto-detection in `openai-completions.ts:762-802` (`detectCompat()`) only recognizes cloud providers by URL pattern. Local models served through Ollama or vLLM need compat settings tuned to the underlying model family, not the server software.

### Implementation

#### 6.1 Create `packages/ai/src/providers/local-compat.ts`

A compat detection module for local models based on the model ID/name:

```typescript
export function detectLocalCompat(modelId: string): Partial<OpenAICompletionsCompat> {
  const id = modelId.toLowerCase();

  // Qwen family
  if (id.includes("qwen")) {
    return {
      thinkingFormat: "qwen",
      maxTokensField: "max_tokens",
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      supportsStrictMode: false,
    };
  }

  // Mistral/Devstral family
  if (id.includes("mistral") || id.includes("devstral")) {
    return {
      requiresMistralToolIds: true,
      requiresToolResultName: true,
      requiresThinkingAsText: true,
      maxTokensField: "max_tokens",
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsStrictMode: false,
    };
  }

  // Llama family
  if (id.includes("llama")) {
    return {
      maxTokensField: "max_tokens",
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      supportsStrictMode: false,
    };
  }

  // DeepSeek family
  if (id.includes("deepseek")) {
    return {
      maxTokensField: "max_tokens",
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsStrictMode: false,
    };
  }

  // Default conservative settings for unknown local models
  return {
    supportsStore: false,
    supportsDeveloperRole: false,
    supportsReasoningEffort: false,
    supportsUsageInStreaming: false, // Many local servers don't support stream_options
    maxTokensField: "max_tokens",
    supportsStrictMode: false,
  };
}
```

#### 6.2 Integrate into `detectCompat()`

In `openai-completions.ts`, extend `detectCompat()` to check if the model is served locally (indicated by `localhost`, `127.0.0.1`, or private IP in `baseUrl`), and if so, merge with `detectLocalCompat(model.id)`:

```typescript
function detectCompat(model: Model<"openai-completions">): Required<OpenAICompletionsCompat> {
  // Existing cloud provider detection...

  // Check if this is a local model
  if (isLocalEndpoint(model.baseUrl)) {
    const localCompat = detectLocalCompat(model.id);
    return { ...defaults, ...localCompat };
  }

  return defaults;
}

function isLocalEndpoint(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname.startsWith("192.168.") ||
      parsed.hostname.startsWith("10.") ||
      parsed.hostname === "0.0.0.0"
    );
  } catch {
    return false;
  }
}
```

#### 6.3 Allow `compat` Overrides in Auto-Discovery

When `local-discovery.ts` discovers a model, set the appropriate `compat` field based on the model family detected from the model ID:

```typescript
// In discoverLocalModels()
const model = {
  // ...
  compat: detectLocalCompat(modelId),
};
```

### Files Modified

| File | Change |
|---|---|
| `packages/ai/src/providers/local-compat.ts` | **New file** — local model compat detection |
| `packages/ai/src/providers/openai-completions.ts` | Extend `detectCompat()` for local endpoints |
| `packages/coding-agent/src/core/local-discovery.ts` | Apply compat during discovery |

---

## 7. Phase 5: Recommended Model Profiles

### Goal

Ship pre-configured model profiles for common local setups, so users can get started with a single command instead of manually writing `models.json`.

### Implementation

#### 7.1 Create `packages/coding-agent/src/core/model-profiles.ts`

```typescript
export interface ModelProfile {
  name: string;
  description: string;
  backend: "ollama" | "vllm" | "lmstudio" | "llama.cpp";
  modelId: string;          // Model ID to pull/load
  pullCommand?: string;     // e.g., "ollama pull qwen2.5-coder:32b"
  minVram: number;          // Minimum VRAM in GB
  contextWindow: number;
  reasoning: boolean;
  quality: "basic" | "good" | "excellent";
  compat: Partial<OpenAICompletionsCompat>;
}

export const RECOMMENDED_PROFILES: ModelProfile[] = [
  {
    name: "Qwen 2.5 Coder 32B (Ollama)",
    description: "Strong coding model, good tool use. Needs ~20GB VRAM (Q4).",
    backend: "ollama",
    modelId: "qwen2.5-coder:32b",
    pullCommand: "ollama pull qwen2.5-coder:32b",
    minVram: 20,
    contextWindow: 32768,
    reasoning: false,
    quality: "good",
    compat: { thinkingFormat: "qwen", maxTokensField: "max_tokens", supportsStore: false, supportsDeveloperRole: false, supportsStrictMode: false },
  },
  {
    name: "Qwen 3 Coder 30B (Ollama)",
    description: "Latest Qwen coding model with thinking. Needs ~20GB VRAM (Q4).",
    backend: "ollama",
    modelId: "qwen3-coder:30b",
    pullCommand: "ollama pull qwen3-coder:30b-a3b",
    minVram: 20,
    contextWindow: 32768,
    reasoning: true,
    quality: "excellent",
    compat: { thinkingFormat: "qwen", maxTokensField: "max_tokens", supportsStore: false, supportsDeveloperRole: false, supportsStrictMode: false },
  },
  {
    name: "Devstral Small 24B (Ollama)",
    description: "Mistral's coding model. Needs ~15GB VRAM (Q4).",
    backend: "ollama",
    modelId: "devstral:24b",
    pullCommand: "ollama pull devstral",
    minVram: 15,
    contextWindow: 32768,
    reasoning: false,
    quality: "good",
    compat: { requiresMistralToolIds: true, requiresToolResultName: true, requiresThinkingAsText: true, maxTokensField: "max_tokens", supportsStore: false, supportsDeveloperRole: false, supportsStrictMode: false },
  },
  {
    name: "Llama 3.1 8B Instruct (Ollama)",
    description: "Lightweight model for quick tasks. Needs ~6GB VRAM (Q4).",
    backend: "ollama",
    modelId: "llama3.1:8b",
    pullCommand: "ollama pull llama3.1:8b",
    minVram: 6,
    contextWindow: 8192,
    reasoning: false,
    quality: "basic",
    compat: { maxTokensField: "max_tokens", supportsStore: false, supportsDeveloperRole: false, supportsStrictMode: false },
  },
];
```

#### 7.2 Add `/setup-local` Slash Command

Add a new slash command that guides users through local model setup:

```
/setup-local
  1. Detect running local servers (Ollama, vLLM, etc.)
  2. List available models on detected servers
  3. If no server detected, suggest installing Ollama
  4. If Ollama detected but no suitable models, suggest pulling a recommended model
  5. Write selected config to ~/.pi/agent/models.json
  6. Switch to the configured local model
```

### Files Modified

| File | Change |
|---|---|
| `packages/coding-agent/src/core/model-profiles.ts` | **New file** — recommended profiles |
| `packages/coding-agent/src/core/slash-commands.ts` | Add `/setup-local` command |

---

## 8. Phase 6: Ollama-Native Provider (Optional)

### Rationale

While the OpenAI-compatible `/v1/chat/completions` endpoint works for Ollama, the native Ollama API (`/api/chat`) provides richer features:
- Direct model pulling/management
- Model metadata (context length, capabilities, quantization info)
- Keep-alive control (prevent model unloading between requests)
- Better streaming performance (no OpenAI protocol overhead)
- Native image handling
- Raw mode for fine-grained prompt control

### Implementation

Register a new API backend `"ollama-native"` in the API registry:

```typescript
// packages/ai/src/providers/ollama-native.ts
registerApiProvider({
  api: "ollama-native",
  stream: streamOllamaNative,
  streamSimple: streamSimpleOllamaNative,
});
```

This would use the `ollama` npm package directly instead of going through the OpenAI compatibility layer. The main benefit is access to `keep_alive` (preventing the model from being unloaded between agent loop turns — critical for performance) and better error messages.

**Decision point**: This is optional. The OpenAI-compatible path already works. Only pursue this if users report issues with Ollama's OpenAI compatibility layer (historically, tool calling through the compatibility layer has lagged behind the native API).

### Files Modified (if pursued)

| File | Change |
|---|---|
| `packages/ai/src/providers/ollama-native.ts` | **New file** — native Ollama streaming |
| `packages/ai/src/providers/register-builtins.ts` | Register `ollama-native` backend |
| `packages/ai/src/types.ts` | Add `"ollama-native"` to `KnownApi` |
| `packages/ai/package.json` | Add `ollama` dependency |

---

## 9. Phase 7: Testing & Validation

### 7.1 Unit Tests

| Test File | Coverage |
|---|---|
| `packages/agent/test/tool-call-repair.test.ts` | JSON repair, fuzzy name matching, text-embedded extraction, type coercion |
| `packages/ai/test/local-compat.test.ts` | Compat detection for each model family, local endpoint detection |
| `packages/coding-agent/test/local-discovery.test.ts` | Discovery with mocked HTTP responses, timeout handling, model filtering |
| `packages/coding-agent/test/compaction-presets.test.ts` | Preset selection by context window, tool budget calculation |

### 7.2 Integration Tests

Create an integration test suite that runs against a real Ollama instance (skipped in CI if Ollama isn't available, similar to the existing E2E skip pattern):

```typescript
// packages/coding-agent/test/integration/local-model.test.ts
const ollamaAvailable = await checkOllamaHealth("http://localhost:11434");
const describeLocal = ollamaAvailable ? describe : describe.skip;

describeLocal("Local model integration", () => {
  test("auto-discovery finds Ollama models", async () => { ... });
  test("agent loop completes a simple task with local model", async () => { ... });
  test("tool call repair fixes common issues", async () => { ... });
  test("compaction triggers at correct threshold", async () => { ... });
});
```

### 7.3 Manual Validation Matrix

| Scenario | Ollama | vLLM | LM Studio | llama.cpp |
|---|---|---|---|---|
| Auto-discovery detects server | | | | |
| Model list populated correctly | | | | |
| Simple chat (no tools) works | | | | |
| Tool calling works (read_file) | | | | |
| Multi-tool agent loop completes | | | | |
| Compaction triggers correctly | | | | |
| Model switching mid-conversation | | | | |
| Reasoning/thinking displays | | | | |

---

## 10. Phase 8: Documentation & Onboarding

### 10.1 Update Existing Docs

- **README.md**: Add "Local Models" section with quick-start guide
- **CHANGELOG.md**: Document local model support additions

### 10.2 New Documentation

Create `docs/local-models.md`:

```markdown
# Running pi with Local Models

## Quick Start (Ollama)
1. Install Ollama: https://ollama.com
2. Pull a recommended model: `ollama pull qwen2.5-coder:32b`
3. Run pi: `pi` (auto-discovers Ollama)

## Quick Start (vLLM)
1. Start vLLM: `vllm serve Qwen/Qwen2.5-Coder-32B-Instruct --enable-auto-tool-choice --tool-call-parser hermes`
2. Run pi: `pi`

## Manual Configuration (~/.pi/agent/models.json)
[Include example configs for each backend]

## Recommended Models
[Table of recommended models by VRAM budget]

## Troubleshooting
- Model not showing up → check capabilities, ensure tool support
- Slow responses → check VRAM, consider quantized models
- Tool call errors → update model, check for known issues
- Context too small → adjust compaction settings
```

---

## 11. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Local models produce significantly worse tool calls than cloud models | High | High | Tool call repair (Phase 2), clear quality tier labeling, retry logic |
| Ollama OpenAI-compat layer has bugs/limitations | Medium | Medium | Ollama-native provider (Phase 6) as fallback |
| Auto-discovery slows CLI startup | Low | Medium | Run async with timeout, cache results |
| Different quantization levels produce different behaviors | Medium | Low | Test with common quantizations (Q4_K_M, Q8_0, FP16) |
| Models get unloaded between agent turns (Ollama) | High | High | Ollama `keep_alive` setting, or native provider with explicit keep_alive |
| Users expect cloud-quality results from small local models | High | Medium | Clear documentation of quality tiers, recommend minimum 30B+ models |

---

## 12. Appendix: Reference Architecture

### Data Flow: Local Model Agent Loop

```
User Input
    │
    ▼
┌─────────────────────────────┐
│   Coding Agent CLI          │
│   (interactive-mode.ts)     │
│                             │
│   ┌─────────────────────┐   │
│   │ Local Discovery     │   │  ← Probes localhost:11434, :8000, :1234, :8080
│   │ (local-discovery.ts)│   │
│   └────────┬────────────┘   │
│            │                │
│   ┌────────▼────────────┐   │
│   │ Model Registry      │   │  ← Merges discovered + models.json + built-in
│   │ (model-registry.ts) │   │
│   └────────┬────────────┘   │
│            │                │
│   ┌────────▼────────────┐   │
│   │ Agent Session       │   │  ← Manages conversation, compaction
│   │ (agent-session.ts)  │   │
│   └────────┬────────────┘   │
│            │                │
└────────────┼────────────────┘
             │
             ▼
┌─────────────────────────────┐
│   Agent Loop                │
│   (agent-loop.ts)           │
│                             │
│   1. Transform context      │  ← Prune tools if context is tight
│   2. Convert to LLM msgs    │
│   3. Call streamSimple()     │──────────────┐
│   4. Repair tool calls       │  ← NEW        │
│   5. Execute tools           │               │
│   6. Loop until done         │               │
│   7. Compact if needed       │               │
└─────────────────────────────┘               │
                                               ▼
                                ┌──────────────────────────────┐
                                │   openai-completions.ts      │
                                │                              │
                                │   ┌────────────────────┐     │
                                │   │ detectCompat()     │     │ ← Detects local endpoint,
                                │   │ + local-compat.ts  │     │   applies model-family compat
                                │   └────────┬───────────┘     │
                                │            │                 │
                                │   ┌────────▼───────────┐     │
                                │   │ OpenAI SDK client   │     │ ← Points to localhost
                                │   │ (baseUrl: local)    │     │
                                │   └────────┬───────────┘     │
                                │            │                 │
                                └────────────┼─────────────────┘
                                             │
                                             ▼
                                ┌──────────────────────────────┐
                                │   Local Model Server          │
                                │   (Ollama / vLLM / etc.)     │
                                │                              │
                                │   /v1/chat/completions       │
                                │   ← streaming SSE response → │
                                └──────────────────────────────┘
```

### Implementation Priority & Dependencies

```
Phase 1: CLI Auto-Discovery ─────────────────────┐
                                                   │
Phase 4: Local Model Compat Layer ────────────────┤
                                                   │
Phase 2: Robust Tool Calling ─────────────────────┤── Can be done in parallel
                                                   │
Phase 3: Context Window & Compaction ─────────────┤
                                                   │
Phase 5: Recommended Model Profiles ──────────────┘── Depends on 1 + 4

Phase 6: Ollama-Native Provider ──── Optional, independent

Phase 7: Testing ──── Ongoing, parallel with all phases

Phase 8: Documentation ──── After all other phases
```

### Summary of New Files

| File | Package | Purpose |
|---|---|---|
| `src/core/local-discovery.ts` | coding-agent | Auto-discover local model servers |
| `src/core/model-profiles.ts` | coding-agent | Pre-configured model profiles |
| `src/providers/local-compat.ts` | ai | Compat detection for local model families |
| `src/tool-call-repair.ts` | agent | Repair malformed tool calls |
| `src/providers/ollama-native.ts` | ai | (Optional) Native Ollama API provider |

### Summary of Modified Files

| File | Package | Change |
|---|---|---|
| `src/core/model-registry.ts` | coding-agent | `discoverLocal()` method |
| `src/core/settings-manager.ts` | coding-agent | Local discovery + compaction settings |
| `src/core/slash-commands.ts` | coding-agent | `/setup-local` command |
| `src/core/compaction/compaction.ts` | coding-agent | Presets, tool budget |
| `src/core/compaction/utils.ts` | coding-agent | `estimateToolDefinitionTokens()` |
| `src/core/agent-session.ts` | coding-agent | Wire compaction presets |
| `src/modes/interactive/interactive-mode.ts` | coding-agent | Discovery on startup |
| `src/agent-loop.ts` | agent | Tool call repair, retry logic |
| `src/types.ts` | agent | New config fields |
| `src/providers/openai-completions.ts` | ai | Extend `detectCompat()` for local |
| `src/providers/register-builtins.ts` | ai | (If Phase 6) Register ollama-native |
| `src/types.ts` | ai | (If Phase 6) Add to `KnownApi` |

### New Dependencies

| Package | Added To | Purpose |
|---|---|---|
| `ollama` (Node.js) | coding-agent | Ollama discovery + (optional) native provider |
| `jsonrepair` | agent | Fix malformed JSON in tool call arguments |
