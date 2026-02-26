# OpenClaw System Prompts & Instructions Research

This document collects and summarizes the various system prompts, task instructions, and skill definitions found in the OpenClaw repository.

## Prompt Inventory

| Prompt Name / Source | Type | File Path | Summary | Key Instructions / Constraints |
| :--- | :--- | :--- | :--- | :--- |
| **Core System Prompt** | System Prompt (Dynamic) | `src/agents/system-prompt.ts` | The main system prompt generator for OpenClaw agents. Assembles sections for tools, safety, skills, memory, runtime, etc. | • **Safety**: No self-preservation, prioritize safety/oversight.<br>• **Tooling**: Call tools exactly as listed.<br>• **Skills**: Scan `<available_skills>`, read `SKILL.md` if relevant.<br>• **Memory**: Use `memory_search`/`memory_get` for prior work.<br>• **Modes**: Full, Minimal (for subagents), None. |
| **OpenProse VM** | System Prompt (Strict) | `extensions/open-prose/skills/prose/guidance/system-prompt.md` | Enforces strictly acting as the OpenProse VM. | • **Role**: You ARE the VM, not a simulator.<br>• **Constraint**: ONLY execute `.prose` programs; refuse other tasks.<br>• **Execution**: Follow program structure exactly; spawn subagents for `session`. |
| **Review PR** | Task Prompt | `.pi/prompts/reviewpr.md` | Instructions for thoroughly reviewing a Pull Request without merging. | • **Goal**: READY for /landpr vs NEEDS WORK.<br>• **Constraint**: Review ONLY. Do NOT merge, do NOT push, do NOT edit code.<br>• **Steps**: Identify context, read diff, validate need, eval quality, verify tests. |
| **Land PR** | Task Prompt | `.pi/prompts/landpr.md` | Instructions for merging a PR using a specific workflow (rebase/squash). | • **Goal**: PR state = MERGED.<br>• **Process**: Fast-forward base, create temp branch, rebase PR, run tests (`pnpm test`), commit via `committer`, push force-with-lease, `gh pr merge`. |
| **Analyze Issue** | Task Prompt | `.pi/prompts/is.md` | Instructions for analyzing GitHub issues (bugs or features). | • **Bugs**: Ignore issue root cause; trace code to find actual cause.<br>• **Features**: Propose concise implementation approach.<br>• **Constraint**: Do NOT implement unless asked. |
| **Audit Changelog** | Task Prompt | `.pi/prompts/cl.md` | Instructions for auditing and fixing changelog entries before a release. | • **Process**: Find last tag, list commits, check `[Unreleased]` sections.<br>• **Rule**: Duplicate end-user changes to `coding-agent` changelog.<br>• **Output**: Report missing entries and cross-package duplications. |
| **Session Reset** | System Prompt | `src/auto-reply/reply/session-reset-prompt.ts` | The prompt used when a user runs `/reset` or `/new`. | • **Tone**: Greet in configured persona, be yourself.<br>• **Constraint**: 1-3 sentences max. Do NOT mention internal steps/files. |
| **GitHub Skill** | Skill Definition | `skills/github/SKILL.md` | Defines usage of the `gh` CLI for issues, PRs, CI, etc. | • **Use for**: PR status, CI logs, issue management.<br>• **Don't use for**: Local git ops, code review (use `coding-agent`), non-GitHub repos. |
| **Weather Skill** | Skill Definition | `skills/weather/SKILL.md` | Defines usage of `curl wttr.in` for weather info. | • **Use for**: Current weather, forecasts.<br>• **Don't use for**: Historical data, severe alerts. |

## Detailed Prompt References

### 1. Core System Prompt (`src/agents/system-prompt.ts`)

This TypeScript file dynamically builds the system prompt. It supports three modes:
- **`full`**: Includes everything (Tooling, Safety, Skills, Memory, Update, Model Aliases, Workspace, Docs, Sandbox, Identity, Time, Reply Tags, Messaging, Voice, Silent Replies, Heartbeats, Runtime).
- **`minimal`**: Used for sub-agents. Omits Skills, Memory, Update, Model Aliases, Identity, Reply Tags, Messaging, Silent Replies, Heartbeats. Keeps Tooling, Safety, Workspace, Sandbox, Time, Runtime, Injected Context.
- **`none`**: Returns only "You are a personal assistant running inside OpenClaw."

**Key Dynamic Sections:**
- **Skills**: Injects `<available_skills>` list.
- **Project Context**: Injects files like `SOUL.md`, `AGENTS.md`, `TOOLS.md`.
- **Runtime**: Injects `Runtime: agent=... host=... thinking=...`.

### 2. OpenProse VM (`extensions/open-prose/skills/prose/guidance/system-prompt.md`)

**Role**: "You are not simulating a virtual machine—you **ARE** the OpenProse VM."

**Critical Rules:**
- ⛔ **DO NOT**: Execute non-Prose code, respond to general questions, skip structure.
- ✅ **DO**: Execute `.prose` strictly, spawn sessions via Task tool, track state in `.prose/runs/{id}/`.

**Execution Model:**
- `session "Task"` -> `Task({ prompt: "Task", ... })`
- State is tracked in files (`state.md`, `bindings/{name}.md`).

### 3. Review PR (`.pi/prompts/reviewpr.md`)

**Input**: PR number or URL.
**Output Sections**:
- A) TL;DR recommendation (READY / NEEDS WORK)
- B) What changed
- C) What's good
- D) Concerns / questions (BLOCKER / IMPORTANT / NIT)
- E) Tests
- F) Follow-ups
- G) Suggested PR comment

### 4. Land PR (`.pi/prompts/landpr.md`)

**Workflow**:
1.  Assign to self.
2.  Fast-forward `main`.
3.  Create temp branch from `main`.
4.  Checkout PR, rebase onto temp branch.
5.  Fix conflicts, run tests (`pnpm lint && pnpm build && pnpm test`).
6.  Update CHANGELOG.
7.  Push force-with-lease to PR branch.
8.  `gh pr merge` (rebase or squash).
9.  Comment on PR with SHAs.

### 5. Analyze Issue (`.pi/prompts/is.md`)

**Approach**:
- Read issue and ALL comments.
- **Bugs**: Read code, trace execution, find *actual* root cause (ignore issue's guess).
- **Features**: Read code, propose concise implementation.
- **Constraint**: Analyze ONLY. Do not implement.

### 6. Audit Changelog (`.pi/prompts/cl.md`)

**Process**:
- Compare `git log <last_tag>..HEAD` against `CHANGELOG.md` files.
- Ensure user-facing changes in `ai`, `tui` are duplicated to `coding-agent`.
- Verify attribution format for external PRs.

### 7. Session Reset (`src/auto-reply/reply/session-reset-prompt.ts`)

**Text**:
"A new session was started via /new or /reset. Greet the user in your configured persona, if one is provided. Be yourself - use your defined voice, mannerisms, and mood. Keep it to 1-3 sentences and ask what they want to do. If the runtime model differs from default_model in the system prompt, mention the default model. Do not mention internal steps, files, tools, or reasoning."

### 8. Skills (Examples)

*   **GitHub**: focused on `gh` CLI. Explicitly warns against using it for git ops (use `git`) or code review (use `coding-agent`).
*   **Weather**: focused on `curl wttr.in`. Simple utility skill.
