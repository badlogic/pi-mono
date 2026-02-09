import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import type { VideoClipMeta, VideoProjectManifestV1 } from "./types.js";

const PROJECT_DIR = ".pi-video";
const PROJECT_MANIFEST_FILE = "project.json";
const TIMELINES_DIR = "timelines";
const RECIPES_DIR = "recipes";
const ARTIFACTS_DIR = "artifacts";

const VIDEO_EXTENSIONS: ReadonlySet<string> = new Set([
	".mp4",
	".mov",
	".mkv",
	".avi",
	".webm",
	".m4v",
	".mpg",
	".mpeg",
]);

interface FfprobeStream {
	codec_type?: string;
	codec_name?: string;
	width?: number;
	height?: number;
	avg_frame_rate?: string;
}

interface FfprobeFormat {
	duration?: string;
}

interface FfprobeOutput {
	streams?: FfprobeStream[];
	format?: FfprobeFormat;
}

export interface ProjectLayoutPaths {
	projectDir: string;
	manifestPath: string;
	timelinesDir: string;
	recipesDir: string;
	artifactsDir: string;
}

export function getProjectLayoutPaths(projectRoot: string): ProjectLayoutPaths {
	const root = resolve(projectRoot);
	const projectDir = join(root, PROJECT_DIR);
	return {
		projectDir,
		manifestPath: join(projectDir, PROJECT_MANIFEST_FILE),
		timelinesDir: join(projectDir, TIMELINES_DIR),
		recipesDir: join(projectDir, RECIPES_DIR),
		artifactsDir: join(projectDir, ARTIFACTS_DIR),
	};
}

export async function ensureProjectLayout(projectRoot: string): Promise<ProjectLayoutPaths> {
	const paths = getProjectLayoutPaths(projectRoot);
	await fs.mkdir(paths.projectDir, { recursive: true });
	await fs.mkdir(paths.timelinesDir, { recursive: true });
	await fs.mkdir(paths.recipesDir, { recursive: true });
	await fs.mkdir(paths.artifactsDir, { recursive: true });
	return paths;
}

export async function loadProjectManifest(projectRoot: string): Promise<VideoProjectManifestV1 | null> {
	const { manifestPath } = getProjectLayoutPaths(projectRoot);
	try {
		const raw = await fs.readFile(manifestPath, "utf8");
		return JSON.parse(raw) as VideoProjectManifestV1;
	} catch {
		return null;
	}
}

export async function saveProjectManifest(projectRoot: string, manifest: VideoProjectManifestV1): Promise<string> {
	const paths = await ensureProjectLayout(projectRoot);
	await fs.writeFile(paths.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
	return paths.manifestPath;
}

export interface IndexProjectOptions {
	ffprobePath?: string;
	onProgress?: (indexed: number, total: number, path: string) => void;
}

export async function openOrCreateVideoProject(
	projectRoot: string,
	options: IndexProjectOptions = {},
): Promise<VideoProjectManifestV1> {
	const absoluteRoot = resolve(projectRoot);
	await ensureProjectLayout(absoluteRoot);
	const existing = await loadProjectManifest(absoluteRoot);

	const mediaFiles = await collectMediaFiles(absoluteRoot);
	const clips: VideoClipMeta[] = [];
	for (let index = 0; index < mediaFiles.length; index += 1) {
		const filePath = mediaFiles[index];
		const clip = await toClipMeta(absoluteRoot, filePath, options.ffprobePath);
		clips.push(clip);
		options.onProgress?.(index + 1, mediaFiles.length, filePath);
	}

	const now = new Date().toISOString();
	const manifest: VideoProjectManifestV1 = {
		version: 1,
		projectId: existing?.projectId ?? createStableId(absoluteRoot),
		rootPath: absoluteRoot,
		createdAt: existing?.createdAt ?? now,
		updatedAt: now,
		clips,
		activeTimelineId: existing?.activeTimelineId,
	};

	await saveProjectManifest(absoluteRoot, manifest);
	return manifest;
}

async function collectMediaFiles(projectRoot: string): Promise<string[]> {
	const result: string[] = [];
	await walk(projectRoot, result);
	return result.sort((left, right) => left.localeCompare(right));
}

async function walk(currentPath: string, result: string[]): Promise<void> {
	const entries = await fs.readdir(currentPath, { withFileTypes: true });
	for (const entry of entries) {
		if (entry.name === ".git" || entry.name === PROJECT_DIR || entry.name === "node_modules") {
			continue;
		}
		const fullPath = join(currentPath, entry.name);
		if (entry.isDirectory()) {
			await walk(fullPath, result);
			continue;
		}
		if (!entry.isFile()) {
			continue;
		}
		const extension = extname(entry.name).toLowerCase();
		if (VIDEO_EXTENSIONS.has(extension)) {
			result.push(fullPath);
		}
	}
}

async function toClipMeta(projectRoot: string, filePath: string, ffprobePath?: string): Promise<VideoClipMeta> {
	const rel = relative(projectRoot, filePath);
	const probe = await probeMedia(filePath, ffprobePath ?? "ffprobe");
	const videoStream = probe.streams?.find((stream) => stream.codec_type === "video");
	const audioStream = probe.streams?.find((stream) => stream.codec_type === "audio");
	return {
		id: createStableId(rel),
		path: rel,
		durationSec: parseDuration(probe.format?.duration),
		width: videoStream?.width ?? 0,
		height: videoStream?.height ?? 0,
		fps: parseFps(videoStream?.avg_frame_rate),
		hasAudio: Boolean(audioStream),
		codecVideo: videoStream?.codec_name,
		codecAudio: audioStream?.codec_name,
	};
}

function createStableId(input: string): string {
	return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

function parseDuration(duration: string | undefined): number {
	if (!duration) return 0;
	const value = Number.parseFloat(duration);
	return Number.isFinite(value) ? value : 0;
}

function parseFps(rate: string | undefined): number | undefined {
	if (!rate) return undefined;
	const [numeratorRaw, denominatorRaw] = rate.split("/");
	if (!numeratorRaw || !denominatorRaw) return undefined;
	const numerator = Number.parseFloat(numeratorRaw);
	const denominator = Number.parseFloat(denominatorRaw);
	if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
		return undefined;
	}
	return numerator / denominator;
}

async function probeMedia(filePath: string, ffprobePath: string): Promise<FfprobeOutput> {
	return await new Promise<FfprobeOutput>((resolveProbe) => {
		const args = ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", filePath];
		const child = spawn(ffprobePath, args, { stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		child.stdout.on("data", (buffer: Buffer) => {
			stdout += buffer.toString("utf8");
		});

		child.on("close", () => {
			if (stdout.trim().length === 0) {
				resolveProbe({});
				return;
			}
			try {
				resolveProbe(JSON.parse(stdout) as FfprobeOutput);
			} catch {
				resolveProbe({});
			}
		});

		child.on("error", () => resolveProbe({}));
	});
}

export function getTimelineFilename(timelineId: string): string {
	return `${sanitizeFilename(timelineId)}.json`;
}

export function getRecipeFilename(recipeId: string): string {
	return `${sanitizeFilename(recipeId)}.json`;
}

function sanitizeFilename(name: string): string {
	return basename(name).replace(/[^a-zA-Z0-9._-]/g, "_");
}
