# Energy-Aware Mode

This document defines the design contract for energy-aware operation in pi-mono, using Neuralwatt endpoints.

## Overview

pi-mono supports two runtime modes that can be compared head-to-head:

- **Baseline Mode** — default behavior, no policy intervention, all model calls use full parameters
- **Energy-Aware Mode** — a runtime policy observes energy consumption per call and adaptively reduces it without degrading task success rate

Both modes use the **same Neuralwatt endpoint** (`https://api.neuralwatt.com/v1`). The only difference is the active `RuntimePolicy`.

## Metrics

| Metric | Unit | Description |
|--------|------|-------------|
| energy/task | joules (J) | Total energy consumed to complete one benchmark task |
| time/task | milliseconds (ms) | Wall-clock time to complete one benchmark task |
| success rate | % | Fraction of tasks whose validator returns `passed: true` |
| task score | 0–10 | Quality score from the task validator |

## Energy Data Source

Neuralwatt returns per-request energy data in the API response. The `EnergyUsage` fields are:

```typescript
interface EnergyUsage {
  energy_joules: number;   // energy consumed for this request
  energy_kwh: number;      // same value in kWh
  duration_seconds: number; // server-side processing time
}
```

These fields are attached to every `AssistantMessage` returned through the Neuralwatt provider as `message.energy`.

## Policy Architecture

### RuntimePolicy interface

```typescript
interface RuntimePolicy {
  name: string;
  beforeModelCall(ctx: PolicyContext): PolicyDecision;
  afterModelCall(ctx: PolicyContext, usage: UsageWithEnergy): void;
}
```

- `beforeModelCall` is called before each LLM call and can override model, maxTokens, reasoning level, or trigger compaction/abort
- `afterModelCall` is called after each LLM call completes and updates the policy's internal state with energy consumed

### BaselinePolicy

No-op policy. `beforeModelCall` returns an empty `PolicyDecision`. `afterModelCall` logs telemetry only. Used to establish baseline measurements.

### EnergyAwarePolicy

Adaptive policy with a five-stage strategy chain, activated in order as budget pressure increases:

| Stage | Trigger | Action |
|-------|---------|--------|
| 1. Reasoning reduction | pressure > 30% | Reduce reasoning level: high → medium → low → off |
| 2. Token reduction | pressure > 50% | Reduce maxTokens by up to 40% |
| 3. Model routing | pressure > 70% | Switch to cheapest available model supporting required capabilities |
| 4. Context compaction | pressure > 50% AND tokens > 60% of context window | Trigger context compaction |
| 5. Budget exhaustion | pressure ≥ 100% | Abort with reason message |

**Budget pressure** = `consumedEnergy / energy_budget_joules`

Falls back to time-based pressure (`consumedTime / time_budget_ms`) if no energy budget is set.
Returns 0 (no intervention) if neither budget is set.

Every policy decision includes a human-readable `reason` string for observability.

## Acceptance Criteria

Energy-aware mode must:
- Achieve **≥20% energy reduction** compared to baseline across the benchmark task suite
- Maintain **≤5% success rate degradation** compared to baseline
- Never crash when energy telemetry is missing (graceful fallback to baseline behavior)

## Benchmark Harness

The `packages/benchmarks` package provides:

```bash
# Run baseline only
cd packages/benchmarks && node dist/cli.js run --mode baseline

# Run energy-aware only
cd packages/benchmarks && node dist/cli.js run --mode energy-aware

# Run both and generate comparison report
cd packages/benchmarks && node dist/cli.js run --compare
```

Output files:
- `results.jsonl` — per-call telemetry records
- `summary.csv` — per-task aggregated results
- `report.md` — human-readable comparison report with verdict

## Live Demos

### Demo 1: Coding Agent Energy Challenge
```bash
npm run demo:coding -w packages/benchmarks
```
Runs a real coding agent task in both modes sequentially with a live energy meter and final scorecard.

### Demo 2: HackerNews Energy-Aware Watcher
```bash
npm run demo:hn -w packages/benchmarks
```
Runs a continuous HackerNews relevance monitor for AI-related topics, comparing energy consumption between modes over 3 minutes.
