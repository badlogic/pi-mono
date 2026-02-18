# Claude Code Instructions

## Project Overview

This is a fork of `badlogic/pi-mono` — a TypeScript monorepo for AI-powered coding agents. We are implementing **Energy-Aware Mode** using Neuralwatt endpoints. See `energy_aware_agent_plan.md` for the full execution plan.

## Read First

Before working, read these files:
- `AGENTS.md` — repo-wide development rules (git safety, code quality, testing, style). **All rules in AGENTS.md apply here.**
- `energy_aware_agent_plan.md` — the execution plan with task definitions, architecture context, and acceptance criteria

## Quick Reference

### Build & Check
```bash
# Typecheck + lint (run before every commit)
npm run check

# Run a specific test file (from the package root)
npx tsx ../../node_modules/vitest/dist/cli.js --run test/specific.test.ts
```

### Forbidden Commands
- `npm run dev`, `npm run build`, `npm test` at repo root
- `git add -A`, `git add .`, `git reset --hard`, `git stash`, `git commit --no-verify`

### Style
- Tabs, indent width 3, line width 120
- ESM with `.js` extensions in imports
- Conventional commits: `feat(ai):`, `fix(agent):`, `test(benchmarks):`
- No emojis in code, commits, or comments
- No `any` types unless absolutely necessary

## Team Mode Rules

### File Ownership
Each agent owns specific directories. Never modify files outside your scope without lead approval.

| Role | Owned Files |
|------|------------|
| Provider | `packages/ai/src/providers/neuralwatt*`, `packages/ai/src/energy-types.ts`, `packages/ai/src/types.ts` (EnergyUsage addition), `packages/ai/test/neuralwatt*`, `packages/ai/test/energy*` |
| Runtime | `packages/agent/src/policy/*`, `packages/agent/src/agent-loop.ts`, `packages/agent/src/types.ts` (policy additions), `packages/agent/test/policy/*` |
| Benchmark | `packages/benchmarks/**` |
| Lead | Root configs, `ENERGY_AWARENESS.md`, integration tests, demos |

Agents own the listed shared files for their specific additions only. If a shared file needs changes outside your scope, coordinate with the lead first.

### Git Workflow
1. Create feature branch: `energy/<task-id>-<short-name>`
2. Implement + test on the branch
3. Run `npm run check` — fix all errors
4. Run your tests — all must pass
5. Commit only your files: `git add <specific-files>`
6. Merge to main: `git checkout main && git pull --rebase && git merge <branch> && git push`
7. If rebase conflicts occur in files you didn't modify, stop and notify lead

### Testing Requirements
- All new code must have unit tests
- API-dependent tests use mocked HTTP responses (no real API calls in CI)
- Use Vitest's `vi.fn()` and manual mocks
- Create `test/fixtures/` for sample API responses
- Integration tests guarded with: `describe.skipIf(!process.env.NEURALWATT_API_KEY)`
- Target 80%+ line coverage on new code

### Coordination
- Check the task board after completing each task
- Message the lead when a task is complete or when blocked
- Never modify shared type files outside your designated scope
- The telemetry schema (T1.3) is a contract — changes require agreement from Provider and Benchmark agents
- Update `packages/*/CHANGELOG.md` under `## [Unreleased]` for every meaningful change

## Architecture Notes

### Adding Neuralwatt as a provider
Neuralwatt is OpenAI-compatible. Follow the pattern in `packages/ai/src/providers/openai-completions.ts`. Key integration points:
- `src/types.ts` — add `"neuralwatt"` to `KnownProvider`
- `src/env-api-keys.ts` — add `NEURALWATT_API_KEY` detection
- `src/providers/register-builtins.ts` — register the provider
- Reuse `openai-completions` API, set `baseUrl: "https://api.neuralwatt.com/v1"`

### Adding policy hooks to the agent loop
The agent loop in `packages/agent/src/agent-loop.ts` calls `streamAssistantResponse()` on each turn. Policy hooks wrap this function:
- `beforeModelCall` — called before `streamAssistantResponse`, can modify model/options
- `afterModelCall` — called after response completes, receives usage data with energy telemetry
- Policy interface lives in `packages/agent/src/policy/types.ts`
- Integration via `AgentLoopConfig` — add optional `policy?: RuntimePolicy` field

### EnergyAwarePolicy (critical path)
This is the most important deliverable. The strategy chain:
1. Reasoning reduction (pressure > 30%)
2. Token limit reduction (pressure > 50%)
3. Model routing to cheaper models (pressure > 70%) — pick cheapest from `availableModels` that supports required capabilities
4. Context compaction (pressure > 50% AND `estimatedInputTokens` > 60% of model's `contextWindow`)
5. Budget exhaustion abort (pressure >= 100%)

Budget pressure = consumedEnergy / energy_budget_joules. Falls back to time-based if no energy budget. Falls back to no intervention if no budget set.

`availableModels` is populated by the caller (benchmark runner or CLI) — a list of Neuralwatt model definitions sorted by cost.output ascending. Policy picks the first one that meets capability requirements (tools, image, reasoning).

`estimatedInputTokens` = last `AssistantMessage.usage.totalTokens` seen (proxy for current context size).

## Autonomy Guidelines

- Work independently. Only escalate to the user for: blocked API access, ambiguous product requirements, or architectural disagreements between agents.
- Every task completion is a check-in — commit and push to main.
- The lead posts a brief status summary after each epic completes.
- If a task is blocked by a dependency, work on the next available unblocked task.
- If all tasks are blocked, help unblock by assisting the blocking agent.
