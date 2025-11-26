# Polling Module Contract (Fork-only Feature)

This module introduces minimal, opt-in background behavior to the interactive agent to surface incoming messages from a shared queue/database. It is designed for human-agent workflows and debugging. It is intended for a fork and is not aligned with upstream philosophy (no background behavior).

## Architecture Overview

```mermaid
flowchart LR
    subgraph User["Human"]
        U1[Interactive Agent UI]
    end

    subgraph Agent["Interactive Agent (Fork)"]
        A1[Agent Core]
        A2[Poller Module (Idle-only)]
        A3[Slash Commands (/poll)]
    end

    subgraph Adapter["Database Adapter"]
        D1[ArangoJsAdapter]
        D2[HttpAdapter (python-arango)]
    end

    subgraph DB["Shared Message Store"]
        MQ[(messages)]
    end

    U1 --> A1
    A1 <-->A2
    A2 -->|fetchQueued| Adapter
    Adapter --> MQ
    MQ --> Adapter
    Adapter -->|listInbox/claim/updateStatus| A2
    A2 -->|enqueue system prompt| A1
    A3 -->|list/ack/done/failed| A2
```

## Purpose
- Detect incoming messages while idle.
- Alert the user concisely.
- Provide a simple inbox listing via `/poll`.
- Keep database choice pluggable via adapters.

## Philosophy Divergence
Upstream avoids background execution. This module adds opt-in, idle-only polling; treat as fork-only.

## Lifecycle

```mermaid
sequenceDiagram
    participant User as User
    participant Agent as Interactive Agent
    participant Poller as Poller (Idle-only)
    participant Adapter as DB Adapter
    participant DB as Message Store

    Note over Agent,Poller: Agent is idle (not streaming)
    Poller->>Adapter: fetchQueued(agentId, limit)
    Adapter->>DB: Query queued & lease-expired
    DB-->>Adapter: Messages[]
    alt Messages found
        loop For each message
            Poller->>Adapter: claimMessage(id, agentId, leaseUntilMs)
            Adapter->>DB: status=in_progress, lease set
            Poller->>Agent: enqueue system prompt (process next)
        end
        Poller->>User: Alert: Inbox +N (console/TUI)
    else No messages
        Poller-->Poller: No-op (skip)
    end

    Note over Agent: Agent processes next prompt; polling pauses while streaming
    Agent->>Adapter: updateStatus(id, acked|done|failed)
    Adapter->>DB: Update status, clear lease
```

- Startup: disabled by default; enable via settings or `/poll on`. Single adapter init.
- Tick (idle-only): skip if streaming; fetch queued; claim with lease; enqueue; alert.
- Shutdown: stop on `/poll off`, SIGINT, SIGTERM.
- Errors & backoff: bounded exponential; degraded/recovered notices.

## Security
- Credentials via settings/headers; least-privilege DB access.
- Unique `agentId` per poller instance.
- Avoid logging sensitive payloads.

## Message Lifecycle & Status
- `queued` → claim → `in_progress` → `acked|done|failed`.
- Lease default 2m, configurable; no auto-renew.
- Optional LRU dedup to avoid immediate dupes on restart.

## MUST
- Idle-only polling.
- Runtime toggle `/poll on|off`; interval `/poll interval <ms>`.
- Alert on new messages; track inbox count for TUI.
- `/poll` lists id/type/from/status/correlation_id?/payload_ref?.
- Adapter interface: `init`, `fetchQueued`, `claimMessage`, `updateStatus`, `listInbox`.
- Clean start/stop; sane defaults (interval 5–10s, batch 25, lease 2m).
- Poller remains decoupled: exported via `src/poller/index.ts`; optional bootstrap with `createPollerRuntime` only when `settings.poller` exists.

## SHOULD
- Bounded backoff with degraded/recovered notices.
- Status bar inbox count.
- Optional `/poll ack|done|failed <id>` helpers.
- LRU dedup.

## MUST NOT
- Poll while streaming.
- Auto-ack/done without intent.
- Background bash loops.
- Hard-wire to a DB; always use adapters.
- Swallow correctness-affecting errors silently.

## Acceptance Checklist
- Disabled by default; enable via settings or `/poll on`.
- Idle-only verified.
- Alerts on new messages; inbox count increments.
- `/poll` lists required fields.
- Interval configurable at runtime.
- Backoff + degraded/recovered notices.
- Lease default 2m; claim sets `in_progress`.
- Adapter abstraction implemented (ArangoDB + HTTP).
- Clean stop on disable/signals.
- No auto-ack/done; no background bash.
- Poller exports confined to `src/poller/*`; removing the poller should not affect core tools.
