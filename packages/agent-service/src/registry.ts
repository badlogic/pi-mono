import { resolve } from "node:path";
import {
	createAgentSession,
	createBashTool,
	createEditTool,
	createFindTool,
	createGrepTool,
	createLsTool,
	createReadTool,
	createWriteTool,
	DefaultResourceLoader,
	SessionManager,
} from "@mariozechner/pi-coding-agent";
import { sessionNotFoundError } from "./errors.js";
import { productExtension } from "./extensions/product-extension.js";
import { createPolicyBashSpawnHook, normalizePolicyConfig } from "./policy.js";
import { type AgentRuntime, type AgentSessionBackend, CodingAgentSessionBackend, createRuntime } from "./runtime.js";
import type { BashPolicyConfig, CreateSessionRequest } from "./types.js";

export interface DefaultBackendFactoryOptions {
	defaultCwd?: string;
	defaultAgentDir?: string;
	defaultSessionDir?: string;
	bashPolicy?: BashPolicyConfig;
}

export type SessionBackendFactory = (request: CreateSessionRequest) => Promise<AgentSessionBackend>;

export function buildSessionManager(
	cwd: string,
	request: CreateSessionRequest,
	defaultSessionDir?: string,
): SessionManager {
	const sessionDir = request.sessionDir ?? defaultSessionDir;
	if (request.sessionPath) {
		return SessionManager.open(request.sessionPath, sessionDir);
	}
	if (request.continueRecent) {
		return SessionManager.continueRecent(cwd, sessionDir);
	}
	return SessionManager.create(cwd, sessionDir);
}

export function createDefaultBackendFactory(options: DefaultBackendFactoryOptions = {}): SessionBackendFactory {
	const bashPolicy = normalizePolicyConfig(options.bashPolicy);

	return async (request: CreateSessionRequest): Promise<AgentSessionBackend> => {
		const cwd = resolve(request.cwd ?? options.defaultCwd ?? process.cwd());
		const agentDir = request.agentDir ?? options.defaultAgentDir;
		const sessionManager = buildSessionManager(cwd, request, options.defaultSessionDir);

		const resourceLoader = new DefaultResourceLoader({
			cwd,
			agentDir,
			extensionFactories: [productExtension({ bashPolicy })],
		});
		await resourceLoader.reload();

		const tools = [
			createReadTool(cwd),
			createBashTool(cwd, { spawnHook: createPolicyBashSpawnHook(bashPolicy) }),
			createEditTool(cwd),
			createWriteTool(cwd),
			createGrepTool(cwd),
			createFindTool(cwd),
			createLsTool(cwd),
		];

		const result = await createAgentSession({
			cwd,
			agentDir,
			sessionManager,
			resourceLoader,
			tools,
		});

		const backend = new CodingAgentSessionBackend(result.session);

		if (request.provider && request.modelId) {
			await backend.setModel(request.provider, request.modelId);
		}
		if (request.thinkingLevel) {
			backend.setThinkingLevel(request.thinkingLevel);
		}

		return backend;
	};
}

export class AgentRuntimeRegistry {
	private readonly runtimes: Map<string, AgentRuntime> = new Map();
	private readonly backendFactory: SessionBackendFactory;

	constructor(backendFactory: SessionBackendFactory) {
		this.backendFactory = backendFactory;
	}

	async createSession(request: CreateSessionRequest): Promise<AgentRuntime> {
		const backend = await this.backendFactory(request);
		const runtime = createRuntime({ backend });
		this.runtimes.set(runtime.id, runtime);
		return runtime;
	}

	getSession(sessionId: string): AgentRuntime {
		const runtime = this.runtimes.get(sessionId);
		if (!runtime) {
			throw sessionNotFoundError(sessionId);
		}
		return runtime;
	}

	listSessions(): AgentRuntime[] {
		return [...this.runtimes.values()];
	}

	disposeSession(sessionId: string): void {
		const runtime = this.runtimes.get(sessionId);
		if (!runtime) {
			return;
		}
		runtime.dispose();
		this.runtimes.delete(sessionId);
	}

	dispose(): void {
		for (const runtime of this.runtimes.values()) {
			runtime.dispose();
		}
		this.runtimes.clear();
	}
}
