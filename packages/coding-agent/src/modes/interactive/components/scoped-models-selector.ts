import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import { type Api, type Model, supportsXhigh } from "@mariozechner/pi-ai";
import {
	Container,
	type Focusable,
	fuzzyFilter,
	getEditorKeybindings,
	Input,
	Key,
	matchesKey,
	Spacer,
	Text,
} from "@mariozechner/pi-tui";
import { theme } from "../theme/theme.js";
import { DynamicBorder } from "./dynamic-border.js";

// EnabledIds: null = all enabled (no filter), string[] = explicit ordered list
type EnabledIds = string[] | null;

/** Stores only non-default overrides (no entry = off/default). */
type ThinkingOverrides = Map<string, ThinkingLevel>;

function isEnabled(enabledIds: EnabledIds, id: string): boolean {
	return enabledIds === null || enabledIds.includes(id);
}

function toggle(enabledIds: EnabledIds, id: string): EnabledIds {
	if (enabledIds === null) return [id]; // First toggle: start with only this one
	const index = enabledIds.indexOf(id);
	if (index >= 0) return [...enabledIds.slice(0, index), ...enabledIds.slice(index + 1)];
	return [...enabledIds, id];
}

function enableAll(enabledIds: EnabledIds, allIds: string[], targetIds?: string[]): EnabledIds {
	if (enabledIds === null) return null; // Already all enabled
	const targets = targetIds ?? allIds;
	const result = [...enabledIds];
	for (const id of targets) {
		if (!result.includes(id)) result.push(id);
	}
	return result;
}

function clearAll(enabledIds: EnabledIds, allIds: string[], targetIds?: string[]): EnabledIds {
	if (enabledIds === null) {
		return targetIds ? allIds.filter((id) => !targetIds.includes(id)) : [];
	}
	const targets = new Set(targetIds ?? enabledIds);
	return enabledIds.filter((id) => !targets.has(id));
}

function move(enabledIds: EnabledIds, allIds: string[], id: string, delta: number): EnabledIds {
	const list = enabledIds ?? [...allIds];
	const index = list.indexOf(id);
	if (index < 0) return list;
	const newIndex = index + delta;
	if (newIndex < 0 || newIndex >= list.length) return list;
	const result = [...list];
	[result[index], result[newIndex]] = [result[newIndex], result[index]];
	return result;
}

function getSortedIds(enabledIds: EnabledIds, allIds: string[]): string[] {
	if (enabledIds === null) return allIds;
	const enabledSet = new Set(enabledIds);
	return [...enabledIds, ...allIds.filter((id) => !enabledSet.has(id))];
}

function getThinkingCycleLevels(model: Model<Api>): ThinkingLevel[] {
	if (!model.reasoning) return [];
	return supportsXhigh(model) ? ["minimal", "low", "medium", "high", "xhigh"] : ["minimal", "low", "medium", "high"];
}

interface ModelItem {
	fullId: string;
	model: Model<Api>;
	enabled: boolean;
	thinkingOverride?: ThinkingLevel;
}

export interface ModelsConfig {
	allModels: Model<Api>[];
	enabledIds: EnabledIds;
	/** Non-default overrides only (no entry = off/default). */
	thinkingOverrides?: ThinkingOverrides;
}

export interface ModelsCallbacks {
	/** Called whenever the in-memory selection changes (session-only). */
	onChange: (patterns: string[] | null) => void;
	/** Called when user wants to persist current selection to settings (Ctrl+S). */
	onPersist: (patterns: string[] | null) => void;
	onCancel: () => void;
}

/**
 * Component for enabling/disabling models for Ctrl+P cycling.
 * Changes are session-only until explicitly persisted with Ctrl+S.
 */
export class ScopedModelsSelectorComponent extends Container implements Focusable {
	private modelsById: Map<string, Model<Api>> = new Map();
	private allIds: string[] = [];
	private enabledIds: EnabledIds = null;
	private thinkingOverrides: ThinkingOverrides = new Map();
	private filteredItems: ModelItem[] = [];
	private selectedIndex = 0;
	private searchInput: Input;

	private readonly initialEnabledIds: EnabledIds;
	private readonly initialThinkingOverrides: ThinkingOverrides;

	// Focusable implementation - propagate to searchInput for IME cursor positioning
	private _focused = false;
	get focused(): boolean {
		return this._focused;
	}
	set focused(value: boolean) {
		this._focused = value;
		this.searchInput.focused = value;
	}

	private listContainer: Container;
	private footerText: Text;
	private callbacks: ModelsCallbacks;
	private maxVisible = 15;
	private isDirty = false;

	constructor(config: ModelsConfig, callbacks: ModelsCallbacks) {
		super();
		this.callbacks = callbacks;

		for (const model of config.allModels) {
			const fullId = `${model.provider}/${model.id}`;
			this.modelsById.set(fullId, model);
			this.allIds.push(fullId);
		}

		this.enabledIds = config.enabledIds;
		this.thinkingOverrides = new Map(config.thinkingOverrides ?? []);

		this.initialEnabledIds = this.enabledIds === null ? null : [...this.enabledIds];
		this.initialThinkingOverrides = new Map(this.thinkingOverrides);

		this.filteredItems = this.buildItems();

		// Header
		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.fg("accent", theme.bold("Model Configuration")), 0, 0));
		this.addChild(new Text(theme.fg("muted", "Session-only. Ctrl+S to save to settings."), 0, 0));
		this.addChild(new Spacer(1));

		// Search input
		this.searchInput = new Input();
		this.addChild(this.searchInput);
		this.addChild(new Spacer(1));

		// List container
		this.listContainer = new Container();
		this.addChild(this.listContainer);

		// Footer hint
		this.addChild(new Spacer(1));
		this.footerText = new Text(this.getFooterText(), 0, 0);
		this.addChild(this.footerText);

		this.addChild(new DynamicBorder());
		this.updateList();
	}

	private buildPatterns(): string[] | null {
		// null = no filter (all models enabled). In this mode, thinking overrides are not active/persisted.
		if (this.enabledIds === null) return null;
		return this.enabledIds.map((id) => {
			const override = this.thinkingOverrides.get(id);
			return override ? `${id}:${override}` : id;
		});
	}

	private emitChange(): void {
		this.callbacks.onChange(this.buildPatterns());
	}

	private buildItems(): ModelItem[] {
		return getSortedIds(this.enabledIds, this.allIds).map((id) => ({
			fullId: id,
			model: this.modelsById.get(id)!,
			enabled: isEnabled(this.enabledIds, id),
			thinkingOverride: this.thinkingOverrides.get(id),
		}));
	}

	private getFooterText(): string {
		const enabledCount = this.enabledIds?.length ?? this.allIds.length;
		const allEnabled = this.enabledIds === null;
		const countText = allEnabled ? "all enabled" : `${enabledCount}/${this.allIds.length} enabled`;
		const parts = [
			"Enter toggle",
			"^A all",
			"^X clear",
			"^P provider",
			"^T thinking",
			"^R reset",
			"Alt+↑↓ reorder",
			"^S save",
			countText,
		];
		return this.isDirty
			? theme.fg("dim", `  ${parts.join(" · ")} `) + theme.fg("warning", "(unsaved)")
			: theme.fg("dim", `  ${parts.join(" · ")}`);
	}

	private refresh(): void {
		const query = this.searchInput.getValue();
		const items = this.buildItems();
		this.filteredItems = query ? fuzzyFilter(items, query, (i) => `${i.model.id} ${i.model.provider}`) : items;
		this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.filteredItems.length - 1));
		this.updateList();
		this.footerText.setText(this.getFooterText());
	}

	private updateList(): void {
		this.listContainer.clear();

		if (this.filteredItems.length === 0) {
			this.listContainer.addChild(new Text(theme.fg("muted", "  No matching models"), 0, 0));
			return;
		}

		const startIndex = Math.max(
			0,
			Math.min(this.selectedIndex - Math.floor(this.maxVisible / 2), this.filteredItems.length - this.maxVisible),
		);
		const endIndex = Math.min(startIndex + this.maxVisible, this.filteredItems.length);

		for (let i = startIndex; i < endIndex; i++) {
			const item = this.filteredItems[i]!;
			const isSelected = i === this.selectedIndex;
			const prefix = isSelected ? theme.fg("accent", "→ ") : "  ";

			const thinkingSuffix = item.enabled && item.thinkingOverride ? `:${item.thinkingOverride}` : "";
			const displayId = `${item.model.id}${thinkingSuffix}`;
			const modelText = isSelected ? theme.fg("accent", displayId) : displayId;
			const providerBadge = theme.fg("muted", ` [${item.model.provider}]`);
			const status = item.enabled ? theme.fg("success", " ✓") : theme.fg("dim", " ✗");

			this.listContainer.addChild(new Text(`${prefix}${modelText}${providerBadge}${status}`, 0, 0));
		}

		// Add scroll indicator if needed
		if (startIndex > 0 || endIndex < this.filteredItems.length) {
			this.listContainer.addChild(
				new Text(theme.fg("muted", `  (${this.selectedIndex + 1}/${this.filteredItems.length})`), 0, 0),
			);
		}
	}

	handleInput(data: string): void {
		const kb = getEditorKeybindings();

		// Navigation
		if (kb.matches(data, "selectUp")) {
			if (this.filteredItems.length === 0) return;
			this.selectedIndex = this.selectedIndex === 0 ? this.filteredItems.length - 1 : this.selectedIndex - 1;
			this.updateList();
			return;
		}
		if (kb.matches(data, "selectDown")) {
			if (this.filteredItems.length === 0) return;
			this.selectedIndex = this.selectedIndex === this.filteredItems.length - 1 ? 0 : this.selectedIndex + 1;
			this.updateList();
			return;
		}

		// Alt+Up/Down - Reorder enabled models
		if (matchesKey(data, Key.alt("up")) || matchesKey(data, Key.alt("down"))) {
			const item = this.filteredItems[this.selectedIndex];
			if (item && isEnabled(this.enabledIds, item.fullId)) {
				const delta = matchesKey(data, Key.alt("up")) ? -1 : 1;
				const enabledList = this.enabledIds ?? this.allIds;
				const currentIndex = enabledList.indexOf(item.fullId);
				const newIndex = currentIndex + delta;
				// Only move if within bounds
				if (newIndex >= 0 && newIndex < enabledList.length) {
					this.enabledIds = move(this.enabledIds, this.allIds, item.fullId, delta);
					this.isDirty = true;
					this.selectedIndex += delta;
					this.emitChange();
					this.refresh();
				}
			}
			return;
		}

		// Toggle on Enter
		if (matchesKey(data, Key.enter)) {
			const item = this.filteredItems[this.selectedIndex];
			if (item) {
				this.enabledIds = toggle(this.enabledIds, item.fullId);
				this.isDirty = true;
				this.emitChange();
				this.refresh();
			}
			return;
		}

		// Ctrl+T - Cycle per-model thinking override (selected models only)
		if (matchesKey(data, Key.ctrl("t"))) {
			const item = this.filteredItems[this.selectedIndex];
			if (!item) return;
			// Only for enabled models when a filter is active (not the default "all enabled" mode)
			if (this.enabledIds === null || !item.enabled) return;

			const levels = getThinkingCycleLevels(item.model);
			if (levels.length === 0) return;

			const current = this.thinkingOverrides.get(item.fullId);
			let next: ThinkingLevel | undefined;
			if (!current) {
				next = levels[0];
			} else {
				const idx = levels.indexOf(current);
				next = idx === -1 || idx === levels.length - 1 ? undefined : levels[idx + 1];
			}

			if (next) {
				this.thinkingOverrides.set(item.fullId, next);
			} else {
				this.thinkingOverrides.delete(item.fullId);
			}
			this.isDirty = true;
			this.emitChange();
			this.refresh();
			return;
		}

		// Ctrl+R - Reset to initial state
		if (matchesKey(data, Key.ctrl("r"))) {
			this.enabledIds = this.initialEnabledIds === null ? null : [...this.initialEnabledIds];
			this.thinkingOverrides = new Map(this.initialThinkingOverrides);
			this.isDirty = false;
			this.emitChange();
			this.refresh();
			return;
		}

		// Ctrl+A - All enabled (clear filter)
		if (matchesKey(data, Key.ctrl("a"))) {
			this.enabledIds = null;
			this.thinkingOverrides.clear();
			this.isDirty = true;
			this.emitChange();
			this.refresh();
			return;
		}

		// Ctrl+X - Clear all (filtered if search active, otherwise all)
		if (matchesKey(data, Key.ctrl("x"))) {
			const targetIds = this.searchInput.getValue() ? this.filteredItems.map((i) => i.fullId) : undefined;
			this.enabledIds = clearAll(this.enabledIds, this.allIds, targetIds);
			this.isDirty = true;
			this.emitChange();
			this.refresh();
			return;
		}

		// Ctrl+P - Toggle provider of current item
		if (matchesKey(data, Key.ctrl("p"))) {
			const item = this.filteredItems[this.selectedIndex];
			if (item) {
				const provider = item.model.provider;
				const providerIds = this.allIds.filter((id) => this.modelsById.get(id)!.provider === provider);
				const allEnabled = providerIds.every((id) => isEnabled(this.enabledIds, id));
				this.enabledIds = allEnabled
					? clearAll(this.enabledIds, this.allIds, providerIds)
					: enableAll(this.enabledIds, this.allIds, providerIds);
				this.isDirty = true;
				this.emitChange();
				this.refresh();
			}
			return;
		}

		// Ctrl+S - Save/persist to settings
		if (matchesKey(data, Key.ctrl("s"))) {
			this.callbacks.onPersist(this.buildPatterns());
			this.isDirty = false;
			this.footerText.setText(this.getFooterText());
			return;
		}

		// Ctrl+C - clear search or cancel if empty
		if (matchesKey(data, Key.ctrl("c"))) {
			if (this.searchInput.getValue()) {
				this.searchInput.setValue("");
				this.refresh();
			} else {
				this.callbacks.onCancel();
			}
			return;
		}

		// Escape - cancel
		if (matchesKey(data, Key.escape)) {
			this.callbacks.onCancel();
			return;
		}

		// Pass everything else to search input
		this.searchInput.handleInput(data);
		this.refresh();
	}

	getSearchInput(): Input {
		return this.searchInput;
	}
}
