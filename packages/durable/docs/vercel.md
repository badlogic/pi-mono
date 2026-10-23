# Run Pi durably on Vercel

> Describes [`durable-harness`](https://github.com/vercel-labs/durable-harness), Vercel's integration for this package. It is on `0.0.x` and its API changes between releases. The [README](../README.md) documents the Harness itself.

A Vercel Function can be cut off at any point: it crashes, it runs out of memory, it reaches its time limit, or the deployment is replaced. `durable-harness` opens this package's `Harness` on a [Workflow SDK](https://workflow-sdk.dev/worlds) World, which on Vercel is the one the platform runs for your project. One session is one workflow run, and each Pi commit is an event in that run, so a turn whose function disappears is picked up by a new function at the last commit instead of starting over. A tool call that is not safe to repeat is never run twice.

Only the storage changes. Conversations, tasks, extensions, forks, and compaction stay the same.

## Install

```bash
npm install durable-harness @earendil-works/pi-durable @earendil-works/chord @earendil-works/pi-ai just-bash
```

`just-bash` is only needed for `CodingTools` on a virtual workspace, below.

## Register how a session reopens

The function that resumes a turn is not the one that started it, and it has none of your setup: no models, no registry, no extensions. Pass the function that opens your Harness to `resumeWith()` once, at the top of a module, so a resuming function can rebuild it:

```typescript
// lib/agent.ts
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createRegistry, Harness, type Storage } from "@earendil-works/pi-durable";
import { CodingTools, GATEWAY_PROVIDER, gatewayModels, resumeWith, virtualEnv } from "durable-harness/pi-durable";

const models = gatewayModels(); // pi-ai Models on the Vercel AI Gateway provider
const registry = createRegistry();
registry.install(CodingTools); // pi-durable's read, write, edit, and bash

export { context };
export const agent = { model: { provider: GATEWAY_PROVIDER, modelId: "anthropic/claude-sonnet-5.5" } };
export const open = resumeWith((storage: Storage) =>
	Harness.open(storage, { models, registry, env: virtualEnv() }, context),
);
```

`gatewayModels()` asks for `AI_GATEWAY_API_KEY` or the deployment's OIDC token at every request; any other pi-ai provider is configured as it is elsewhere. `resumeWith()` returns the opener unchanged, so it is also what you open sessions with.

`virtualEnv()` runs `CodingTools` on a virtual workspace at `/workspace`: each call sees the files as committed, and what it changed commits with its result, so the files follow the session to whichever function resumes it, and a call a crash cut off changed nothing. Never give a Function `NodeExecutionEnv`, which runs the model's commands on the instance's own disk and processes, where every session on it can reach them; `CodingTools` refuses one on Vercel. The session's own [Vercel Sandbox](https://vercel.com/docs/sandbox) is the other option, as `sandboxEnv()`.

## Open sessions on the World

Where you would open SQLite, JSONL, or memory storage, call `openWorldStorage()`:

```typescript
import { openWorldStorage } from "durable-harness/pi-durable";
import { agent, context, open } from "./agent";

const storage = await openWorldStorage(sessionId); // without an ID, a new session; its ID is storage.sessionId
const harness = await open(storage);
const root = await harness.root(context, { agent });
await root.submit({ type: "input", content: "What changed here?", requestId: "review-1" }, context);
await harness.close(context); // closing with work left hands it to the next function at once
```

Everything after that is this package's API: submissions and their waits, `watchEvents()`, forks, and compaction.

## Serve a chat route

`chatRoute()` is a ready-made route for a session: `POST` submits text to the root conversation, drives the turn in that invocation, and streams it as server-sent events; `GET ?sessionId=` follows a turn that is already under way, without opening the session.

```typescript
// app/api/chat/route.ts
import { chatRoute } from "durable-harness/pi-durable";
import { agent, open } from "@/lib/agent";

export const { GET, POST } = chatRoute({
	open,
	agent,
	authorize: async (request) => {
		/* your check; throw a Response to refuse */
	},
});
```

`authorize` is required in production: without it every request to the route is refused with 401, and `authorize: "public"` lets anyone spend your model credits. A route of your own is the same thing: `acquireHarness()` for the session, `root.submit()`, then release.

## Configure the deployment

Each turn runs in a function that a queue delivers to. On Next.js, `withDurableHarness` writes that route and its trigger, and finds the modules that call `resumeWith()`:

```typescript
// next.config.ts
import type { NextConfig } from "next";
import { withDurableHarness } from "durable-harness/next";

const nextConfig: NextConfig = {
	// your existing config
};

export default withDurableHarness(nextConfig);
```

On other frameworks, add the route yourself and subscribe it to the queue:

```typescript
// api/flow.ts
import "../lib/agent.js"; // the module that calls resumeWith
import { flowHandler } from "durable-harness";

export const POST = flowHandler();
```

`npx durable-harness vercel-json --write` adds the `vercel.json` entry that gives it the queue trigger and your plan's maximum duration. Then deploy:

```bash
vercel deploy
```

Run `vercel link` and `vercel env pull` first, so model calls, and a Sandbox if your tools use one, authenticate with the project. `next dev`, or `vercel dev` elsewhere, keeps sessions in `.workflow-data`, so add it to `.gitignore`; on its first request it resumes the sessions a stopped server left mid-turn.

## What differs from local storage

- **Opening a session takes it over.** That is this package's own rule, and the World enforces it: the storage that lost the session is fenced, its next commit rejects with `StorageFenced`, and nothing more of it lands. Keep one open Harness per session per process, which `acquireHarness()` shares, and follow a session that may be running with `openWorldReader()`, which never opens it.
- **A long silence looks like a crash.** A session with unfinished work that commits nothing for `recoverAfterMs` (120 seconds by default) may be taken over and resumed, which includes a tool that runs that long without output. Raise it for those: `openWorldStorage(sessionId, { recoverAfterMs })`.
- **Closing hands work on.** Closing the Harness with work left, a background compaction or subagent included, gives it to the next function rather than dropping it, and a request that returns while Pi still works is kept alive until the session is idle.
- **A reconnect replays the response in flight.** Pi's live partial has no cursor, so `GET` resends the model response in progress from its start: replace the text you showed for it, and drop a model call's text when a `rewind` event says that call restarted.

## More

- [Running Pi Durably on Vercel](https://vercel.com/docs/agent-harnesses/pi): Vercel's guide, which also covers the agent-loop-only `durable-harness/pi` variant, Sandbox-backed tools, steering a running turn, observability in Agent Runs, and self-hosting on another World.
- [`durable-harness`](https://github.com/vercel-labs/durable-harness) on GitHub.
