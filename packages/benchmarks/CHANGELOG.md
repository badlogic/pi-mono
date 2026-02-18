# Changelog

## [Unreleased]

### Added
- Initial package scaffold for energy-aware benchmark harness
- Core types: TelemetryRecord, BenchmarkTask, TaskResult, TaskComparison, BenchmarkReport, RunConfig, RunResult
- Benchmark runner with runTask/runSuite supporting policy hooks and mocked turn usage
- CLI entry point with --mode, --tasks, --budget-joules, --budget-ms, --output options
- Smoke tests covering runner, suite execution, pressure computation, and policy integration
