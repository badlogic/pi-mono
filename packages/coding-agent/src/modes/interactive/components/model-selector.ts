import { type Model, modelsAreEqual } from "@mariozechner/pi-ai";
import {
	Container,
	type Focusable,
	fuzzyFilter,
	getEditorKeybindings,
	Input,
	Spacer,
	Text,
	type TUI,
} from "@mariozechner/pi-tui";
import type { ModelRegistry } from "../../../core/model-registry.js";
import type { SettingsManager } from "../../../core/settings-manager.js";
import { theme } from "../theme/theme.js";
import { DynamicBorder } from "./dynamic-border.js";

interface ModelItem {
	provider: string;
	id: string;
	model: Model<any>;
}

interface ScopedModelItem {
	model: Model<any>;
	thinkingLevel: string;
}

/**
 * Component that renders a model selector with search
 */
export class ModelSelectorComponent extends Container implements Focusable {
	private searchInput: Input;

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
	private allModels: ModelItem[] = [];
	private filteredModels: ModelItem[] = [];
	private selectedIndex: number = 0;
	private currentModel?: Model<any>;
	private settingsManager: SettingsManager;
	private modelRegistry: ModelRegistry;
	private onSelectCallback: (model: Model<any>) => void;
	private onCancelCallback: () => void;
	private errorMessage?: string;
	private tui: TUI;
	private scopedModels: ReadonlyArray<ScopedModelItem>;

	constructor(
		tui: TUI,
		currentModel: Model<any> | undefined,
		settingsManager: SettingsManager,
		modelRegistry: ModelRegistry,
		scopedModels: ReadonlyArray<ScopedModelItem>,
		onSelect: (model: Model<any>) => void,
		onCancel: () => void,
		initialSearchInput?: string,
	) {
		super();

		this.tui = tui;
		this.currentModel = currentModel;
		this.settingsManager = settingsManager;
		this.modelRegistry = modelRegistry;
		this.scopedModels = scopedModels;
		this.onSelectCallback = onSelect;
		this.onCancelCallback = onCancel;

		// Add top border
		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));

		// Add hint about model filtering
		const hintText =
			scopedModels.length > 0
				? "Showing models from --models scope"
				: "Only showing models with configured API keys (see README for details)";
		this.addChild(new Text(theme.fg("warning", hintText), 0, 0));
		this.addChild(new Spacer(1));

		// Create search input
		this.searchInput = new Input();
		if (initialSearchInput) {
			this.searchInput.setValue(initialSearchInput);
		}
		this.searchInput.onSubmit = () => {
			// Enter on search input selects the first filtered item
			if (this.filteredModels[this.selectedIndex]) {
				this.handleSelect(this.filteredModels[this.selectedIndex].model);
			}
		};
		this.addChild(this.searchInput);

		this.addChild(new Spacer(1));

		// Create list container
		this.listContainer = new Container();
		this.addChild(this.listContainer);

		this.addChild(new Spacer(1));

		// Add bottom border
		this.addChild(new DynamicBorder());

		// Load models and do initial render
		this.loadModels().then(() => {
			if (initialSearchInput) {
				this.filterModels(initialSearchInput);
			} else {
				this.updateList();
			}
			// Request re-render after models are loaded
			this.tui.requestRender();
		});
	}

	private async loadModels(): Promise<void> {
		let models: ModelItem[];

		// Use scoped models if provided via --models flag
		if (this.scopedModels.length > 0) {
			models = this.scopedModels.map((scoped) => ({
				provider: scoped.model.provider,
				id: scoped.model.id,
				model: scoped.model,
			}));
		} else {
			// Refresh to pick up any changes to models.json
			this.modelRegistry.refresh();

			// Check for models.json errors
			const loadError = this.modelRegistry.getError();
			if (loadError) {
				this.errorMessage = loadError;
			}

			// Load available models (built-in models still work even if models.json failed)
			try {
				const availableModels = await this.modelRegistry.getAvailable();
				models = availableModels.map((model: Model<any>) => ({
					provider: model.provider,
					id: model.id,
					model,
				}));
			} catch (error) {
				this.allModels = [];
				this.filteredModels = [];
				this.errorMessage = error instanceof Error ? error.message : String(error);
				return;
			}
		}

		// Sort: current model first, then by provider
		models.sort((a, b) => {
			const aIsCurrent = modelsAreEqual(this.currentModel, a.model);
			const bIsCurrent = modelsAreEqual(this.currentModel, b.model);
			if (aIsCurrent && !bIsCurrent) return -1;
			if (!aIsCurrent && bIsCurrent) return 1;
			return a.provider.localeCompare(b.provider);
		});

		this.allModels = models;
		this.filteredModels = models;
		this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, models.length - 1));
	}

	private filterModels(query: string): void {
		this.filteredModels = fuzzyFilter(this.allModels, query, ({ id, provider }) => `${id} ${provider}`);
		this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.filteredModels.length - 1));
		this.updateList();
	}

	private updateList(): void {
		this.listContainer.clear();

		const maxVisible = 10;
		const startIndex = Math.max(
			0,
			Math.min(this.selectedIndex - Math.floor(maxVisible / 2), this.filteredModels.length - maxVisible),
		);
		const endIndex = Math.min(startIndex + maxVisible, this.filteredModels.length);

		// Show visible slice of filtered models
		for (let i = startIndex; i < endIndex; i++) {
			const item = this.filteredModels[i];
			if (!item) continue;

			const isSelected = i === this.selectedIndex;
			const isCurrent = modelsAreEqual(this.currentModel, item.model);

			let line = "";
			if (isSelected) {
				const prefix = theme.fg("accent", "→ ");
				const modelText = `${item.id}`;
				const providerBadge = theme.fg("muted", `[${item.provider}]`);
				const checkmark = isCurrent ? theme.fg("success", " ✓") : "";
				line = `${prefix + theme.fg("accent", modelText)} ${providerBadge}${checkmark}`;
			} else {
				const modelText = `  ${item.id}`;
				const providerBadge = theme.fg("muted", `[${item.provider}]`);
				const checkmark = isCurrent ? theme.fg("success", " ✓") : "";
				line = `${modelText} ${providerBadge}${checkmark}`;
			}

			this.listContainer.addChild(new Text(line, 0, 0));
		}

		// Add scroll indicator if needed
		if (startIndex > 0 || endIndex < this.filteredModels.length) {
			const scrollInfo = theme.fg("muted", `  (${this.selectedIndex + 1}/${this.filteredModels.length})`);
			this.listContainer.addChild(new Text(scrollInfo, 0, 0));
		}

		// Show error message or "no results" if empty
		if (this.errorMessage) {
			// Show error in red
			const errorLines = this.errorMessage.split("\n");
			for (const line of errorLines) {
				this.listContainer.addChild(new Text(theme.fg("error", line), 0, 0));
			}
		} else if (this.filteredModels.length === 0) {
			this.listContainer.addChild(new Text(theme.fg("muted", "  No matching models"), 0, 0));
		}
	}

	handleInput(keyData: string): void {
		const kb = getEditorKeybindings();
		// Up arrow - wrap to bottom when at top
		if (kb.matches(keyData, "selectUp")) {
			if (this.filteredModels.length === 0) return;
			this.selectedIndex = this.selectedIndex === 0 ? this.filteredModels.length - 1 : this.selectedIndex - 1;
			this.updateList();
		}
		// Down arrow - wrap to top when at bottom
		else if (kb.matches(keyData, "selectDown")) {
			if (this.filteredModels.length === 0) return;
			this.selectedIndex = this.selectedIndex === this.filteredModels.length - 1 ? 0 : this.selectedIndex + 1;
			this.updateList();
		}
		// Enter
		else if (kb.matches(keyData, "selectConfirm")) {
			const selectedModel = this.filteredModels[this.selectedIndex];
			if (selectedModel) {
				this.handleSelect(selectedModel.model);
			}
		}
		// Escape or Ctrl+C
		else if (kb.matches(keyData, "selectCancel")) {
			this.onCancelCallback();
		}
		// Pass everything else to search input
		else {
			this.searchInput.handleInput(keyData);
			this.filterModels(this.searchInput.getValue());
		}
	}

	private handleSelect(model: Model<any>): void {
		// Save as new default
		this.settingsManager.setDefaultModelAndProvider(model.provider, model.id);
		this.onSelectCallback(model);
	}

	getSearchInput(): Input {
		return this.searchInput;
	}
}
