import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import { type Static, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { getProjectLayoutPaths, getRecipeFilename, getTimelineFilename } from "./project.js";
import type { FfmpegRecipeV1, TimelineTrack, TimelineV1 } from "./types.js";

const TimelineSegmentSchema = Type.Object({
	clipId: Type.String({ minLength: 1 }),
	startSec: Type.Number({ minimum: 0 }),
	endSec: Type.Number({ minimum: 0 }),
	placementSec: Type.Number({ minimum: 0 }),
});

const TimelineTrackSchema = Type.Object({
	id: Type.String({ minLength: 1 }),
	kind: Type.Union([Type.Literal("video"), Type.Literal("audio")]),
	segments: Type.Array(TimelineSegmentSchema),
});

const TimelineSchema = Type.Object({
	version: Type.Literal(1),
	timelineId: Type.String({ minLength: 1 }),
	title: Type.String({ minLength: 1 }),
	fps: Type.Number({ exclusiveMinimum: 0 }),
	resolution: Type.Object({
		width: Type.Number({ minimum: 1 }),
		height: Type.Number({ minimum: 1 }),
	}),
	tracks: Type.Array(TimelineTrackSchema),
	totalDurationSec: Type.Number({ minimum: 0 }),
});

const RecipeSchema = Type.Object({
	version: Type.Literal(1),
	recipeId: Type.String({ minLength: 1 }),
	timelineId: Type.String({ minLength: 1 }),
	commands: Type.Array(Type.String({ minLength: 1 })),
	notes: Type.Array(Type.String()),
	requiresApproval: Type.Literal(true),
});

type TimelinePayload = Static<typeof TimelineSchema>;
type RecipePayload = Static<typeof RecipeSchema>;

export function assertTimelineArtifact(value: unknown): asserts value is TimelinePayload {
	if (!Value.Check(TimelineSchema, value)) {
		throw new Error("Invalid timeline payload");
	}
}

export function assertRecipeArtifact(value: unknown): asserts value is RecipePayload {
	if (!Value.Check(RecipeSchema, value)) {
		throw new Error("Invalid ffmpeg recipe payload");
	}
}

export async function saveTimelineArtifact(projectRoot: string, timeline: TimelineV1): Promise<string> {
	assertTimelineArtifact(timeline);
	const paths = getProjectLayoutPaths(projectRoot);
	await fs.mkdir(paths.timelinesDir, { recursive: true });
	const outputPath = join(paths.timelinesDir, getTimelineFilename(timeline.timelineId));
	await fs.writeFile(outputPath, `${JSON.stringify(timeline, null, 2)}\n`, "utf8");
	return outputPath;
}

export async function saveRecipeArtifact(projectRoot: string, recipe: FfmpegRecipeV1): Promise<string> {
	assertRecipeArtifact(recipe);
	const paths = getProjectLayoutPaths(projectRoot);
	await fs.mkdir(paths.recipesDir, { recursive: true });
	const outputPath = join(paths.recipesDir, getRecipeFilename(recipe.recipeId));
	await fs.writeFile(outputPath, `${JSON.stringify(recipe, null, 2)}\n`, "utf8");
	return outputPath;
}

export function buildRecipeFromTimeline(timeline: TimelineV1): FfmpegRecipeV1 {
	const videoTrack = timeline.tracks.find((track) => track.kind === "video");
	const segmentArgs = renderSegmentArgs(videoTrack?.segments ?? []);
	const outputPath = `.pi-video/artifacts/${timeline.timelineId}.render.mp4`;
	const command =
		segmentArgs.length > 0 ? `ffmpeg ${segmentArgs} "${outputPath}"` : `ffmpeg -i input.mp4 "${outputPath}"`;

	return {
		version: 1,
		recipeId: `${timeline.timelineId}-recipe`,
		timelineId: timeline.timelineId,
		commands: [command],
		notes: [
			"Review clip IDs and map them to real file paths before executing.",
			"Command execution must go through the explicit approval gate.",
		],
		requiresApproval: true,
	};
}

export function resolveConstraintsPath(projectRoot: string): string {
	return resolve(projectRoot, ".pi-video", "constraints.md");
}

function renderSegmentArgs(segments: TimelineTrack["segments"]): string {
	if (segments.length === 0) return "";
	return segments
		.map(
			(segment, index) =>
				`-ss ${segment.startSec.toFixed(3)} -to ${segment.endSec.toFixed(3)} -i "${segment.clipId}" -map ${index}:v? -map ${index}:a?`,
		)
		.join(" ");
}
