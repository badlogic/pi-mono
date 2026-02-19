# Energy-Aware Pi Mono

A fork of [badlogic/pi-mono](https://github.com/badlogic/pi-mono) that adds **Energy-Aware Mode** — a runtime policy layer that reduces energy consumption and cost for LLM workloads without degrading output quality.

Built on [Neuralwatt](https://neuralwatt.com) endpoints, which expose per-request energy telemetry (`energy_joules`, `energy_kwh`) alongside standard token usage.

---

## What this adds to pi-mono

### Energy-Aware Runtime Policy (`packages/agent`)

A policy hook system that wraps the agent loop and intervenes at model call boundaries:

- `BaselinePolicy` — no intervention, mirrors default pi-mono behavior
- `EnergyAwarePolicy` — budget-aware policy that fires a cascade of interventions as budget pressure rises:
  1. **>30% pressure** — reduces reasoning budget
  2. **>50% pressure** — caps output token limits
  3. **>70% pressure** — routes to a cheaper, more energy-efficient model
  4. **>50% pressure + large context** — triggers context compaction
  5. **100% pressure** — aborts to prevent overrun

Budget pressure = `consumedEnergy / energy_budget_joules`. Falls back to time-based pressure if no energy budget is set.

### Four-Tier Discriminator (`packages/benchmarks/src/demos/demo-discriminator.ts`)

A lightweight classifier (GPT-OSS-20B) evaluates each prompt before the main model call and routes to one of four tiers based on task complexity and whether chain-of-thought reasoning is needed:

| Tier | Model | Tokens/J | Cost/1M tokens | Use case |
|------|-------|----------|----------------|----------|
| thinking | Kimi K2.5 | 0.482 | $1.327 | CoT reasoning, debugging, step-by-step |
| complex | Qwen3-Coder-480B | 0.314 | $0.10 | High quality, direct answer, no CoT |
| medium | Devstral-24B | 0.809 | $0.12 | Moderate complexity, clear spec |
| simple | GPT-OSS-20B | 1.371 | $0.10 | Boilerplate, obvious tasks, trivial answers |

Optional tiers fall back gracefully: `thinking` → `complex`, `medium` → `simple`.

The classifier also returns a `length` field (`full` / `brief`) that can cap downstream `maxTokens` to avoid over-generating short answers.

### Persistent Cross-Run Memory (`packages/benchmarks/src/demos/demo-memory.ts`)

Stored at `~/.energy-demo-memory.json`. Records routing quality observations across runs so each startup can display learned confidence:

```
Memory (5 previous runs): GPT-OSS scores agree with Kimi within 0.15 in 94% of stories (n=47)
                           Routes at ~74% pressure — saves 69% energy with no quality loss
```

Memory informs the discriminator prompt on subsequent runs — phases that historically routed to complex and failed are weighted toward higher tiers.

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
| Four-tier discriminator (shared module) | Done |
| Persistent cross-run memory | Done |
| HN Watcher demo | Done |
| Coding Agent demo (acceptance-test-driven) | Done |
| Unit tests for policy layer | Done |
| Benchmark runner / report generator | Planned |

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

The watcher displays a live two-column feed (baseline vs energy-aware) and prints a final report showing energy used, cost, score agreement percentage, and a verdict:

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
3. **Verify + fix loop** — run acceptance tests, request corrections until all pass or budget is exhausted

Final scorecard shows per-turn model routing, energy used, cost, and test pass/fail with turn count.

---

## Packages

| Package | Description |
|---------|-------------|
| **[@mariozechner/pi-ai](packages/ai)** | Unified multi-provider LLM API — includes Neuralwatt provider and energy telemetry parsing |
| **[@mariozechner/pi-agent-core](packages/agent)** | Agent runtime — includes `BaselinePolicy`, `EnergyAwarePolicy`, and policy hook types |
| **[@mariozechner/pi-benchmarks](packages/benchmarks)** | Demos and benchmark runner for energy-aware evaluation |
| **[@mariozechner/pi-coding-agent](packages/coding-agent)** | Interactive coding agent CLI (from upstream pi-mono) |
| **[@mariozechner/pi-mom](packages/mom)** | Slack bot (from upstream pi-mono) |
| **[@mariozechner/pi-tui](packages/tui)** | Terminal UI library (from upstream pi-mono) |
| **[@mariozechner/pi-web-ui](packages/web-ui)** | Web components for AI chat (from upstream pi-mono) |
| **[@mariozechner/pi-pods](packages/pods)** | vLLM deployment CLI (from upstream pi-mono) |

---

## Development

```bash
npm install          # Install all dependencies
npm run check        # Lint, format, and type check (biome + tsgo)
./test.sh            # Run tests (skips API-dependent tests without keys)
```

See [AGENTS.md](AGENTS.md) for contribution rules and [energy_aware_agent_plan.md](energy_aware_agent_plan.md) for the full implementation plan.

---

## License

MIT — same as upstream [badlogic/pi-mono](https://github.com/badlogic/pi-mono).
