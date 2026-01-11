import type { Model } from "@mariozechner/pi-ai";
import { Container, getEditorKeybindings, Spacer, Text } from "@mariozechner/pi-tui";
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
	onModelToggle: (modelId: string, enabled: boolean) => void;
	onCancel: () => void;
}

/**
 * Component for enabling/disabling models for Ctrl+P cycling.
 */
export class ModelsSelectorComponent extends Container {
	private items: ModelItem[] = [];
	private selectedIndex = 0;
	private listContainer: Container;
	private callbacks: ModelsCallbacks;
	private maxVisible = 15;

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

		// Header
		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.fg("accent", theme.bold("Model Configuration")), 0, 0));
		this.addChild(new Text(theme.fg("muted", "Enable/disable models for Ctrl+P cycling"), 0, 0));
		this.addChild(new Spacer(1));

		// List container
		this.listContainer = new Container();
		this.addChild(this.listContainer);

		// Footer hint
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.fg("dim", "  Enter/Space to toggle · Esc to close"), 0, 0));

		this.addChild(new DynamicBorder());

		this.updateList();
	}

	private updateList(): void {
		this.listContainer.clear();

		const startIndex = Math.max(
			0,
			Math.min(this.selectedIndex - Math.floor(this.maxVisible / 2), this.items.length - this.maxVisible),
		);
		const endIndex = Math.min(startIndex + this.maxVisible, this.items.length);

		for (let i = startIndex; i < endIndex; i++) {
			const item = this.items[i];
			if (!item) continue;

			const isSelected = i === this.selectedIndex;

			let line = "";
			if (isSelected) {
				const prefix = theme.fg("accent", "→ ");
				const modelText = theme.fg("accent", item.model.id);
				const providerBadge = theme.fg("muted", ` [${item.model.provider}]`);
				const status = item.enabled ? theme.fg("success", " ✓") : theme.fg("dim", " ✗");
				line = `${prefix}${modelText}${providerBadge}${status}`;
			} else {
				const prefix = "  ";
				const modelText = item.model.id;
				const providerBadge = theme.fg("muted", ` [${item.model.provider}]`);
				const status = item.enabled ? theme.fg("success", " ✓") : theme.fg("dim", " ✗");
				line = `${prefix}${modelText}${providerBadge}${status}`;
			}

			this.listContainer.addChild(new Text(line, 0, 0));
		}

		// Add scroll indicator if needed
		if (startIndex > 0 || endIndex < this.items.length) {
			const scrollInfo = theme.fg("muted", `  (${this.selectedIndex + 1}/${this.items.length})`);
			this.listContainer.addChild(new Text(scrollInfo, 0, 0));
		}
	}

	handleInput(data: string): void {
		const kb = getEditorKeybindings();

		if (kb.matches(data, "selectUp")) {
			this.selectedIndex = this.selectedIndex === 0 ? this.items.length - 1 : this.selectedIndex - 1;
			this.updateList();
		} else if (kb.matches(data, "selectDown")) {
			this.selectedIndex = this.selectedIndex === this.items.length - 1 ? 0 : this.selectedIndex + 1;
			this.updateList();
		} else if (kb.matches(data, "selectConfirm") || data === " ") {
			// Toggle on Enter or Space
			const item = this.items[this.selectedIndex];
			if (item) {
				item.enabled = !item.enabled;
				this.callbacks.onModelToggle(item.fullId, item.enabled);
				this.updateList();
			}
		} else if (kb.matches(data, "selectCancel")) {
			this.callbacks.onCancel();
		}
	}

	getSettingsList(): this {
		// Return self for focus management (compatible with showSelector interface)
		return this;
	}
}
