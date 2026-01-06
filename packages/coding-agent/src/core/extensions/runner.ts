/**
 * Extension runner - executes extensions and manages their lifecycle.
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { ImageContent, Model } from "@mariozechner/pi-ai";
import type { KeyId } from "@mariozechner/pi-tui";
import { theme } from "../../modes/interactive/theme/theme.js";
import type { ModelRegistry } from "../model-registry.js";
import type { SessionManager } from "../session-manager.js";
import type {
	AppendEntryHandler,
	BeforeAgentStartEvent,
	BeforeAgentStartEventResult,
	ContextEvent,
	ContextEventResult,
	ExtensionCommandContext,
	ExtensionContext,
	ExtensionError,
	ExtensionEvent,
	ExtensionFlag,
	ExtensionShortcut,
	ExtensionUIContext,
	GetActiveToolsHandler,
	GetAllToolsHandler,
	LoadedExtension,
	MessageRenderer,
	RegisteredCommand,
	RegisteredTool,
	SendMessageHandler,
	SessionBeforeCompactResult,
	SessionBeforeTreeResult,
	SetActiveToolsHandler,
	ToolCallEvent,
	ToolCallEventResult,
	ToolResultEventResult,
} from "./types.js";

/** Combined result from all before_agent_start handlers */
interface BeforeAgentStartCombinedResult {
	messages?: NonNullable<BeforeAgentStartEventResult["message"]>[];
	systemPromptAppend?: string;
}

export type ExtensionErrorListener = (error: ExtensionError) => void;

export type NewSessionHandler = (options?: {
	parentSession?: string;
	setup?: (sessionManager: SessionManager) => Promise<void>;
}) => Promise<{ cancelled: boolean }>;

export type BranchHandler = (entryId: string) => Promise<{ cancelled: boolean }>;

export type NavigateTreeHandler = (
	targetId: string,
	options?: { summarize?: boolean },
) => Promise<{ cancelled: boolean }>;

const noOpUIContext: ExtensionUIContext = {
	select: async () => undefined,
	confirm: async () => false,
	input: async () => undefined,
	notify: () => {},
	setStatus: () => {},
	setWidget: () => {},
	setFooter: () => {},
	setTitle: () => {},
	custom: async () => undefined as never,
	setEditorText: () => {},
	getEditorText: () => "",
	editor: async () => undefined,
	get theme() {
		return theme;
	},
};

export class ExtensionRunner {
	private extensions: LoadedExtension[];
	private uiContext: ExtensionUIContext;
	private hasUI: boolean;
	private cwd: string;
	private sessionManager: SessionManager;
	private modelRegistry: ModelRegistry;
	private errorListeners: Set<ExtensionErrorListener> = new Set();
	private getModel: () => Model<any> | undefined = () => undefined;
	private isIdleFn: () => boolean = () => true;
	private waitForIdleFn: () => Promise<void> = async () => {};
	private abortFn: () => void = () => {};
	private hasPendingMessagesFn: () => boolean = () => false;
	private newSessionHandler: NewSessionHandler = async () => ({ cancelled: false });
	private branchHandler: BranchHandler = async () => ({ cancelled: false });
	private navigateTreeHandler: NavigateTreeHandler = async () => ({ cancelled: false });

	constructor(
		extensions: LoadedExtension[],
		cwd: string,
		sessionManager: SessionManager,
		modelRegistry: ModelRegistry,
	) {
		this.extensions = extensions;
		this.uiContext = noOpUIContext;
		this.hasUI = false;
		this.cwd = cwd;
		this.sessionManager = sessionManager;
		this.modelRegistry = modelRegistry;
	}

	initialize(options: {
		getModel: () => Model<any> | undefined;
		sendMessageHandler: SendMessageHandler;
		appendEntryHandler: AppendEntryHandler;
		getActiveToolsHandler: GetActiveToolsHandler;
		getAllToolsHandler: GetAllToolsHandler;
		setActiveToolsHandler: SetActiveToolsHandler;
		newSessionHandler?: NewSessionHandler;
		branchHandler?: BranchHandler;
		navigateTreeHandler?: NavigateTreeHandler;
		isIdle?: () => boolean;
		waitForIdle?: () => Promise<void>;
		abort?: () => void;
		hasPendingMessages?: () => boolean;
		uiContext?: ExtensionUIContext;
		hasUI?: boolean;
	}): void {
		this.getModel = options.getModel;
		this.isIdleFn = options.isIdle ?? (() => true);
		this.waitForIdleFn = options.waitForIdle ?? (async () => {});
		this.abortFn = options.abort ?? (() => {});
		this.hasPendingMessagesFn = options.hasPendingMessages ?? (() => false);

		if (options.newSessionHandler) {
			this.newSessionHandler = options.newSessionHandler;
		}
		if (options.branchHandler) {
			this.branchHandler = options.branchHandler;
		}
		if (options.navigateTreeHandler) {
			this.navigateTreeHandler = options.navigateTreeHandler;
		}

		for (const ext of this.extensions) {
			ext.setSendMessageHandler(options.sendMessageHandler);
			ext.setAppendEntryHandler(options.appendEntryHandler);
			ext.setGetActiveToolsHandler(options.getActiveToolsHandler);
			ext.setGetAllToolsHandler(options.getAllToolsHandler);
			ext.setSetActiveToolsHandler(options.setActiveToolsHandler);
		}

		this.uiContext = options.uiContext ?? noOpUIContext;
		this.hasUI = options.hasUI ?? false;
	}

	getUIContext(): ExtensionUIContext | null {
		return this.uiContext;
	}

	getHasUI(): boolean {
		return this.hasUI;
	}

	getExtensionPaths(): string[] {
		return this.extensions.map((e) => e.path);
	}

	/** Get all registered tools from all extensions. */
	getAllRegisteredTools(): RegisteredTool[] {
		const tools: RegisteredTool[] = [];
		for (const ext of this.extensions) {
			for (const tool of ext.tools.values()) {
				tools.push(tool);
			}
		}
		return tools;
	}

	getFlags(): Map<string, ExtensionFlag> {
		const allFlags = new Map<string, ExtensionFlag>();
		for (const ext of this.extensions) {
			for (const [name, flag] of ext.flags) {
				allFlags.set(name, flag);
			}
		}
		return allFlags;
	}

	setFlagValue(name: string, value: boolean | string): void {
		for (const ext of this.extensions) {
			if (ext.flags.has(name)) {
				ext.setFlagValue(name, value);
			}
		}
	}

	private static readonly RESERVED_SHORTCUTS = new Set([
		"ctrl+c",
		"ctrl+d",
		"ctrl+z",
		"ctrl+k",
		"ctrl+p",
		"ctrl+l",
		"ctrl+o",
		"ctrl+t",
		"ctrl+g",
		"shift+tab",
		"shift+ctrl+p",
		"alt+enter",
		"escape",
		"enter",
	]);

	getShortcuts(): Map<KeyId, ExtensionShortcut> {
		const allShortcuts = new Map<KeyId, ExtensionShortcut>();
		for (const ext of this.extensions) {
			for (const [key, shortcut] of ext.shortcuts) {
				const normalizedKey = key.toLowerCase() as KeyId;

				if (ExtensionRunner.RESERVED_SHORTCUTS.has(normalizedKey)) {
					console.warn(
						`Extension shortcut '${key}' from ${shortcut.extensionPath} conflicts with built-in shortcut. Skipping.`,
					);
					continue;
				}

				const existing = allShortcuts.get(normalizedKey);
				if (existing) {
					console.warn(
						`Extension shortcut conflict: '${key}' registered by both ${existing.extensionPath} and ${shortcut.extensionPath}. Using ${shortcut.extensionPath}.`,
					);
				}
				allShortcuts.set(normalizedKey, shortcut);
			}
		}
		return allShortcuts;
	}

	onError(listener: ExtensionErrorListener): () => void {
		this.errorListeners.add(listener);
		return () => this.errorListeners.delete(listener);
	}

	emitError(error: ExtensionError): void {
		for (const listener of this.errorListeners) {
			listener(error);
		}
	}

	hasHandlers(eventType: string): boolean {
		for (const ext of this.extensions) {
			const handlers = ext.handlers.get(eventType);
			if (handlers && handlers.length > 0) {
				return true;
			}
		}
		return false;
	}

	getMessageRenderer(customType: string): MessageRenderer | undefined {
		for (const ext of this.extensions) {
			const renderer = ext.messageRenderers.get(customType);
			if (renderer) {
				return renderer;
			}
		}
		return undefined;
	}

	getRegisteredCommands(): RegisteredCommand[] {
		const commands: RegisteredCommand[] = [];
		for (const ext of this.extensions) {
			for (const command of ext.commands.values()) {
				commands.push(command);
			}
		}
		return commands;
	}

	getCommand(name: string): RegisteredCommand | undefined {
		for (const ext of this.extensions) {
			const command = ext.commands.get(name);
			if (command) {
				return command;
			}
		}
		return undefined;
	}

	private createContext(): ExtensionContext {
		return {
			ui: this.uiContext,
			hasUI: this.hasUI,
			cwd: this.cwd,
			sessionManager: this.sessionManager,
			modelRegistry: this.modelRegistry,
			model: this.getModel(),
			isIdle: () => this.isIdleFn(),
			abort: () => this.abortFn(),
			hasPendingMessages: () => this.hasPendingMessagesFn(),
		};
	}

	createCommandContext(): ExtensionCommandContext {
		return {
			...this.createContext(),
			waitForIdle: () => this.waitForIdleFn(),
			newSession: (options) => this.newSessionHandler(options),
			branch: (entryId) => this.branchHandler(entryId),
			navigateTree: (targetId, options) => this.navigateTreeHandler(targetId, options),
		};
	}

	private isSessionBeforeEvent(
		type: string,
	): type is "session_before_switch" | "session_before_branch" | "session_before_compact" | "session_before_tree" {
		return (
			type === "session_before_switch" ||
			type === "session_before_branch" ||
			type === "session_before_compact" ||
			type === "session_before_tree"
		);
	}

	async emit(
		event: ExtensionEvent,
	): Promise<SessionBeforeCompactResult | SessionBeforeTreeResult | ToolResultEventResult | undefined> {
		const ctx = this.createContext();
		let result: SessionBeforeCompactResult | SessionBeforeTreeResult | ToolResultEventResult | undefined;

		for (const ext of this.extensions) {
			const handlers = ext.handlers.get(event.type);
			if (!handlers || handlers.length === 0) continue;

			for (const handler of handlers) {
				try {
					const handlerResult = await handler(event, ctx);

					if (this.isSessionBeforeEvent(event.type) && handlerResult) {
						result = handlerResult as SessionBeforeCompactResult | SessionBeforeTreeResult;
						if (result.cancel) {
							return result;
						}
					}

					if (event.type === "tool_result" && handlerResult) {
						result = handlerResult as ToolResultEventResult;
					}
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					const stack = err instanceof Error ? err.stack : undefined;
					this.emitError({
						extensionPath: ext.path,
						event: event.type,
						error: message,
						stack,
					});
				}
			}
		}

		return result;
	}

	async emitToolCall(event: ToolCallEvent): Promise<ToolCallEventResult | undefined> {
		const ctx = this.createContext();
		let result: ToolCallEventResult | undefined;

		for (const ext of this.extensions) {
			const handlers = ext.handlers.get("tool_call");
			if (!handlers || handlers.length === 0) continue;

			for (const handler of handlers) {
				const handlerResult = await handler(event, ctx);

				if (handlerResult) {
					result = handlerResult as ToolCallEventResult;
					if (result.block) {
						return result;
					}
				}
			}
		}

		return result;
	}

	async emitContext(messages: AgentMessage[]): Promise<AgentMessage[]> {
		const ctx = this.createContext();
		let currentMessages = structuredClone(messages);

		for (const ext of this.extensions) {
			const handlers = ext.handlers.get("context");
			if (!handlers || handlers.length === 0) continue;

			for (const handler of handlers) {
				try {
					const event: ContextEvent = { type: "context", messages: currentMessages };
					const handlerResult = await handler(event, ctx);

					if (handlerResult && (handlerResult as ContextEventResult).messages) {
						currentMessages = (handlerResult as ContextEventResult).messages!;
					}
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					const stack = err instanceof Error ? err.stack : undefined;
					this.emitError({
						extensionPath: ext.path,
						event: "context",
						error: message,
						stack,
					});
				}
			}
		}

		return currentMessages;
	}

	async emitBeforeAgentStart(
		prompt: string,
		images?: ImageContent[],
	): Promise<BeforeAgentStartCombinedResult | undefined> {
		const ctx = this.createContext();
		const messages: NonNullable<BeforeAgentStartEventResult["message"]>[] = [];
		const systemPromptAppends: string[] = [];

		for (const ext of this.extensions) {
			const handlers = ext.handlers.get("before_agent_start");
			if (!handlers || handlers.length === 0) continue;

			for (const handler of handlers) {
				try {
					const event: BeforeAgentStartEvent = { type: "before_agent_start", prompt, images };
					const handlerResult = await handler(event, ctx);

					if (handlerResult) {
						const result = handlerResult as BeforeAgentStartEventResult;
						if (result.message) {
							messages.push(result.message);
						}
						if (result.systemPromptAppend) {
							systemPromptAppends.push(result.systemPromptAppend);
						}
					}
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					const stack = err instanceof Error ? err.stack : undefined;
					this.emitError({
						extensionPath: ext.path,
						event: "before_agent_start",
						error: message,
						stack,
					});
				}
			}
		}

		if (messages.length > 0 || systemPromptAppends.length > 0) {
			return {
				messages: messages.length > 0 ? messages : undefined,
				systemPromptAppend: systemPromptAppends.length > 0 ? systemPromptAppends.join("\n\n") : undefined,
			};
		}

		return undefined;
	}
}
