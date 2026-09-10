import type { Context, Message, Tool } from "../types.ts";

type ToolNameNormalizer = (name: string) => string;

export interface ToolChange {
	added: Tool[];
	removed: Tool[];
}

/** Provider-neutral tool history. Current availability is obtained by replaying changes forward. */
export interface ToolHistory {
	initial: Tool[];
	definitions: Map<string, Tool>;
	changes: Map<Message, ToolChange>;
}

export function resolveToolHistory(context: Context, normalizeName: ToolNameNormalizer = (name) => name): ToolHistory {
	const initial = new Map<string, Tool>();
	for (const tool of context.tools ?? []) initial.set(normalizeName(tool.name), tool);
	const definitions = new Map(initial);
	const changes = new Map<Message, ToolChange>();
	for (const message of context.messages) {
		if (message.role !== "system") continue;
		const added = message.toolsAdded ?? [];
		const removed = message.toolsRemoved ?? [];
		for (const tool of [...added, ...removed]) {
			const name = normalizeName(tool.name);
			if (!definitions.has(name)) definitions.set(name, tool);
		}
	}

	// Legacy results carry only names. Resolve them from the supplied catalog and
	// move their initial declarations to the first marker, unless already used.
	// First-class system changes never depend on this compatibility path.
	const seen = new Set<string>();
	for (const message of context.messages) {
		if (message.role === "assistant") {
			for (const block of message.content) {
				if (block.type === "toolCall") seen.add(normalizeName(block.name));
			}
		} else if (message.role === "system") {
			changes.set(message, { added: message.toolsAdded ?? [], removed: message.toolsRemoved ?? [] });
			for (const tool of message.toolsAdded ?? []) seen.add(normalizeName(tool.name));
		} else if (message.role === "toolResult") {
			const added: Tool[] = [];
			for (const rawName of message.addedToolNames ?? []) {
				const name = normalizeName(rawName);
				const tool = definitions.get(name);
				if (!tool || seen.has(name)) continue;
				seen.add(name);
				initial.delete(name);
				added.push(tool);
			}
			if (added.length > 0) changes.set(message, { added, removed: [] });
		}
	}
	return { initial: [...initial.values()], definitions, changes };
}

export interface ToolPlacementOptions {
	toolResultMarkers: boolean;
	systemMarkers: boolean;
	normalizeName?: ToolNameNormalizer;
}

export interface ToolPlacement {
	immediate: Tool[];
	deferred: Map<string, Tool>;
}

/** Definitions needed for historical calls as well as currently available tools. */
export function declaredTools(context: Context): Tool[] {
	return [...resolveToolHistory(context).definitions]
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([, tool]) => tool);
}

export function splitDeferredTools(context: Context, options: ToolPlacementOptions): ToolPlacement {
	const normalizeName = options.normalizeName ?? ((name: string) => name);
	const history = resolveToolHistory(context, normalizeName);
	const immediate = new Map(history.initial.map((tool) => [normalizeName(tool.name), tool]));
	const deferred = new Map<string, Tool>();
	for (const [message, change] of history.changes) {
		const canDefer = message.role === "system" ? options.systemMarkers : options.toolResultMarkers;
		for (const tool of change.added) {
			const name = normalizeName(tool.name);
			if (immediate.has(name) || deferred.has(name)) continue;
			if (canDefer) deferred.set(name, tool);
			else immediate.set(name, tool);
		}
	}
	return {
		immediate: [...immediate].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, tool]) => tool),
		deferred,
	};
}
