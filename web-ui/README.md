# Pi durable web interface

A local HTML/CSS/JavaScript interface for the **real Pi durable harness**. It includes the `openDurable()`, `DurableView`, and `DurableController` adapter originally used by Pi's experimental durable TUI, adapted to this fork's APIs. The browser is a presentation layer; the Node process owns the harness, tools, model connections and SQLite database.

## Independence

All browser code, server code, tests and the durable adapter are included in this fork. There are no imports or symlinks into the original sibling `pi` or `web-ui` directories. This is a maintained copy: future changes to the original do not propagate automatically. Runtime dependencies are installed from this repository’s lockfile; generated model metadata comes from its own setup command.

## Start

From the `web-pi` repository root:

```sh
npm run web:start
```

This starts a new durable session, serves the UI on `127.0.0.1:4317`, and opens the **default browser**. The current working directory is the agent's project. The shell launcher uses Node on your PATH; nothing outside this repository is required.

To select a project and resume its latest durable session:

```sh
./web-ui/start.sh --cwd /path/to/project --continue
```

Other options:

```sh
./web-ui/start.sh --port 0          # Choose a free port and open its URL
./web-ui/start.sh --no-open        # Print the URL without opening a browser
./web-ui/start.sh --help
```

On Windows, or when Node is already on PATH, use the equivalent cross-platform entry point:

```sh
node web-ui/start.mjs --cwd /path/to/project
```

You can also use `npm --prefix web-ui start -- --cwd /path/to/project`. Set `--cwd` explicitly when using package-manager launchers to avoid ambiguity about their working directory.

Stop the server with **Ctrl+C in its terminal**. Closing/reloading a tab does not stop the harness. Restart with `--continue` to reopen the latest session for the same project; Pi resumes interrupted work according to its durable recovery rules. A new run without `--continue` creates a new session. The flag reports an error if no previous session exists. Sessions cannot be opened simultaneously by the TUI and the web server.

## First-time prerequisites

Use Node.js **22.19 or newer**, with this fork cloned locally. Its own `packages/` directory supplies the durable runtime. From the repository root:

```sh
npm ci --ignore-scripts
npm run hydrate:model-data
```

The first command installs the lockfile's dependencies without running dependency lifecycle scripts. The second downloads public model metadata required by the source runtime. No Pi build or UI bundler is required. The web application itself has no npm dependencies.

Configure credentials using your usual Pi installation's `/login`, or Pi-supported provider environment variables, before starting. Defaults, model selection and thinking settings come from Pi's settings. The web UI shares the normal Pi agent profile; it does not implement a separate login flow. If no models are available, it shows a configuration notice and an empty model picker. After adding credentials, restart the server with `--continue`.

For an isolated profile, set `PI_CODING_AGENT_DIR` before launching. This changes settings/auth/session storage as in Pi itself. The tests use temporary profiles, not your normal credentials.

## Layout

At normal browser sizes the page occupies the viewport and does **not** scroll. CSS grid allocates the remaining space to the transcript, keeping the composer, controls and status visible. Long transcripts, tool outputs, model lists and sidebar lists have their own scrolling regions, so history remains readable without moving the whole page.

Below **441 CSS pixels wide** or **561 CSS pixels high**, the page permits vertical scrolling and keeps controls at usable sizes. No horizontal page scrolling is needed. Below 701 pixels wide the sidebar is hidden; **Switch** still opens conversations and the header's **Tasks** button opens a live task dialog. Sizes react immediately to window resizing, with no page reload.

Streaming follows the bottom until you scroll up. **Jump to latest** resumes following. Tool-detail expansion is retained during streaming; message drafts are kept per conversation while the page stays open. Browser reload reconnects to the durable state but does not preserve unsent drafts or replay submitted commands.

## Features and controls

| Feature | Browser control | Durable TUI equivalent |
|---|---|---|
| Prompt / steer | Send or Enter; becomes “Steer” while busy | Submit |
| Follow-up | Follow-up or Alt+Enter | Follow-up key |
| New line | Shift+Enter | Multiline editor |
| Abort current conversation | Stop or Esc outside dialogs | Esc |
| Model selection | Model button, Alt+M, `/model` | Model selector |
| Thinking level | Thinking button or Alt+T | Cycle thinking |
| Compaction | Compact dialog or `/compact [instructions]` | `/compact` |
| Main/subagent switching | Sidebar, Switch, `/agents`, subagent tool card | `/agents` |
| Live task graph | Sidebar or Tasks dialog; `/tasks` toggles collection | `/tasks` |
| Tool output, arguments, failures | Expandable tool cards; Alt+O expands/collapses | Expand tools |
| Reasoning and context summaries | Expandable disclosures | Thinking/compaction rendering |
| Streaming, queued input, retry/compaction status | Transcript, queue strip and status line | Durable view |
| Token counts, cache counts, cost, context usage | Footer; hover for cache totals | Footer |
| Help | Help button or `/help` | Key hints |

The task panel shows task IDs, owner relationships, owned conversations, phases, waits, background and abort flags. Costs are usage estimates/provider reports, not billing statements. Markdown rendering supports text, headings, bold, inline code, fenced code and HTTP(S) links; raw HTML is displayed as text. Specialized terminal tool renderers, ANSI colors and complete Markdown syntax are not reproduced.

Like the upstream durable TUI, this interface does not add a session picker, forks/tree navigation, extension loading, image attachments, prompt templates or `/login`. It does support child conversations created by the durable `subagent` tool. It runs **durable mode**, not Pi's ordinary RPC mode and not a simulated chat backend.

## Local transport and behavior

The server binds only to IPv4 loopback. Its printed launch URL contains a random per-process token in a URL fragment; the browser saves it in tab-scoped session storage and removes the fragment from the address bar. API requests use bearer authorization. Host/origin validation and a restrictive content-security policy protect the local command surface. Do not expose the server through a public proxy or share the launch URL: it controls a coding agent with the same filesystem/process permissions as Pi.

`GET /api/events` streams complete `DurableView` snapshots as server-sent events over authenticated fetch. Updates are coalesced and slow clients reconnect rather than accumulating unlimited buffered snapshots. Browser reconnect always reads current state; it never replays a mutation. `POST /api/command` dispatches a small allowlist of controller methods, validates targets/arguments, and deduplicates recent request IDs. A selected-conversation check rejects stale commands when another tab switches conversations. All tabs share the server's current selection.

Controller errors can also arrive as durable notices after transport acceptance; the UI displays them. If a connection fails while submitting, the UI keeps the draft and asks you to check the transcript before retrying. It does not assume a failed HTTP response means the harness did no work.

Sessions use Pi's existing location:

```text
~/.pi/agent/experimental/durable-sessions/<cwd-hash>/<session>/session.sqlite
```

The web server adds no second persistence format. The [durable adapter README](../packages/coding-agent/src/experimental/durable/README.md) documents the copied runtime bridge and session lifecycle.

## Source map

| File | Responsibility |
|---|---|
| [start.sh](start.sh), [start.mjs](start.mjs) | Runtime/dependency checks and source-resolver launcher |
| [main.mjs](main.mjs) | Open real durable runtime, start HTTP server, open default browser, handle shutdown |
| [server.mjs](server.mjs) | Local authenticated HTTP/SSE transport and command validation |
| [public/index.html](public/index.html) | Accessible page regions and dialogs |
| [public/style.css](public/style.css) | Viewport layout and small-window fallback |
| [public/app.js](public/app.js) | DOM rendering, safe formatted text, controls, keyboard shortcuts, reconnect |
| [public/view.js](public/view.js) | Pure projections of transcript, live status and usage |
| [Pi runtime](../packages/coding-agent/src/experimental/durable/runtime.ts) | Fork-local durable session/controller |

## Verification

With Node on PATH, from the repository root:

```sh
npm run web:test
npm run web:test:adapter
npm run web:test:durable
npm run web:test:browser
```

The first command checks HTTP authorization, origin/host validation, duplicate submissions, stale conversation commands, tool-result correlation, streaming and usage projection. The adapter test drives the real durable engine with a faux provider and verifies that the copied subagent returns its answer through this fork's `output` contract. The smoke test starts the **real runtime**, closes it, and verifies `--continue` reopens the same SQLite session. It creates its own profile under `.artifacts/web-ui/temp/` and sends no model request.

The browser check uses installed Chrome and the DevTools protocol directly. On macOS it uses Chrome's standard application path; elsewhere set `CHROME_PATH` to the browser executable. It checks four normal viewport sizes, a small-window scrolling fallback, safe rendering, model/thinking/subagent/follow-up/compaction controls, Esc abort, streaming cards and reload without duplicate submissions. Its backend is explicitly a test fixture. It does not certify a live model's response quality or every provider.

Logs, screenshots and JSON results are retained in `.artifacts/web-ui/output/`. Temporary test profiles are retained in `.artifacts/web-ui/temp/`. Production startup always uses the real durable runtime; test fixtures are only imported by the tests.
