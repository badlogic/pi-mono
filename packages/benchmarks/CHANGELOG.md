# Changelog

## [Unreleased]

### Added
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
