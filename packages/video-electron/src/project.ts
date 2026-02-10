import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import { promises as fs } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import type { ProjectChangeLogEntryV1, VideoClipMeta, VideoProjectManifestV1 } from "./types.js";

const PROJECT_DIR = ".pi-video";
const PROJECT_MANIFEST_FILE = "project.json";
const INPUTS_DIR = "inputs";
const OUTPUTS_DIR = "outputs";
const TIMELINES_DIR = "timelines";
const RECIPES_DIR = "recipes";
const ARTIFACTS_DIR = "artifacts";
const LOGS_DIR = "logs";
const CHANGE_LOG_FILE = "changes.jsonl";

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
const AUDIO_EXTENSIONS: ReadonlySet<string> = new Set([
	".mp3",
	".wav",
	".aac",
	".m4a",
	".flac",
	".ogg",
	".opus",
	".wma",
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

interface IndexedMediaFile {
	filePath: string;
	source: "input" | "output";
}

export interface ProjectLayoutPaths {
	projectDir: string;
	inputsDir: string;
	outputsDir: string;
	manifestPath: string;
	timelinesDir: string;
	recipesDir: string;
	artifactsDir: string;
	logsDir: string;
	changeLogPath: string;
}

export function getProjectLayoutPaths(projectRoot: string): ProjectLayoutPaths {
	const root = resolve(projectRoot);
	const projectDir = join(root, PROJECT_DIR);
	const logsDir = join(projectDir, LOGS_DIR);
	return {
		projectDir,
		inputsDir: join(root, INPUTS_DIR),
		outputsDir: join(root, OUTPUTS_DIR),
		manifestPath: join(projectDir, PROJECT_MANIFEST_FILE),
		timelinesDir: join(projectDir, TIMELINES_DIR),
		recipesDir: join(projectDir, RECIPES_DIR),
		artifactsDir: join(projectDir, ARTIFACTS_DIR),
		logsDir,
		changeLogPath: join(logsDir, CHANGE_LOG_FILE),
	};
}

export async function ensureProjectLayout(projectRoot: string): Promise<ProjectLayoutPaths> {
	const paths = getProjectLayoutPaths(projectRoot);
	await fs.mkdir(paths.projectDir, { recursive: true });
	await fs.mkdir(paths.inputsDir, { recursive: true });
	await fs.mkdir(paths.outputsDir, { recursive: true });
	await fs.mkdir(paths.timelinesDir, { recursive: true });
	await fs.mkdir(paths.recipesDir, { recursive: true });
	await fs.mkdir(paths.artifactsDir, { recursive: true });
	await fs.mkdir(paths.logsDir, { recursive: true });
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
	const paths = await ensureProjectLayout(absoluteRoot);
	const existing = await loadProjectManifest(absoluteRoot);

	const mediaFiles = await collectMediaFiles(paths);
	const clips: VideoClipMeta[] = [];
	for (let index = 0; index < mediaFiles.length; index += 1) {
		const mediaFile = mediaFiles[index];
		const clip = await toClipMeta(absoluteRoot, mediaFile.filePath, mediaFile.source, options.ffprobePath);
		clips.push(clip);
		options.onProgress?.(index + 1, mediaFiles.length, mediaFile.filePath);
	}

	const now = new Date().toISOString();
	const manifest: VideoProjectManifestV1 = {
		version: 1,
		projectId: existing?.projectId ?? createStableId(absoluteRoot),
		rootPath: absoluteRoot,
		inputsPath: paths.inputsDir,
		outputsPath: paths.outputsDir,
		changeLogPath: paths.changeLogPath,
		createdAt: existing?.createdAt ?? now,
		updatedAt: now,
		clips,
		activeTimelineId: existing?.activeTimelineId,
	};

	await saveProjectManifest(absoluteRoot, manifest);
	return manifest;
}

export interface ImportMediaIntoProjectOptions {
	destination?: "input" | "output";
	ffprobePath?: string;
}

export interface ImportMediaIntoProjectResult {
	manifest: VideoProjectManifestV1;
	importedPath: string;
}

export async function importMediaIntoProject(
	projectRoot: string,
	sourcePath: string,
	options: ImportMediaIntoProjectOptions = {},
): Promise<ImportMediaIntoProjectResult> {
	const absoluteRoot = resolve(projectRoot);
	const absoluteSourcePath = resolve(sourcePath);
	const paths = await ensureProjectLayout(absoluteRoot);
	const destinationDir = options.destination === "output" ? paths.outputsDir : paths.inputsDir;
	const importedPath = await copyIntoDirectory(absoluteSourcePath, destinationDir);
	const manifest = await openOrCreateVideoProject(absoluteRoot, { ffprobePath: options.ffprobePath });
	return { manifest, importedPath };
}

export async function appendProjectChangeLog(
	projectRoot: string,
	eventType: string,
	details: Record<string, unknown>,
): Promise<string> {
	const paths = await ensureProjectLayout(projectRoot);
	const entry: ProjectChangeLogEntryV1 = {
		version: 1,
		eventId: randomUUID(),
		timestamp: new Date().toISOString(),
		eventType,
		details,
	};
	await fs.appendFile(paths.changeLogPath, `${JSON.stringify(entry)}\n`, "utf8");
	return paths.changeLogPath;
}

async function collectMediaFiles(paths: ProjectLayoutPaths): Promise<IndexedMediaFile[]> {
	const result: IndexedMediaFile[] = [];
	await walk(paths.inputsDir, "input", result);
	await walk(paths.outputsDir, "output", result);
	return result.sort((left, right) => left.filePath.localeCompare(right.filePath));
}

async function walk(currentPath: string, source: "input" | "output", result: IndexedMediaFile[]): Promise<void> {
	let entries: Dirent[];
	try {
		entries = await fs.readdir(currentPath, { withFileTypes: true, encoding: "utf8" });
	} catch {
		return;
	}
	for (const entry of entries) {
		const fullPath = join(currentPath, entry.name);
		if (entry.isDirectory()) {
			await walk(fullPath, source, result);
			continue;
		}
		if (!entry.isFile()) {
			continue;
		}
		const extension = extname(entry.name).toLowerCase();
		if (VIDEO_EXTENSIONS.has(extension) || AUDIO_EXTENSIONS.has(extension)) {
			result.push({ filePath: fullPath, source });
		}
	}
}

async function toClipMeta(
	projectRoot: string,
	filePath: string,
	source: "input" | "output",
	ffprobePath?: string,
): Promise<VideoClipMeta> {
	const rel = relative(projectRoot, filePath).replace(/\\/g, "/");
	const probe = await probeMedia(filePath, ffprobePath ?? "ffprobe");
	const videoStream = probe.streams?.find((stream) => stream.codec_type === "video");
	const audioStream = probe.streams?.find((stream) => stream.codec_type === "audio");
	return {
		id: createStableId(rel),
		path: rel,
		source,
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

async function copyIntoDirectory(sourcePath: string, destinationDir: string): Promise<string> {
	await fs.mkdir(destinationDir, { recursive: true });
	if (isPathInsideDirectory(sourcePath, destinationDir)) {
		return sourcePath;
	}
	const targetPath = await findAvailablePath(destinationDir, basename(sourcePath));
	await fs.copyFile(sourcePath, targetPath);
	return targetPath;
}

async function findAvailablePath(directory: string, fileName: string): Promise<string> {
	const extension = extname(fileName);
	const baseName = extension.length > 0 ? fileName.slice(0, -extension.length) : fileName;
	let attempt = 0;
	while (true) {
		const candidate =
			attempt === 0 ? join(directory, fileName) : join(directory, `${baseName}-${attempt + 1}${extension}`);
		try {
			await fs.access(candidate);
			attempt += 1;
		} catch {
			return candidate;
		}
	}
}

function isPathInsideDirectory(candidatePath: string, directoryPath: string): boolean {
	const candidate = normalizePath(resolve(candidatePath));
	const directory = normalizePath(resolve(directoryPath));
	if (candidate === directory) return true;
	return candidate.startsWith(`${directory}/`);
}

function normalizePath(path: string): string {
	return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
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
