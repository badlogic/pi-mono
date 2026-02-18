# Energy-Aware Agents in pi-mono (Neuralwatt)

**Project Execution Plan — Claude Code Agent Teams**

---

## Objective

Implement **Energy-Aware Mode** as a first-class runtime feature in pi-mono, using:

- Neuralwatt OpenAI-compatible endpoints (`https://api.neuralwatt.com/v1`)
- Per-request energy telemetry (`energy_joules`, `energy_kwh`)
- Benchmarking against baseline behavior on the **same endpoints**

The system supports:

- **Baseline Mode** — default pi-mono behavior, no policy intervention
- **Energy-Aware Mode** — budgeted + routed runtime policy that reduces energy consumption without degrading task success rate

Benchmark output compares: **time/task**, **energy/task**, **success rate**

---

## Constraints

- All model calls use Neuralwatt API endpoints (`https://api.neuralwatt.com/v1`)
- Baseline vs energy-aware differ **only by policy** — same provider, same endpoint
- Benchmarks run both modes back-to-back and generate a comparison report
- This is already the fork — no additional forking needed

---

## Architecture Context

### How providers work (`packages/ai`)

- Providers register via `registerApiProvider()` in `src/api-registry.ts`
- Each provider implements `StreamFunction<TApi, TOptions>` returning `AssistantMessageEventStream`
- Neuralwatt is OpenAI-compatible, so it can reuse `openai-completions` API with a custom provider name
- Provider detection: `src/providers/register-builtins.ts` registers all built-in providers
- Models are defined in `src/models.generated.ts` (auto-generated) and `src/models.ts`
- `Usage` type (`src/types.ts:147-160`) already tracks tokens and cost — energy fields extend this

### How the agent loop works (`packages/agent`)

- `AgentLoopConfig` in `src/types.ts` defines hooks: `transformContext`, `getSteeringMessages`, `getFollowUpMessages`
- The loop in `src/agent-loop.ts` calls `streamAssistantResponse()` which transforms `AgentMessage[] -> Message[]` at the LLM boundary
- **Policy hook points**: `transformContext` runs before each LLM call (line 213), making it ideal for policy intervention
- The `StreamFn` type allows injecting a custom stream function — the policy can wrap this to modify options per-call

### Key types

- `Model<TApi>` — includes `cost`, `contextWindow`, `maxTokens`, `reasoning`
- `Usage` — `input`, `output`, `cacheRead`, `cacheWrite`, `totalTokens`, `cost`
- `AssistantMessage` — includes `usage: Usage`, `model`, `provider`
- `SimpleStreamOptions` — includes `reasoning`, `maxTokens`, `temperature`

---

## Team Structure

### Lead (Integrator)

- Owns the task list, coordinates merge ordering
- Creates scaffold (EPIC 0)
- Runs final benchmark comparisons
- Merges integration work, resolves conflicts
- Builds the demo

### Teammate Roles

| Role | Scope | Owned Files |
|------|-------|------------|
| Provider | Neuralwatt integration + energy telemetry parsing | `packages/ai/src/providers/neuralwatt*`, `packages/ai/src/energy-types.ts`, `packages/ai/test/neuralwatt*`, `packages/ai/test/energy*` |
| Runtime | Policy hooks + BaselinePolicy + EnergyAwarePolicy | `packages/agent/src/policy/*`, `packages/agent/src/agent-loop.ts`, `packages/agent/src/types.ts` (policy additions only), `packages/agent/test/policy/*` |
| Benchmark | Task suite + runner + report generator | `packages/benchmarks/**` (new package) |

**Shared files requiring coordination before modification:**
- `packages/ai/src/types.ts` — Provider owns; add `EnergyUsage` interface and extend `AssistantMessage`
- `packages/agent/src/types.ts` — Runtime owns; add `PolicyContext`, `PolicyDecision`, `EnergyBudget`, `RuntimePolicy` interfaces and `policy?` field to `AgentLoopConfig`
- `packages/agent/src/agent-loop.ts` — Runtime owns; integrate `beforeModelCall`/`afterModelCall` hooks into `runLoop`

---

## Workflow Rules

### Git workflow (follows AGENTS.md)

- Feature branches for isolation: `energy/<task-id>-<short-name>`
- Merge to `main` when tests pass — no PRs
- CI on push to `main` is the quality gate
- Follow all git safety rules in AGENTS.md (never `git add -A`, specific files only)
- Conventional commits: `feat(ai):`, `fix(agent):`, `test(benchmarks):`

### Coordination

- Lead coordinates merge ordering to avoid conflicts
- Agents own specific directories — never modify files outside your scope without lead approval
- If a rebase conflict occurs in a file you didn't modify, stop and notify the lead
- Check the task board after completing each task to find available work

### Quality gates

- All new code must have unit tests
- API-dependent tests must use mocked HTTP responses (no real API calls in CI)
- `npm run check` must pass (biome lint + tsgo typecheck) before committing
- Target 80%+ line coverage on new code
- Update the relevant `packages/*/CHANGELOG.md` under `## [Unreleased]` for every change (required by AGENTS.md)

### Style (inherited from repo)

- Tabs, indent width 3, line width 120 (Biome enforced)
- ESM with `.js` extensions in imports
- No emojis in code, commits, or comments
- No `any` types unless absolutely necessary
- Run individual tests: `npx tsx ../../node_modules/vitest/dist/cli.js --run test/specific.test.ts`
- Never run `npm test` or `npm run build` at root

---

## Task Board

### EPIC 0 — Scaffold

#### T0.1 — Project scaffold + docs

**Owner:** Lead
**Deliverables:**
- `ENERGY_AWARENESS.md` at repo root — design doc covering baseline vs energy-aware definitions
- `packages/benchmarks/` scaffold:
  - `package.json` (name: `@mariozechner/pi-benchmarks`, type: module, vitest scripts)
  - `tsconfig.build.json` extending `../../tsconfig.base.json`
  - `vitest.config.ts` (required for `npm test --workspaces` to pick up tests)
  - `src/index.ts`, `src/types.ts` stubs
  - `test/` directory
- Add `"packages/benchmarks"` to root `package.json` workspaces array
- Metrics definitions: time/task (ms), energy/task (joules), success rate (%)

**Done when:** `npm run check` passes, new package compiles, `vitest --run` in the package exits cleanly.

---

### EPIC 1 — Neuralwatt Provider + Energy Telemetry (`packages/ai`)

#### T1.1 — Add Neuralwatt provider configuration

**Owner:** Provider
**Deliverables:**
- Add `"neuralwatt"` to `KnownProvider` type union in `src/types.ts`
- Register Neuralwatt in `src/providers/register-builtins.ts` — reuses `openai-completions` API with:
  - Base URL: `https://api.neuralwatt.com/v1`
  - Bearer auth via `NEURALWATT_API_KEY` env var
- Add env key detection in `src/env-api-keys.ts`
- Add at least one model entry (can be manual in code, doesn't need generate-models.ts)

**Done when:** A chat completion succeeds through Neuralwatt endpoint. Test with mocked HTTP response.

---

#### T1.2 — Parse and normalize energy metrics

**Owner:** Provider
**Depends on:** T1.1
**Deliverables:**
- `EnergyUsage` interface in `src/types.ts`:
  ```typescript
  interface EnergyUsage {
    energy_joules: number;
    energy_kwh: number;
    duration_seconds: number;
  }
  ```
- Add `EnergyUsage` to `packages/ai/src/types.ts` and extend `AssistantMessage` with `energy?: EnergyUsage`
- Determine where Neuralwatt returns energy fields: check response body `usage` object first (most OpenAI-compatible providers put metadata there), then response headers as fallback. If genuinely ambiguous, parse both and use whichever is non-null.
- Unit tests with mocked responses confirming energy fields are captured

**Done when:** Tests confirm energy data is parsed from mocked Neuralwatt responses.

---

#### T1.3 — Structured telemetry logging schema

**Owner:** Provider
**Depends on:** T1.2
**Deliverables:**
- `TelemetryRecord` interface:
  ```typescript
  interface TelemetryRecord {
    task_id: string;
    run_id: string;
    step_id: string;
    model: string;
    provider: string;
    tokens: { input: number; output: number; total: number };
    latency_ms: number;
    energy_joules: number;
    energy_kwh: number;
    timestamp: number;
  }
  ```
- Telemetry emitter that produces JSONL records
- This is a **contract** — benchmark runner (EPIC 3) consumes this format

**Done when:** Benchmark runner can consume telemetry logs reliably. Schema is documented.

---

#### T1.4 — (Optional) Usage reconciliation endpoint client

**Owner:** Provider
**Deliverables:**
- Client for `GET /v1/usage/energy` (if Neuralwatt exposes this)
- Can sanity-check cumulative energy against per-request totals

---

### EPIC 2 — Runtime Policy Hooks (`packages/agent`)

#### T2.1 — Add policy hook interface

**Owner:** Runtime
**Deliverables:**
- Policy interface in `src/policy/types.ts`:
  ```typescript
  interface RuntimePolicy {
    name: string;
    beforeModelCall(ctx: PolicyContext): PolicyDecision;
    afterModelCall(ctx: PolicyContext, usage: UsageWithEnergy): void;
  }

  interface PolicyContext {
    taskId?: string;
    turnNumber: number;
    model: Model<any>;
    // Models available for routing, sorted by cost.output ascending.
    // Populated by the caller (benchmark runner or CLI) at agent construction time.
    // Policy picks the cheapest one that supports required capabilities.
    availableModels: Model<any>[];
    budget: EnergyBudget;
    consumedEnergy: number;  // joules consumed so far in this run
    consumedTime: number;    // ms elapsed since run start
    messageCount: number;
    // Total input tokens of the current context (sum of all message tokens seen so far).
    // Use the last AssistantMessage's usage.totalTokens as a proxy for context size.
    estimatedInputTokens: number;
  }

  interface PolicyDecision {
    model?: Model<any>;       // override model selection
    maxTokens?: number;       // override max tokens
    reasoning?: ThinkingLevel; // override reasoning level
    shouldCompact?: boolean;   // trigger context compaction
    abort?: boolean;           // abort if budget exhausted
    reason?: string;           // log why this decision was made
  }

  interface EnergyBudget {
    energy_budget_joules?: number;
    time_budget_ms?: number;
  }
  ```
- Integration point in `agent-loop.ts` — wrap `streamAssistantResponse` to call `beforeModelCall` / `afterModelCall`

**Done when:** Policy hook is called on every model invocation. Baseline behavior unchanged when no policy is set.

---

#### T2.2 — Implement BaselinePolicy

**Owner:** Runtime
**Depends on:** T2.1
**Deliverables:**
- `BaselinePolicy` class implementing `RuntimePolicy`
- `beforeModelCall` returns empty `PolicyDecision` (no overrides)
- `afterModelCall` logs telemetry but takes no action
- Unit tests confirming baseline outputs match upstream behavior exactly

**Done when:** Agent loop with BaselinePolicy produces identical results to no-policy execution.

---

#### T2.3 — Implement EnergyAwarePolicy v1 (CRITICAL PATH)

**Owner:** Runtime
**Depends on:** T1.2, T2.1, T2.2

This is the core value of the project. The policy must intelligently reduce energy consumption without degrading task success rate.

**Strategy chain (priority order):**

1. **Reasoning reduction** — If budget pressure > 30%, reduce reasoning level (high -> medium -> low -> off). This is the cheapest intervention with lowest quality impact.

2. **Token limit reduction** — If budget pressure > 50%, reduce `maxTokens` by up to 40%. Prevents verbose completions that waste energy on non-essential output.

3. **Model routing** — If budget pressure > 70%, switch to a cheaper/smaller model from `availableModels` list. Selection criteria: lowest `cost.output` that still supports the required capabilities (tools, reasoning, image input).

4. **Context compaction** — If `estimatedInputTokens` exceeds 60% of the current model's `contextWindow` AND budget pressure > 50%, trigger compaction via `shouldCompact`. Reduces input tokens on subsequent calls.

5. **Budget exhaustion** — If consumed energy exceeds budget, set `abort: true` with a clear reason message.

**Budget pressure calculation:**
```
pressure = consumedEnergy / energy_budget_joules
```
If no energy budget is set, fall back to time-based pressure:
```
pressure = consumedTime / time_budget_ms
```
If neither budget is set, pressure = 0 (no intervention).

**Deliverables:**
- `EnergyAwarePolicy` class with the strategy chain above
- Each strategy is a separate private method for testability
- Comprehensive unit tests:
  - Test each strategy in isolation (5 strategies x positive/negative = 10+ tests)
  - Test strategy ordering (reasoning reduced before model switch)
  - Test budget pressure calculation edge cases (0 budget, exceeded budget, no budget)
  - Test that decisions include `reason` strings for observability
  - Test graceful degradation when energy data is missing (fall back to baseline behavior)
- Integration test: run policy with a sequence of mocked `afterModelCall` calls showing progressive budget consumption, verify strategy escalation

**Acceptance criteria:**
- On benchmark tasks (EPIC 3), energy-aware mode achieves **20%+ energy reduction** compared to baseline
  - Note: This is contingent on Neuralwatt returning meaningful per-request energy data. If energy data is too coarse or only available as cumulative totals, the acceptance threshold may need recalibration. In that case, time-based budget pressure serves as the proxy metric and the acceptance threshold becomes **15%+ time reduction**.
- Task success rate degradation is **5% or less**
- Every policy decision is logged with a human-readable `reason`
- If energy telemetry is unavailable, policy degrades to baseline (never crashes)

---

#### T2.4 — Endpoint parity guardrail

**Owner:** Runtime
**Deliverables:**
- Validation that both baseline and energy-aware modes use the same Neuralwatt endpoint/provider
- Error if someone configures baseline with one provider and energy-aware with another

---

### EPIC 3 — Benchmark Harness (`packages/benchmarks`)

#### T3.1 — Create benchmark runner CLI

**Owner:** Benchmark
**Depends on:** T0.1 (scaffold); T1.3 (for real telemetry integration — can be stubbed until T1.3 is done)
**Deliverables:**
- CLI entry point at `packages/benchmarks/src/cli.ts`:
  - `bench run --mode baseline`
  - `bench run --mode energy-aware`
  - `bench run --compare` (runs both back-to-back)
- Produces `results.jsonl` consuming `TelemetryRecord` format from T1.3
- Each run gets a unique `run_id`
- Configurable: `--tasks <glob>`, `--budget-joules <n>`, `--budget-ms <n>`
- `availableModels` list passed to policy — hard-coded initially as a small set of Neuralwatt model IDs sorted by cost.output ascending

**Done when:** CLI runs a single task in both modes and produces valid JSONL. Real telemetry integration completes after T1.3 merges.

---

#### T3.2 — Define task format + initial suite (10 tasks)

**Owner:** Benchmark
**Depends on:** T3.1
**Deliverables:**
- Task definition format:
  ```typescript
  interface BenchmarkTask {
    id: string;
    name: string;
    description: string;
    prompt: string;
    tools?: AgentTool[];
    validator: (result: AgentMessage[]) => { passed: boolean; score: number; reason: string };
    maxTurns: number;
  }
  ```
- 10 deterministic tasks covering:
  - Simple Q&A (2 tasks) — baseline quality check
  - Code generation (3 tasks) — multi-step, tool-using
  - Reasoning (2 tasks) — math, logic
  - Summarization (2 tasks) — long input, concise output
  - Multi-tool orchestration (1 task) — complex agent workflow
- Each task has a deterministic validator (regex match, code execution, semantic check)

---

#### T3.3 — Aggregation + report generator

**Owner:** Benchmark
**Depends on:** T3.1, T3.2
**Deliverables:**
- `summary.csv` with columns: task_id, mode, time_ms, energy_joules, tokens_total, success, score
- `report.md` comparing:
  - Per-task: time, energy, success, score (side-by-side table)
  - Aggregate: mean energy savings %, mean time delta %, success rate delta
  - Verdict: "Energy-aware mode saved X% energy with Y% success rate impact"

---

#### T3.4 — CI smoke benchmark

**Owner:** Benchmark
**Depends on:** T3.2
**Deliverables:**
- CI job that runs 2-3 tasks with mocked API responses
- Validates benchmark infrastructure works, not actual energy savings
- Fails if runner crashes or report format is invalid

---

### EPIC 4 — App Wiring + Demo

#### T4.1 — Add `--energy-aware` CLI toggle

**Owner:** Lead
**Deliverables:**
- CLI flag `--energy-aware` activates EnergyAwarePolicy
- Config file support: `energy_aware: true` in session config
- Budget flags: `--energy-budget <joules>`, `--time-budget <ms>`

---

#### T4.2 — Two live demos

**Owner:** Lead
**Depends on:** T2.3, T3.3

**The demos must be visually compelling and agentic.** Run via: `npm run demo -w packages/benchmarks -- --demo <name>`

---

**Demo 1: "Coding Agent Energy Challenge"**

A real coding agent solves a multi-step programming task under both modes:

1. **Task**: "Implement a rate-limiting middleware with tests" (requires multiple tool calls, code gen, verification)
2. **Sequential runs** — baseline first, then energy-aware, with live output
3. **Real-time energy meter** during each run:
   ```
   [baseline]  Turn 2/? | Energy: 3.1J | Model: neuralwatt-large
   [energy]    Turn 2/? | Energy: [=====>    ] 1.8J / 5.0J | pressure: 36%
                          [policy] reasoning: high -> medium
   ```
4. **Final scorecard** printed to terminal:
   ```
   ┌──────────────────────────────────────────────┐
   │       Energy-Aware Coding Agent Results       │
   ├──────────────┬──────────┬────────────────────┤
   │              │ Baseline │ Energy-Aware        │
   ├──────────────┼──────────┼────────────────────┤
   │ Energy       │ 8.4 J    │ 4.9 J  (-42%)      │
   │ Time         │ 41s      │ 33s    (-20%)       │
   │ Tests pass   │ yes      │ yes                 │
   │ Code quality │ 9/10     │ 8/10                │
   └──────────────┴──────────┴────────────────────┘
   ```

---

**Demo 2: "HackerNews Energy-Aware Watcher"**

A long-running agentic monitor that shows energy savings over sustained operation:

- **What it does**: Polls HackerNews top stories every N seconds, uses an LLM to score each story's relevance against a keyword set, and surfaces high-relevance items
- **Seed keywords** (pre-configured): `["AI agents", "LLM", "energy efficiency", "open source AI", "Claude", "Anthropic", "inference", "GPU", "sustainable computing", "model routing"]`
- **Baseline mode**: Calls the large model for every story, full reasoning
- **Energy-aware mode**: Routes to cheaper models for low-complexity scoring, reserves the large model for final summaries, compacts context when it grows
- **Live output** shows both running concurrently (two columns) with a shared energy budget meter
- **Compelling because**: The watcher runs continuously — energy savings compound over time. After 2 minutes the energy delta is visible and growing. The agent is doing real useful work, not a toy task.

**Example output:**
```
Monitoring HackerNews | Keywords: AI agents, LLM, energy efficiency ...
Budget: 20.0J total

[baseline]     [energy-aware]         Policy
─────────────────────────────────────────────
Story #1: 0.9J  Story #1: 0.4J  routing: large->mini
Story #2: 0.8J  Story #2: 0.4J  routing: large->mini
Story #3: 1.1J  Story #3: 0.9J  no routing (complex)
...
Elapsed: 90s | Baseline: 12.4J | Energy-aware: 6.1J (-51%)

HIGH RELEVANCE (energy-aware found these too):
  - "Anthropic releases new inference pricing" (score: 0.95)
  - "Open source LLM routing achieves GPT-4 parity" (score: 0.91)
```

**Implementation notes:**
- Uses HackerNews public API (no key needed): `https://hacker-news.firebaseio.com/v0/`
- Demo runs for a fixed duration (default 3 minutes) then prints summary
- Keyword config is a plain JSON array, seeded with AI-related terms by default
- Both modes use the same Neuralwatt endpoint — only the policy differs

---

## Dependency Graph

```
T0.1 ──────────────────────────────────> T3.1 ──> T3.2 ──> T3.3
                                           │                  │
T1.1 ──> T1.2 ──> T1.3                    └──> T3.4          │
            │                                                  │
            v                                                  │
T2.1 ──> T2.2 ──> T2.3 ──────────────────────────────────> T4.2
                    │
                    v
                  T2.4
                    │
                    v
                  T4.1
```

**Critical path:** T1.1 -> T1.2 -> T2.3 -> T3.3 -> T4.2

**Parallelizable work:**
- T0.1 + T1.1 (Lead + Provider start simultaneously)
- T2.1 (Runtime) can start immediately — interface design doesn't need T1.1
- T3.1 + T3.2 (Benchmark) can start after T0.1, before provider/runtime are done

---

## Milestone M1 — First Proof

**Goal:** 5-task benchmark comparison works end-to-end.

Must include:
- Neuralwatt calls with energy telemetry parsed
- Baseline + Energy-Aware policies runnable
- `bench run --compare` generates `report.md` with energy/task + time/task
- Energy-aware mode shows measurable energy reduction (target: 20%+)

---

## Error Handling & Graceful Degradation

- **Neuralwatt API down:** Fall back to error with clear message. Never silently switch providers.
- **Energy telemetry missing:** Log warning, continue as baseline. Policy returns empty `PolicyDecision`.
- **Budget exhausted mid-task:** Policy sets `abort: true` with reason. Agent loop respects abort and returns partial results with explanation.
- **Unknown model in routing:** Skip model routing strategy, move to next strategy in chain.

---

## Testing Strategy

### Unit tests (mocked, run in CI)
- Provider: mock HTTP responses with energy fields, verify parsing
- Policy: mock `PolicyContext` with various budget pressures, verify decisions
- Benchmark: mock telemetry records, verify aggregation math

### Integration tests (require API key, skip in CI)
- End-to-end: run 1 task through Neuralwatt, verify energy telemetry flows through policy to benchmark report
- Mark with `describe.skipIf(!process.env.NEURALWATT_API_KEY)`

### Mock strategy
- Use Vitest's `vi.fn()` and manual mocks — no external mocking libraries needed
- Create `test/fixtures/` directories with sample API responses as JSON files
- Mock at the HTTP client level (intercept `OpenAI` client calls) for provider tests
- Mock at the policy interface level for benchmark tests
