# Optional Enhancements Evaluation

## External searchable index mirror
Decision: No-go for MVP.
Rationale: SessionManager JSONL already provides authoritative persistence and branching semantics. Additional index would add synchronization risk before product validation.

## RPC compatibility adapter for non-Node consumers
Decision: No-go for MVP, keep as next increment.
Rationale: HTTP + SSE is now complete and stable for Node-first integration. RPC adapter should only be added when a non-Node client is committed.

## Advanced provider/proxy registration and telemetry pipeline
Decision: No-go for MVP.
Rationale: Current SDK-backed model selection and canonical error mapping are sufficient. Telemetry/proxy complexity is deferred until operational scale requires it.
