import { type Model, modelsAreEqual } from "@mariozechner/pi-ai";
import {
	Container,
	fuzzyFilter,
	getEditorKeybindings,
	Input,
	Key,
	matchesKey,
	Spacer,
	TabBar,
	Text,
	type TUI,
} from "@mariozechner/pi-tui";
import type { ModelRegistry } from "../../../core/model-registry.js";
import { decodeRecentModelKey, RECENT_MODELS_LIMIT, type SettingsManager } from "../../../core/settings-manager.js";
import { theme } from "../theme/theme.js";
import { DynamicBorder } from "./dynamic-border.js";

const ALL_TAB = "ALL";
const RECENT_TAB = "RECENT";

interface ModelItem {
	provider: string;
	id: string;
	model: Model<any>;
	usedAt?: number; // Timestamp when model was last used (for sorting)
}

interface ScopedModelItem {
	model: Model<any>;
	thinkingLevel: string;
}

/**
 * Component that renders a model selector with provider tabs and search
 * - Tab/Arrow Left/Right: Switch between provider tabs (if enabled)
 * - Arrow Up/Down: Navigate model list
 * - Enter: Select model
 * - Escape: Close selector
 *
 * Provider tabs can be enabled via settings.enableModelProviderTabs
 */
export class ModelSelectorComponent extends Container {
	private searchInput: Input;
	private headerContainer: Container;
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
	private enableProviderTabs: boolean;
	private tabBar?: TabBar;
	private recentModelsCount: number = 0;

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
		this.enableProviderTabs = settingsManager.getEnableModelProviderTabs();

		// Add top border
		this.addChild(new DynamicBorder());

		// Add hint about model filtering
		const hintText =
			scopedModels.length > 0
				? "Showing models from --models scope"
				: "Only showing models with configured API keys";
		this.addChild(new Text(theme.fg("warning", hintText), 0, 0));
		this.addChild(new Spacer(1));

		// Create header container for tab bar
		this.headerContainer = new Container();
		if (this.enableProviderTabs) {
			this.addChild(this.headerContainer);
			this.addChild(new Spacer(1));
		}

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
			this.buildTabBar();
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

		// Sort: current model first, then by provider, then by id
		models.sort((a, b) => {
			const aIsCurrent = modelsAreEqual(this.currentModel, a.model);
			const bIsCurrent = modelsAreEqual(this.currentModel, b.model);
			if (aIsCurrent && !bIsCurrent) return -1;
			if (!aIsCurrent && bIsCurrent) return 1;
			const providerCmp = a.provider.localeCompare(b.provider);
			if (providerCmp !== 0) return providerCmp;
			return a.id.localeCompare(b.id);
		});

		this.allModels = models;
		this.filteredModels = models;
		this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, models.length - 1));

		// Load recent models from settings
		this.loadRecentModels();
	}

	private loadRecentModels(): void {
		// Get recent models from settings
		const recentModelIds = this.settingsManager.getRecentModels();
		const modelKeyMap = new Map<string, ModelItem>();
		for (const item of this.allModels) {
			modelKeyMap.set(`${item.provider}/${item.id}`, item);
		}

		// Count and add usage timestamps to models based on recent list order
		this.recentModelsCount = 0;
		const seenModels = new Set<string>();
		for (let i = 0; i < recentModelIds.length && i < RECENT_MODELS_LIMIT; i++) {
			const modelIdStr = recentModelIds[i]!;
			const parsed = decodeRecentModelKey(modelIdStr);
			const lookupKey = parsed ? `${parsed.provider}/${parsed.modelId}` : modelIdStr;
			const model = modelKeyMap.get(lookupKey);
			if (!model) {
				continue;
			}
			const canonicalKey = `${model.provider}/${model.id}`;
			if (seenModels.has(canonicalKey)) {
				continue;
			}
			seenModels.add(canonicalKey);
			// Use inverse index as timestamp (earlier in list = more recent)
			model.usedAt = Date.now() - i * 1000;
			this.recentModelsCount++;
		}
	}

	private buildTabBar(): void {
		if (!this.enableProviderTabs) {
			this.headerContainer.clear();
			return;
		}

		// Extract unique providers from models
		const providerSet = new Set<string>();
		for (const item of this.allModels) {
			providerSet.add(item.provider.toUpperCase());
		}
		// Sort providers alphabetically
		const sortedProviders = Array.from(providerSet).sort();

		// Build tabs: ALL, RECENT, then providers
		const tabs = [{ id: ALL_TAB, label: ALL_TAB }];

		// Add RECENT tab only if there are recent models
		if (this.recentModelsCount > 0) {
			tabs.push({ id: RECENT_TAB, label: RECENT_TAB });
		}

		for (const provider of sortedProviders) {
			tabs.push({ id: provider, label: provider });
		}

		// Create TabBar component
		this.tabBar = new TabBar("Provider", tabs, {
			label: (text) => theme.fg("muted", text),
			activeTab: (text) => theme.fg("accent", text),
			inactiveTab: (text) => theme.fg("muted", text),
			hint: (text) => theme.fg("dim", text),
		});

		// Set callback for tab changes
		this.tabBar.onTabChange = (_tab) => {
			this.selectedIndex = 0;
			this.applyTabFilter();
		};

		// Replace header content with TabBar
		this.headerContainer.clear();
		this.headerContainer.addChild(new Text(this.tabBar.render(0)[0], 0, 0));
	}

	private getActiveProvider(): string {
		if (!this.tabBar) {
			return ALL_TAB;
		}
		return this.tabBar.getActiveTab().id;
	}

	private filterModels(query: string): void {
		const activeProvider = this.getActiveProvider();

		// Start with all models or filter by provider
		let baseModels = this.allModels;

		if (activeProvider === RECENT_TAB) {
			// Show only recent models
			baseModels = this.allModels.filter((m) => m.usedAt !== undefined);
			// Sort by usage time (most recent first)
			baseModels.sort((a, b) => (b.usedAt ?? 0) - (a.usedAt ?? 0));
		} else if (activeProvider !== ALL_TAB) {
			// Filter by provider
			baseModels = this.allModels.filter((m) => m.provider.toUpperCase() === activeProvider);
		}

		// Apply fuzzy filter if query is present
		if (query.trim()) {
			// If user is searching, auto-switch to ALL tab to show global results
			if (activeProvider !== ALL_TAB && this.tabBar) {
				// Clear callback to prevent infinite loop during programmatic index change
				const originalCallback = this.tabBar.onTabChange;
				this.tabBar.onTabChange = undefined;
				this.tabBar.setActiveIndex(0);
				this.headerContainer.clear();
				this.headerContainer.addChild(new Text(this.tabBar.render(0)[0], 0, 0));
				this.tabBar.onTabChange = originalCallback;
				baseModels = this.allModels;
			}
			this.filteredModels = fuzzyFilter(baseModels, query, ({ id, provider }) => `${id} ${provider}`);
		} else {
			this.filteredModels = baseModels;
		}

		this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.filteredModels.length - 1));
		this.updateList();
	}

	private applyTabFilter(): void {
		const query = this.searchInput.getValue();
		this.filterModels(query);
	}

	private updateList(): void {
		this.listContainer.clear();

		const maxVisible = 12;
		const startIndex = Math.max(
			0,
			Math.min(this.selectedIndex - Math.floor(maxVisible / 2), this.filteredModels.length - maxVisible),
		);
		const endIndex = Math.min(startIndex + maxVisible, this.filteredModels.length);

		const activeProvider = this.getActiveProvider();
		const showProvider = activeProvider === ALL_TAB || activeProvider === RECENT_TAB;

		// Show visible slice of filtered models
		for (let i = startIndex; i < endIndex; i++) {
			const item = this.filteredModels[i];
			if (!item) continue;

			const isSelected = i === this.selectedIndex;
			const isCurrent = modelsAreEqual(this.currentModel, item.model);

			let line = "";
			if (isSelected) {
				const prefix = theme.fg("accent", "►");
				const modelText = ` ${item.id}`;
				if (showProvider) {
					const providerBadge = theme.fg("muted", `[${item.provider}]`);
					const checkmark = isCurrent ? theme.fg("success", " ✓") : "";
					line = `${prefix}${modelText} ${providerBadge}${checkmark}`;
				} else {
					const checkmark = isCurrent ? theme.fg("success", " ✓") : "";
					line = `${prefix}${modelText}${checkmark}`;
				}
			} else {
				const prefix = " ";
				const modelText = ` ${item.id}`;
				if (showProvider) {
					const providerBadge = theme.fg("muted", `[${item.provider}]`);
					const checkmark = isCurrent ? theme.fg("success", " ✓") : "";
					line = `${prefix}${modelText} ${providerBadge}${checkmark}`;
				} else {
					const checkmark = isCurrent ? theme.fg("success", " ✓") : "";
					line = `${prefix}${modelText}${checkmark}`;
				}
			}

			this.listContainer.addChild(new Text(line, 0, 0));
		}

		// Add scroll indicator if needed
		if (startIndex > 0 || endIndex < this.filteredModels.length) {
			const scrollInfo = theme.fg("muted", ` (${this.selectedIndex + 1}/${this.filteredModels.length})`);
			this.listContainer.addChild(new Text(scrollInfo, 0, 0));
		}

		// Show error message or "no results" if empty
		if (this.errorMessage) {
			const errorLines = this.errorMessage.split("\n");
			for (const line of errorLines) {
				this.listContainer.addChild(new Text(theme.fg("error", line), 0, 0));
			}
		} else if (this.filteredModels.length === 0) {
			this.listContainer.addChild(new Text(theme.fg("muted", " No matching models"), 0, 0));
		}
	}

	handleInput(keyData: string): void {
		const kb = getEditorKeybindings();
		const hasSearchText = this.searchInput.getValue().trim().length > 0;

		// Tab bar navigation (only when enabled and not searching)
		if (this.enableProviderTabs && !hasSearchText && this.tabBar) {
			// Allow Tab/Shift+Tab, but only allow arrow keys when tab bar has more than 1 tab
			const allowArrow = this.tabBar.getActiveTab().id !== ALL_TAB || this.tabBar.getActiveIndex() > 0;
			if (
				matchesKey(keyData, Key.tab) ||
				matchesKey(keyData, Key.right) ||
				(allowArrow && matchesKey(keyData, Key.left)) ||
				matchesKey(keyData, Key.shift("tab"))
			) {
				if (this.tabBar.handleInput(keyData)) {
					this.headerContainer.clear();
					this.headerContainer.addChild(new Text(this.tabBar.render(0)[0], 0, 0));
					return;
				}
			}
		}

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
		else if (kb.matches(keyData, "selectCancel") || matchesKey(keyData, Key.escape)) {
			this.onCancelCallback();
		}
		// Pass everything else to search input
		else {
			this.searchInput.handleInput(keyData);
			this.filterModels(this.searchInput.getValue());
		}
	}

	private handleSelect(model: Model<any>): void {
		// Save as new default (this also adds to recent models)
		this.settingsManager.setDefaultModelAndProvider(model.provider, model.id);
		this.onSelectCallback(model);
	}

	getSearchInput(): Input {
		return this.searchInput;
	}
}
