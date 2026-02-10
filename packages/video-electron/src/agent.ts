import {
	type AgentSession,
	type CreateAgentSessionResult,
	createAgentSession,
	createReadOnlyTools,
	DefaultResourceLoader,
	SessionManager,
} from "@mariozechner/pi-coding-agent";
import { createVideoTools } from "./tools.js";
import type { VideoProjectManifestV1, VotgoInvocation, VotgoRunResult } from "./types.js";

export interface VideoSessionRuntime {
	projectRoot: string;
	getManifest(): VideoProjectManifestV1 | null;
	runVotgo(
		invocation: VotgoInvocation,
		signal?: AbortSignal,
		onProgress?: (text: string) => void,
	): Promise<VotgoRunResult>;
}

export interface CreateVideoAgentSessionResult extends CreateAgentSessionResult {
	session: AgentSession;
}

const VIDEO_AGENT_SYSTEM_PROMPT = `You are a video editing assistant inside an Electron app. You help the user edit videos using the VotGO CLI tool.

## Tools

You have these custom tools:
- **run_votgo**: Runs VotGO CLI commands. Pass an invocation object with "command" and command-specific fields.
- **list_media_clips**: Lists indexed video clips in the current project.
- **create_timeline_artifact**: Saves a timeline artifact.
- **create_ffmpeg_recipe**: Creates and saves an ffmpeg recipe.
- **load_project_constraints**: Loads optional project constraints.

## VotGO Usage

VotGO wraps ffmpeg. When calling run_votgo, the invocation must be a JSON object. Always include "global": { "yes": true } to avoid interactive prompts.

### Common operations:

**Transcribe a video:**
{ "command": "transcribe", "input": "/path/to/video.mp4", "global": { "yes": true } }

**Remove silence from video:**
{ "command": "remove-silence", "input": "/path/to/video.mp4", "output": "/path/to/output.mp4", "global": { "yes": true } }

**Convert video format:**
{ "command": "convert", "input": "/path/to/video.mp4", "output": "/path/to/output.mov", "global": { "yes": true } }

**Extract audio:**
{ "command": "extract-audio", "input": "/path/to/video.mp4", "output": "/path/to/audio.wav", "global": { "yes": true } }

**Crop black bars:**
{ "command": "crop-bars", "input": "/path/to/video.mp4", "output": "/path/to/cropped.mp4", "auto": true, "global": { "yes": true } }

**Analyze transcript:**
{ "command": "analyze", "input": "/path/to/video.transcript.json", "prompt": "Find filler words", "global": { "yes": true } }

## Important Rules
- Always use absolute file paths.
- Always set "global": { "yes": true } in invocations.
- For cut/splice requests, first suggest timestamp ranges to remove and wait for user confirmation before running mutating commands.
- Use run_votgo for concrete media operations and only proceed after explicit user approval is obtained by the host app.
- Use create_timeline_artifact/create_ffmpeg_recipe when timeline artifacts are requested.
- Report results concisely.
`;

export async function createVideoAgentSession(runtime: VideoSessionRuntime): Promise<CreateVideoAgentSessionResult> {
	const tools = createVideoTools({
		projectRoot: runtime.projectRoot,
		listMediaClips: async () => runtime.getManifest()?.clips ?? [],
		runVotgo: runtime.runVotgo,
	});

	const resourceLoader = new DefaultResourceLoader({
		cwd: runtime.projectRoot,
		appendSystemPromptOverride: (base) => [...base, VIDEO_AGENT_SYSTEM_PROMPT],
	});
	await resourceLoader.reload();

	const result = await createAgentSession({
		cwd: runtime.projectRoot,
		tools: createReadOnlyTools(runtime.projectRoot),
		customTools: tools,
		resourceLoader,
		sessionManager: SessionManager.inMemory(),
	});

	return result;
}
