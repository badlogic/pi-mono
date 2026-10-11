import { copyJson, type Draft } from "@earendil-works/chord";
import { defineDoc } from "../documents.ts";
import { documentRetention } from "../session/session.ts";
import type { ConversationId, ConversationRecord, Tx } from "../types.ts";
import type {
	Agent,
	AgentChange,
	AgentState,
	CompactionPolicy,
	ConversationRetryPolicy,
	Extension,
	HarnessSettings,
	ProgressPolicy,
	PromptSection,
	RegistrySnapshot,
	Settings,
	ToolRegistration,
} from "./types.ts";

export const DEFAULT_RETRY_POLICY: ConversationRetryPolicy = {
	enabled: true,
	maxRetries: 3,
	baseDelayMs: 2000,
	maxAgentDelayMs: 60000,
};

export const DEFAULT_COMPACTION_POLICY: CompactionPolicy = {
	enabled: true,
	reserveTokens: 16384,
	keepRecentTokens: 20000,
	backgroundTokens: 32768,
};

export const DEFAULT_PROGRESS_POLICY: ProgressPolicy = {
	partialIntervalMs: 100,
	outputIntervalMs: 100,
};

/** The reserved section key of the agent's `instructions`. */
export const INSTRUCTIONS_KEY = "instructions";

/** Built-in agent document; rewindable so forks start from the agent at their fork entry. */
export const AgentDoc = defineDoc<AgentState>({
	kind: "pi.agent",
	version: 1,
	scope: "conversation",
	history: "rewindable",
	fork: "asOf",
	initial: () => ({}),
	checkpointWhen: () => true,
});

/** Default `settings.contextRetentionMs`: ten minutes. */
const DEFAULT_CONTEXT_RETENTION_MS = 600_000;

/** Resolve the host settings: every field over its built-in default, object fields merged. */
export function resolveSettings(settings: HarnessSettings | undefined): Settings {
	const extensions = settings?.extensions;
	return {
		...(extensions === undefined ? {} : { extensions }),
		stream: { ...settings?.stream },
		retry: { ...DEFAULT_RETRY_POLICY, ...settings?.retry },
		compaction: { ...DEFAULT_COMPACTION_POLICY, ...settings?.compaction },
		// Field by field, so an explicitly undefined interval keeps its default.
		progress: {
			partialIntervalMs: settings?.progress?.partialIntervalMs ?? DEFAULT_PROGRESS_POLICY.partialIntervalMs,
			outputIntervalMs: settings?.progress?.outputIntervalMs ?? DEFAULT_PROGRESS_POLICY.outputIntervalMs,
		},
		toolExecution: settings?.toolExecution ?? "parallel",
		steeringMode: settings?.steeringMode ?? "one-at-a-time",
		followUpMode: settings?.followUpMode ?? "one-at-a-time",
		contextRetentionMs: settings?.contextRetentionMs ?? DEFAULT_CONTEXT_RETENTION_MS,
		documentRetentionMs: documentRetention(settings?.documentRetentionMs),
	};
}

/** Apply one change to `pi.agent`: a given field replaces the stored one, `null` clears it, `undefined` changes nothing. */
export async function configure(tx: Tx, conversationId: ConversationId, change: AgentChange): Promise<void> {
	const state = await tx.doc(AgentDoc, conversationId);
	applyChange(state, change);
}

/**
 * `addTools` of a tool round, applied to `tools` and `modelTools`, so the next request offers the tools: an array gets
 * each name it lacks appended, `{ remove }` loses the names, and an unset filter already lets every tool through, so
 * nothing is written.
 */
export async function addTools(tx: Tx, conversationId: ConversationId, added: readonly string[]): Promise<void> {
	const state = await tx.doc(AgentDoc, conversationId);
	for (const field of ["tools", "modelTools"] as const) {
		const filter = state[field];
		if (filter === undefined) continue;
		if (Array.isArray(filter)) {
			for (const name of added) if (!filter.includes(name)) filter.push(name);
		} else {
			const remove = (filter as { remove: string[] }).remove;
			if (remove.some((name) => added.includes(name))) {
				state[field] = { remove: remove.filter((name) => !added.includes(name)) };
			}
		}
	}
}

function applyChange(state: Draft<AgentState>, change: AgentChange): void {
	const set = <K extends keyof AgentState>(key: K, value: AgentState[K] | null | undefined) => {
		if (value === undefined) return;
		if (value === null) delete state[key];
		else state[key] = value as Draft<AgentState>[K];
	};
	set("model", change.model === undefined || change.model === null ? change.model : { ...change.model });
	set("thinkingLevel", change.thinkingLevel);
	const extensions = change.extensions;
	set(
		"extensions",
		extensions === undefined || extensions === null
			? extensions
			: isList(extensions)
				? names(extensions)
				: {
						...(extensions.add === undefined ? {} : { add: names(extensions.add) }),
						...(extensions.remove === undefined ? {} : { remove: names(extensions.remove) }),
					},
	);
	for (const field of ["tools", "modelTools"] as const) {
		const filter = change[field];
		set(
			field,
			filter === undefined || filter === null
				? filter
				: isList(filter)
					? names(filter)
					: { remove: names(filter.remove) },
		);
	}
	set("instructions", change.instructions);
	set("cwd", change.cwd);
}

function isList<T>(value: readonly T[] | object): value is readonly T[] {
	return Array.isArray(value);
}

function names(items: readonly { readonly name: string }[]): string[] {
	return items.map((item) => item.name);
}

/**
 * Built-in part of every Harness commit that creates or forks a conversation, for `pi.agent`: a fork keeps its `asOf`
 * copy; a new task-owned conversation copies the stored agent of its owner task's conversation; a new ownerless one
 * starts empty.
 */
export async function createAgent(tx: Tx, conversation: ConversationRecord): Promise<void> {
	if (conversation.parent !== undefined) return;
	const agent = await tx.doc(AgentDoc, conversation.id);
	if (conversation.owner === undefined) return;
	const owner = await tx.doc(AgentDoc, conversation.owner.conversationId);
	Object.assign(agent, copyJson(owner) as AgentState);
}

/** Handlers of the selected extensions' hooks for a task name, in extension order. */
export function agentHooks(agent: Agent, taskName: string): object[] {
	const handlers: object[] = [];
	for (const extension of agent.extensions) {
		for (const hook of extension.hooks ?? []) if (hook.task === taskName) handlers.push(hook.handlers);
	}
	return handlers;
}

/**
 * Resolve an agent from its stored state (absent: every field unset), a registry snapshot, and resolved settings. A
 * wrapper that throws or renames drops its target and is reported; a wrapper without a target does nothing.
 */
export function resolveAgent<Tool extends ToolRegistration>(
	state: Readonly<AgentState> | undefined,
	snapshot: RegistrySnapshot<Tool>,
	settings: Settings,
	report: (error: unknown) => void,
): Agent<Tool> {
	const extensions = selectExtensions(state?.extensions, snapshot, settings);

	const composed = new Map<string, Tool>();
	for (const extension of extensions) for (const tool of extension.tools ?? []) composed.set(tool.name, tool);
	const sections = new Map<string, PromptSection<Tool>>();
	for (const extension of extensions) {
		for (const section of extension.sections ?? []) sections.set(section.key, section);
	}
	for (const extension of extensions) {
		for (const wrap of extension.wraps ?? []) {
			if ("tool" in wrap)
				applyWrap(
					composed,
					wrap.tool,
					(tool) => wrap.wrap(tool),
					(tool) => tool.name,
					report,
				);
			else
				applyWrap(
					sections,
					wrap.section,
					(section) => wrap.wrap(section),
					(section) => section.key,
					report,
				);
		}
	}

	const enabled = filterTools([...composed.values()], state?.tools);
	const callableBy = (caller: "model" | "tools") => (tool: Tool) =>
		tool.callers === undefined || tool.callers.includes(caller);
	const tools = filterTools(enabled.filter(callableBy("model")), state?.modelTools);
	const callable = enabled.filter(callableBy("tools"));

	const instructions = state?.instructions;
	const agentSections = [...sections.values()];
	if (instructions !== undefined) agentSections.push({ key: INSTRUCTIONS_KEY, render: () => instructions });

	const agent: Agent<Tool> = {
		...(state?.model === undefined ? {} : { model: state.model }),
		thinkingLevel: state?.thinkingLevel ?? "off",
		extensions,
		tools,
		callable,
		sections: agentSections,
		...(instructions === undefined ? {} : { instructions }),
		...(state?.cwd === undefined ? {} : { cwd: state.cwd }),
	};
	return agent;
}

/** `tools` through a stored filter: an array selects exactly its names, in its order; `{ remove }` drops names. */
function filterTools<Tool extends ToolRegistration>(tools: Tool[], filter: AgentState["tools"]): Tool[] {
	if (filter === undefined) return tools;
	if (Array.isArray(filter)) {
		const byName = new Map(tools.map((tool) => [tool.name, tool]));
		return [...new Set(filter)].flatMap((name) => {
			const tool = byName.get(name);
			return tool === undefined ? [] : [tool];
		});
	}
	const removed = new Set((filter as { remove: string[] }).remove);
	return tools.filter((tool) => !removed.has(tool.name));
}

/** Selected installed extensions: the stored array, or the default selection edited by `{ add, remove }`. */
function selectExtensions<Tool extends ToolRegistration>(
	stored: AgentState["extensions"],
	snapshot: RegistrySnapshot<Tool>,
	settings: Settings,
): Extension<Tool>[] {
	let selected: string[];
	if (Array.isArray(stored)) selected = stored;
	else {
		const base = settings.extensions?.map((extension) => extension.name) ?? snapshot.installed().map((e) => e.name);
		const edit = stored as { add?: string[]; remove?: string[] } | undefined;
		const removed = new Set(edit?.remove ?? []);
		selected = [...base, ...(edit?.add ?? [])].filter((name) => !removed.has(name));
	}
	const extensions: Extension<Tool>[] = [];
	for (const name of new Set(selected)) {
		const extension = snapshot.extension(name);
		if (extension !== undefined) extensions.push(extension);
	}
	return extensions;
}

function applyWrap<T>(
	items: Map<string, T>,
	target: string,
	wrap: (item: T) => T,
	nameOf: (item: T) => string,
	report: (error: unknown) => void,
): void {
	const item = items.get(target);
	if (item === undefined) return;
	try {
		const wrapped = wrap(item);
		if (nameOf(wrapped) !== target) throw new Error(`Wrapper renamed ${target} to ${nameOf(wrapped)}`);
		items.set(target, wrapped);
	} catch (error) {
		items.delete(target);
		report(error);
	}
}
