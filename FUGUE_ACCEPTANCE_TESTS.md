# Fugue MVP — Manual Acceptance Test Guide

> **Bootstrap constraint:** The MVP is complete when Fugue can be used to build Fugue.
> Work through S1–S11 to verify each capability, then run S12 as the final proof.

---

## Prerequisites

| Requirement | Version | Check |
|---|---|---|
| Docker Desktop / Docker CE | 24+ | `docker --version` |
| Docker Compose | v2 | `docker compose version` |
| `curl` | any | `curl --version` |
| A terminal with `jq` | any | `jq --version` |
| A GitHub account (S5 only) | — | — |
| `NEURALWATT_API_KEY` env var (S7) | — | — |

---

## Part 0 — Environment Setup

### 0.1 Clone and start

```bash
# In the monorepo root
git checkout fugue/phase-0
docker compose up --build -d
```

Expected output: all six services start without error.

```
✔ Container fugue-postgres      Healthy
✔ Container fugue-core          Started
✔ Container fugue-sync          Started
✔ Container fugue-connectors    Started
✔ Container fugue-surface       Started
```

### 0.2 Health checks

Run all at once:

```bash
curl -s http://localhost:3001/health | jq .   # API
curl -s http://localhost:4002/health | jq .   # Connectors
# Surface is at http://localhost:3000
```

**Pass:** Every endpoint returns `{ "ok": true }` (or equivalent). No container is in `Exited` state.

```bash
docker compose ps   # all should show "running" or "healthy"
```

### 0.3 Create your test account

The Better Auth API is at `http://localhost:3001/api/auth`.

```bash
# Register
curl -s -X POST http://localhost:3001/api/auth/sign-up/email \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"fugue-test-1","name":"Test User"}' | jq .

# Sign in and capture the session token
SESSION=$(curl -s -X POST http://localhost:3001/api/auth/sign-in/email \
  -H "Content-Type: application/json" \
  -c /tmp/fugue-cookies.txt \
  -d '{"email":"you@example.com","password":"fugue-test-1"}' | jq -r '.token // .session.token')

echo "Session token: $SESSION"
```

**Pass:** You get back a session object with a token. Save it — all tRPC calls below use it.

Define a helper for the rest of the guide:

```bash
# tRPC query helper
tq() {
  local proc=$1; shift
  curl -s "http://localhost:3001/trpc/${proc}?input=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "${1:-{}}")" \
    -H "Cookie: $(cat /tmp/fugue-cookies.txt | grep better-auth | awk '{print $6"="$7}')" \
    | jq .
}

# tRPC mutation helper
tm() {
  local proc=$1; shift
  curl -s -X POST "http://localhost:3001/trpc/${proc}" \
    -H "Content-Type: application/json" \
    -H "Cookie: $(cat /tmp/fugue-cookies.txt | grep better-auth | awk '{print $6"="$7}')" \
    -d "${1:-{}}" | jq .
}
```

---

## S1 — "What should we build next?"

> **Goal:** Open the canvas, see active work, and create nodes for current priorities.

### Steps

**1. Open the canvas**

Navigate to `http://localhost:3000` in your browser. You should see the tldraw canvas.

**Pass:** Canvas loads with no errors in the browser console.

**2. Create a strategy node via the API**

```bash
tm nodes.create '{"json":{"type":"idea","title":"Fugue v0.1 — what to prioritise","content":{"description":"Open question for the team sprint kick-off"}}}'
```

**Pass:** Response contains `"id"` and `"status":"active"`.

**3. Create child work-item nodes**

```bash
# Run three times with different titles
for title in "Ship connector protocol" "Add assumption confidence UI" "Write onboarding docs"; do
  tm nodes.create "{\"json\":{\"type\":\"idea\",\"title\":\"${title}\"}}"
done
```

**4. List nodes**

```bash
tq nodes.list '{}'
```

**Pass:** Four nodes returned (the strategy node + three work items).

**5. Link them on the canvas**

In the tldraw UI, drag a connector from the strategy node card to each work-item card.

Or via API:

```bash
PARENT_ID="<id from step 2>"
CHILD_ID="<id from step 3a>"
tm nodes.createEdge "{\"json\":{\"sourceId\":\"${PARENT_ID}\",\"targetId\":\"${CHILD_ID}\",\"type\":\"builds_on\",\"authorId\":\"you@example.com\"}}"
```

**Pass:** `"type":"builds_on"` edge returned.

---

## S2 — "How should we architect the event system?"

> **Goal:** Kick off a structured investigation, add findings, and conclude it.

### Steps

**1. Create an investigation**

```bash
INV=$(tm research.createInvestigation '{"json":{"question":"Should we use pgmq, NATS, or Redis Streams for the Fugue event bus?","methodology":"Benchmark throughput at 1k msg/s, evaluate operational complexity, assess Postgres synergy"}}')
INV_ID=$(echo $INV | jq -r '.result.data.id')
echo "Investigation ID: $INV_ID"
```

**Pass:** Status is `"open"`, `investigatorId` matches your user.

**2. Add findings from research**

```bash
tm research.addFinding "{\"json\":{\"investigationId\":\"${INV_ID}\",\"claim\":\"pgmq runs inside Postgres, eliminating a separate service\",\"evidence\":\"pgmq GitHub README, Tembo blog post 2024\",\"confidence\":0.9}}"

tm research.addFinding "{\"json\":{\"investigationId\":\"${INV_ID}\",\"claim\":\"NATS offers 4x throughput at high message volumes but adds operational overhead\",\"evidence\":\"Internal benchmark: 40k msg/s vs 10k msg/s at 8-core\",\"confidence\":0.75}}"

tm research.addFinding "{\"json\":{\"investigationId\":\"${INV_ID}\",\"claim\":\"Redis Streams requires Redis license compliance check post-2024 relicensing\",\"evidence\":\"Redis Inc. announcement March 2024\",\"confidence\":0.95}}"
```

**Pass:** Three findings returned, all linked to `INV_ID`.

**3. Read back findings**

```bash
tq research.findingsFor "{\"investigationId\":\"${INV_ID}\"}"
```

**Pass:** All three findings present with correct confidence scores.

**4. Conclude the investigation**

```bash
tm research.conclude "{\"json\":{\"id\":\"${INV_ID}\",\"conclusion\":\"Use pgmq for MVP: no new infra, Postgres transaction safety, acceptable throughput at our scale. Revisit NATS at 50k daily active users.\"}}"
```

**Pass:** Status changes to `"concluded"`. Conclusion stored verbatim.

---

## S3 — "WebSocket vs SSE vs polling — run them in parallel"

> **Goal:** Create a competition, add two candidate nodes, score them, and declare a winner.

### Steps

**1. Create the competition**

```bash
COMP=$(tm competitions.create '{"json":{"title":"Canvas sync protocol: WebSocket vs SSE","description":"Evaluate real-time sync options for the Fugue tldraw canvas","criteria":{"latency_p99_ms":"weight:0.4","complexity":"weight:0.3","browser_compat":"weight:0.3"}}}')
COMP_ID=$(echo $COMP | jq -r '.result.data.id')
echo "Competition ID: $COMP_ID"
```

**2. Create candidate nodes**

```bash
WS_NODE=$(tm nodes.create '{"json":{"type":"competition","title":"WebSocket-based sync","content":{"notes":"Native tldraw sync uses WebSockets"}}}')
WS_ID=$(echo $WS_NODE | jq -r '.result.data.id')

SSE_NODE=$(tm nodes.create '{"json":{"type":"competition","title":"SSE + REST polling fallback","content":{"notes":"Server-sent events for server→client, REST for client→server"}}}')
SSE_ID=$(echo $SSE_NODE | jq -r '.result.data.id')
```

**3. Add both as entries**

```bash
WS_ENTRY=$(tm competitions.addEntry "{\"json\":{\"competitionId\":\"${COMP_ID}\",\"graphNodeId\":\"${WS_ID}\",\"notes\":\"p99: 12ms, already built into tldraw\"}}")
WS_ENTRY_ID=$(echo $WS_ENTRY | jq -r '.result.data.id')

SSE_ENTRY=$(tm competitions.addEntry "{\"json\":{\"competitionId\":\"${COMP_ID}\",\"graphNodeId\":\"${SSE_ID}\",\"notes\":\"p99: 45ms, more complex, better firewall compat\"}}")
SSE_ENTRY_ID=$(echo $SSE_ENTRY | jq -r '.result.data.id')
```

**4. Score both entries**

```bash
tm competitions.scoreEntry "{\"json\":{\"entryId\":\"${WS_ENTRY_ID}\",\"score\":0.88}}"
tm competitions.scoreEntry "{\"json\":{\"entryId\":\"${SSE_ENTRY_ID}\",\"score\":0.61}}"
```

**5. Conclude with winner**

```bash
tm competitions.conclude "{\"json\":{\"id\":\"${COMP_ID}\",\"winnerNodeId\":\"${WS_ID}\"}}"
```

**Pass:** `status:"concluded"`, `winnerNodeId` matches `WS_ID`, `concludedAt` is set.

**6. Verify entries and scores**

```bash
tq competitions.entries "{\"competitionId\":\"${COMP_ID}\"}"
```

**Pass:** Both entries present, scores match what was set.

---

## S4 — "Ship the connector protocol and measure adoption"

> **Goal:** Create a goal node, record baseline metrics, then record post-ship metrics and verify the change.

### Steps

**1. Create a goal node**

```bash
GOAL=$(tm nodes.create '{"json":{"type":"metric","title":"Connector protocol adoption","content":{"target":"5 external connectors within 30 days of ship"}}}')
GOAL_ID=$(echo $GOAL | jq -r '.result.data.id')
```

**2. Record pre-ship baseline**

```bash
tm metrics.record "{\"json\":{\"graphNodeId\":\"${GOAL_ID}\",\"name\":\"active_connectors\",\"value\":1,\"unit\":\"count\"}}"
tm metrics.record "{\"json\":{\"graphNodeId\":\"${GOAL_ID}\",\"name\":\"connector_events_per_day\",\"value\":0,\"unit\":\"events/day\"}}"
```

**3. Check metrics for the node**

```bash
tq metrics.forNode "{\"graphNodeId\":\"${GOAL_ID}\"}"
```

**Pass:** Both metrics returned, linked to the goal node.

**4. Record post-ship metrics (simulate 2 weeks later)**

```bash
tm metrics.record "{\"json\":{\"graphNodeId\":\"${GOAL_ID}\",\"name\":\"active_connectors\",\"value\":4,\"unit\":\"count\"}}"
tm metrics.record "{\"json\":{\"graphNodeId\":\"${GOAL_ID}\",\"name\":\"connector_events_per_day\",\"value\":830,\"unit\":\"events/day\"}}"
```

**5. Create an assumption about adoption**

```bash
tm assumptions.create "{\"json\":{\"graphNodeId\":\"${GOAL_ID}\",\"claim\":\"Teams will configure connectors within 48h of onboarding\",\"confidence\":0.6,\"verificationMethod\":\"cohort analysis on connector setup time\",\"verifyByDays\":30}}"
```

**6. Update confidence after evidence**

```bash
ASS_ID=$(tq assumptions.forNode "{\"graphNodeId\":\"${GOAL_ID}\"}" | jq -r '.result.data[0].id')
tm assumptions.updateConfidence "{\"json\":{\"id\":\"${ASS_ID}\",\"confidence\":0.82}}"
```

**Pass:** Confidence updates from 0.6 → 0.82. Audit log entry created.

---

## S5 — "A PR was merged that breaks an assumption"

> **Goal:** Send a GitHub webhook, verify it produces a FugueEvent, then manually update the affected assumption confidence.

### Steps

**1. Create the affected assumption**

```bash
NODE=$(tm nodes.create '{"json":{"type":"assumption","title":"API performance assumption"}}')
NODE_ID=$(echo $NODE | jq -r '.result.data.id')

ASS=$(tm assumptions.create "{\"json\":{\"graphNodeId\":\"${NODE_ID}\",\"claim\":\"API response time < 200ms at p99\",\"confidence\":0.85,\"verificationMethod\":\"load test\"}}")
ASS_ID=$(echo $ASS | jq -r '.result.data.id')
echo "Assumption ID: $ASS_ID"
```

**2. Send a simulated GitHub webhook**

The connectors service validates HMAC only when `GITHUB_WEBHOOK_SECRET` is set. For testing, send without a secret (the `docker-compose.yml` default leaves it empty):

```bash
curl -s -X POST http://localhost:4002/webhooks/github \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: pull_request" \
  -d '{
    "action": "closed",
    "number": 142,
    "pull_request": {
      "title": "perf: remove caching layer — increases response time",
      "html_url": "https://github.com/neuralwatt/fugue/pull/142",
      "state": "closed",
      "merged": true,
      "user": {"login": "alice"},
      "head": {"ref": "remove-cache"},
      "base": {"ref": "main"}
    },
    "repository": {"full_name": "neuralwatt/fugue"}
  }' | jq .
```

**Pass:** Response: `{"ok":true,"eventsPublished":1}`.

**3. Verify webhook HMAC validation (security check)**

If you have set `GITHUB_WEBHOOK_SECRET=mysecret` in `.env`:

```bash
# A request without the signature header should be rejected
curl -s -X POST http://localhost:4002/webhooks/github \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: push" \
  -d '{"ref":"refs/heads/main","commits":[]}'
# Expected: {"error":"Missing X-Hub-Signature-256 header"} — 401
```

**4. Update assumption confidence based on the merged PR**

This step is currently manual (event→assumption routing is a Phase 3+ automation target):

```bash
tm assumptions.updateConfidence "{\"json\":{\"id\":\"${ASS_ID}\",\"confidence\":0.40}}"
```

**Pass:** Confidence drops from 0.85 → 0.40. Audit log records the change with your userId.

```bash
tq audit.query "{\"action\":\"assumption.confidence_updated\"}"
```

**Pass:** Entry present with `actorId` = your user and `detail.confidence` = 0.4.

---

## S6 — "I'm picking this up — what happened while I was away?"

> **Goal:** Use the catch-up view to see all recent activity across nodes, assumptions, investigations, decisions, and findings.

### Steps

**1. Ensure there is recent activity** (skip if you ran S1–S5 in order — there is plenty)

**2. Request the catch-up view for the last 7 days**

```bash
tq memory.catchUp '{"sinceDays":7}'
```

**Pass:** Response contains items of multiple types. Verify:
- At least one `"type":"node"` item
- At least one `"type":"assumption"` item
- At least one `"type":"investigation"` item (from S2)
- At least one `"type":"decision"` item (from S3/S8 decision records)
- Items are sorted by `timestamp` descending (most recent first)

**3. Fetch a narrower window**

```bash
tq memory.catchUp '{"sinceDays":1}'
```

**Pass:** Fewer items, but all still within the last 24 hours.

**4. Search institutional memory**

```bash
tq memory.search '{"q":"pgmq"}'
```

**Pass:** The decision episode about `pgmq` from S2 appears (once you record it — see S8 step 1).

---

## S7 — "Agent, go deep on this and report back"

> **Prerequisites:** `NEURALWATT_API_KEY` environment variable set and accessible to the core container.
> If you do not have an API key, steps 1–3 verify the wiring only; skip step 4.

### Steps

**1. Spawn an agent via the API**

```bash
AGENT=$(tm agents.spawn '{"json":{"goal":"Research the tradeoffs between PostgreSQL row-level security and application-level access control for a multi-tenant SaaS. Produce a structured finding with confidence scores.","model":"neuralwatt-large","budgetMaxJoules":500}}')
AGENT_ID=$(echo $AGENT | jq -r '.result.data.id')
echo "Agent ID: $AGENT_ID"
```

**Pass:** Agent created with `status:"pending"`.

**2. Start the agent (if AgentService is wired to the HTTP layer)**

Currently the `AgentService.start()` must be triggered from the server. If the endpoint is not yet exposed via HTTP, verify via the `agents.getState` procedure:

```bash
tq agents.getState "{\"id\":\"${AGENT_ID}\"}"
```

**Pass:** Agent record exists with the correct `goal`.

**3. Verify abort works**

```bash
tm agents.abort "{\"json\":{\"id\":\"${AGENT_ID}\"}}"
tq agents.getState "{\"id\":\"${AGENT_ID}\"}" | jq '.result.data.status'
```

**Pass:** Status becomes `"aborted"`.

**4. Full agent run (requires API key)**

Spawn a new agent and wait for completion:

```bash
AGENT2=$(tm agents.spawn '{"json":{"goal":"List exactly three advantages of using Drizzle ORM over raw SQL in a TypeScript project. Format your answer as three \"finding\" nodes and then stop.","model":"neuralwatt-small"}}')
AGENT2_ID=$(echo $AGENT2 | jq -r '.result.data.id')

# Poll until terminal
for i in $(seq 1 30); do
  STATUS=$(tq agents.getState "{\"id\":\"${AGENT2_ID}\"}" | jq -r '.result.data.status')
  echo "[$i] Status: $STATUS"
  [[ "$STATUS" == "completed" || "$STATUS" == "failed" || "$STATUS" == "aborted" ]] && break
  sleep 5
done
```

**Pass:** Agent reaches `"completed"`. Nodes of type `"finding"` appear in `nodes.list`.

---

## S8 — "How does this decision connect to our goals?"

> **Goal:** Record a decision episode, link it to a node, and traverse the graph to show impact lineage.

### Steps

**1. Record the architectural decision**

```bash
DEC=$(tm memory.recordDecision '{"json":{"title":"Use pgmq over NATS for event bus","decision":"pgmq","context":"Evaluated in investigation Q2-2025","optionsConsidered":["pgmq","NATS","Redis Streams"],"rationale":"pgmq runs inside Postgres, no new service dependency, transaction-safe publish, acceptable throughput for MVP scale"}}')
DEC_ID=$(echo $DEC | jq -r '.result.data.id')
echo "Decision ID: $DEC_ID"
```

**2. Search for the decision**

```bash
tq memory.search '{"q":"NATS"}'
```

**Pass:** The pgmq decision appears. Search is case-insensitive; try `'{"q":"nats"}'` too.

**3. Create a goal node and link decision to it**

```bash
GOAL2=$(tm nodes.create '{"json":{"type":"idea","title":"Q2 initiative: event-driven architecture","content":{"impact":"enables async agent coordination"}}}')
GOAL2_ID=$(echo $GOAL2 | jq -r '.result.data.id')

TECH=$(tm nodes.create '{"json":{"type":"decision","title":"pgmq as event backbone"}}')
TECH_ID=$(echo $TECH | jq -r '.result.data.id')

tm nodes.createEdge "{\"json\":{\"sourceId\":\"${TECH_ID}\",\"targetId\":\"${GOAL2_ID}\",\"type\":\"decided_by\",\"authorId\":\"you@example.com\"}}"
```

**4. Traverse the graph**

```bash
# Forward: what does the goal node connect to?
tq nodes.traverse "{\"id\":\"${GOAL2_ID}\",\"maxDepth\":3}"

# Ancestors: what decisions led here?
tq nodes.ancestors "{\"id\":\"${GOAL2_ID}\",\"maxDepth\":3}"
```

**Pass:** Traversal returns nodes at multiple depths. `path` array shows the lineage chain.

---

## S9 — "My team's data never leaves infrastructure I control"

> **Goal:** Verify self-hosting works, no mandatory external calls, and data is exportable.

### Steps

**1. Confirm no external DNS at startup**

Run with your network egress blocked (firewall or `--network none` won't work with Docker healthchecks, but you can inspect):

```bash
docker compose logs fugue-core 2>&1 | grep -i "external\|telemetry\|analytics\|segment\|sentry"
```

**Pass:** No external tracking calls in logs.

**2. Verify all data stays in Postgres**

```bash
docker exec -it fugue-postgres-1 psql -U fugue -d fugue -c "\dt fugue_*"
```

**Pass:** All Fugue tables visible inside the local Postgres instance.

**3. Export all nodes (data portability)**

```bash
tq nodes.list '{"limit":500}' | jq '.result.data' > /tmp/fugue-nodes-export.json
wc -l /tmp/fugue-nodes-export.json
```

**Pass:** All nodes serialised to local JSON. The file is readable without any proprietary tooling.

**4. Verify TLS is configurable**

The `docker-compose.yml` exposes plain HTTP for local dev. For production, place an nginx/Caddy reverse proxy in front:

```bash
# Confirm no TLS cert required for local dev (intentional)
curl -s http://localhost:3001/health | jq .ok
```

**Pass:** Local dev works over HTTP. Production deployments add TLS at the reverse-proxy layer.

**5. Verify database can be fully backed up**

```bash
docker exec fugue-postgres-1 pg_dump -U fugue fugue > /tmp/fugue-backup.sql
wc -l /tmp/fugue-backup.sql
```

**Pass:** Full SQL dump produced. Restore test:

```bash
docker exec -i fugue-postgres-1 psql -U fugue -d fugue -c "SELECT COUNT(*) FROM fugue_nodes;"
```

---

## S10 — "Every agent action is scoped and auditable"

> **Goal:** Verify that every mutation produces an audit entry with actor, action, target, and authority chain.

### Steps

**1. Check audit log after recent actions**

```bash
tq audit.query '{"limit":20}'
```

**Pass:** Each entry has:
- `actorId` (your user ID)
- `actorType` ("human" or "agent")
- `action` (e.g. "node.create", "assumption.confidence_updated")
- `targetType` and `targetId`
- `authorityChain` array containing at least one entry
- `createdAt` timestamp

**2. Filter by action type**

```bash
tq audit.query '{"action":"assumption.confidence_updated"}'
```

**Pass:** Only confidence-update entries returned.

**3. Filter by actor**

```bash
tq audit.query "{\"actorId\":\"you@example.com\"}"
```

**Pass:** All your actions listed.

**4. Verify agent actions are audited**

If you ran S7 and the agent created nodes:

```bash
tq audit.query '{"actorType":"agent","limit":10}'
```

**Pass:** Agent actions appear with `actorType:"agent"` and `authorityChain` showing the parent user who spawned the agent.

**5. Verify UNAUTHORIZED responses for unauthenticated requests**

```bash
# No cookie / auth header
curl -s -X POST http://localhost:3001/trpc/nodes.create \
  -H "Content-Type: application/json" \
  -d '{"json":{"type":"idea","title":"Unauthenticated attempt"}}' | jq '.error.data.code'
```

**Pass:** Returns `"UNAUTHORIZED"`.

---

## S11 — "I spin up Fugue with one command"

> **Goal:** Verify a clean `docker compose up` produces a working instance in under 60 seconds.

### Steps

**1. Full reset**

```bash
docker compose down -v   # removes containers and volumes
time docker compose up --build -d
```

**2. Measure time to healthy**

The `time` command from step 1 should complete before all health checks pass. Wait for all services:

```bash
# Poll until all are healthy
for i in $(seq 1 30); do
  UNHEALTHY=$(docker compose ps --format json | jq '[.[] | select(.Health != "healthy" and .Health != "")] | length')
  echo "[$i] Unhealthy services: $UNHEALTHY"
  [[ "$UNHEALTHY" == "0" ]] && echo "All healthy!" && break
  sleep 2
done
```

**Pass:** All services reach healthy state in under 60 seconds from `docker compose up`.

**3. Verify migrations ran automatically**

```bash
docker exec fugue-postgres-1 psql -U fugue -d fugue \
  -c "SELECT id, applied_at FROM fugue_migrations ORDER BY applied_at;"
```

**Pass:** All five migrations applied (`001` through `005`) with timestamps set to the startup window.

**4. Verify zero manual config required**

All defaults work out of the box:
- Database credentials: `fugue/fugue` (in docker-compose.yml)
- API port: 3001
- Surface port: 3000
- Connector port: 4002

```bash
# Re-register a fresh account on the clean instance
curl -s -X POST http://localhost:3001/api/auth/sign-up/email \
  -H "Content-Type: application/json" \
  -d '{"email":"fresh@example.com","password":"newpass1","name":"Fresh User"}' | jq .ok
```

**Pass:** `true`. No manual DB init, no schema migrations to run by hand.

**5. Verify secret management pattern**

Create a `.env` file:

```bash
cat > .env <<'EOF'
GITHUB_WEBHOOK_SECRET=my-production-secret
NEURALWATT_API_KEY=your-key-here
EOF

docker compose up -d
docker compose logs fugue-connectors | grep "HMAC"
```

**Pass:** Log line: `GitHub webhook HMAC validation enabled`.

---

## S12 — "Fugue deploys a new version of itself" (Bootstrap)

> **Goal:** Use Fugue's own canvas and context graph to plan, track, and execute an upgrade of the running Fugue instance. This is the strange loop made literal.

This scenario ties everything together. You are about to use Fugue to build Fugue.

### 12.1 — Track the deployment on the canvas

**1. Create a deployment node**

```bash
DEPLOY=$(tm nodes.create '{"json":{"type":"deployment","title":"Fugue self-upgrade: fugue/phase-0 → main","content":{"version_from":"phase-0","version_to":"main","trigger":"manual","status":"planning"}}}')
DEPLOY_ID=$(echo $DEPLOY | jq -r '.result.data.id')
echo "Deployment node: $DEPLOY_ID"
```

**2. Record the deployment decision**

```bash
tm memory.recordDecision "{\"json\":{
  \"title\": \"Roll forward to latest main\",
  \"decision\": \"rolling upgrade\",
  \"context\": \"phase-0 MVP acceptance tests passing, ready to promote\",
  \"optionsConsidered\": [\"rolling upgrade\", \"blue-green\", \"big bang\"],
  \"rationale\": \"Rolling upgrade preserves state continuity; Fugue's own context graph survives the transition\",
  \"graphNodeId\": \"${DEPLOY_ID}\"
}}"
```

**Pass:** Decision episode created, linked to the deployment node.

### 12.2 — Verify state continuity (pre-upgrade snapshot)

**3. Snapshot current state counts**

```bash
echo "=== Pre-upgrade snapshot ==="
tq nodes.list '{"limit":500}' | jq '.result.data | length' | xargs echo "Nodes:"
tq audit.query '{"limit":500}' | jq '.result.data | length' | xargs echo "Audit entries:"
tq memory.catchUp '{"sinceDays":7}' | jq '.result.data | length' | xargs echo "Catch-up items:"
```

Record these numbers. You will verify they survive the upgrade.

**4. Create a canary assumption**

```bash
CANARY=$(tm assumptions.create "{\"json\":{\"graphNodeId\":\"${DEPLOY_ID}\",\"claim\":\"The canary assumption survives the rolling upgrade\",\"confidence\":1.0,\"ownerId\":\"you@example.com\"}}")
CANARY_ID=$(echo $CANARY | jq -r '.result.data.id')
echo "Canary ID: $CANARY_ID"
```

### 12.3 — Perform the rolling upgrade

**5. Pull the new image** (or rebuild from latest commit)

```bash
git pull origin fugue/phase-0   # or the target branch
docker compose build fugue-core fugue-connectors fugue-sync
```

**6. Rolling restart of core (zero-downtime pattern)**

```bash
# Start new core alongside old one (Docker Compose rolling update)
docker compose up -d --no-deps --scale fugue-core=2 fugue-core 2>/dev/null || \
  docker compose up -d --no-deps fugue-core

# Wait for new instance to be healthy
for i in $(seq 1 30); do
  STATUS=$(docker compose ps fugue-core --format json | jq -r '.[0].Health // "unknown"')
  echo "[$i] Core health: $STATUS"
  [[ "$STATUS" == "healthy" ]] && break
  sleep 3
done
```

**7. Restart remaining services**

```bash
docker compose up -d --no-deps fugue-sync fugue-connectors
```

**Pass:** All services restart and reach healthy state. Core health check: `curl -s http://localhost:3001/health | jq .ok` returns `true`.

### 12.4 — Verify state continuity (post-upgrade)

**8. Check snapshot counts match**

```bash
echo "=== Post-upgrade snapshot ==="
tq nodes.list '{"limit":500}' | jq '.result.data | length' | xargs echo "Nodes:"
tq audit.query '{"limit":500}' | jq '.result.data | length' | xargs echo "Audit entries:"
```

**Pass:** Counts match the pre-upgrade snapshot. No data was lost.

**9. Verify the canary assumption survived**

```bash
tq nodes.get "{\"id\":\"${DEPLOY_ID}\"}" | jq .result.data.title
```

```bash
# The assumption is linked to the deployment node
tq assumptions.forNode "{\"graphNodeId\":\"${DEPLOY_ID}\"}" | jq '.[0].confidence'
```

**Pass:** Deployment node intact. Canary assumption returns `1` confidence.

### 12.5 — Rollback test

**10. Simulate a bad deploy**

```bash
# Tag current image as "previous"
docker tag fugue-core:local fugue-core:previous

# Simulate bad deploy by stopping core
docker compose stop fugue-core
sleep 5

# Verify health check fails
curl -s --max-time 3 http://localhost:3001/health || echo "Core down — rollback triggered"
```

**11. Roll back**

```bash
docker tag fugue-core:previous fugue-core:local
docker compose up -d --no-deps fugue-core

for i in $(seq 1 20); do
  STATUS=$(docker inspect fugue-core-1 2>/dev/null | jq -r '.[0].State.Health.Status // "unknown"')
  echo "[$i] $STATUS"
  [[ "$STATUS" == "healthy" ]] && break
  sleep 3
done
```

**Pass:** Core recovers and health check returns `true`. Canvas state still intact.

### 12.6 — Record the outcome in the context graph

**12. Update the deployment node with the result**

```bash
tm nodes.update "{\"json\":{\"id\":\"${DEPLOY_ID}\",\"content\":{
  \"version_from\":\"phase-0\",
  \"version_to\":\"main\",
  \"trigger\":\"manual\",
  \"status\":\"completed\",
  \"state_continuity\":\"verified\",
  \"rollback_tested\":true,
  \"notes\":\"All 12 acceptance scenarios passed. Bootstrap constraint met.\"
}}}"
```

**13. Update the canary assumption**

```bash
tm assumptions.updateConfidence "{\"json\":{\"id\":\"${CANARY_ID}\",\"confidence\":1.0}}"
```

**14. Final audit trail check**

```bash
tq audit.query "{\"targetId\":\"${DEPLOY_ID}\"}" | jq '[.result.data[] | {action,createdAt}]'
```

**Pass:** Audit log shows the full lifecycle: node created, assumption created, node updated, confidence confirmed. Every action logged with actor, timestamp, and authority chain.

---

## Final Pass Criteria

All 12 scenarios pass when:

| # | Scenario | Core pass condition |
|---|---|---|
| S1 | Canvas + priorities | Nodes created, edges linked, list returns all |
| S2 | Investigation | Investigation concluded with 3+ findings |
| S3 | Competition | Winner declared, both entries scored |
| S4 | Metrics | Assumption confidence updated with evidence |
| S5 | GitHub event | Webhook accepted (200), HMAC rejected without sig (401) |
| S6 | Catch-up | Multi-type activity returned, sorted by recency |
| S7 | Agent | Agent spawned, aborted cleanly; full run completes (with API key) |
| S8 | Decision lineage | Decision searchable, graph traversal shows lineage |
| S9 | Self-hosting | One-command start, data exportable, no mandatory external deps |
| S10 | Audit trail | Every mutation logged, UNAUTHORIZED on unauthenticated calls |
| S11 | One-command deploy | `docker compose up` healthy in <60s, migrations auto-applied |
| S12 | Bootstrap | State survives upgrade, rollback works, outcome recorded in graph |

**The MVP is complete when every row above has a check.**
