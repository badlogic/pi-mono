# Polling Module Quickstart (Fork-only Feature)

Opt-in, idle-only polling that surfaces queued messages to the interactive agent.

## What You Get
- Idle-only: no mid-stream interference.
- Alert: `[poller] Inbox: +N new item(s). Use /poll to list.`
- `/poll` commands:
  - `/poll` – list inbox
  - `/poll on|off` – enable/disable
  - `/poll interval <ms>` – set interval
  - `/poll ack|done|failed <id>` – update status

## Requirements
- Unique `agentId` per agent.
- Message store fields: `id`, `to_agent`, `from_agent`, `type`, `status`, optional `correlation_id`, `payload_ref`, `payload`.
- Backend adapter choice: ArangoDB (node `arangojs`) or HTTP REST (e.g., python-arango service).

## Example Settings (ArangoDB)
```json
{
  "poller": {
    "enabled": true,
    "pollIntervalMs": 5000,
    "agentId": "ProjectA",
    "backend": "arangojs",
    "arango": {
      "url": "http://localhost:8529",
      "database": "agents",
      "username": "root",
      "password": "openSesame",
      "messagesCollection": "messages"
    },
    "batchLimit": 25,
    "leaseMs": 120000,
    "backoff": { "initialMs": 1000, "factor": 2, "maxMs": 30000, "failureThreshold": 3 },
    "options": { "lruDedupSize": 128, "autoProcessNext": false }
  }
}
```

## Example Settings (HTTP / python-arango)
Expose endpoints:
- `GET /health`
- `GET /messages/queued?agentId=ProjectA&limit=25`
- `POST /messages/{id}/claim` body `{ "agentId": "ProjectA", "leaseUntilMs": 1730000000000 }`
- `GET /messages/inbox?agentId=ProjectA&limit=50`
- `POST /messages/{id}/status` body `{ "status": "acked" }`

Settings:
```json
{
  "poller": {
    "enabled": true,
    "pollIntervalMs": 5000,
    "agentId": "ProjectA",
    "backend": "http",
    "http": {
      "baseUrl": "http://localhost:8080",
      "headers": { "Authorization": "Bearer YOUR_TOKEN" }
    },
    "batchLimit": 25,
    "leaseMs": 120000,
    "backoff": { "initialMs": 1000, "factor": 2, "maxMs": 30000, "failureThreshold": 3 }
  }
}
```

## Wiring
```ts
import { createPollerRuntime } from "./poller/setup.js";

const pollerSettings = settingsManager.getPollerSettings();
// Decoupled: if pollerSettings is undefined, nothing is started.
const runtime = await createPollerRuntime(agent, pollerSettings, (count) => {
	// optional UI hook: update status bar, etc.
});
// runtime?.poller.start() is called inside createPollerRuntime
```

## Workflow
- Idle: poller fetches queued, claims with lease, enqueues system prompt, alerts.
- `/poll` lists inbox; use `/poll ack|done|failed <id>` to update status.
- Optional: wire inbox count into status bar via `runtime.uiBridge.getInboxCount()`.

## Tests
- Unit smoke: `npm run test -- -w @mariozechner/pi-coding-agent --run test/poller/poller.test.ts`
- (Add integration as needed against your backend.)

## Troubleshooting
- No alerts: ensure enabled, matching `agentId`, backend healthy.
- Duplicates: ensure one poller per `agentId`; verify leases; enable LRU dedup.
- Errors/backoff: degraded notice after repeated failures; recovers on success.

## Best Practices
- Interval 5–10s; batch 25.
- Keep `autoProcessNext` false initially.
- Avoid logging sensitive payloads; use refs.
- Fork-only: upstream avoids background behavior.
