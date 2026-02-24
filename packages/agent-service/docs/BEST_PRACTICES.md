# Agent Service User Best Practices

This guide describes practical operating patterns for `@mariozechner/pi-agent-service`.
It focuses on production behavior of the current implementation in this repository.

## 1. Use the Service in the Intended Architecture

### 1.1 Prefer SDK-first host integration
- Run the service in Node/TypeScript and use `createAgentService()` from this package.
- Keep non-Node integration behind HTTP + SSE clients, not custom protocols.

### 1.2 Keep one owner per session
- Treat each `sessionId` as a single conversation owner.
- Avoid concurrent `prompt` calls for one session. The service enforces this with `SESSION_BUSY`.

### 1.3 Isolate environments by `cwd`
- Set `cwd` intentionally when creating sessions.
- Use separate session directories or working directories per tenant/project/workspace.

## 2. Secure the Service Boundary First

### 2.1 Always enforce API key auth at the edge
- Every endpoint requires `X-API-Key`.
- Do not expose this service publicly without a reverse proxy and TLS.

### 2.2 Never hardcode keys in client code
- Inject API keys via environment/config management.
- Rotate regularly and invalidate leaked keys immediately.

### 2.3 Add network-layer protections
- Put the service behind an API gateway/reverse proxy.
- Add request limits and connection limits at the edge.
- Restrict source networks where possible.

## 3. Session Lifecycle Best Practices

### 3.1 Create sessions explicitly
- Use `POST /v1/sessions` with explicit creation options (`cwd`, `agentDir`, `sessionDir`, `sessionPath`, `continueRecent`, model hints).
- Persist returned `sessionId` in your app state.

### 3.2 Treat JSONL sessions as source of truth
- Session persistence is managed by built-in `SessionManager` JSONL files.
- If you build indexing/search later, mirror JSONL; do not replace JSONL as authority.

### 3.3 Use the right operation for context control
- `fork`: branch from a historical entry while preserving lineage.
- `tree/navigate`: move inside the existing session tree.
- `switch`: load a different session file.
- `newSession`: start clean with optional parent linkage.

## 4. Prompt Orchestration: Prompt vs Steer vs Follow-up

### 4.1 Use `prompt` only when idle
- `POST /prompt` starts a new run.
- If a run is active and you submit another prompt, you get `SESSION_BUSY`.

### 4.2 Use `steer` for immediate correction
- `POST /steer` is for urgent redirection while a run is active.
- Use when the current trajectory is wrong and needs interruption.

### 4.3 Use `follow-up` for queued continuation
- `POST /follow-up` queues additional intent without forceful interruption.
- Use for additive instructions that can wait until current work settles.

### 4.4 Use `abort` for hard stop
- `POST /abort` is idempotent in runtime behavior.
- Abort before model switches or session switches to keep behavior deterministic.

## 5. Streaming and SSE Consumption

### 5.1 Use a dedicated SSE consumer
- Subscribe via `GET /v1/sessions/{sessionId}/events/stream`.
- Process `session_event` and `heartbeat` separately.

### 5.2 Assume network interruptions
- Heartbeats are emitted periodically; use them for liveness.
- On disconnect, reconnect and query current state/messages before resuming UI assumptions.

### 5.3 Order by `seq`
- SSE envelopes include monotonic `seq` per runtime.
- Use `seq` to preserve event ordering client-side.

### 5.4 Do not infer completion from transport only
- Use emitted event types (`agent_end`, etc.) and state polling (`GET /sessions/{id}`) for robust completion detection.

## 6. Tooling Safety and Execution Policy

### 6.1 Start with built-ins only
- Current service intentionally uses built-ins first:
  - `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`

### 6.2 Keep bash allowlist strict
- The service includes a command allowlist policy hook.
- Add only necessary command prefixes for your workload.
- Reject broad shells or destructive command families by default.

### 6.3 Prefer narrow working directories
- Use the smallest possible `cwd` scope to reduce accidental file impact.
- Segment workspaces per app/project.

### 6.4 Expect truncation in large outputs
- Built-in tools can truncate output for safety/perf.
- Handle large-output workflows by paging/chunking instead of assuming full payloads.

## 7. Models and Thinking Levels

### 7.1 Set model explicitly per session when needed
- Use `POST /model` to pin provider/model where determinism matters.
- Validate available models in your provisioning layer.

### 7.2 Use conservative thinking levels first
- Default to lower-cost levels for routine tasks.
- Raise thinking level only for complex reasoning paths.

### 7.3 Handle model errors as user-visible decisions
- Map `MODEL_ERROR` to actionable UI: re-select model, verify credentials, retry with fallback.

## 8. Error Handling Contract

### 8.1 Use canonical error codes, not message parsing
- Service returns stable codes:
  - `AUTH_INVALID`
  - `SESSION_NOT_FOUND`
  - `SESSION_BUSY`
  - `POLICY_DENIED`
  - `TOOL_EXEC_ERROR`
  - `MODEL_ERROR`
  - `INTERNAL_ERROR`

### 8.2 Retry only when appropriate
- Respect `retryable` field in error payloads.
- Typical strategy:
  - retryable true: bounded backoff retries
  - retryable false: surface to user/system control path

### 8.3 Separate policy denial from execution failure
- `POLICY_DENIED`: blocked by safety rule; do not blind-retry.
- `TOOL_EXEC_ERROR`: command/tool failed; may retry after state/input fix.

## 9. Extension Layer Best Practices

### 9.1 Keep extensions product-focused
- Use extensions for guardrails, commands, renderers, and policy-specific behavior.
- Avoid duplicating core agent/session behavior in your host app.

### 9.2 Persist reconstruction state in entries
- Use `appendEntry(...)` for state that must survive reload/resume.
- Reconstruct in `session_start` from prior entries.

### 9.3 Keep custom message rendering lightweight
- Renderers should be deterministic and cheap.
- Avoid expensive synchronous logic in rendering paths.

### 9.4 Use commands for repeatable workflows
- Provide concise product commands (for example `/plan`) for common user intents.

## 10. Reliability and Operational Hardening

### 10.1 Run continuous type and integration checks
- Keep package-level typecheck and tests in CI.
- Keep workspace-level typecheck as a separate gate.

### 10.2 Cover critical runtime edges
- Must-have scenarios:
  - prompt streaming path
  - steer vs follow-up semantics
  - abort during streaming
  - branch/fork/switch correctness
  - SSE ordering and reconnect behavior
  - policy denied and auth invalid paths

### 10.3 Instrument key service metrics
- Track:
  - active sessions
  - SSE connections
  - prompt latency
  - tool failure rates
  - abort rates
  - policy-denied counts
  - model error rates

### 10.4 Define capacity boundaries explicitly
- Limit maximum concurrent sessions per instance.
- Cap SSE connections per instance.
- Use horizontal scaling only after session isolation strategy is clear.

## 11. Recommended Client Integration Pattern

### 11.1 Startup
1. Create session.
2. Open SSE stream.
3. Render current state and messages.

### 11.2 User turn
1. Submit `prompt`.
2. Stream/render incremental events.
3. Allow `steer`/`follow-up` while active.
4. Use `abort` when user cancels.

### 11.3 Recovery
1. On disconnect, reconnect SSE.
2. Fetch `GET /sessions/{id}` and `GET /messages`.
3. Reconcile UI from server state, not local assumptions.

## 12. Anti-Patterns to Avoid

- Sending concurrent `prompt` calls to the same session.
- Implementing a second event model before confirming native event payloads are insufficient.
- Replacing JSONL persistence before proving product needs.
- Granting unrestricted shell access in production.
- Treating `POLICY_DENIED` as transient and auto-retrying.
- Ignoring heartbeat and disconnect events on SSE streams.

## 13. Minimal Production Readiness Checklist

- [ ] `X-API-Key` enforced at service and gateway.
- [ ] TLS termination and network restrictions configured.
- [ ] Session `cwd` isolation strategy documented.
- [ ] Bash allowlist reviewed and approved.
- [ ] SSE reconnect/reconciliation implemented client-side.
- [ ] Canonical error-code handling implemented.
- [ ] Typecheck + tests green in CI.
- [ ] Observability dashboards and alerts in place.

## 14. Reference Files

- Runtime behavior: `packages/agent-service/src/runtime.ts`
- HTTP + SSE contract: `packages/agent-service/src/http.ts`
- Session/backend composition: `packages/agent-service/src/registry.ts`
- Policy adapter: `packages/agent-service/src/policy.ts`
- Product extension layer: `packages/agent-service/src/extensions/product-extension.ts`
- Optional enhancement decisions: `packages/agent-service/docs/optional-evaluation.md`
