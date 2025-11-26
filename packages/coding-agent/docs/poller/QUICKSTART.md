# Polling Module Quickstart

Opt-in, idle-only poller for queued messages. Fork-only.

## Settings Examples

### ArangoDB
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
      "messagesCollection": "messages",
      "username": "root",
      "password": "openSesame"
    },
    "batchLimit": 25,
    "leaseMs": 120000,
    "backoff": { "initialMs": 1000, "factor": 2, "maxMs": 30000, "failureThreshold": 3 },
    "options": { "lruDedupSize": 128, "autoProcessNext": false }
  }
}
```

### HTTP (e.g., python-arango service)
```json
{
  "poller": {
    "enabled": true,
    "pollIntervalMs": 5000,
    "agentId": "ProjectA",
    "backend": "http",
    "http": {
      "baseUrl": "http://localhost:8080",
      "headers": { "Authorization": "Bearer TOKEN" },
      "timeoutMs": 4000
    },
    "batchLimit": 25,
    "leaseMs": 120000,
    "backoff": { "initialMs": 1000, "factor": 2, "maxMs": 30000, "failureThreshold": 3 }
  }
}
```

## Wiring
- SettingsManager returns `poller` block; pass to `createPollerRuntime(agent, pollerConfig)`.
- Poller is optional; if config absent or `enabled=false`, nothing starts.
- Logger optional; defaults to console.
```ts
import { createPollerRuntime } from "./poller/setup.js";

const pollerSettings = settingsManager.getPollerSettings();
const runtime = await createPollerRuntime(agent, pollerSettings);
if (runtime) {
  // Update UI badge when inbox count changes
  runtime.poller.events.on("inboxIncrement", (delta) => {
    // e.g., redraw status bar "Inbox: N"
  });

  // Use runtime.uiBridge from `/poll` command handlers
  // to list inbox, toggle on/off, change interval, and update status.
}
```

## Commands
- `/poll` → list inbox
- `/poll on|off`
- `/poll interval <ms>`
- `/poll ack <id>` / `/poll done <id>` / `/poll failed <id>`

## Run Tests
- Unit smoke: `npm run test -- -w @mariozechner/pi-coding-agent --run test/poller/poller.test.ts`
- Full lint/type: `npm run check`

## Troubleshooting
- No alerts: ensure `enabled=true`, correct `agentId`, backend reachable.
- Degraded notices: backend failing; verify config/endpoint.
- Duplicates: ensure unique `agentId`, leases set; enable dedup.
- Hung HTTP calls: set `http.timeoutMs`.

## Notes
- Idle-only: skips while agent is streaming.
- Lease is not renewed; keep tasks shorter than `leaseMs`.
- Dedup kept in-process; IDs remain until process restart.
