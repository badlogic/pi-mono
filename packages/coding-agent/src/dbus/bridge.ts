/**
 * D-Bus ↔ RPC Bridge for org.embry.Agent.
 *
 * Thin translation layer: D-Bus method calls → RPC JSON commands → parse events → D-Bus signals.
 * Spawns Pi via RpcClient and registers on the session bus.
 *
 * Uses configureMembers() instead of decorators — dbus-next decorators require
 * TC39 Stage 2 format which is incompatible with TypeScript's legacy decorators.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentEvent } from "@mariozechner/pi-agent-core";
import dbus from "dbus-next";
import { RpcClient, type RpcClientOptions } from "../modes/rpc/rpc-client.js";
import type { RpcExtensionUIRequest } from "../modes/rpc/rpc-types.js";
import { DBUS_BUS_NAME, DBUS_INTERFACE_NAME, DBUS_OBJECT_PATH } from "./interface.js";
import {
	type BridgeOptions,
	type DBusAgentState,
	type QueuedRequest,
	type RequestHints,
	RequestPriority,
	type SessionPersistence,
} from "./types.js";

const { Interface, ACCESS_READ } = dbus.interface;

const SESSION_STATE_DIR = path.join(os.homedir(), ".pi", "state");
const SESSION_STATE_FILE = path.join(SESSION_STATE_DIR, "dbus-session.json");

// Helper to extract text from agent messages
export function extractTextFromMessages(messages: unknown[]): string {
	if (!Array.isArray(messages)) return "";
	const last = messages[messages.length - 1] as any;
	if (!last?.content) return "";
	const parts = Array.isArray(last.content) ? last.content : [last.content];
	return parts
		.filter((p: any) => typeof p === "string" || p?.type === "text")
		.map((p: any) => (typeof p === "string" ? p : (p.text ?? "")))
		.join("");
}

class AgentDBusInterface extends Interface {
	private bridge!: AgentDBusBridge;

	constructor(bridge: AgentDBusBridge) {
		super(DBUS_INTERFACE_NAME);
		this.bridge = bridge;
	}

	// --- Properties (accessed via D-Bus Get/GetAll) ---
	get IsStreaming(): boolean {
		return this.bridge.isStreaming;
	}

	get CurrentModel(): string {
		return this.bridge.currentModel;
	}

	get SessionName(): string {
		return this.bridge.sessionName;
	}

	// --- Methods (called via D-Bus) ---
	async Ask(prompt: string): Promise<string> {
		return this.bridge.enqueueAsk(prompt);
	}

	async AskAsync(prompt: string): Promise<string> {
		return this.bridge.enqueueAskAsync(prompt);
	}

	async Steer(message: string): Promise<void> {
		this.bridge.enqueueSteer(message);
	}

	async FollowUp(message: string): Promise<void> {
		this.bridge.enqueueFollowUp(message);
	}

	async Abort(): Promise<void> {
		this.bridge.enqueueAbort();
	}

	async GetState(): Promise<string> {
		const state = await this.bridge.rpcClient.getState();
		const result: DBusAgentState = {
			isStreaming: state.isStreaming,
			currentModel: state.model ? `${state.model.provider}/${state.model.id}` : "unknown",
			sessionName: state.sessionName ?? "",
			sessionId: state.sessionId,
			thinkingLevel: state.thinkingLevel,
			messageCount: state.messageCount,
		};
		return JSON.stringify(result);
	}

	async SetModel(provider: string, model: string): Promise<void> {
		await this.bridge.rpcClient.setModel(provider, model);
	}

	async RespondToUI(id: string, response: string): Promise<void> {
		this.bridge.respondToUI(id, response);
	}

	Ping(): string {
		return "pong";
	}

	async AskWithHints(prompt: string, hintsJson: string): Promise<string> {
		return this.bridge.enqueueAskWithHints(prompt, hintsJson);
	}

	async AskAs(persona: string, prompt: string): Promise<string> {
		return this.bridge.enqueueAskAs(persona, prompt);
	}

	// --- Signals (stubs — replaced by configureMembers) ---
	// Signal methods must RETURN their args; dbus-next uses the return value as signal data.
	MessageUpdate(text: string): string {
		return text;
	}
	ToolExecution(name: string, args: string): string[] {
		return [name, args];
	}
	AgentEnd(response: string): string {
		return response;
	}
	ExtensionUIRequest(id: string, method: string, title: string, options: string): string[] {
		return [id, method, title, options];
	}
	Ready(): void {}
	Error(message: string): string {
		return message;
	}
}

// Configure all D-Bus members without decorators
AgentDBusInterface.configureMembers({
	properties: {
		IsStreaming: { signature: "b", access: ACCESS_READ },
		CurrentModel: { signature: "s", access: ACCESS_READ },
		SessionName: { signature: "s", access: ACCESS_READ },
	},
	methods: {
		Ask: { inSignature: "s", outSignature: "s" },
		AskAsync: { inSignature: "s", outSignature: "s" },
		Steer: { inSignature: "s" },
		FollowUp: { inSignature: "s" },
		Abort: {},
		GetState: { outSignature: "s" },
		SetModel: { inSignature: "ss" },
		RespondToUI: { inSignature: "ss" },
		Ping: { outSignature: "s" },
		AskWithHints: { inSignature: "ss", outSignature: "s" },
		AskAs: { inSignature: "ss", outSignature: "s" },
	},
	signals: {
		MessageUpdate: { signature: "s" },
		ToolExecution: { signature: "ss" },
		AgentEnd: { signature: "s" },
		ExtensionUIRequest: { signature: "ssss" },
		Ready: { signature: "" },
		Error: { signature: "s" },
	},
});

export class AgentDBusBridge {
	rpcClient: RpcClient;
	private bus: dbus.MessageBus | null = null;
	private iface: AgentDBusInterface | null = null;
	private options: BridgeOptions;
	private restartAttempts = 0;
	private maxRestartDelay = 30000;
	private destroyed = false;
	private lastResponseText = "";

	// Phase 2: Request queue
	private queue: QueuedRequest[] = [];
	private processing = false;
	private requestCounter = 0;

	// Tracked state for D-Bus properties
	isStreaming = false;
	currentModel = "unknown";
	sessionName = "";

	constructor(options: BridgeOptions = {}) {
		this.options = options;

		const rpcOptions: RpcClientOptions = {
			cwd: options.cwd,
			provider: options.provider,
			model: options.model,
			cliPath: options.cliPath,
			env: { PI_STDIN_TIMEOUT_MS: "0" },
		};

		// Phase 1: Resume from persisted session
		const sessionArgs = this.loadPersistedSession();
		if (sessionArgs.length > 0) {
			rpcOptions.args = sessionArgs;
		}

		// CLI --session override takes precedence
		if (options.sessionFile) {
			rpcOptions.args = ["--session", options.sessionFile];
		}

		this.rpcClient = new RpcClient(rpcOptions);
	}

	async start(): Promise<void> {
		// Connect to session bus
		this.bus = dbus.sessionBus();

		// Request the bus name
		await this.bus.requestName(DBUS_BUS_NAME, 0);

		// Create and export the interface
		this.iface = new AgentDBusInterface(this);
		this.bus.export(DBUS_OBJECT_PATH, this.iface);

		// Start the RPC client
		await this.startRpcClient();

		// Emit Ready signal
		this.iface.Ready();

		console.log(`[embry-agent] D-Bus service registered: ${DBUS_BUS_NAME}`);
	}

	async stop(): Promise<void> {
		this.destroyed = true;
		this.persistSession();
		await this.rpcClient.stop();
		if (this.bus) {
			this.bus.releaseName(DBUS_BUS_NAME);
			this.bus.disconnect();
			this.bus = null;
		}
		console.log("[embry-agent] Stopped");
	}

	// --- Phase 2: Request Queuing ---

	enqueueAsk(prompt: string): Promise<string> {
		return new Promise((resolve, reject) => {
			this.enqueue({
				id: `req_${++this.requestCounter}`,
				priority: RequestPriority.ASK,
				type: "ask",
				prompt,
				resolve,
				reject,
			});
		});
	}

	enqueueAskAsync(prompt: string): string {
		const requestId = `req_${++this.requestCounter}`;
		this.enqueue({
			id: requestId,
			priority: RequestPriority.ASK,
			type: "askAsync",
			prompt,
		});
		return requestId;
	}

	enqueueSteer(message: string): void {
		this.enqueue({
			id: `req_${++this.requestCounter}`,
			priority: RequestPriority.STEER,
			type: "steer",
			prompt: message,
		});
	}

	enqueueFollowUp(message: string): void {
		this.enqueue({
			id: `req_${++this.requestCounter}`,
			priority: RequestPriority.FOLLOWUP,
			type: "followUp",
			prompt: message,
		});
	}

	enqueueAbort(): void {
		this.enqueue({
			id: `req_${++this.requestCounter}`,
			priority: RequestPriority.ABORT,
			type: "abort",
		});
	}

	// Phase 3: AskWithHints
	enqueueAskWithHints(prompt: string, hintsJson: string): Promise<string> {
		let hints: RequestHints = {};
		try {
			hints = JSON.parse(hintsJson);
		} catch {
			// Invalid JSON — proceed without hints
		}
		return new Promise((resolve, reject) => {
			this.enqueue({
				id: `req_${++this.requestCounter}`,
				priority: RequestPriority.ASK,
				type: "askWithHints",
				prompt,
				hints,
				resolve,
				reject,
			});
		});
	}

	// Phase 4: AskAs
	enqueueAskAs(persona: string, prompt: string): Promise<string> {
		return new Promise((resolve, reject) => {
			this.enqueue({
				id: `req_${++this.requestCounter}`,
				priority: RequestPriority.ASK,
				type: "askAs",
				prompt,
				persona,
				resolve,
				reject,
			});
		});
	}

	private enqueue(request: QueuedRequest): void {
		// Insert by priority (lower number = higher priority)
		let insertIdx = this.queue.length;
		for (let i = 0; i < this.queue.length; i++) {
			if (request.priority < this.queue[i].priority) {
				insertIdx = i;
				break;
			}
		}
		this.queue.splice(insertIdx, 0, request);
		this.processQueue();
	}

	private async processQueue(): Promise<void> {
		if (this.processing) return;
		this.processing = true;

		try {
			while (this.queue.length > 0) {
				const request = this.queue.shift()!;
				await this.executeRequest(request);
			}
		} finally {
			this.processing = false;
		}
	}

	private async executeRequest(request: QueuedRequest): Promise<void> {
		try {
			switch (request.type) {
				case "abort":
					await this.rpcClient.abort();
					break;

				case "steer":
					await this.rpcClient.steer(request.prompt!);
					break;

				case "followUp":
					await this.rpcClient.followUp(request.prompt!);
					break;

				case "ask": {
					const response = await this.doAsk(request.prompt!);
					request.resolve?.(response);
					break;
				}

				case "askAsync":
					this.rpcClient.prompt(request.prompt!).catch((err) => {
						this.iface?.Error(String(err));
					});
					break;

				case "askWithHints": {
					// Apply hints before prompting
					if (request.hints?.provider && request.hints?.model) {
						await this.rpcClient.setModel(request.hints.provider, request.hints.model);
					} else if (request.hints?.model) {
						// Try to parse "provider/model" format
						const parts = request.hints.model.split("/");
						if (parts.length === 2) {
							await this.rpcClient.setModel(parts[0], parts[1]);
						}
					}
					if (request.hints?.thinking) {
						await this.rpcClient.setThinkingLevel(request.hints.thinking as any);
					}
					const response = await this.doAsk(request.prompt!);
					request.resolve?.(response);
					break;
				}

				case "askAs": {
					const personaPrompt = this.wrapWithPersona(request.persona!, request.prompt!);
					const response = await this.doAsk(personaPrompt);
					request.resolve?.(response);
					break;
				}
			}
		} catch (err) {
			request.reject?.(err);
		}
	}

	private async doAsk(prompt: string): Promise<string> {
		this.lastResponseText = "";
		const events = await this.rpcClient.promptAndWait(prompt, undefined, 300000);
		const endEvent = events.find((e) => e.type === "agent_end");
		if (endEvent?.type === "agent_end") {
			return extractTextFromMessages(endEvent.messages);
		}
		return this.lastResponseText;
	}

	// --- Phase 4: Persona wrapping ---

	private wrapWithPersona(personaName: string, prompt: string): string {
		const agentsMd = this.resolvePersonaAgentsMd(personaName);
		if (!agentsMd) {
			return `[Persona: ${personaName}]\n\n${prompt}`;
		}
		return `<persona-context name="${personaName}">\n${agentsMd}\n</persona-context>\n\n${prompt}`;
	}

	private resolvePersonaAgentsMd(personaName: string): string | null {
		// Walk up from cwd looking for .pi/agents/{name}/AGENTS.md
		let currentDir = this.options.cwd ?? process.cwd();
		while (true) {
			const candidate = path.join(currentDir, ".pi", "agents", personaName, "AGENTS.md");
			if (fs.existsSync(candidate)) {
				return fs.readFileSync(candidate, "utf-8");
			}
			const parentDir = path.dirname(currentDir);
			if (parentDir === currentDir) return null;
			currentDir = parentDir;
		}
	}

	// --- Phase 1: Session Persistence ---

	private persistSession(): void {
		try {
			const state = (this.rpcClient as any).sessionState;
			if (!state?.sessionFile) return;

			fs.mkdirSync(SESSION_STATE_DIR, { recursive: true });

			const persistence: SessionPersistence = {
				sessionFile: state.sessionFile,
				model: this.currentModel,
				provider: this.options.provider ?? "",
				timestamp: new Date().toISOString(),
			};

			fs.writeFileSync(SESSION_STATE_FILE, JSON.stringify(persistence, null, 2));
			console.log(`[embry-agent] Session persisted: ${state.sessionFile}`);
		} catch (err) {
			console.error(`[embry-agent] Failed to persist session: ${err}`);
		}
	}

	private loadPersistedSession(): string[] {
		try {
			if (!fs.existsSync(SESSION_STATE_FILE)) return [];
			const raw = fs.readFileSync(SESSION_STATE_FILE, "utf-8");
			const persistence: SessionPersistence = JSON.parse(raw);

			if (!persistence.sessionFile) return [];

			// Verify session file still exists
			if (!fs.existsSync(persistence.sessionFile)) {
				console.log(`[embry-agent] Persisted session file gone, starting fresh`);
				return [];
			}

			console.log(`[embry-agent] Resuming session: ${persistence.sessionFile}`);
			return ["--session", persistence.sessionFile];
		} catch {
			return [];
		}
	}

	respondToUI(id: string, response: string): void {
		// Send extension UI response via RPC stdin
		const rpcResponse = { type: "extension_ui_response" as const, id, value: response };
		const proc = (this.rpcClient as any).process;
		if (proc?.stdin) {
			proc.stdin.write(`${JSON.stringify(rpcResponse)}\n`);
		}
	}

	private async startRpcClient(): Promise<void> {
		// Subscribe to RPC events and translate to D-Bus signals
		this.rpcClient.onEvent((event: AgentEvent | RpcExtensionUIRequest) => {
			this.handleRpcEvent(event);
		});

		await this.rpcClient.start();

		// Monitor for process exit to auto-restart
		const proc = (this.rpcClient as any).process;
		if (proc) {
			proc.on("exit", (code: number | null) => {
				if (!this.destroyed) {
					console.error(`[embry-agent] Pi process exited with code ${code}, restarting...`);
					this.iface?.Error(`Pi process exited with code ${code}`);
					this.scheduleRestart();
				}
			});
		}

		// Refresh state
		try {
			const state = await this.rpcClient.getState();
			this.isStreaming = state.isStreaming;
			this.currentModel = state.model ? `${state.model.provider}/${state.model.id}` : "unknown";
			this.sessionName = state.sessionName ?? "";
		} catch {
			// State fetch might fail during init, that's OK
		}

		this.restartAttempts = 0;
	}

	private scheduleRestart(): void {
		if (this.destroyed) return;

		// Persist session before restart
		this.persistSession();

		const delay = Math.min(1000 * 2 ** this.restartAttempts, this.maxRestartDelay);
		this.restartAttempts++;

		console.log(`[embry-agent] Restarting in ${delay}ms (attempt ${this.restartAttempts})`);

		setTimeout(async () => {
			if (this.destroyed) return;
			try {
				// Create a fresh RPC client
				const rpcOptions: RpcClientOptions = {
					cwd: this.options.cwd,
					provider: this.options.provider,
					model: this.options.model,
					cliPath: this.options.cliPath,
					env: { PI_STDIN_TIMEOUT_MS: "0" },
				};

				// Resume persisted session on restart
				const sessionArgs = this.loadPersistedSession();
				if (sessionArgs.length > 0) {
					rpcOptions.args = sessionArgs;
				}

				this.rpcClient = new RpcClient(rpcOptions);
				await this.startRpcClient();
				this.iface?.Ready();
				console.log("[embry-agent] Pi process restarted successfully");
			} catch (err) {
				console.error(`[embry-agent] Restart failed: ${err}`);
				this.iface?.Error(`Restart failed: ${err}`);
				this.scheduleRestart();
			}
		}, delay);
	}

	private handleRpcEvent(event: AgentEvent | RpcExtensionUIRequest): void {
		if (!this.iface) return;

		switch (event.type) {
			case "message_update": {
				// Extract text delta from the assistant message event
				const ame = event.assistantMessageEvent;
				if (ame?.type === "text_delta") {
					this.lastResponseText += ame.delta;
					this.iface.MessageUpdate(ame.delta);
				}
				this.isStreaming = true;
				break;
			}

			case "tool_execution_start":
				this.iface.ToolExecution(event.toolName, JSON.stringify(event.args));
				break;

			case "agent_start":
				this.isStreaming = true;
				break;

			case "agent_end": {
				this.isStreaming = false;
				const text = extractTextFromMessages(event.messages);
				this.iface.AgentEnd(text);
				// Persist session after each agent_end
				this.persistSession();
				break;
			}

			case "extension_ui_request": {
				const uiEvent = event as RpcExtensionUIRequest;
				const title = "title" in uiEvent ? ((uiEvent as any).title ?? "") : "";
				const options =
					"options" in uiEvent
						? JSON.stringify((uiEvent as any).options)
						: "message" in uiEvent
							? (uiEvent as any).message
							: "";
				this.iface.ExtensionUIRequest(uiEvent.id, uiEvent.method, title, options);
				break;
			}
		}
	}
}
