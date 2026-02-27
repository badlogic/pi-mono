# Fugue Build Log

## Phase 0 — Infrastructure Shell

**Completed:** 2026-02-27

### Summary

All Phase 0 packages built and tested. 146 unit tests passing across 6 packages.

### Packages Built

| Package | Tests | Duration | Notes |
|---------|-------|----------|-------|
| `@fugue/shared` | 32 | 346ms | Types, IDs, capabilities |
| `@fugue/graph` | 47 | 2.4s | Drizzle schema, CRUD, audit |
| `@fugue/events` | 15 | 374ms | InMemoryEventBus, PgmqEventBus |
| `@fugue/core` | 27 | 2.4s | tRPC router, Hono server |
| `@fugue/sync` | 15 | 1.6s | RoomStore, RoomManager |
| `@fugue/surface` | 10 | 975ms | NodePanel, tRPC client |

**Total: 146 tests, ~8s full suite**

### Key Technical Decisions

1. **PGlite for unit tests** — Switched from pg-mem (incompatible with drizzle-orm v0.45 `getTypeParser`) to `@electric-sql/pglite` (real PostgreSQL WASM). Supports JSONB, arrays, recursive CTEs.

2. **Shared PGlite instance** — Each test file shares one PGlite instance; `TRUNCATE ... RESTART IDENTITY CASCADE` between tests. Reduces per-test init from ~800ms to ~1ms.

3. **tRPC v11 callers** — Use `appRouter.createCaller(ctx)` directly (not `createCallerFactory` which doesn't exist in v11).

4. **drizzle-orm v0.45 + drizzle-kit v0.31** — Upgraded from v0.40/v0.30 to satisfy better-auth peer dependency.

5. **tldraw v4 + @tldraw/sync-core v4** — Canvas uses `useSync()` hook with native WebSocket sync. No Yjs dependency.

### Known Gaps (Phase 1+)

- `traverseFrom` / `findAncestors` (recursive CTE) not unit-tested — requires real Postgres; integration tests TBD
- `searchNodes` (FTS tsvector) not unit-tested — no tsvector support in PGlite unit tests
- Better Auth integration test (sign-up / sign-in) requires real Postgres
- fugue-surface vite build not verified (needs `tldraw` installed, currently excluded from unit test scope)

### Architecture

```
fugue-surface (:3000) ── /trpc ──► fugue-core (:3001) ── pg ──► postgres (:5432)
fugue-surface          ── ws ───► fugue-sync (:3002)  ── pg ──► postgres (:5432)
```

### Running Tests

```bash
# All fugue packages
npm run test:fugue

# Individual package
cd packages/fugue-graph && npx vitest --run
```

### Running Dev Stack

```bash
# Start Postgres (first time, builds custom image)
docker compose build postgres
docker compose up postgres

# Start API + Sync
cd packages/fugue-core && npm run dev
cd packages/fugue-sync && npm run dev

# Start UI
cd packages/fugue-surface && npm run dev
```
