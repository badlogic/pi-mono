import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import { type Model, modelsAreEqual } from "@mariozechner/pi-ai";
import { Container, getEditorKeybindings, Input, matchesKey, Spacer, Text, type TUI } from "@mariozechner/pi-tui";
import type { KeybindingsManager } from "../../../core/keybindings.js";
import type { ModelRegistry } from "../../../core/model-registry.js";
import type { SettingsManager } from "../../../core/settings-manager.js";
import { fuzzyFilter } from "../../../utils/fuzzy.js";
import { theme } from "../theme/theme.js";
import { DynamicBorder } from "./dynamic-border.js";

interface ModelItem {
	provider: string;
	id: string;
	model: Model<any>;
	isFavorite: boolean;
	isProjectFavorite: boolean; // True if favorite is from project settings (read-only)
}

/** Represents either a favorite or non-favorite item for unified navigation */
interface NavigableItem {
	item: ModelItem;
	isFavoriteSection: boolean;
}

interface ScopedModelItem {
	model: Model<any>;
	thinkingLevel: string;
}

/** Sort comparator for model items: current model first, then favorites, then by provider */
function createModelSortComparator(currentModel: Model<any> | undefined) {
	return (a: ModelItem, b: ModelItem): number => {
		const aIsCurrent = modelsAreEqual(currentModel, a.model);
		const bIsCurrent = modelsAreEqual(currentModel, b.model);
		if (aIsCurrent && !bIsCurrent) return -1;
		if (!aIsCurrent && bIsCurrent) return 1;
		if (a.isFavorite && !b.isFavorite) return -1;
		if (!a.isFavorite && b.isFavorite) return 1;
		return a.provider.localeCompare(b.provider);
	};
}

/**
 * Component that renders a model selector with search
 */
export class ModelSelectorComponent extends Container {
	private searchInput: Input;
	private pinnedContainer: Container;
	private listContainer: Container;
	private allModels: ModelItem[] = [];
	private filteredModels: ModelItem[] = [];
	private navigableItems: NavigableItem[] = [];
	private selectedIndex: number = 0;
	private currentModel?: Model<any>;
	private currentThinkingLevel: ThinkingLevel;
	private settingsManager: SettingsManager;
	private modelRegistry: ModelRegistry;
	private onSelectCallback: (model: Model<any>) => void;
	private onCancelCallback: () => void;
	private errorMessage?: string;
	private tui: TUI;
	private scopedModels: ReadonlyArray<ScopedModelItem>;
	private keybindings: KeybindingsManager;

	constructor(
		tui: TUI,
		currentModel: Model<any> | undefined,
		currentThinkingLevel: ThinkingLevel,
		settingsManager: SettingsManager,
		modelRegistry: ModelRegistry,
		keybindings: KeybindingsManager,
		scopedModels: ReadonlyArray<ScopedModelItem>,
		onSelect: (model: Model<any>) => void,
		onCancel: () => void,
	) {
		super();

		this.tui = tui;
		this.currentModel = currentModel;
		this.currentThinkingLevel = currentThinkingLevel;
		this.settingsManager = settingsManager;
		this.modelRegistry = modelRegistry;
		this.keybindings = keybindings;
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
		const cycleFavoriteKey = this.keybindings.getDisplayString("cycleFavoriteForward");
		this.addChild(
			new Text(theme.fg("muted", `Press * to toggle favorite (${cycleFavoriteKey} cycles favorites)`), 0, 0),
		);
		this.addChild(new Spacer(1));

		// Create search input
		this.searchInput = new Input();
		this.searchInput.onSubmit = () => {
			// Enter on search input selects the currently selected item
			const selectedNavItem = this.navigableItems[this.selectedIndex];
			if (selectedNavItem) {
				this.handleSelect(selectedNavItem.item.model);
			}
		};
		this.addChild(this.searchInput);

		this.addChild(new Spacer(1));

		// Pinned favorites container
		this.pinnedContainer = new Container();
		this.addChild(this.pinnedContainer);

		// Create list container
		this.listContainer = new Container();
		this.addChild(this.listContainer);

		this.addChild(new Spacer(1));

		// Add bottom border
		this.addChild(new DynamicBorder());

		// Load models and do initial render
		this.loadModels().then(() => {
			this.updateList();
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
				isFavorite: this.settingsManager.isFavoriteModel(scoped.model.provider, scoped.model.id),
				isProjectFavorite: this.settingsManager.isFavoriteFromProject(scoped.model.provider, scoped.model.id),
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
					isFavorite: this.settingsManager.isFavoriteModel(model.provider, model.id),
					isProjectFavorite: this.settingsManager.isFavoriteFromProject(model.provider, model.id),
				}));
			} catch (error) {
				this.allModels = [];
				this.filteredModels = [];
				this.errorMessage = error instanceof Error ? error.message : String(error);
				return;
			}
		}

		// Sort: current model first, then by provider
		models.sort(createModelSortComparator(this.currentModel));

		this.allModels = models;
		const favorites = models.filter((m) => m.isFavorite);
		this.filteredModels = models.filter((m) => !m.isFavorite);
		this.navigableItems = [
			...favorites.map((item) => ({ item, isFavoriteSection: true })),
			...this.filteredModels.map((item) => ({ item, isFavoriteSection: false })),
		];
		this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.navigableItems.length - 1));
	}

	private getFavoriteKey(provider: string, modelId: string): string {
		// Use current thinking level (what user sees in UI), not default
		return `${provider}/${modelId}:${this.currentThinkingLevel}`;
	}

	private toggleFavorite(item: ModelItem): void {
		// Can't toggle project-level favorites from UI
		if (item.isProjectFavorite) {
			return; // Silently ignore - the star already shows it's locked
		}

		// Remember the current item to maintain selection
		const currentItemKey = `${item.provider}/${item.id}`;

		// Find existing global favorite key for this model
		const existingKey = this.settingsManager.findGlobalFavoriteKey(item.provider, item.id);

		if (existingKey) {
			this.settingsManager.removeFavoriteModel(existingKey);
			item.isFavorite = false;
		} else {
			const favoriteKey = this.getFavoriteKey(item.provider, item.id);
			this.settingsManager.addFavoriteModel(favoriteKey);
			item.isFavorite = true;
		}

		this.resortModels();

		// Restore selection to the same item after re-sort
		const newIndex = this.navigableItems.findIndex((n) => `${n.item.provider}/${n.item.id}` === currentItemKey);
		if (newIndex !== -1) {
			this.selectedIndex = newIndex;
		}

		this.updateList();
	}

	private resortModels(): void {
		this.allModels.sort(createModelSortComparator(this.currentModel));
		this.filterModels(this.searchInput.getValue());
	}

	private filterModels(query: string): void {
		// Filter all models
		const allFiltered = fuzzyFilter(this.allModels, query, ({ id, provider }) => `${id} ${provider}`);
		// Separate favorites and non-favorites
		const favorites = allFiltered.filter((m) => m.isFavorite);
		this.filteredModels = allFiltered.filter((m) => !m.isFavorite);
		// Build unified navigable list: favorites first, then non-favorites
		this.navigableItems = [
			...favorites.map((item) => ({ item, isFavoriteSection: true })),
			...this.filteredModels.map((item) => ({ item, isFavoriteSection: false })),
		];
		this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.navigableItems.length - 1));
		this.updateList();
	}

	private updateList(): void {
		this.pinnedContainer.clear();
		this.listContainer.clear();

		// Get favorites from navigableItems for display
		const favoriteItems = this.navigableItems.filter((n) => n.isFavoriteSection);
		const nonFavoriteItems = this.navigableItems.filter((n) => !n.isFavoriteSection);

		// Show pinned favorites section (always visible at top, now navigable)
		if (favoriteItems.length > 0) {
			// Calculate max ID length for alignment
			const maxIdLength = Math.max(...favoriteItems.map((f) => f.item.id.length));

			this.pinnedContainer.addChild(new Text(theme.fg("muted", "  Favorites:"), 0, 0));
			for (let i = 0; i < favoriteItems.length; i++) {
				const navItem = favoriteItems[i];
				if (!navItem) continue;
				const fav = navItem.item;
				const isSelected = this.selectedIndex === i;
				const isCurrent = modelsAreEqual(this.currentModel, fav.model);
				const paddedId = fav.id.padEnd(maxIdLength);
				const providerBadge = theme.fg("muted", fav.provider);
				// Use locked star (☆) for project favorites, filled star (★) for user favorites
				const star = fav.isProjectFavorite ? theme.fg("muted", "☆ ") : theme.fg("warning", "★ ");

				let line = "";
				if (isSelected) {
					const prefix = theme.fg("accent", "→ ");
					const checkmark = isCurrent ? theme.fg("success", "✓ ") : "  ";
					line = `${prefix}${checkmark}${star}${theme.fg("accent", paddedId)}  ${providerBadge}`;
				} else {
					const checkmark = isCurrent ? theme.fg("success", "✓ ") : "  ";
					line = `  ${checkmark}${star}${paddedId}  ${providerBadge}`;
				}
				this.pinnedContainer.addChild(new Text(line, 0, 0));
			}
			this.pinnedContainer.addChild(new Spacer(1));
		}

		// For non-favorites, calculate the adjusted selected index
		const favoritesCount = favoriteItems.length;
		const adjustedSelectedIndex = this.selectedIndex - favoritesCount;

		// Scrolling for non-favorites list
		const maxVisible = 10;
		const startIndex = Math.max(
			0,
			Math.min(adjustedSelectedIndex - Math.floor(maxVisible / 2), nonFavoriteItems.length - maxVisible),
		);
		const endIndex = Math.min(startIndex + maxVisible, nonFavoriteItems.length);

		// Calculate max ID length from ALL non-favorites for stable alignment while scrolling
		const maxIdLength = nonFavoriteItems.length > 0 ? Math.max(...nonFavoriteItems.map((m) => m.item.id.length)) : 0;

		// Show visible slice of filtered models (non-favorites only)
		for (let i = startIndex; i < endIndex; i++) {
			const navItem = nonFavoriteItems[i];
			if (!navItem) continue;
			const item = navItem.item;

			const isSelected = i + favoritesCount === this.selectedIndex;
			const isCurrent = modelsAreEqual(this.currentModel, item.model);
			const paddedId = item.id.padEnd(maxIdLength);

			let line = "";
			if (isSelected) {
				const prefix = theme.fg("accent", "→ ");
				const checkmark = isCurrent ? theme.fg("success", "✓ ") : "  ";
				const providerBadge = theme.fg("muted", item.provider);
				line = `${prefix}${checkmark}${theme.fg("accent", paddedId)}  ${providerBadge}`;
			} else {
				const checkmark = isCurrent ? theme.fg("success", "✓ ") : "  ";
				const providerBadge = theme.fg("muted", item.provider);
				line = `  ${checkmark}${paddedId}  ${providerBadge}`;
			}

			this.listContainer.addChild(new Text(line, 0, 0));
		}

		// Add scroll indicator if needed
		if (startIndex > 0 || endIndex < nonFavoriteItems.length) {
			const displayIndex = adjustedSelectedIndex >= 0 ? adjustedSelectedIndex + 1 : 0;
			const scrollInfo = theme.fg("muted", `  (${displayIndex}/${nonFavoriteItems.length})`);
			this.listContainer.addChild(new Text(scrollInfo, 0, 0));
		}

		// Show error message or "no results" if empty
		if (this.errorMessage) {
			// Show error in red
			const errorLines = this.errorMessage.split("\n");
			for (const line of errorLines) {
				this.listContainer.addChild(new Text(theme.fg("error", line), 0, 0));
			}
		} else if (this.navigableItems.length === 0) {
			this.listContainer.addChild(new Text(theme.fg("muted", "  No matching models"), 0, 0));
		}
	}

	handleInput(keyData: string): void {
		const kb = getEditorKeybindings();
		// Up arrow - wrap to bottom when at top
		if (kb.matches(keyData, "selectUp")) {
			if (this.navigableItems.length === 0) return;
			this.selectedIndex = this.selectedIndex === 0 ? this.navigableItems.length - 1 : this.selectedIndex - 1;
			this.updateList();
		}
		// Down arrow - wrap to top when at bottom
		else if (kb.matches(keyData, "selectDown")) {
			if (this.navigableItems.length === 0) return;
			this.selectedIndex = this.selectedIndex === this.navigableItems.length - 1 ? 0 : this.selectedIndex + 1;
			this.updateList();
		}
		// Enter
		else if (kb.matches(keyData, "selectConfirm")) {
			const selectedNavItem = this.navigableItems[this.selectedIndex];
			if (selectedNavItem) {
				this.handleSelect(selectedNavItem.item.model);
			}
		}
		// Escape or Ctrl+C
		else if (kb.matches(keyData, "selectCancel")) {
			this.onCancelCallback();
		} else if (matchesKey(keyData, "*")) {
			const selectedNavItem = this.navigableItems[this.selectedIndex];
			if (selectedNavItem) {
				this.toggleFavorite(selectedNavItem.item);
			}
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
