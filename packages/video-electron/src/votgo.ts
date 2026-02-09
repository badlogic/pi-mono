import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { getDefaultBinaryCandidates, type VideoElectronSettings } from "./config.js";
import type { VotgoGlobalOptions, VotgoInvocation, VotgoProgressEvent, VotgoRunResult } from "./types.js";

export class VotgoBinaryNotFoundError extends Error {
	public readonly candidates: string[];

	public constructor(candidates: string[]) {
		super(`Could not find votgo binary. Checked: ${candidates.join(", ")}`);
		this.name = "VotgoBinaryNotFoundError";
		this.candidates = candidates;
	}
}

export interface RunVotgoCommandOptions {
	cwd: string;
	signal?: AbortSignal;
	onProgress?: (event: VotgoProgressEvent) => void;
}

export function resolveVotgoBinary(settings: VideoElectronSettings): string {
	const candidates = getDefaultBinaryCandidates(settings).map((entry) => (entry === "votgo" ? entry : resolve(entry)));
	for (const candidate of candidates) {
		if (candidate === "votgo") {
			const which = spawnSync("which", ["votgo"], { encoding: "utf8" });
			if (which.status === 0 && which.stdout.trim().length > 0) {
				return "votgo";
			}
			continue;
		}
		if (existsSync(candidate)) {
			return candidate;
		}
	}
	throw new VotgoBinaryNotFoundError(candidates);
}

export async function runVotgoCommand(
	settings: VideoElectronSettings,
	invocation: VotgoInvocation,
	options: RunVotgoCommandOptions,
): Promise<VotgoRunResult> {
	const binaryPath = resolveVotgoBinary(settings);
	const args = buildArgs(invocation);
	const started = Date.now();
	const startedAt = new Date(started).toISOString();

	return await new Promise<VotgoRunResult>((resolveResult, rejectResult) => {
		const child = spawn(binaryPath, args, {
			cwd: options.cwd,
			env: process.env,
			stdio: ["ignore", "pipe", "pipe"],
		});

		let stdout = "";
		let stderr = "";
		let completed = false;

		const onAbort = (): void => {
			if (completed) return;
			child.kill("SIGTERM");
		};

		options.signal?.addEventListener("abort", onAbort);

		child.stdout.on("data", (buffer: Buffer) => {
			const chunk = buffer.toString("utf8");
			stdout += chunk;
			options.onProgress?.({
				command: invocation.command,
				stream: "stdout",
				chunk,
				timestamp: Date.now(),
			});
		});

		child.stderr.on("data", (buffer: Buffer) => {
			const chunk = buffer.toString("utf8");
			stderr += chunk;
			options.onProgress?.({
				command: invocation.command,
				stream: "stderr",
				chunk,
				timestamp: Date.now(),
			});
		});

		child.on("error", (error) => {
			completed = true;
			options.signal?.removeEventListener("abort", onAbort);
			rejectResult(error);
		});

		child.on("close", (exitCode) => {
			completed = true;
			options.signal?.removeEventListener("abort", onAbort);
			const ended = Date.now();
			const result: VotgoRunResult = {
				command: invocation.command,
				binaryPath,
				args,
				cwd: options.cwd,
				exitCode: exitCode ?? -1,
				stdout,
				stderr,
				startedAt,
				endedAt: new Date(ended).toISOString(),
				durationMs: ended - started,
			};

			if ((exitCode ?? -1) !== 0) {
				rejectResult(
					new Error(
						`VotGO command "${invocation.command}" failed with code ${exitCode ?? -1}\n${stderr || stdout}`,
					),
				);
				return;
			}

			resolveResult(result);
		});
	});
}

function appendGlobalArgs(target: string[], global: VotgoGlobalOptions | undefined): void {
	if (!global) return;
	if (global.ffmpegPath) {
		target.push("--ffmpeg", global.ffmpegPath);
	}
	if (global.ffprobePath) {
		target.push("--ffprobe", global.ffprobePath);
	}
	if (global.verbose) {
		target.push("--verbose");
	}
	if (global.yes) {
		target.push("--yes");
	}
	if (global.timeout) {
		target.push("--timeout", global.timeout);
	}
	if (global.model) {
		target.push("--model", global.model);
	}
	if (global.elevenlabsKey) {
		target.push("--elevenlabs-key", global.elevenlabsKey);
	}
	if (global.openrouterKey) {
		target.push("--openrouter-key", global.openrouterKey);
	}
}

function buildArgs(invocation: VotgoInvocation): string[] {
	const args: string[] = [];
	appendGlobalArgs(args, invocation.global);
	args.push(invocation.command);

	switch (invocation.command) {
		case "convert": {
			args.push("--input", invocation.input);
			if (invocation.output) args.push("--output", invocation.output);
			if (invocation.format) args.push("--format", invocation.format);
			if (invocation.reencode) args.push("--reencode");
			if (invocation.vcodec) args.push("--vcodec", invocation.vcodec);
			if (invocation.acodec) args.push("--acodec", invocation.acodec);
			return args;
		}
		case "extract-audio": {
			args.push("--input", invocation.input);
			if (invocation.output) args.push("--output", invocation.output);
			if (invocation.stream !== undefined) args.push("--stream", String(invocation.stream));
			if (invocation.forceFormat) args.push("--force-format", invocation.forceFormat);
			if (invocation.reencode) args.push("--reencode");
			return args;
		}
		case "remove-silence": {
			args.push("--input", invocation.input);
			if (invocation.output) args.push("--output", invocation.output);
			if (invocation.noise) args.push("--noise", invocation.noise);
			if (invocation.minSilence !== undefined) args.push("--min-silence", String(invocation.minSilence));
			if (invocation.pad !== undefined) args.push("--pad", String(invocation.pad));
			if (invocation.vcodec) args.push("--vcodec", invocation.vcodec);
			if (invocation.acodec) args.push("--acodec", invocation.acodec);
			if (invocation.report) args.push("--report", invocation.report);
			return args;
		}
		case "crop-bars": {
			args.push("--input", invocation.input);
			if (invocation.output) args.push("--output", invocation.output);
			if (invocation.auto) args.push("--auto");
			if (invocation.top !== undefined) args.push("--top", String(invocation.top));
			if (invocation.bottom !== undefined) args.push("--bottom", String(invocation.bottom));
			if (invocation.left !== undefined) args.push("--left", String(invocation.left));
			if (invocation.right !== undefined) args.push("--right", String(invocation.right));
			if (invocation.limit !== undefined) args.push("--limit", String(invocation.limit));
			if (invocation.round !== undefined) args.push("--round", String(invocation.round));
			if (invocation.detectSeconds !== undefined) args.push("--detect-seconds", String(invocation.detectSeconds));
			if (invocation.seek !== undefined) args.push("--seek", String(invocation.seek));
			if (invocation.dryRun) args.push("--dry-run");
			if (invocation.vcodec) args.push("--vcodec", invocation.vcodec);
			return args;
		}
		case "transcribe": {
			args.push("--input", invocation.input);
			if (invocation.output) args.push("--output", invocation.output);
			return args;
		}
		case "analyze": {
			args.push("--input", invocation.input);
			if (invocation.output) args.push("--output", invocation.output);
			if (invocation.prompt) args.push("--prompt", invocation.prompt);
			return args;
		}
		case "agent-run": {
			args.push("--input", invocation.input);
			if (invocation.output) args.push("--output", invocation.output);
			if (invocation.prompt) args.push("--prompt", invocation.prompt);
			return args;
		}
	}
}
