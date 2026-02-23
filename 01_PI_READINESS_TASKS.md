# Task List: Pi CLI Readiness Validation

**Created**: 2026-02-23
**Goal**: Validate Pi as Embry OS agentic harness — prove what works, document what doesn't, close the gap.

## Context

Pi (v0.52.8) is the intended long-term harness for Embry OS. We co-develop Pi and keep all 228 skills in the canonical location `.pi/skills/`. Claude Code is the interim harness. This task validates Pi's readiness: headless execution, skill loading, extension runtime, and documents the Task tool gap for the 18 orchestration-heavy skills.

## Capability Overlap

- **No overlap risk** — this is infrastructure validation, not feature building.
- All skills already live in `.pi/skills/` (canonical location).
- Extensions already use Pi's `ExtensionAPI` (`pi.on()`, `pi.registerTool()`).
- No new systems being created — we're validating existing ones work under Pi runtime.

## Crucial Dependencies (Sanity Scripts)

| Dependency | Method | Sanity Script | Status |
|------------|--------|---------------|--------|
| Pi CLI binary | `node dist/cli.js -p "ping"` | `sanity/pi_headless.sh` | [x] BLOCKED — stdin hang |
| Pi skill loading | `pi -p "list skills"` | `sanity/pi_skill_load.sh` | [ ] BLOCKED by Task 1 |
| Pi extension loading | `pi -p --no-skills "test"` | `sanity/pi_extension_load.sh` | [ ] BLOCKED by Task 1 |

> All sanity scripts must PASS before proceeding to implementation tasks.

## Questions/Blockers

None — all requirements clear from assessment. Pi documentation confirms:
- Headless: `-p` / `--print` flag (main.ts:591-592)
- Skills: Loaded from `.pi/skills/` with validation (skills.ts:369-472)
- Extensions: Loaded from `.pi/extensions/` via jiti (loader.ts:470-516)
- Tools: 7 native (read, bash, edit, write, grep, find, ls)
- Triggers: New feature on feat-triggers branch (skills.ts:74,278,320-321)

## Tasks

### P0: Headless Smoke Test (Sequential)

- [x] **Task 1**: Validate Pi starts and responds in headless mode
  - **RESOLVED**: Option C fix applied (early-exit + stdin timeout). 3-round code review complete. All 6 findings addressed.
  - Agent: general-purpose
  - Parallel: 0
  - Dependencies: none
  - **Details**:
    1. Run `echo "respond with exactly: pong" | node /home/graham/workspace/experiments/pi-mono/packages/coding-agent/dist/cli.js -p` with 30s timeout
    2. Run `node dist/cli.js -p "respond with exactly: pong"` with 30s timeout
    3. Run `node dist/cli.js -p --max-turns 1 "respond with exactly: pong"` with 30s timeout
    4. If all hang, check if ANTHROPIC_API_KEY is set (Pi needs an LLM provider)
    5. Try `node dist/cli.js --list-models` to verify provider connectivity
    6. Write results to `sanity/pi_headless.sh` as a reusable sanity script
  - **Definition of Done**:
    - Test: `bash sanity/pi_headless.sh` exits 0
    - Assertion: Pi responds to a prompt in print mode within 30 seconds

### P1: Skill & Extension Validation (Parallel after P0)

- [x] **Task 2**: Validate Pi discovers and lists all 228 skills
  - Agent: general-purpose
  - Parallel: 1
  - Dependencies: Task 1
  - **Details**:
    1. Run Pi with `-p "How many skills do you have access to? List them."` and capture output
    2. Verify skill count matches `.pi/skills-manifest.json` (196 in manifest, 228 directories)
    3. Check Pi's skill loading diagnostics for errors/warnings (skills.ts validation)
    4. Verify trigger fields are parsed for skills that have them (feat-triggers)
    5. Test one skill invocation: ask Pi to use `/memory` or `/brave-search` (simple, no Task dependency)
    6. Document any skills that fail to load with reasons
  - **Definition of Done**:
    - Test: `bash sanity/pi_skill_load.sh` exits 0
    - Assertion: Pi discovers 190+ skills without errors and can invoke at least one

- [x] **Task 3**: Validate Pi loads and runs extensions from .pi/extensions/
  - Agent: general-purpose
  - Parallel: 1
  - Dependencies: Task 1
  - **Details**:
    1. Run Pi with `-p "run: echo hello"` and check if `bounded-concurrency.ts` intercepts the bash tool call
    2. Run Pi with `-p --no-extensions "run: echo hello"` as control (should NOT intercept)
    3. Check Pi startup logs/output for extension loading messages
    4. Verify `memory-first.ts` hooks `before_agent_start` (may require checking Pi's debug output)
    5. Test `skill-rediscovery.ts` loads without error (it's a 3-line stub, should be harmless)
    6. Document which extensions load successfully vs fail
  - **Definition of Done**:
    - Test: `bash sanity/pi_extension_load.sh` exits 0
    - Assertion: At least `bounded-concurrency.ts` and `memory-first.ts` load without error under Pi runtime

- [x] **Task 4**: Audit and categorize the 18 Task-tool-dependent skills
  - Agent: general-purpose
  - Parallel: 1
  - Dependencies: Task 1
  - **Details**:
    1. For each of the 18 skills that declare `Task` in allowed-tools, read their SKILL.md
    2. Categorize by HOW they use Task:
       - **Subagent spawning** (parallel research) — needs Task tool extension
       - **Sequential delegation** (hand off to specialist) — could use bash + pi -p instead
       - **Just listed but not critical** — Task in allowed-tools but skill works without it
    3. For each skill, determine: can it function with Pi's 7 native tools? What breaks?
    4. Write findings to `docs/pi-task-tool-gap.md` with migration path per skill
    5. The 18 skills: plan, orchestrate, create-movie, create-story, create-music, paper-lab, review-paper, review-story, argue, sparta-review, review-sparta, train-voice, learn-voice, learn-artist, create-stems, voice-lab, monitor-contacts, discover-contacts, debug-fetcher
  - **Definition of Done**:
    - Test: `test -f docs/pi-task-tool-gap.md && wc -l docs/pi-task-tool-gap.md | awk '{exit ($1 < 50)}'`
    - Assertion: Gap analysis document exists with 50+ lines covering all 18 skills with categorization and migration paths

### P2: Integration & Documentation (After P1)

- [x] **Task 5**: Create .pi/agents/ directory with Embry OS persona stubs
  - Agent: general-purpose
  - Parallel: 2
  - Dependencies: Task 2, Task 3
  - **Details**:
    1. Create `.pi/agents/` directory
    2. Read existing AGENTS.md at repo root (development rules, 230 lines)
    3. Create `.pi/agents/README.md` explaining the agent model for Embry OS
    4. Create one example agent file: `.pi/agents/embry/AGENTS.md` with:
       - System prompt referencing Embry OS core identity
       - Tool restrictions (the 7 native Pi tools)
       - Skill allowlist (skills that work without Task tool)
       - Memory-first enforcement reference
    5. This is a STUB — full persona export from `/monitor-personas` is future work
    6. Verify Pi loads the agent file via `resource-loader.ts` context file discovery
  - **Definition of Done**:
    - Test: `test -d .pi/agents/embry && test -f .pi/agents/embry/AGENTS.md`
    - Assertion: .pi/agents/embry/AGENTS.md exists and Pi loads it as context when run from that directory

- [x] **Task 6**: Write Pi readiness report with go/no-go recommendation
  - Agent: general-purpose
  - Parallel: 2
  - Dependencies: Task 1, Task 2, Task 3, Task 4, Task 5
  - **Details**:
    1. Aggregate results from all previous tasks
    2. Write `docs/pi-readiness-report.md` with:
       - Executive summary: go/no-go for each capability
       - Headless execution: pass/fail + evidence
       - Skill loading: count loaded, count failed, reasons
       - Extension loading: which work, which don't, errors
       - Task tool gap: summary of 18-skill audit with migration tiers
       - Agent definition: stub status, next steps
       - Trigger system: status on feat-triggers branch
       - Recommended next steps: ordered by impact
    3. Include a "What works TODAY" section (skills that can run under Pi right now)
    4. Include a "What needs work" section with effort estimates
  - **Definition of Done**:
    - Test: `test -f docs/pi-readiness-report.md && wc -l docs/pi-readiness-report.md | awk '{exit ($1 < 100)}'`
    - Assertion: Report exists with 100+ lines covering all validation areas with evidence-backed go/no-go per capability

## Completion Criteria

- [ ] All sanity scripts pass (Tasks 1-3)
- [ ] All tasks marked [x]
- [ ] All Definition of Done tests pass
- [ ] `docs/pi-readiness-report.md` delivered with go/no-go
- [ ] `docs/pi-task-tool-gap.md` delivered with migration paths for 18 skills
- [ ] `.pi/agents/embry/AGENTS.md` stub created
- [ ] No regressions — existing skills and extensions unchanged

## Notes

- Pi is co-developed in this repo. `.pi/skills/` is the canonical location for all Embry OS skills.
- Pi v0.52.8 has 7 native tools: read, bash, edit, write, grep, find, ls
- Claude Code's Task tool (subagent spawning) has no Pi equivalent yet — this is the primary gap
- Pi's extension API `registerTool()` could build a Task equivalent, but that's out of scope here
- The feat-triggers branch adds skill trigger support (auto-invocation based on patterns)
- Pi already supports headless via `-p`/`--print` flag — the earlier smoke test used wrong invocation
