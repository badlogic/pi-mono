import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getModels, getProviders, type KnownProvider } from "@mariozechner/pi-ai";
import type { AgentSession } from "@mariozechner/pi-coding-agent";
import { createVideoAgentSession } from "./agent.js";
import { type ApprovalHandler, defaultApprovalReason, requiresApproval } from "./approval.js";
import { saveRecipeArtifact, saveTimelineArtifact } from "./artifacts.js";
import { createDefaultVideoElectronSettings, type VideoElectronSettings } from "./config.js";
import type { CommandFailure, CommandResult, CommandSuccess, RendererCommand, RendererCommandData } from "./ipc.js";
import { openOrCreateVideoProject } from "./project.js";
import type {
	AgentStateSnapshot,
	ApprovalDecision,
	VideoControllerEvent,
	VideoProjectManifestV1,
	VotgoInvocation,
	VotgoRunResult,
} from "./types.js";
import { runVotgoCommand } from "./votgo.js";

export interface VideoAgentControllerOptions {
	settings?: Partial<VideoElectronSettings>;
	approvalHandler?: ApprovalHandler;
}

export class VideoAgentController {
	private readonly settings: VideoElectronSettings;
	private readonly approvalHandler?: ApprovalHandler;
	private readonly listeners = new Set<(event: VideoControllerEvent) => void>();
	private manifest: VideoProjectManifestV1 | null = null;
	private projectRoot: string | null = null;
	private session: AgentSession | null = null;

	public constructor(options: VideoAgentControllerOptions = {}) {
		const defaults = createDefaultVideoElectronSettings();
		this.settings = {
			...defaults,
			...options.settings,
			allowedCommands: options.settings?.allowedCommands ?? defaults.allowedCommands,
		};
		this.approvalHandler = options.approvalHandler;
	}

	public subscribe(listener: (event: VideoControllerEvent) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	public async handleCommand(command: RendererCommand): Promise<CommandResult> {
		console.info("[video-controller] handleCommand", { type: command.type });
		try {
			switch (command.type) {
				case "project/open": {
					const manifest = await this.openProject(command.projectRoot);
					console.info("[video-controller] project/open success", {
						projectRoot: manifest.rootPath,
						clips: manifest.clips.length,
					});
					return success({ type: command.type, manifest });
				}
				case "project/get_manifest":
					return success({ type: command.type, manifest: this.manifest });
				case "agent/prompt": {
					const session = await this.requireSession();
					session.prompt(command.message).catch((error) => {
						console.error("[video-controller] prompt error", {
							message: error instanceof Error ? error.message : String(error),
						});
						this.emit({
							type: "agent_event",
							event: { type: "agent_end", messages: [] },
						});
					});
					return success({ type: command.type, queued: true });
				}
				case "agent/abort": {
					const session = await this.requireSession();
					await session.abort();
					return success({ type: command.type, aborted: true });
				}
				case "agent/get_state": {
					const session = await this.requireSession();
					return success({ type: command.type, state: snapshotState(session) });
				}
				case "agent/set_model": {
					const session = await this.requireSession();
					if (!isKnownProvider(command.provider)) {
						return failure(command.type, `Unknown provider "${command.provider}"`);
					}
					const model = getModels(command.provider).find((candidate) => candidate.id === command.modelId);
					if (!model) {
						return failure(command.type, `Model ${command.provider}/${command.modelId} not found`);
					}
					await session.setModel(model);
					return success({ type: command.type, changed: true });
				}
				case "agent/set_thinking_level": {
					const session = await this.requireSession();
					session.setThinkingLevel(command.level);
					return success({ type: command.type, changed: true });
				}
				case "tools/votgo/run": {
					const result = await this.runVotgoWithApproval(command.invocation);
					return success({ type: command.type, result });
				}
				case "artifact/save_timeline": {
					const projectRoot = this.requireProjectRoot();
					const path = await saveTimelineArtifact(projectRoot, command.timeline);
					return success({ type: command.type, path });
				}
				case "artifact/save_recipe": {
					const projectRoot = this.requireProjectRoot();
					const path = await saveRecipeArtifact(projectRoot, command.recipe);
					return success({ type: command.type, path });
				}
				case "fs/read_text": {
					const content = await readFile(resolve(command.path), "utf8");
					return success({ type: command.type, content });
				}
				case "fs/exists": {
					const exists = existsSync(resolve(command.path));
					return success({ type: command.type, exists });
				}
			}
		} catch (error) {
			console.error("[video-controller] handleCommand failed", {
				type: command.type,
				message: error instanceof Error ? error.message : String(error),
			});
			return failure(command.type, error instanceof Error ? error.message : String(error));
		}
	}

	public dispose(): void {
		this.session?.dispose();
		this.session = null;
		this.listeners.clear();
	}

	private emit(event: VideoControllerEvent): void {
		for (const listener of this.listeners) {
			listener(event);
		}
	}

	private async openProject(projectRoot: string): Promise<VideoProjectManifestV1> {
		const absoluteRoot = resolve(projectRoot);
		console.info("[video-controller] openProject start", { projectRoot: absoluteRoot });
		this.projectRoot = absoluteRoot;
		const manifest = await openOrCreateVideoProject(absoluteRoot, {
			onProgress: (indexed, total, path) => {
				this.emit({
					type: "project_index_progress",
					indexed,
					total,
					path,
				});
			},
		});
		this.manifest = manifest;
		await this.resetSession();
		this.emit({ type: "project_index_complete", manifest });
		console.info("[video-controller] openProject complete", { clips: manifest.clips.length });
		return manifest;
	}

	private async resetSession(): Promise<void> {
		const projectRoot = this.requireProjectRoot();
		console.info("[video-controller] resetSession start", { projectRoot });
		this.session?.dispose();
		const result = await createVideoAgentSession({
			projectRoot,
			getManifest: () => this.manifest,
			runVotgo: async (invocation, signal, onProgress) => {
				return await this.runVotgoWithApproval(invocation, signal, onProgress);
			},
		});
		this.session = result.session;
		this.session.subscribe((event) => {
			this.emit({ type: "agent_event", event });
		});
		console.info("[video-controller] resetSession complete", {
			sessionId: this.session.sessionId,
		});
	}

	private async requireSession(): Promise<AgentSession> {
		if (this.session) {
			return this.session;
		}
		if (!this.projectRoot) {
			throw new Error("No active project. Open a project folder first.");
		}
		await this.resetSession();
		if (!this.session) {
			throw new Error("Failed to initialize session");
		}
		return this.session;
	}

	private requireProjectRoot(): string {
		if (!this.projectRoot) {
			throw new Error("No active project. Open a project folder first.");
		}
		return this.projectRoot;
	}

	private async runVotgoWithApproval(
		invocation: VotgoInvocation,
		signal?: AbortSignal,
		onProgress?: (text: string) => void,
	): Promise<VotgoRunResult> {
		if (!this.settings.allowedCommands.includes(invocation.command)) {
			throw new Error(`Command "${invocation.command}" is not allowed by current settings`);
		}
		if (this.settings.requireApproval && requiresApproval(invocation)) {
			const decision = await this.requestApproval(invocation);
			if (!decision.approved) {
				throw new Error(decision.reason ?? `Command "${invocation.command}" denied by approval gate`);
			}
		}

		const cwd = this.projectRoot ?? process.cwd();
		return await runVotgoCommand(this.settings, invocation, {
			cwd,
			signal,
			onProgress: (progress) => {
				this.emit({ type: "votgo_progress", progress });
				onProgress?.(`[${progress.stream}] ${progress.chunk}`);
			},
		});
	}

	private async requestApproval(invocation: VotgoInvocation): Promise<ApprovalDecision> {
		if (!this.approvalHandler) {
			return {
				approved: false,
				reason: `No approval handler configured. ${defaultApprovalReason(invocation)}`,
			};
		}
		return await this.approvalHandler({
			invocation,
			reason: defaultApprovalReason(invocation),
		});
	}
}

function success(data: RendererCommandData): CommandSuccess {
	return { ok: true, data };
}

function failure(commandType: RendererCommand["type"], error: string): CommandFailure {
	return { ok: false, error, commandType };
}

function snapshotState(session: AgentSession): AgentStateSnapshot {
	return {
		model: session.model ?? null,
		thinkingLevel: session.thinkingLevel,
		isStreaming: session.isStreaming,
		sessionId: session.sessionId,
		sessionFile: session.sessionFile,
	};
}

function isKnownProvider(provider: string): provider is KnownProvider {
	return getProviders().includes(provider as KnownProvider);
}
