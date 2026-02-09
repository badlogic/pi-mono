# Video Agent — Electron App

## Overview

An Electron app that wraps a pi coding agent with VotGO-backed video tools. The user loads a video, interacts with an AI agent via a floating prompt bubble, and edits the video by manipulating its transcript.

## Architecture

- **Main process**: `src/electron-main.ts` — boots Electron, creates the `VideoAgentController`, wires IPC
- **Preload**: `src/preload.cjs` — exposes `window.videoAgent` bridge (sendCommand, onEvent, pickVideoFile)
- **Renderer**: `renderer/index.html` + `renderer/index.js` — the UI (no framework, vanilla JS)
- **Controller**: `src/controller.ts` — `VideoAgentController` handles all commands (project/open, agent/prompt, tools/votgo/run, etc.)
- **Agent session**: `src/agent.ts` — `createVideoAgentSession` creates a pi session with VotGO tools
- **VotGO tools**: `src/tools.ts` — tool definitions exposed to the agent (run_votgo, list_media_clips, create_timeline_artifact, etc.)
- **VotGO binary**: `../../VotGO/bin/votgo` — Go CLI for ffmpeg operations, transcription (ElevenLabs), and analysis (OpenRouter)

## UI Layout (Target Design)

The renderer must have exactly three components:

### 1. Video Preview (~70% of screen)
- Occupies the main area, roughly 70% of the viewport
- Plays the currently loaded video file via `<video>` element with native controls
- Updates in real-time when the agent produces a new cut/edit (reload the video source)
- Shows current time and duration

### 2. Floating Agent Prompt Bubble
- A draggable, always-on-top bubble/pill that floats over the video preview
- The user can reposition it anywhere on screen by dragging
- Contains a text input for typing prompts to the agent
- Sends prompts via `window.videoAgent.sendCommand({ type: "agent/prompt", message })` 
- Shows a minimal indicator when the agent is processing (e.g., pulsing dot)
- Collapsed by default (small circle/icon), expands on click to reveal the input

### 3. Transcript Panel (Left Sidebar)
- Fixed panel on the left side of the screen
- Displays the video transcript (word-level, from VotGO `transcribe` command output)
- Each word is individually selectable/deletable
- **Deleting words from the transcript removes the corresponding time segments from the video**
  - Uses word-level timestamps from the ElevenLabs transcript JSON
  - Builds a timeline excluding deleted word segments
  - Runs VotGO to render the edited video (via `remove-silence` or by building a timeline artifact + ffmpeg recipe)
- Transcript loads automatically after a video is opened (trigger `transcribe` via the agent or directly via VotGO)
- Words should be visually distinct (inline spans), with hover/selection styling
- Deleted words should appear struck-through before the edit is applied

## IPC Commands (renderer → main)

All communication goes through `window.videoAgent.sendCommand(command)`:

| Command | Purpose |
|---|---|
| `project/open` | Open a video project folder |
| `agent/prompt` | Send a natural-language prompt to the agent |
| `agent/abort` | Cancel the current agent operation |
| `tools/votgo/run` | Run a VotGO command directly (transcribe, remove-silence, etc.) |
| `artifact/save_timeline` | Save a timeline artifact |
| `artifact/save_recipe` | Save an ffmpeg recipe artifact |

Events flow back via `window.videoAgent.onEvent(callback)`.

## VotGO Commands Used

| Command | Role in this app |
|---|---|
| `transcribe` | Generate word-level transcript JSON with timestamps |
| `remove-silence` | Remove silent segments from video |
| `convert` | Format conversion if needed |
| `extract-audio` | Pull audio track for processing |
| `analyze` | AI-powered edit suggestions from transcript |
| `agent-run` | Full pipeline: transcribe + analyze |

## Transcript JSON Format

VotGO `transcribe` produces ElevenLabs Scribe v2 output with word-level timestamps:
```json
{
  "words": [
    { "text": "Hello", "start": 0.0, "end": 0.45, "type": "word" },
    { "text": "world", "start": 0.50, "end": 0.92, "type": "word" }
  ]
}
```

When the user deletes words, the app must:
1. Collect the time ranges of remaining (non-deleted) words
2. Merge adjacent ranges with a small padding
3. Build a timeline or ffmpeg filter to keep only those ranges
4. Run VotGO/ffmpeg to produce the trimmed video
5. Reload the preview with the new video

## Build & Run

```bash
# From repo root
make video-agent          # Build VotGO + video-electron, launch app

# Or manually
cd VotGO && go build -o bin/votgo .
cd packages/video-electron && npm run build
npx electron packages/video-electron/dist/run.js
```

## Code Conventions

- No frameworks in the renderer — vanilla HTML/JS/CSS
- All IPC goes through the `window.videoAgent` bridge (never use `ipcRenderer` directly)
- VotGO invocations are typed via `VotgoInvocation` union in `src/types.ts`
- Artifacts (timelines, recipes) are validated with TypeBox schemas before saving
- The agent session is managed by `VideoAgentController` — the renderer never talks to the agent directly

## Environment Variables

| Variable | Required for |
|---|---|
| `ELEVENLABS_API_KEY` | Transcription |
| `OPENROUTER_API_KEY` | AI analysis and agent LLM calls |

## Key Files

| File | Purpose |
|---|---|
| `renderer/index.html` | UI markup and styles |
| `renderer/index.js` | UI logic, IPC calls, video preview |
| `src/electron-main.ts` | Electron bootstrap |
| `src/controller.ts` | Command handler, session management |
| `src/agent.ts` | Pi agent session factory |
| `src/tools.ts` | VotGO tool definitions for the agent |
| `src/types.ts` | All TypeScript types (invocations, manifests, events) |
| `src/ipc.ts` | IPC command/response type definitions |
| `src/votgo.ts` | VotGO binary runner |
| `src/config.ts` | Settings and defaults |
| `src/project.ts` | Project folder scanning and manifest creation |
| `src/artifacts.ts` | Timeline/recipe persistence and validation |
