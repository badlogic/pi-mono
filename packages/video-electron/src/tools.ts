import { promises as fs } from "node:fs";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
	assertRecipeArtifact,
	assertTimelineArtifact,
	buildRecipeFromTimeline,
	resolveConstraintsPath,
	saveRecipeArtifact,
	saveTimelineArtifact,
} from "./artifacts.js";
import { VOTGO_COMMANDS } from "./config.js";
import type { FfmpegRecipeV1, VideoClipMeta, VotgoInvocation, VotgoRunResult } from "./types.js";

export interface VideoToolRuntime {
	projectRoot: string;
	listMediaClips(): Promise<VideoClipMeta[]>;
	runVotgo(
		invocation: VotgoInvocation,
		signal?: AbortSignal,
		onProgress?: (text: string) => void,
	): Promise<VotgoRunResult>;
}

const runVotgoParamsSchema = Type.Object({
	invocation: Type.Unknown({
		description: `VotGO invocation object. Must include "command" (string) and command-specific fields.

Available commands and their fields:
- transcribe: { command: "transcribe", input: "<video-path>" , output?: "<output-path>" }
- remove-silence: { command: "remove-silence", input: "<video-path>", output?: "<path>", noise?: "<dB e.g. -30dB>", minSilence?: <seconds>, pad?: <seconds>, vcodec?: "<codec>", acodec?: "<codec>" }
- convert: { command: "convert", input: "<path>", output?: "<path>", format?: "<ext>", reencode?: true, vcodec?: "<codec>", acodec?: "<codec>" }
- extract-audio: { command: "extract-audio", input: "<path>", output?: "<path>", stream?: <number>, forceFormat?: "<fmt>", reencode?: true }
- crop-bars: { command: "crop-bars", input: "<path>", output?: "<path>", auto?: true, top?: <px>, bottom?: <px>, left?: <px>, right?: <px>, dryRun?: true, vcodec?: "<codec>" }
- analyze: { command: "analyze", input: "<path>", output?: "<path>", prompt?: "<text>" }
- agent-run: { command: "agent-run", input: "<path>", output?: "<path>", prompt?: "<text>" }

All commands accept an optional "global" object: { yes?: true, verbose?: true, ffmpegPath?: "<path>", ffprobePath?: "<path>", timeout?: "<duration>", elevenlabsKey?: "<key>", openrouterKey?: "<key>" }

Example: { "command": "transcribe", "input": "/path/to/video.mp4", "global": { "yes": true } }`,
	}),
});

const createTimelineParamsSchema = Type.Object({
	timeline: Type.Unknown({ description: "TimelineV1 payload." }),
});

const createRecipeParamsSchema = Type.Object({
	recipe: Type.Optional(Type.Unknown({ description: "Optional FfmpegRecipeV1 payload." })),
	timeline: Type.Optional(Type.Unknown({ description: "Optional TimelineV1 payload used to generate recipe." })),
});

export function createVideoTools(runtime: VideoToolRuntime): ToolDefinition[] {
	const listMediaClipsTool: ToolDefinition = {
		name: "list_media_clips",
		label: "List Media Clips",
		description: "Lists indexed clips and metadata from the active video project.",
		parameters: Type.Object({}),
		execute: async () => {
			const clips = await runtime.listMediaClips();
			return {
				content: [{ type: "text", text: JSON.stringify(clips, null, 2) }],
				details: { clipCount: clips.length },
			};
		},
	};

	const runVotgoTool: ToolDefinition = {
		name: "run_votgo",
		label: "Run VotGO Command",
		description: "Runs one VotGO CLI command against project media.",
		parameters: runVotgoParamsSchema,
		execute: async (_toolCallId, params, signal, onUpdate) => {
			const paramsRecord = requireRecord(params, "run_votgo params");
			const invocation = toVotgoInvocation(paramsRecord.invocation);
			const result = await runtime.runVotgo(invocation, signal, (text) => {
				onUpdate?.({
					content: [{ type: "text", text }],
					details: { command: invocation.command },
				});
			});
			return {
				content: [{ type: "text", text: formatRunResult(result) }],
				details: { command: result.command, exitCode: result.exitCode, durationMs: result.durationMs },
			};
		},
	};

	const createTimelineArtifactTool: ToolDefinition = {
		name: "create_timeline_artifact",
		label: "Create Timeline Artifact",
		description: "Validates and saves a timeline artifact under .pi-video/timelines.",
		parameters: createTimelineParamsSchema,
		execute: async (_toolCallId, params) => {
			const paramsRecord = requireRecord(params, "create_timeline_artifact params");
			const timeline = paramsRecord.timeline;
			assertTimelineArtifact(timeline);
			const path = await saveTimelineArtifact(runtime.projectRoot, timeline);
			return {
				content: [{ type: "text", text: `Saved timeline artifact at ${path}` }],
				details: { path },
			};
		},
	};

	const createRecipeTool: ToolDefinition = {
		name: "create_ffmpeg_recipe",
		label: "Create FFmpeg Recipe",
		description:
			"Creates and saves an ffmpeg recipe under .pi-video/recipes. Accepts either recipe directly or builds one from a timeline.",
		parameters: createRecipeParamsSchema,
		execute: async (_toolCallId, params) => {
			const paramsRecord = requireRecord(params, "create_ffmpeg_recipe params");
			const recipe = toRecipePayload(paramsRecord.recipe, paramsRecord.timeline);
			const path = await saveRecipeArtifact(runtime.projectRoot, recipe);
			return {
				content: [{ type: "text", text: `Saved ffmpeg recipe at ${path}` }],
				details: { path },
			};
		},
	};

	const loadConstraintsTool: ToolDefinition = {
		name: "load_project_constraints",
		label: "Load Project Constraints",
		description: "Loads optional project constraints from .pi-video/constraints.md.",
		parameters: Type.Object({}),
		execute: async () => {
			const filePath = resolveConstraintsPath(runtime.projectRoot);
			try {
				const constraints = await fs.readFile(filePath, "utf8");
				return {
					content: [{ type: "text", text: constraints }],
					details: { loaded: true, path: filePath },
				};
			} catch {
				return {
					content: [{ type: "text", text: "No constraints file found for this project." }],
					details: { loaded: false, path: filePath },
				};
			}
		},
	};

	return [listMediaClipsTool, runVotgoTool, createTimelineArtifactTool, createRecipeTool, loadConstraintsTool];
}

function toVotgoInvocation(value: unknown): VotgoInvocation {
	let parsed = value;
	if (typeof value === "string") {
		try {
			parsed = JSON.parse(value);
		} catch {
			throw new Error(`Invalid invocation payload: could not parse JSON string: ${value.slice(0, 200)}`);
		}
	}
	if (!isRecord(parsed)) {
		throw new Error("Invalid invocation payload: expected object");
	}
	const command = parsed.command;
	if (typeof command !== "string") {
		throw new Error("Invalid invocation payload: missing string command");
	}
	const normalizedCommand = command.replace(/\s+/g, "-").toLowerCase();
	if (!VOTGO_COMMANDS.includes(normalizedCommand as VotgoInvocation["command"])) {
		throw new Error(`Invalid command "${command}". Valid commands: ${VOTGO_COMMANDS.join(", ")}`);
	}
	parsed.command = normalizedCommand;
	return parsed as unknown as VotgoInvocation;
}

function toRecipePayload(recipe: unknown, timeline: unknown): FfmpegRecipeV1 {
	if (recipe !== undefined) {
		assertRecipeArtifact(recipe);
		return recipe;
	}
	if (timeline !== undefined) {
		assertTimelineArtifact(timeline);
		return buildRecipeFromTimeline(timeline);
	}
	throw new Error("Either recipe or timeline must be provided");
}

function formatRunResult(result: VotgoRunResult): string {
	const lines: string[] = [
		`Command: ${result.command}`,
		`Exit code: ${result.exitCode}`,
		`Duration: ${result.durationMs}ms`,
	];
	if (result.stdout.trim().length > 0) {
		lines.push("", "stdout:", result.stdout.trim());
	}
	if (result.stderr.trim().length > 0) {
		lines.push("", "stderr:", result.stderr.trim());
	}
	return lines.join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
	let parsed = value;
	if (typeof parsed === "string") {
		try {
			parsed = JSON.parse(parsed);
		} catch {
			throw new Error(`Invalid ${label}: could not parse JSON string`);
		}
	}
	if (!isRecord(parsed)) {
		throw new Error(`Invalid ${label}: expected object`);
	}
	return parsed;
}
