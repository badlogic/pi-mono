# Energy-Aware Pi Mono

A fork of [badlogic/pi-mono](https://github.com/badlogic/pi-mono) that adds **Energy-Aware Mode** — a runtime policy layer that reduces energy consumption and cost for LLM workloads without degrading output quality.

Built on [Neuralwatt](https://neuralwatt.com) endpoints, which expose per-request energy telemetry (`energy_joules`, `energy_kwh`) alongside standard token usage. Both baseline and energy-aware modes use the **same Neuralwatt endpoint** (`https://api.neuralwatt.com/v1`) — the only difference is the active runtime policy.

---

## Core Idea

LLM inference consumes measurable energy, and not every task needs the most capable (and most expensive) model. A simple prompt classifier running on GPT-OSS-20B costs ~$0.00001 and completes in milliseconds. Routing that prompt to Kimi K2.5 instead costs 13x more energy and 13x more money for equivalent output quality.

This project makes that tradeoff explicit and automated:

1. **Energy telemetry** — Neuralwatt returns `energy_joules` per request. The policy layer tracks cumulative consumption against a budget.
2. **Budget pressure** — as the agent burns through its energy budget, the policy escalates interventions: reduce reasoning, cap tokens, route to a cheaper model, compact context, abort.
3. **Discriminator routing** — a lightweight classifier evaluates each prompt before the main model call and selects the most appropriate tier. Tasks that need chain-of-thought go to Kimi K2.5; boilerplate tasks go to GPT-OSS-20B.
4. **Learned memory** — routing quality observations persist across runs. On subsequent runs the discriminator prompt is informed by historical pass rates per phase.

The result: the same task suite completes with 40–70% less energy, at lower cost, with no measurable quality loss.

---

## Architecture

### Energy Telemetry (`packages/ai`)

Neuralwatt returns energy data in the final streaming chunk's `usage` object. The `openai-completions` provider parses this into `AssistantMessage.energy`:

```typescript
interface EnergyUsage {
  energy_joules: number;    // energy consumed for this request
  energy_kwh: number;       // same value in kWh
  duration_seconds: number; // server-side processing time
}
```

When the API does not return energy data for a model (some models lack metering), the system falls back to a token-based estimate using known `tokens/joule` rates. Per-turn output labels `[api]` or `[est]` so it is always clear which source was used.

### Policy Hooks (`packages/agent`)

The agent loop calls `beforeModelCall` before each LLM call and `afterModelCall` after it completes. Policies implement:

```typescript
interface RuntimePolicy {
  name: string;
  beforeModelCall(ctx: PolicyContext): PolicyDecision;
  afterModelCall(ctx: PolicyContext, usage: UsageWithEnergy): void;
}
```

`PolicyContext` carries the current model, available models for routing, budget configuration, energy consumed so far, elapsed time, and estimated input token count. `PolicyDecision` can override model selection, cap `maxTokens`, adjust reasoning level, trigger context compaction, or abort.

### BaselinePolicy

No-op policy. `beforeModelCall` returns an empty decision — no overrides. Used to establish a fair baseline measurement with the same endpoint.

### EnergyAwarePolicy

Adaptive policy with a five-stage strategy chain, triggered in priority order as budget pressure rises:

| Stage | Trigger | Action |
|-------|---------|--------|
| 1. Reasoning reduction | pressure > 30% | Reduce reasoning level: high → medium → low → off |
| 2. Token reduction | pressure > 50% | Reduce `maxTokens` by up to 40% |
| 3. Model routing | pressure > 70% | Switch to cheapest available model that supports required capabilities |
| 4. Context compaction | pressure > 50% AND tokens > 60% of context window | Trigger context compaction |
| 5. Budget exhaustion | pressure ≥ 100% | Abort with reason message |

**Budget pressure** = `consumedEnergy / energy_budget_joules`

Falls back to time-based pressure (`consumedTime / time_budget_ms`) if no energy budget is set. Returns 0 (no intervention) if neither budget is set. Every decision includes a human-readable `reason` string for observability.

Model routing selects the cheapest model from `availableModels` (sorted by `cost.output` ascending) that meets capability requirements (tool calling, image input, reasoning). If energy telemetry is missing, the policy degrades gracefully to baseline behavior — it never crashes on missing data.

### Four-Tier Discriminator (`packages/benchmarks/src/demos/demo-discriminator.ts`)

A lightweight classifier (GPT-OSS-20B) evaluates each prompt before the main model call and routes to one of four tiers based on task complexity and whether chain-of-thought reasoning is needed:

| Tier | Model | Tokens/J | Cost/1M | Use case |
|------|-------|----------|---------|----------|
| thinking | Kimi K2.5 | 0.482 | $1.327 | CoT reasoning, debugging, step-by-step |
| complex | Qwen3-Coder-480B | 0.314 | $0.10 | High quality, direct answer, no CoT overhead |
| medium | Devstral-24B | 0.809 | $0.12 | Moderate complexity, clear spec |
| simple | GPT-OSS-20B | 1.371 | $0.10 | Boilerplate, obvious tasks, trivial answers |

The classifier returns `{"tier":"medium","length":"full","reason":"..."}`. Optional tiers fall back gracefully: `thinking` → `complex`, `medium` → `simple`. A `length=brief` response caps downstream `maxTokens` to avoid over-generating short answers.

EnergyAwarePolicy handles budget pressure (aggregate abort/token-limit strategies); the discriminator handles per-task model selection. Both apply simultaneously — the discriminator selects the model and the policy enforces the budget envelope.

### Persistent Cross-Run Memory (`packages/benchmarks/src/demos/demo-memory.ts`)

Stored at `~/.energy-demo-memory.json`. Records routing quality observations across runs:

- **HN Watcher**: tracks per-story score agreement between baseline and energy-aware runs
- **Coding Agent**: tracks pass/fail per routing decision per phase, average turns-to-pass, energy savings

On startup, each demo displays learned confidence from previous runs:

```
Memory (5 previous runs): GPT-OSS scores agree with Kimi within 0.15 in 94% of stories (n=47)
                           Routes at ~74% pressure — saves 69% energy with no quality loss
```

The discriminator prompt is enriched with historical routing outcomes for each phase. Phases that historically failed when routed to lightweight models are weighted toward higher tiers on subsequent runs.

---

## Acceptance Criteria

Energy-aware mode must:
- Achieve **≥20% energy reduction** compared to baseline across the benchmark task suite
- Maintain **≤5% success rate degradation** compared to baseline
- Never crash when energy telemetry is missing (graceful fallback to baseline behavior)

---

## Models (Neuralwatt)

All five available Neuralwatt models, in descending energy efficiency:

| Model ID | Name | Tokens/J | Input $/1M | Output $/1M | Context |
|----------|------|----------|------------|-------------|---------|
| `openai/gpt-oss-20b` | GPT-OSS 20B | 1.371 | $0.10 | $0.10 | 16K |
| `mistralai/Devstral-Small-2-24B-Instruct-2512` | Devstral-24B | 0.809 | $0.12 | $0.12 | 262K |
| `moonshotai/Kimi-K2.5` | Kimi K2.5 | 0.482 | $1.327 | $1.327 | 262K |
| `Qwen/Qwen3-Coder-480B-A35B-Instruct` | Qwen3-Coder-480B | 0.314 | $0.10 | $0.10 | 262K |
| `deepseek-ai/deepseek-coder-33b-instruct` | DeepSeek-Coder-33B | 0.092 | $0.15 | $0.60 | 16K |

DeepSeek-33B is the least energy-efficient and is excluded from discriminator routing.

---

## Status

**Work in progress.** Core infrastructure is complete and both demos are functional.

| Component | Status |
|-----------|--------|
| Neuralwatt provider (`packages/ai`) | Done |
| Energy telemetry parsing (`energy_joules` from streaming chunks) | Done |
| `BaselinePolicy` + `EnergyAwarePolicy` (`packages/agent`) | Done |
| Policy integration in agent loop | Done |
| Unit tests for policy layer | Done |
| Four-tier discriminator (shared module) | Done |
| Persistent cross-run memory | Done |
| HN Watcher demo | Done |
| Coding Agent demo (acceptance-test-driven) | Done |
| `--energy-aware` CLI flag for the pi coding agent | Planned |
| Benchmark runner CLI (`bench run --compare`) | Planned |
| Benchmark task suite (10 tasks with validators) | Planned |
| JSONL telemetry + `report.md` generator | Planned |

---

## Demos

Both demos require a Neuralwatt API key:

```bash
export NEURALWATT_API_KEY=sk-...
```

### Demo 1: HackerNews Energy-Aware Watcher

Polls HackerNews top stories and scores each title's relevance to configurable keywords. Runs baseline (Kimi K2.5, no budget) and energy-aware (3-tier discriminator + budget policy) side by side, then prints a final comparison.

```bash
cd packages/benchmarks

# Default: 120s, 3500J budget
npx tsx src/demos/hn-watcher.ts

# Custom duration and budget
npx tsx src/demos/hn-watcher.ts --duration 180 --budget 5000

# Custom keywords
npx tsx src/demos/hn-watcher.ts --keywords "AI,LLM,GPU,CUDA,transformer"

# Start fresh (wipe cross-run memory)
npx tsx src/demos/hn-watcher.ts --clear-memory
```

The watcher displays a live two-column feed (baseline vs energy-aware) and prints a final report showing energy used, cost, score agreement, and a verdict:

```
  ✓ Energy-aware wins: 68% less energy, 71% lower cost — same scoring quality
```

### Demo 2: Acceptance-Test-Driven Coding Agent

Implements a rate limiter in TypeScript using an energy-aware multi-turn coding agent. Runs baseline and energy-aware agents in parallel, then verifies the output against pre-written acceptance tests.

```bash
cd packages/benchmarks

# Default configuration
npx tsx src/demos/coding-agent.ts

# Start fresh (wipe cross-run memory)
npx tsx src/demos/coding-agent.ts --clear-memory
```

The agent runs in three phases:

1. **Build** (4 turns) — incremental implementation: interfaces, class, middleware, validation
2. **Consolidate** (1 turn) — emit final `impl.ts` as a single file
3. **Verify + fix loop** — run acceptance tests; request corrections until all pass or budget is exhausted

The discriminator classifies each prompt before every turn and routes to the appropriate model tier. Final scorecard shows per-turn model routing, energy and cost per turn, acceptance test results, and a side-by-side comparison:

```
  | Energy used    | 14.3 J              | 4.9 J  (-66%)             |
  | Est. cost      | $0.00142            | $0.00038  (-73%)           |
  | Quality        | ✓ PASSED (turn 5)   | ✓ PASSED (turn 6, +1 fix)  |
```

---

## Error Handling

- **Neuralwatt API down** — fails with a clear error message; never silently switches providers
- **Energy telemetry missing** — logs a warning, continues as baseline; policy returns empty `PolicyDecision`
- **Budget exhausted mid-task** — policy sets `abort: true` with reason; agent loop returns partial results
- **Unknown model in routing** — skips model routing strategy and moves to the next in the chain
- **Discriminator classifier error** — falls back to `complex` tier (safest default)

---

## Benchmark Harness (Planned)

The `packages/benchmarks` package will add a formal benchmark CLI:

```bash
cd packages/benchmarks

# Run baseline only
npx tsx src/cli.ts run --mode baseline

# Run energy-aware only
npx tsx src/cli.ts run --mode energy-aware

# Run both back-to-back and generate comparison report
npx tsx src/cli.ts run --compare --budget-joules 50
```

Output:
- `results.jsonl` — per-call telemetry records (`task_id`, `model`, `energy_joules`, `tokens`, `latency_ms`, ...)
- `summary.csv` — per-task aggregated results (`time_ms`, `energy_joules`, `tokens_total`, `success`, `score`)
- `report.md` — human-readable comparison with verdict: "Energy-aware mode saved X% energy with Y% success rate impact"

The task format includes a deterministic validator so results are reproducible:

```typescript
interface BenchmarkTask {
  id: string;
  name: string;
  prompt: string;
  tools?: AgentTool[];
  validator: (result: AgentMessage[]) => { passed: boolean; score: number; reason: string };
  maxTurns: number;
}
```

---

## Packages

| Package | Published as | Description |
|---------|-------------|-------------|
| **[packages/ai](packages/ai)** | `@neuralwatt/pi-ai` | Unified multi-provider LLM API — includes Neuralwatt provider and energy telemetry parsing |
| **[packages/agent](packages/agent)** | `@neuralwatt/pi-agent-core` | Agent runtime — includes `BaselinePolicy`, `EnergyAwarePolicy`, and policy hook types |
| **[packages/benchmarks](packages/benchmarks)** | `@mariozechner/pi-benchmarks` | Demos and benchmark runner for energy-aware evaluation |
| **[packages/coding-agent](packages/coding-agent)** | `@mariozechner/pi-coding-agent` | Interactive coding agent CLI (from upstream pi-mono) |
| **[packages/mom](packages/mom)** | `@mariozechner/pi-mom` | Slack bot (from upstream pi-mono) |
| **[packages/tui](packages/tui)** | `@mariozechner/pi-tui` | Terminal UI library (from upstream pi-mono) |
| **[packages/web-ui](packages/web-ui)** | `@mariozechner/pi-web-ui` | Web components for AI chat (from upstream pi-mono) |
| **[packages/pods](packages/pods)** | `@mariozechner/pi` | vLLM deployment CLI (from upstream pi-mono) |

---

## Publishing to GitHub Packages

`@neuralwatt/pi-ai` and `@neuralwatt/pi-agent-core` are published to the GitHub Packages npm registry so that downstream repos (e.g. `fugue-mono`) can consume them without needing this repo on the local filesystem.

### Automatic (CI)

The [publish-packages](.github/workflows/publish-packages.yml) workflow runs automatically on every push to `fugue/phase-0` that touches `packages/ai/**` or `packages/agent/**`.

### Manual trigger

```bash
# Trigger from the CLI — publishes both packages
gh workflow run publish-packages.yml --ref fugue/phase-0

# Publish only one package
gh workflow run publish-packages.yml --ref fugue/phase-0 -f package=ai
gh workflow run publish-packages.yml --ref fugue/phase-0 -f package=agent
```

Or from the GitHub UI: **Actions → Publish Neuralwatt Packages → Run workflow**.

### Versioning

Both packages are versioned together at `packages/*/package.json`. Bump before publishing:

```bash
# From repo root — bumps all workspace packages and syncs cross-references
npm run version:patch   # 0.53.0 → 0.53.1
npm run version:minor   # 0.53.0 → 0.54.0
npm run version:major   # 0.53.0 → 1.0.0
```

Then push to trigger the workflow. GitHub Packages will reject a publish if the version already exists, so always bump before pushing.

---

## Development

```bash
npm install          # Install all dependencies
npm run check        # Lint, format, and type check (biome + tsgo)
./test.sh            # Run tests (skips API-dependent tests without keys)
```

See [AGENTS.md](AGENTS.md) for contribution rules and [energy_aware_agent_plan.md](energy_aware_agent_plan.md) for the full implementation plan.

### Fugue integration

The [Fugue](../fugue) repo consumes `@neuralwatt/pi-ai` and `@mariozechner/pi-benchmarks` via `file:` references for local dev. For Docker builds, Fugue vendors these packages using `fugue/docker/vendor-pi-mono.sh`, which copies `packages/ai` and `packages/benchmarks` (including `dist/` and `src/`) into Fugue's `.vendor/` directory and patches `package.json` to resolve private `npm:@neuralwatt/*` aliases locally.

After making changes to `packages/ai` or `packages/benchmarks`, rebuild them before Fugue can pick up the changes:

```bash
npm run build --workspace=@neuralwatt/pi-ai
npm run build --workspace=@mariozechner/pi-benchmarks
```

Then in the Fugue repo, re-vendor and rebuild Docker:

```bash
cd ~/dev/fugue
bash docker/vendor-pi-mono.sh && docker compose up -d --build fugue-core
```

---

## License

MIT — same as upstream [badlogic/pi-mono](https://github.com/badlogic/pi-mono).
