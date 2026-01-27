/**
 * Extension runner - executes extensions and manages their lifecycle.
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { ImageContent, Model } from "@mariozechner/pi-ai";
import type { KeyId } from "@mariozechner/pi-tui";
import { type Theme, theme } from "../../modes/interactive/theme/theme.js";
import type { ResourceDiagnostic } from "../diagnostics.js";
import type { KeyAction, KeybindingsConfig } from "../keybindings.js";
import type { ModelRegistry } from "../model-registry.js";
import type { SessionManager } from "../session-manager.js";
import type { SettingsManager } from "../settings-manager.js";
import type {
	AfterCommandHandler,
	BeforeAgentStartEvent,
	BeforeAgentStartEventResult,
	BeforeCommandHandler,
	CommandDataMap,
	CommandMetadata,
	CommandResult,
	CompactOptions,
	ContextEvent,
	ContextEventResult,
	ContextUsage,
	Extension,
	ExtensionActions,
	ExtensionCommandContext,
	ExtensionCommandContextActions,
	ExtensionContext,
	ExtensionContextActions,
	ExtensionError,
	ExtensionEvent,
	ExtensionFlag,
	ExtensionRuntime,
	ExtensionShortcut,
	ExtensionUIContext,
	InputEvent,
	InputEventResult,
	InputSource,
	MessageRenderer,
	PipelineStageInfo,
	RegisteredCommand,
	RegisteredCommandHandler,
	RegisteredTool,
	SessionBeforeCompactResult,
	SessionBeforeTreeResult,
	ToolCallEvent,
	ToolCallEventResult,
	ToolResultEventResult,
	UserBashEvent,
	UserBashEventResult,
} from "./types.js";

// Keybindings for these actions cannot be overridden by extensions
const RESERVED_ACTIONS_FOR_EXTENSION_CONFLICTS: ReadonlyArray<KeyAction> = [
	"interrupt",
	"clear",
	"exit",
	"suspend",
	"cycleThinkingLevel",
	"cycleModelForward",
	"cycleModelBackward",
	"selectModel",
	"expandTools",
	"toggleThinking",
	"externalEditor",
	"followUp",
	"submit",
	"selectConfirm",
	"selectCancel",
	"copy",
	"deleteToLineEnd",
];

type BuiltInKeyBindings = Partial<Record<KeyId, { action: KeyAction; restrictOverride: boolean }>>;

const buildBuiltinKeybindings = (effectiveKeybindings: Required<KeybindingsConfig>): BuiltInKeyBindings => {
	const builtinKeybindings = {} as BuiltInKeyBindings;
	for (const [action, keys] of Object.entries(effectiveKeybindings)) {
		const keyAction = action as KeyAction;
		const keyList = Array.isArray(keys) ? keys : [keys];
		const restrictOverride = RESERVED_ACTIONS_FOR_EXTENSION_CONFLICTS.includes(keyAction);
		for (const key of keyList) {
			const normalizedKey = key.toLowerCase() as KeyId;
			builtinKeybindings[normalizedKey] = {
				action: keyAction,
				restrictOverride: restrictOverride,
			};
		}
	}
	return builtinKeybindings;
};

/** Combined result from all before_agent_start handlers */
interface BeforeAgentStartCombinedResult {
	messages?: NonNullable<BeforeAgentStartEventResult["message"]>[];
	systemPrompt?: string;
}

export type ExtensionErrorListener = (error: ExtensionError) => void;

export type NewSessionHandler = (options?: {
	parentSession?: string;
	setup?: (sessionManager: SessionManager) => Promise<void>;
}) => Promise<{ cancelled: boolean }>;

export type ForkHandler = (entryId: string) => Promise<{ cancelled: boolean }>;

export type NavigateTreeHandler = (
	targetId: string,
	options?: { summarize?: boolean; customInstructions?: string; replaceInstructions?: boolean; label?: string },
) => Promise<{ cancelled: boolean }>;

export type ShutdownHandler = () => void;

/**
 * Helper function to emit session_shutdown event to extensions.
 * Returns true if the event was emitted, false if there were no handlers.
 */
export async function emitSessionShutdownEvent(extensionRunner: ExtensionRunner | undefined): Promise<boolean> {
	if (extensionRunner?.hasHandlers("session_shutdown")) {
		await extensionRunner.emit({
			type: "session_shutdown",
		});
		return true;
	}
	return false;
}

const noOpUIContext: ExtensionUIContext = {
	select: async () => undefined,
	confirm: async () => false,
	input: async () => undefined,
	notify: () => {},
	setStatus: () => {},
	setWorkingMessage: () => {},
	setWidget: () => {},
	setFooter: () => {},
	setHeader: () => {},
	setTitle: () => {},
	custom: async () => undefined as never,
	setEditorText: () => {},
	getEditorText: () => "",
	editor: async () => undefined,
	setEditorComponent: () => {},
	get theme() {
		return theme;
	},
	getAllThemes: () => [],
	getTheme: () => undefined,
	setTheme: (_theme: string | Theme) => ({ success: false, error: "UI not available" }),
};

export class ExtensionRunner {
	private extensions: Extension[];
	private runtime: ExtensionRuntime;
	private uiContext: ExtensionUIContext;
	private cwd: string;
	private sessionManager: SessionManager;
	private modelRegistry: ModelRegistry;
	private settingsManager: SettingsManager | undefined;
	private errorListeners: Set<ExtensionErrorListener> = new Set();
	private getModel: () => Model<any> | undefined = () => undefined;
	private isIdleFn: () => boolean = () => true;
	private waitForIdleFn: () => Promise<void> = async () => {};
	private abortFn: () => void = () => {};
	private hasPendingMessagesFn: () => boolean = () => false;
	private getContextUsageFn: () => ContextUsage | undefined = () => undefined;
	private compactFn: (options?: CompactOptions) => void = () => {};
	private newSessionHandler: NewSessionHandler = async () => ({ cancelled: false });
	private forkHandler: ForkHandler = async () => ({ cancelled: false });
	private navigateTreeHandler: NavigateTreeHandler = async () => ({ cancelled: false });
	private shutdownHandler: ShutdownHandler = () => {};
	private shortcutDiagnostics: ResourceDiagnostic[] = [];
	private commandHandlers: Map<string, RegisteredCommandHandler[]> = new Map();
	private executingCommands: Set<string> = new Set();

	constructor(
		extensions: Extension[],
		runtime: ExtensionRuntime,
		cwd: string,
		sessionManager: SessionManager,
		modelRegistry: ModelRegistry,
		settingsManager?: SettingsManager,
	) {
		this.extensions = extensions;
		this.runtime = runtime;
		this.uiContext = noOpUIContext;
		this.cwd = cwd;
		this.sessionManager = sessionManager;
		this.modelRegistry = modelRegistry;
		this.settingsManager = settingsManager;
		this.commandHandlers = this.collectCommandHandlers();
	}

	bindCore(actions: ExtensionActions, contextActions: ExtensionContextActions): void {
		// Copy actions into the shared runtime (all extension APIs reference this)
		this.runtime.sendMessage = actions.sendMessage;
		this.runtime.sendUserMessage = actions.sendUserMessage;
		this.runtime.appendEntry = actions.appendEntry;
		this.runtime.setSessionName = actions.setSessionName;
		this.runtime.getSessionName = actions.getSessionName;
		this.runtime.setLabel = actions.setLabel;
		this.runtime.getActiveTools = actions.getActiveTools;
		this.runtime.getAllTools = actions.getAllTools;
		this.runtime.setActiveTools = actions.setActiveTools;
		this.runtime.getPipeline = (command) => this.getPipeline(command);
		this.runtime.setModel = actions.setModel;
		this.runtime.getThinkingLevel = actions.getThinkingLevel;
		this.runtime.setThinkingLevel = actions.setThinkingLevel;

		// Context actions (required)
		this.getModel = contextActions.getModel;
		this.isIdleFn = contextActions.isIdle;
		this.abortFn = contextActions.abort;
		this.hasPendingMessagesFn = contextActions.hasPendingMessages;
		this.shutdownHandler = contextActions.shutdown;
		this.getContextUsageFn = contextActions.getContextUsage;
		this.compactFn = contextActions.compact;

		// Process provider registrations queued during extension loading
		for (const { name, config } of this.runtime.pendingProviderRegistrations) {
			this.modelRegistry.registerProvider(name, config);
		}
		this.runtime.pendingProviderRegistrations = [];
	}

	bindCommandContext(actions?: ExtensionCommandContextActions): void {
		if (actions) {
			this.waitForIdleFn = actions.waitForIdle;
			this.newSessionHandler = actions.newSession;
			this.forkHandler = actions.fork;
			this.navigateTreeHandler = actions.navigateTree;
			return;
		}

		this.waitForIdleFn = async () => {};
		this.newSessionHandler = async () => ({ cancelled: false });
		this.forkHandler = async () => ({ cancelled: false });
		this.navigateTreeHandler = async () => ({ cancelled: false });
	}

	setUIContext(uiContext?: ExtensionUIContext): void {
		this.uiContext = uiContext ?? noOpUIContext;
	}

	getUIContext(): ExtensionUIContext {
		return this.uiContext;
	}

	hasUI(): boolean {
		return this.uiContext !== noOpUIContext;
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

	/** Get a tool definition by name. Returns undefined if not found. */
	getToolDefinition(toolName: string): RegisteredTool["definition"] | undefined {
		for (const ext of this.extensions) {
			const tool = ext.tools.get(toolName);
			if (tool) {
				return tool.definition;
			}
		}
		return undefined;
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
		this.runtime.flagValues.set(name, value);
	}

	getFlagValues(): Map<string, boolean | string> {
		return new Map(this.runtime.flagValues);
	}

	getShortcuts(effectiveKeybindings: Required<KeybindingsConfig>): Map<KeyId, ExtensionShortcut> {
		this.shortcutDiagnostics = [];
		const builtinKeybindings = buildBuiltinKeybindings(effectiveKeybindings);
		const extensionShortcuts = new Map<KeyId, ExtensionShortcut>();

		const addDiagnostic = (message: string, extensionPath: string) => {
			this.shortcutDiagnostics.push({ type: "warning", message, path: extensionPath });
			if (!this.hasUI()) {
				console.warn(message);
			}
		};

		for (const ext of this.extensions) {
			for (const [key, shortcut] of ext.shortcuts) {
				const normalizedKey = key.toLowerCase() as KeyId;

				const builtInKeybinding = builtinKeybindings[normalizedKey];
				if (builtInKeybinding?.restrictOverride === true) {
					addDiagnostic(
						`Extension shortcut '${key}' from ${shortcut.extensionPath} conflicts with built-in shortcut. Skipping.`,
						shortcut.extensionPath,
					);
					continue;
				}

				if (builtInKeybinding?.restrictOverride === false) {
					addDiagnostic(
						`Extension shortcut conflict: '${key}' is built-in shortcut for ${builtInKeybinding.action} and ${shortcut.extensionPath}. Using ${shortcut.extensionPath}.`,
						shortcut.extensionPath,
					);
				}

				const existingExtensionShortcut = extensionShortcuts.get(normalizedKey);
				if (existingExtensionShortcut) {
					addDiagnostic(
						`Extension shortcut conflict: '${key}' registered by both ${existingExtensionShortcut.extensionPath} and ${shortcut.extensionPath}. Using ${shortcut.extensionPath}.`,
						shortcut.extensionPath,
					);
				}
				extensionShortcuts.set(normalizedKey, shortcut);
			}
		}
		return extensionShortcuts;
	}

	getShortcutDiagnostics(): ResourceDiagnostic[] {
		return this.shortcutDiagnostics;
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

	private collectCommandHandlers(): Map<string, RegisteredCommandHandler[]> {
		const collected = new Map<string, RegisteredCommandHandler[]>();
		const seenByCommand = new Map<string, Set<string>>();

		for (const ext of this.extensions) {
			for (const [command, handlers] of ext.commandHandlers) {
				const list = collected.get(command) ?? [];
				const seen = seenByCommand.get(command) ?? new Set<string>();

				for (const handler of handlers) {
					if (seen.has(handler.id)) {
						console.warn(
							`Warning: duplicate command handler id '${handler.id}' for '${command}' in ${handler.extensionPath}.`,
						);
					} else {
						seen.add(handler.id);
					}
					list.push(handler);
				}

				collected.set(command, list);
				seenByCommand.set(command, seen);
			}
		}

		return collected;
	}

	/**
	 * Request a graceful shutdown. Called by extension tools and event handlers.
	 * The actual shutdown behavior is provided by the mode via bindExtensions().
	 */
	shutdown(): void {
		this.shutdownHandler();
	}

	/**
	 * Create an ExtensionContext for use in event handlers and tool execution.
	 * Context values are resolved at call time, so changes via bindCore/bindUI are reflected.
	 */
	createContext(): ExtensionContext {
		const getModel = this.getModel;
		return {
			ui: this.uiContext,
			hasUI: this.hasUI(),
			cwd: this.cwd,
			sessionManager: this.sessionManager,
			modelRegistry: this.modelRegistry,
			get model() {
				return getModel();
			},
			isIdle: () => this.isIdleFn(),
			abort: () => this.abortFn(),
			hasPendingMessages: () => this.hasPendingMessagesFn(),
			shutdown: () => this.shutdownHandler(),
			getContextUsage: () => this.getContextUsageFn(),
			compact: (options) => this.compactFn(options),
		};
	}

	createCommandContext(): ExtensionCommandContext {
		return {
			...this.createContext(),
			waitForIdle: () => this.waitForIdleFn(),
			newSession: (options) => this.newSessionHandler(options),
			fork: (entryId) => this.forkHandler(entryId),
			navigateTree: (targetId, options) => this.navigateTreeHandler(targetId, options),
		};
	}

	hasCommandHandlers(command: keyof CommandDataMap): boolean {
		return (this.commandHandlers.get(command)?.length ?? 0) > 0;
	}

	getPipeline(command: keyof CommandDataMap): PipelineStageInfo[] {
		const ordered = this.getOrderedCommandHandlers(command, { includeDisabled: true });
		const disabled = this.getDisabledCommandHandlerIds(command);

		return ordered.map((handler) => ({
			id: handler.id,
			label: handler.label,
			phase: handler.phase,
			transforms: [...handler.transforms],
			extensionPath: handler.extensionPath,
			enabled: !disabled.has(handler.id),
		}));
	}

	async dispatchCommand<K extends keyof CommandDataMap>(
		command: K,
		initialData: CommandDataMap[K],
		executeBuiltIn: (data: CommandDataMap[K], metadata: CommandMetadata) => Promise<CommandResult>,
	): Promise<{ cancelled: boolean; result?: CommandResult }> {
		if (this.executingCommands.has(command)) {
			const result = await executeBuiltIn(initialData, {});
			return { cancelled: false, result };
		}

		this.executingCommands.add(command);

		try {
			const orderedHandlers = this.getOrderedCommandHandlers(command, { includeDisabled: false });
			const beforeHandlers = orderedHandlers.filter((handler) => handler.phase === "before");
			const afterHandlers = orderedHandlers.filter((handler) => handler.phase === "after");

			let currentData = structuredClone(initialData);
			let metadata: CommandMetadata = {};

			for (const handlerInfo of beforeHandlers) {
				try {
					const result = await (handlerInfo.handler as BeforeCommandHandler<K>)(currentData, this.createContext());

					if (!result) {
						continue;
					}

					if (result.cancel) {
						return { cancelled: true };
					}

					if (result.data) {
						this.warnOnUnexpectedTransforms(command, handlerInfo, result.data);
						currentData = { ...currentData, ...result.data };
					}

					if (result.metadata) {
						metadata = { ...metadata, ...result.metadata };
					}
				} catch (err) {
					this.emitError({
						extensionPath: handlerInfo.extensionPath,
						event: `beforeCommand:${command}`,
						error: err instanceof Error ? err.message : String(err),
						stack: err instanceof Error ? err.stack : undefined,
					});
				}
			}

			const result = await executeBuiltIn(currentData, metadata);

			if (afterHandlers.length > 0) {
				const afterData = { ...currentData, result, metadata };
				await Promise.allSettled(
					afterHandlers.map(async (handlerInfo) => {
						try {
							await (handlerInfo.handler as AfterCommandHandler<K>)(afterData, this.createContext());
						} catch (err) {
							this.emitError({
								extensionPath: handlerInfo.extensionPath,
								event: `afterCommand:${command}`,
								error: err instanceof Error ? err.message : String(err),
								stack: err instanceof Error ? err.stack : undefined,
							});
						}
					}),
				);
			}

			return { cancelled: false, result };
		} finally {
			this.executingCommands.delete(command);
		}
	}

	private getOrderedCommandHandlers(
		command: keyof CommandDataMap,
		options: { includeDisabled: boolean },
	): RegisteredCommandHandler[] {
		const handlers = this.commandHandlers.get(command) ?? [];
		const disabled = this.getDisabledCommandHandlerIds(command);
		const order = this.settingsManager?.getPipelineConfig(command)?.order ?? [];
		const orderIndex = new Map(order.map((id, index) => [id, index]));

		const withIndex = handlers.map((handler, index) => ({
			handler,
			index,
			orderIndex: orderIndex.get(handler.id),
		}));

		const sorted = withIndex.sort((a, b) => {
			const aOrder = a.orderIndex ?? Number.POSITIVE_INFINITY;
			const bOrder = b.orderIndex ?? Number.POSITIVE_INFINITY;
			if (aOrder !== bOrder) {
				return aOrder - bOrder;
			}
			return a.index - b.index;
		});

		const ordered = sorted.map((entry) => entry.handler);
		if (options.includeDisabled) {
			return ordered;
		}

		return ordered.filter((handler) => !disabled.has(handler.id));
	}

	private getDisabledCommandHandlerIds(command: keyof CommandDataMap): Set<string> {
		const disabled = this.settingsManager?.getPipelineConfig(command)?.disabled ?? [];
		return new Set(disabled);
	}

	private warnOnUnexpectedTransforms(
		command: keyof CommandDataMap,
		handler: RegisteredCommandHandler,
		data: Partial<CommandDataMap[keyof CommandDataMap]>,
	): void {
		const declared = new Set(handler.transforms);
		const keys = Object.keys(data);
		const unexpected = keys.filter((key) => !declared.has(key));

		if (unexpected.length === 0) {
			return;
		}

		const transformsLabel = handler.transforms.length > 0 ? handler.transforms.join(", ") : "(none)";
		console.warn(
			`Warning: beforeCommand handler '${handler.id}' for '${command}' returned data for [${unexpected.join(
				", ",
			)}] but declared transforms [${transformsLabel}].`,
		);
	}

	private isSessionBeforeEvent(
		type: string,
	): type is "session_before_switch" | "session_before_fork" | "session_before_compact" | "session_before_tree" {
		return (
			type === "session_before_switch" ||
			type === "session_before_fork" ||
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

	async emitUserBash(event: UserBashEvent): Promise<UserBashEventResult | undefined> {
		const ctx = this.createContext();

		for (const ext of this.extensions) {
			const handlers = ext.handlers.get("user_bash");
			if (!handlers || handlers.length === 0) continue;

			for (const handler of handlers) {
				try {
					const handlerResult = await handler(event, ctx);
					if (handlerResult) {
						return handlerResult as UserBashEventResult;
					}
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					const stack = err instanceof Error ? err.stack : undefined;
					this.emitError({
						extensionPath: ext.path,
						event: "user_bash",
						error: message,
						stack,
					});
				}
			}
		}

		return undefined;
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
		images: ImageContent[] | undefined,
		systemPrompt: string,
	): Promise<BeforeAgentStartCombinedResult | undefined> {
		const ctx = this.createContext();
		const messages: NonNullable<BeforeAgentStartEventResult["message"]>[] = [];
		let currentSystemPrompt = systemPrompt;
		let systemPromptModified = false;

		for (const ext of this.extensions) {
			const handlers = ext.handlers.get("before_agent_start");
			if (!handlers || handlers.length === 0) continue;

			for (const handler of handlers) {
				try {
					const event: BeforeAgentStartEvent = {
						type: "before_agent_start",
						prompt,
						images,
						systemPrompt: currentSystemPrompt,
					};
					const handlerResult = await handler(event, ctx);

					if (handlerResult) {
						const result = handlerResult as BeforeAgentStartEventResult;
						if (result.message) {
							messages.push(result.message);
						}
						if (result.systemPrompt !== undefined) {
							currentSystemPrompt = result.systemPrompt;
							systemPromptModified = true;
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

		if (messages.length > 0 || systemPromptModified) {
			return {
				messages: messages.length > 0 ? messages : undefined,
				systemPrompt: systemPromptModified ? currentSystemPrompt : undefined,
			};
		}

		return undefined;
	}

	/** Emit input event. Transforms chain, "handled" short-circuits. */
	async emitInput(text: string, images: ImageContent[] | undefined, source: InputSource): Promise<InputEventResult> {
		const ctx = this.createContext();
		let currentText = text;
		let currentImages = images;

		for (const ext of this.extensions) {
			for (const handler of ext.handlers.get("input") ?? []) {
				try {
					const event: InputEvent = { type: "input", text: currentText, images: currentImages, source };
					const result = (await handler(event, ctx)) as InputEventResult | undefined;
					if (result?.action === "handled") return result;
					if (result?.action === "transform") {
						currentText = result.text;
						currentImages = result.images ?? currentImages;
					}
				} catch (err) {
					this.emitError({
						extensionPath: ext.path,
						event: "input",
						error: err instanceof Error ? err.message : String(err),
						stack: err instanceof Error ? err.stack : undefined,
					});
				}
			}
		}
		return currentText !== text || currentImages !== images
			? { action: "transform", text: currentText, images: currentImages }
			: { action: "continue" };
	}
}
