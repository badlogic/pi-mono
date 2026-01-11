import type { Model } from "@mariozechner/pi-ai";
import {
	Container,
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

interface ModelItem {
	fullId: string;
	model: Model<any>;
	enabled: boolean;
}

export interface ModelsConfig {
	allModels: Model<any>[];
	enabledModelIds: Set<string>;
	/** true if enabledModels setting is defined (empty = all enabled) */
	hasEnabledModelsFilter: boolean;
}

export interface ModelsCallbacks {
	/** Called when a model is toggled (session-only, no persist) */
	onModelToggle: (modelId: string, enabled: boolean) => void;
	/** Called when user wants to persist current selection to settings */
	onPersist: (enabledModelIds: string[]) => void;
	/** Called when user enables all models. Returns list of all model IDs. */
	onEnableAll: (allModelIds: string[]) => void;
	/** Called when user clears all models */
	onClearAll: () => void;
	/** Called when user toggles all models for a provider. Returns affected model IDs. */
	onToggleProvider: (provider: string, modelIds: string[], enabled: boolean) => void;
	onCancel: () => void;
}

/**
 * Component for enabling/disabling models for Ctrl+P cycling.
 * Changes are session-only until explicitly persisted with Ctrl+S.
 */
export class ScopedModelsSelectorComponent extends Container {
	private items: ModelItem[] = [];
	private filteredItems: ModelItem[] = [];
	private selectedIndex = 0;
	private searchInput: Input;
	private listContainer: Container;
	private footerText: Text;
	private callbacks: ModelsCallbacks;
	private maxVisible = 15;
	private isDirty = false;

	constructor(config: ModelsConfig, callbacks: ModelsCallbacks) {
		super();
		this.callbacks = callbacks;

		// Group models by provider for organized display
		const modelsByProvider = new Map<string, Model<any>[]>();
		for (const model of config.allModels) {
			const list = modelsByProvider.get(model.provider) ?? [];
			list.push(model);
			modelsByProvider.set(model.provider, list);
		}

		// Build items - group by provider
		for (const [provider, models] of modelsByProvider) {
			for (const model of models) {
				const fullId = `${provider}/${model.id}`;
				// If no filter defined, all models are enabled by default
				const isEnabled = !config.hasEnabledModelsFilter || config.enabledModelIds.has(fullId);
				this.items.push({
					fullId,
					model,
					enabled: isEnabled,
				});
			}
		}
		this.filteredItems = this.getSortedItems();

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

	/** Get items sorted with enabled items first */
	private getSortedItems(): ModelItem[] {
		const enabled = this.items.filter((i) => i.enabled);
		const disabled = this.items.filter((i) => !i.enabled);
		return [...enabled, ...disabled];
	}

	private getFooterText(): string {
		const enabledCount = this.items.filter((i) => i.enabled).length;
		const allEnabled = enabledCount === this.items.length;
		const countText = allEnabled ? "all enabled" : `${enabledCount}/${this.items.length} enabled`;
		const parts = ["Enter toggle", "^A all", "^X clear", "^P provider", "^S save", countText];
		if (this.isDirty) {
			return theme.fg("dim", `  ${parts.join(" · ")} `) + theme.fg("warning", "(unsaved)");
		}
		return theme.fg("dim", `  ${parts.join(" · ")}`);
	}

	private updateFooter(): void {
		this.footerText.setText(this.getFooterText());
	}

	private filterItems(query: string): void {
		const sorted = this.getSortedItems();
		if (!query) {
			this.filteredItems = sorted;
		} else {
			this.filteredItems = fuzzyFilter(sorted, query, (item) => `${item.model.id} ${item.model.provider}`);
		}
		this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.filteredItems.length - 1));
		this.updateList();
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

		// Only show status if there's a filter (not all models enabled)
		const allEnabled = this.items.every((i) => i.enabled);

		for (let i = startIndex; i < endIndex; i++) {
			const item = this.filteredItems[i];
			if (!item) continue;

			const isSelected = i === this.selectedIndex;
			const prefix = isSelected ? theme.fg("accent", "→ ") : "  ";
			const modelText = isSelected ? theme.fg("accent", item.model.id) : item.model.id;
			const providerBadge = theme.fg("muted", ` [${item.model.provider}]`);
			// Only show checkmarks when there's actually a filter
			const status = allEnabled ? "" : item.enabled ? theme.fg("success", " ✓") : theme.fg("dim", " ✗");

			this.listContainer.addChild(new Text(`${prefix}${modelText}${providerBadge}${status}`, 0, 0));
		}

		// Add scroll indicator if needed
		if (startIndex > 0 || endIndex < this.filteredItems.length) {
			const scrollInfo = theme.fg("muted", `  (${this.selectedIndex + 1}/${this.filteredItems.length})`);
			this.listContainer.addChild(new Text(scrollInfo, 0, 0));
		}
	}

	private toggleItem(item: ModelItem): void {
		// If all models are currently enabled (no scope yet), first toggle starts fresh:
		// clear all and enable only the selected model
		const allEnabled = this.items.every((i) => i.enabled);
		if (allEnabled) {
			for (const i of this.items) {
				i.enabled = false;
			}
			item.enabled = true;
			this.isDirty = true;
			this.callbacks.onClearAll();
			this.callbacks.onModelToggle(item.fullId, true);
		} else {
			item.enabled = !item.enabled;
			this.isDirty = true;
			this.callbacks.onModelToggle(item.fullId, item.enabled);
		}
		// Re-sort and re-filter to move item to correct section
		this.filterItems(this.searchInput.getValue());
		this.updateFooter();
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

		// Toggle on Enter
		if (matchesKey(data, Key.enter)) {
			const item = this.filteredItems[this.selectedIndex];
			if (item) {
				this.toggleItem(item);
			}
			return;
		}

		// Ctrl+A - Enable all (filtered if search active, otherwise all)
		if (matchesKey(data, Key.ctrl("a"))) {
			const targets = this.searchInput.getValue() ? this.filteredItems : this.items;
			for (const item of targets) {
				item.enabled = true;
			}
			this.isDirty = true;
			this.callbacks.onEnableAll(targets.map((i) => i.fullId));
			this.filterItems(this.searchInput.getValue());
			this.updateFooter();
			return;
		}

		// Ctrl+X - Clear all (filtered if search active, otherwise all)
		if (matchesKey(data, Key.ctrl("x"))) {
			const targets = this.searchInput.getValue() ? this.filteredItems : this.items;
			for (const item of targets) {
				item.enabled = false;
			}
			this.isDirty = true;
			this.callbacks.onClearAll();
			this.filterItems(this.searchInput.getValue());
			this.updateFooter();
			return;
		}

		// Ctrl+P - Toggle provider of current item
		if (matchesKey(data, Key.ctrl("p"))) {
			const currentItem = this.filteredItems[this.selectedIndex];
			if (currentItem) {
				const provider = currentItem.model.provider;
				const providerItems = this.items.filter((i) => i.model.provider === provider);
				const allEnabled = providerItems.every((i) => i.enabled);
				const newState = !allEnabled;
				for (const item of providerItems) {
					item.enabled = newState;
				}
				this.isDirty = true;
				this.callbacks.onToggleProvider(
					provider,
					providerItems.map((i) => i.fullId),
					newState,
				);
				this.filterItems(this.searchInput.getValue());
				this.updateFooter();
			}
			return;
		}

		// Ctrl+S - Save/persist to settings
		if (matchesKey(data, Key.ctrl("s"))) {
			const enabledIds = this.items.filter((i) => i.enabled).map((i) => i.fullId);
			this.callbacks.onPersist(enabledIds);
			this.isDirty = false;
			this.updateFooter();
			return;
		}

		// Ctrl+C - clear search or cancel if empty
		if (matchesKey(data, Key.ctrl("c"))) {
			if (this.searchInput.getValue()) {
				this.searchInput.setValue("");
				this.filterItems("");
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
		this.filterItems(this.searchInput.getValue());
	}

	getSearchInput(): Input {
		return this.searchInput;
	}
}
