# Poller Module (Fork-only)

Opt-in idle-only polling with alerts and `/poll` controls. Pluggable adapters: ArangoDB (`arangojs`) or HTTP (e.g., python-arango service).

## Configure
Add to your settings (e.g., `~/.pi/agent/settings.json`):
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

## Wire-up
```ts
import { createPollerRuntime } from "./poller/setup.js";

const pollerSettings = settingsManager.getPollerSettings();
const runtime = await createPollerRuntime(agent, pollerSettings, (count) => {
  // e.g., feed into status bar
});
```

## Use
- Alerts when new messages arrive.
- `/poll` → list inbox
- `/poll on|off` → toggle
- `/poll interval <ms>` → change interval
- `/poll ack|done|failed <id>` → update status

## Notes
- Fork-only; upstream avoids background behavior.
- Security: use headers/tokens; least privilege.
- Resilience: backoff with degraded/recovered notices; leases avoid duplicates.
