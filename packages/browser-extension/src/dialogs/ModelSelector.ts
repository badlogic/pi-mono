import { Badge, Button, DialogHeader, html, icon, type TemplateResult } from "@mariozechner/mini-lit";
import type { Model } from "@mariozechner/pi-ai";
import { MODELS } from "@mariozechner/pi-ai/dist/models.generated.js";
import type { PropertyValues } from "lit";
import { customElement, state } from "lit/decorators.js";
import { createRef, ref } from "lit/directives/ref.js";
import { Brain, Image as ImageIcon } from "lucide";
import { Ollama } from "ollama/dist/browser.mjs";
import { Input } from "../Input.js";
import { formatModelCost } from "../utils/format.js";
import { i18n } from "../utils/i18n.js";
import { DialogBase } from "./DialogBase.js";

@customElement("agent-model-selector")
export class ModelSelector extends DialogBase {
	@state() currentModel: Model<any> | null = null;
	@state() searchQuery = "";
	@state() filterThinking = false;
	@state() filterVision = false;
	@state() ollamaModels: Model<any>[] = [];
	@state() ollamaError: string | null = null;
	@state() selectedIndex = 0;
	@state() private navigationMode: "mouse" | "keyboard" = "mouse";

	private onSelectCallback?: (model: Model<any>) => void;
	private scrollContainerRef = createRef<HTMLDivElement>();
	private searchInputRef = createRef<HTMLInputElement>();
	private lastMousePosition = { x: 0, y: 0 };

	protected override modalWidth = "min(400px, 90vw)";

	static async open(currentModel: Model<any> | null, onSelect: (model: Model<any>) => void) {
		const selector = new ModelSelector();
		selector.currentModel = currentModel;
		selector.onSelectCallback = onSelect;
		selector.open();
		selector.fetchOllamaModels();
	}

	override async firstUpdated(changedProperties: PropertyValues): Promise<void> {
		super.firstUpdated(changedProperties);
		// Wait for dialog to be fully rendered
		await this.updateComplete;
		// Focus the search input when dialog opens
		this.searchInputRef.value?.focus();

		// Track actual mouse movement
		this.addEventListener("mousemove", (e: MouseEvent) => {
			// Check if mouse actually moved
			if (e.clientX !== this.lastMousePosition.x || e.clientY !== this.lastMousePosition.y) {
				this.lastMousePosition = { x: e.clientX, y: e.clientY };
				// Only switch to mouse mode on actual mouse movement
				if (this.navigationMode === "keyboard") {
					this.navigationMode = "mouse";
					// Update selection to the item under the mouse
					const target = e.target as HTMLElement;
					const modelItem = target.closest("[data-model-item]");
					if (modelItem) {
						const allItems = this.scrollContainerRef.value?.querySelectorAll("[data-model-item]");
						if (allItems) {
							const index = Array.from(allItems).indexOf(modelItem);
							if (index !== -1) {
								this.selectedIndex = index;
							}
						}
					}
				}
			}
		});

		// Add global keyboard handler for the dialog
		this.addEventListener("keydown", (e: KeyboardEvent) => {
			// Get filtered models to know the bounds
			const filteredModels = this.getFilteredModels();

			if (e.key === "ArrowDown") {
				e.preventDefault();
				this.navigationMode = "keyboard";
				this.selectedIndex = Math.min(this.selectedIndex + 1, filteredModels.length - 1);
				this.scrollToSelected();
			} else if (e.key === "ArrowUp") {
				e.preventDefault();
				this.navigationMode = "keyboard";
				this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
				this.scrollToSelected();
			} else if (e.key === "Enter") {
				e.preventDefault();
				if (filteredModels[this.selectedIndex]) {
					this.handleSelect(filteredModels[this.selectedIndex].model);
				}
			}
		});
	}

	private async fetchOllamaModels() {
		try {
			// Create Ollama client
			const ollama = new Ollama({ host: "http://localhost:11434" });

			// Get list of available models
			const { models } = await ollama.list();

			// Fetch details for each model and convert to Model format
			const ollamaModelPromises: Promise<Model<any> | null>[] = models
				.map(async (model) => {
					try {
						// Get model details
						const details = await ollama.show({
							model: model.name,
						});

						// Some Ollama servers don't report capabilities; don't filter on them

						// Extract model info
						const modelInfo: any = details.model_info || {};

						// Get context window size - look for architecture-specific keys
						const architecture = modelInfo["general.architecture"] || "";
						const contextKey = `${architecture}.context_length`;
						const contextWindow = parseInt(modelInfo[contextKey] || "8192", 10);
						const maxTokens = 4096; // Default max output tokens

						// Create Model object manually since ollama models aren't in MODELS constant
						const ollamaModel: Model<any> = {
							id: model.name,
							name: model.name,
							api: "openai-completions" as any,
							provider: "ollama",
							baseUrl: "http://localhost:11434/v1",
							reasoning: false,
							input: ["text"],
							cost: {
								input: 0,
								output: 0,
								cacheRead: 0,
								cacheWrite: 0,
							},
							contextWindow: contextWindow,
							maxTokens: maxTokens,
						};

						return ollamaModel;
					} catch (err) {
						console.error(`Failed to fetch details for model ${model.name}:`, err);
						return null;
					}
				})
				.filter((m) => m !== null);

			const results = await Promise.all(ollamaModelPromises);
			this.ollamaModels = results.filter((m): m is Model<any> => m !== null);
		} catch (err) {
			// Ollama not available or other error - silently ignore
			console.debug("Ollama not available:", err);
			this.ollamaError = err instanceof Error ? err.message : String(err);
		}
	}

	private formatTokens(tokens: number): string {
		if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(0)}M`;
		if (tokens >= 1000) return `${(tokens / 1000).toFixed(0)}`;
		return String(tokens);
	}

	private handleSelect(model: Model<any>) {
		if (model) {
			this.onSelectCallback?.(model);
			this.close();
		}
	}

	private getFilteredModels(): Array<{ provider: string; id: string; model: any }> {
		// Collect all models from all providers
		const allModels: Array<{ provider: string; id: string; model: any }> = [];
		for (const [provider, providerData] of Object.entries(MODELS)) {
			for (const [modelId, model] of Object.entries(providerData)) {
				allModels.push({ provider, id: modelId, model });
			}
		}

		// Add Ollama models
		for (const ollamaModel of this.ollamaModels) {
			allModels.push({
				id: ollamaModel.id,
				provider: "ollama",
				model: ollamaModel,
			});
		}

		// Filter models based on search and capability filters
		let filteredModels = allModels;

		// Apply search filter
		if (this.searchQuery) {
			filteredModels = filteredModels.filter(({ provider, id, model }) => {
				const searchTokens = this.searchQuery.split(/\s+/).filter((t) => t);
				const searchText = `${provider} ${id} ${model.name}`.toLowerCase();
				return searchTokens.every((token) => searchText.includes(token));
			});
		}

		// Apply capability filters
		if (this.filterThinking) {
			filteredModels = filteredModels.filter(({ model }) => model.reasoning);
		}
		if (this.filterVision) {
			filteredModels = filteredModels.filter(({ model }) => model.input.includes("image"));
		}

		// Sort: current model first, then by provider
		filteredModels.sort((a, b) => {
			const aIsCurrent = this.currentModel?.id === a.model.id;
			const bIsCurrent = this.currentModel?.id === b.model.id;
			if (aIsCurrent && !bIsCurrent) return -1;
			if (!aIsCurrent && bIsCurrent) return 1;
			return a.provider.localeCompare(b.provider);
		});

		return filteredModels;
	}

	private scrollToSelected() {
		requestAnimationFrame(() => {
			const scrollContainer = this.scrollContainerRef.value;
			const selectedElement = scrollContainer?.querySelectorAll("[data-model-item]")[
				this.selectedIndex
			] as HTMLElement;
			if (selectedElement) {
				selectedElement.scrollIntoView({ block: "nearest", behavior: "smooth" });
			}
		});
	}

	protected override renderContent(): TemplateResult {
		const filteredModels = this.getFilteredModels();

		return html`
			<!-- Header and Search -->
			<div class="p-6 pb-4 flex flex-col gap-4 border-b border-border flex-shrink-0">
				${DialogHeader({ title: i18n("Select Model") })}
				${Input({
					placeholder: i18n("Search models..."),
					value: this.searchQuery,
					inputRef: this.searchInputRef,
					onInput: (e: Event) => {
						this.searchQuery = (e.target as HTMLInputElement).value;
						this.selectedIndex = 0;
						// Reset scroll position when search changes
						if (this.scrollContainerRef.value) {
							this.scrollContainerRef.value.scrollTop = 0;
						}
					},
				})}
				<div class="flex gap-2">
					${Button({
						variant: this.filterThinking ? "default" : "secondary",
						size: "sm",
						onClick: () => {
							this.filterThinking = !this.filterThinking;
							this.selectedIndex = 0;
							if (this.scrollContainerRef.value) {
								this.scrollContainerRef.value.scrollTop = 0;
							}
						},
						className: "rounded-full",
						children: html`<span class="inline-flex items-center gap-1">${icon(Brain, "sm")} ${i18n("Thinking")}</span>`,
					})}
					${Button({
						variant: this.filterVision ? "default" : "secondary",
						size: "sm",
						onClick: () => {
							this.filterVision = !this.filterVision;
							this.selectedIndex = 0;
							if (this.scrollContainerRef.value) {
								this.scrollContainerRef.value.scrollTop = 0;
							}
						},
						className: "rounded-full",
						children: html`<span class="inline-flex items-center gap-1">${icon(ImageIcon, "sm")} ${i18n("Vision")}</span>`,
					})}
				</div>
			</div>

			<!-- Scrollable model list -->
			<div class="flex-1 overflow-y-auto" ${ref(this.scrollContainerRef)}>
				${filteredModels.map(({ provider, id, model }, index) => {
					// Check if this is the current model by comparing IDs
					const isCurrent = this.currentModel?.id === model.id;
					const isSelected = index === this.selectedIndex;
					return html`
						<div
							data-model-item
							class="px-4 py-3 ${
								this.navigationMode === "mouse" ? "hover:bg-muted" : ""
							} cursor-pointer border-b border-border ${isSelected ? "bg-accent" : ""}"
							@click=${() => this.handleSelect(model)}
							@mouseenter=${() => {
								// Only update selection in mouse mode
								if (this.navigationMode === "mouse") {
									this.selectedIndex = index;
								}
							}}
						>
							<div class="flex items-center justify-between gap-2 mb-1">
								<div class="flex items-center gap-2 flex-1 min-w-0">
									<span class="text-sm font-medium text-foreground truncate">${id}</span>
									${isCurrent ? html`<span class="text-green-500">✓</span>` : ""}
								</div>
								${Badge(provider, "outline")}
							</div>
							<div class="flex items-center justify-between text-xs text-muted-foreground">
								<div class="flex items-center gap-2">
									<span class="${model.reasoning ? "" : "opacity-30"}">${icon(Brain, "sm")}</span>
									<span class="${model.input.includes("image") ? "" : "opacity-30"}">${icon(ImageIcon, "sm")}</span>
									<span>${this.formatTokens(model.contextWindow)}K/${this.formatTokens(model.maxTokens)}K</span>
								</div>
								<span>${formatModelCost(model.cost)}</span>
							</div>
						</div>
					`;
				})}
			</div>
		`;
	}
}
