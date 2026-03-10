# Changelog

## [Unreleased]

### Added
- Fast mode (`--fast`): third comparison column in both coding-agent and hn-watcher demos (Kimi K2.5 Fast)
- `minTier` option on discriminator for failure-based tier escalation (escalate after 2 consecutive failures)
- New model definitions: MiniMax M2.5, Qwen3.5 35B, Kimi K2.5 Fast, GLM-5 Fast
- Separate input/output token cost estimation (replaces averaged pricing)

### Changed
- Aggregate scorecard now only averages runs where all modes passed (apples-to-apples comparison)
- Escalation strategy: replaced `FIX_TIER_CEILING` (maxTier per attempt) with failure-counting minTier escalation
- Updated all model pricing in both demos from portal.neuralwatt.com (asymmetric input/output rates)
- Quality summary now shows failure status when EA/fast fails but baseline passes
- maxTier takes precedence when minTier > maxTier (prevents silent contract violation)

### Fixed
- Escalation counter off-by-one: reset to 1 after escalation so next tier also needs only 2 failures
- Stale file header comments updated with correct four-tier architecture and pricing

---

### Added (initial)
- Initial package scaffold for energy-aware benchmark harness
- Core types: TelemetryRecord, BenchmarkTask, TaskResult, TaskComparison, BenchmarkReport, RunConfig, RunResult
- Benchmark runner with runTask/runSuite supporting policy hooks and mocked turn usage
- CLI entry point with --mode, --tasks, --budget-joules, --budget-ms, --output options
- Smoke tests covering runner, suite execution, pressure computation, and policy integration
- 10-task benchmark suite: Q&A (2), code generation (3), reasoning (2), summarization (2), orchestration (1)
- getTasksByGlob for task filtering by ID pattern
- Task suite tests validating structure, categories, and validators
- Demo 1: Coding Agent Energy Challenge (`demo:coding` script) — simulates a multi-step coding task under BaselinePolicy and EnergyAwarePolicy with live energy meter and ASCII scorecard
- Report generator: `generateReport(resultsPath)` reads results.jsonl and produces BenchmarkReport, summary CSV, and Markdown comparison report with per-task table, aggregate stats, and verdict
- CI smoke benchmark: 12 tests running 3 tasks (qa-factual, code-fizzbuzz, reason-math) through baseline and energy-aware modes with budget enforcement validation
- Demo 2: HackerNews Energy-Aware Watcher (`demo:hn` script) — polls real HN top stories, scores relevance via LLM (completeSimple), runs baseline and energy-aware concurrently with live two-column display, shared energy budget meter, and final summary with high-relevance stories. Supports --duration and --budget flags.
