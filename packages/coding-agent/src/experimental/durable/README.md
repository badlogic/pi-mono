# Durable web adapter

This directory carries the durable application adapter needed by the fork’s [web UI](../../../../../web-ui/README.md). It was copied from the sibling Pi checkout at commit `a2d8a2919389635139e8eef687ede65a26d8a75b` and uses only packages and source within this repository. The browser, transport and launchers live in `web-ui/`; the upstream terminal-only frontend is not required here.

The subagent result uses this fork's `output` field in place of the older `content` field. `npm run web:test:adapter` exercises the complete parent → child → tool result flow with a faux provider.

| File | Responsibility |
|---|---|
| [runtime.ts](runtime.ts) | Open the Harness; expose plain view snapshots and submit, abort, model, thinking, compaction, task and conversation controls |
| [sessions.ts](sessions.ts) | Select or create per-project SQLite session directories and lock ownership |
| [harness-setup.ts](harness-setup.ts) | Share Pi model resolution, HTTP setup, settings, execution environments and coding tools |
| [prompt.ts](prompt.ts) | Build Pi system-prompt sections from project context and skills |
| [subagent.ts](subagent.ts) | Foreground child conversations owned by tool calls, with replay-safe submission |

Sessions use `~/.pi/agent/experimental/durable-sessions/<cwd-hash>/<session>/session.sqlite`, respecting `PI_CODING_AGENT_DIR`. `--continue` selects the latest session for the project. One process owns a session; closing writes no completed outcome for interrupted work, so the durable scheduler handles recovery after reopening. The web UI reconnects to snapshots and never implements its own task recovery.

The adapter shares Pi settings and authentication. It does not add extension loading, a session picker, forks/tree navigation, image input or a separate login flow. See the [durable package](../../../../durable/README.md) for the persistence contract.
