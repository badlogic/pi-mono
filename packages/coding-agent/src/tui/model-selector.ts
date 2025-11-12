import { getModels, getProviders, type Model } from "@mariozechner/pi-ai";
import { Container, Input, Spacer, Text } from "@mariozechner/pi-tui";
import chalk from "chalk";

interface ModelItem {
	provider: string;
	id: string;
	model: Model<any>;
}

/**
 * Component that renders a model selector with search
 */
export class ModelSelectorComponent extends Container {
	private searchInput: Input;
	private listContainer: Container;
	private allModels: ModelItem[] = [];
	private filteredModels: ModelItem[] = [];
	private selectedIndex: number = 0;
	private currentModel: Model<any>;
	private onSelectCallback: (model: Model<any>) => void;
	private onCancelCallback: () => void;

	constructor(currentModel: Model<any>, onSelect: (model: Model<any>) => void, onCancel: () => void) {
		super();

		this.currentModel = currentModel;
		this.onSelectCallback = onSelect;
		this.onCancelCallback = onCancel;

		// Load all models
		this.loadModels();

		// Add top border
		this.addChild(new Text(chalk.blue("─".repeat(80)), 0, 0));
		this.addChild(new Spacer(1));

		// Create search input
		this.searchInput = new Input();
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
		this.addChild(new Text(chalk.blue("─".repeat(80)), 0, 0));

		// Initial render
		this.updateList();
	}

	private loadModels(): void {
		const models: ModelItem[] = [];
		const providers = getProviders();

		for (const provider of providers) {
			const providerModels = getModels(provider as any);
			for (const model of providerModels) {
				models.push({ provider, id: model.id, model });
			}
		}

		// Sort: current model first, then by provider
		models.sort((a, b) => {
			const aIsCurrent = this.currentModel?.id === a.model.id;
			const bIsCurrent = this.currentModel?.id === b.model.id;
			if (aIsCurrent && !bIsCurrent) return -1;
			if (!aIsCurrent && bIsCurrent) return 1;
			return a.provider.localeCompare(b.provider);
		});

		this.allModels = models;
		this.filteredModels = models;
	}

	private filterModels(query: string): void {
		if (!query.trim()) {
			this.filteredModels = this.allModels;
		} else {
			const searchTokens = query
				.toLowerCase()
				.split(/\s+/)
				.filter((t) => t);
			this.filteredModels = this.allModels.filter(({ provider, id, model }) => {
				const searchText = `${provider} ${id} ${model.name}`.toLowerCase();
				return searchTokens.every((token) => searchText.includes(token));
			});
		}

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
			const isCurrent = this.currentModel?.id === item.model.id;

			let line = "";
			if (isSelected) {
				const prefix = chalk.blue("→ ");
				const modelText = `${item.id}`;
				const providerBadge = chalk.gray(`[${item.provider}]`);
				const checkmark = isCurrent ? chalk.green(" ✓") : "";
				line = prefix + chalk.blue(modelText) + " " + providerBadge + checkmark;
			} else {
				const modelText = `  ${item.id}`;
				const providerBadge = chalk.gray(`[${item.provider}]`);
				const checkmark = isCurrent ? chalk.green(" ✓") : "";
				line = modelText + " " + providerBadge + checkmark;
			}

			this.listContainer.addChild(new Text(line, 0, 0));
		}

		// Add scroll indicator if needed
		if (startIndex > 0 || endIndex < this.filteredModels.length) {
			const scrollInfo = chalk.gray(`  (${this.selectedIndex + 1}/${this.filteredModels.length})`);
			this.listContainer.addChild(new Text(scrollInfo, 0, 0));
		}

		// Show "no results" if empty
		if (this.filteredModels.length === 0) {
			this.listContainer.addChild(new Text(chalk.gray("  No matching models"), 0, 0));
		}
	}

	handleInput(keyData: string): void {
		// Up arrow
		if (keyData === "\x1b[A") {
			this.selectedIndex = Math.max(0, this.selectedIndex - 1);
			this.updateList();
		}
		// Down arrow
		else if (keyData === "\x1b[B") {
			this.selectedIndex = Math.min(this.filteredModels.length - 1, this.selectedIndex + 1);
			this.updateList();
		}
		// Enter
		else if (keyData === "\r") {
			const selectedModel = this.filteredModels[this.selectedIndex];
			if (selectedModel) {
				this.handleSelect(selectedModel.model);
			}
		}
		// Escape
		else if (keyData === "\x1b") {
			this.onCancelCallback();
		}
		// Pass everything else to search input
		else {
			this.searchInput.handleInput(keyData);
			this.filterModels(this.searchInput.getValue());
		}
	}

	private handleSelect(model: Model<any>): void {
		this.onSelectCallback(model);
	}

	getSearchInput(): Input {
		return this.searchInput;
	}
}
