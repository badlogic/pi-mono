import { Alert, Badge, Button, DialogHeader, html, type TemplateResult } from "@mariozechner/mini-lit";
import { type Context, complete, getModel, getProviders } from "@mariozechner/pi-ai";
import type { PropertyValues } from "lit";
import { customElement, state } from "lit/decorators.js";
import { Input } from "../Input.js";
import { keyStore } from "../state/KeyStore.js";
import { i18n } from "../utils/i18n.js";
import { DialogBase } from "./DialogBase.js";

// Test models for each provider - known to be reliable and cheap
const TEST_MODELS: Record<string, string> = {
	anthropic: "claude-3-5-haiku-20241022",
	openai: "gpt-4o-mini",
	google: "gemini-2.0-flash-exp",
	groq: "llama-3.3-70b-versatile",
	openrouter: "openai/gpt-4o-mini",
	cerebras: "llama3.1-8b",
	xai: "grok-2-1212",
	zai: "glm-4-plus",
};

@customElement("api-keys-dialog")
export class ApiKeysDialog extends DialogBase {
	@state() apiKeys: Record<string, boolean> = {}; // provider -> configured
	@state() apiKeyInputs: Record<string, string> = {};
	@state() testResults: Record<string, "success" | "error" | "testing"> = {};
	@state() savingProvider = "";
	@state() testingProvider = "";
	@state() error = "";

	protected override modalWidth = "min(600px, 90vw)";
	protected override modalHeight = "min(600px, 80vh)";

	static async open() {
		const dialog = new ApiKeysDialog();
		dialog.open();
		await dialog.loadKeys();
	}

	override async firstUpdated(changedProperties: PropertyValues): Promise<void> {
		super.firstUpdated(changedProperties);
		await this.loadKeys();
	}

	private async loadKeys() {
		this.apiKeys = await keyStore.getAllKeys();
	}

	private async testApiKey(provider: string, apiKey: string): Promise<boolean> {
		try {
			// Get the test model for this provider
			const modelId = TEST_MODELS[provider];
			if (!modelId) {
				this.error = `No test model configured for ${provider}`;
				return false;
			}

			const model = getModel(provider as any, modelId);
			if (!model) {
				this.error = `Test model ${modelId} not found for ${provider}`;
				return false;
			}

			// Simple test prompt
			const context: Context = {
				messages: [{ role: "user", content: "Reply with exactly: test successful" }],
			};
			const response = await complete(model, context, {
				apiKey,
				maxTokens: 10, // Keep it minimal for testing
			} as any);

			// Check if response contains expected text
			const text = response.content
				.filter((b) => b.type === "text")
				.map((b) => b.text)
				.join("");

			return text.toLowerCase().includes("test successful");
		} catch (error) {
			console.error(`API key test failed for ${provider}:`, error);
			return false;
		}
	}

	private async saveKey(provider: string) {
		const key = this.apiKeyInputs[provider];
		if (!key) return;

		this.savingProvider = provider;
		this.testResults[provider] = "testing";
		this.error = "";

		try {
			// Test the key first
			const isValid = await this.testApiKey(provider, key);

			if (isValid) {
				await keyStore.setKey(provider, key);
				this.apiKeyInputs[provider] = ""; // Clear input
				await this.loadKeys();
				this.testResults[provider] = "success";
			} else {
				this.testResults[provider] = "error";
				this.error = `Invalid API key for ${provider}`;
			}
		} catch (err: any) {
			this.testResults[provider] = "error";
			this.error = `Failed to save key for ${provider}: ${err.message}`;
		} finally {
			this.savingProvider = "";

			// Clear test result after 3 seconds
			setTimeout(() => {
				delete this.testResults[provider];
				this.requestUpdate();
			}, 3000);
		}
	}

	private async testExistingKey(provider: string) {
		this.testingProvider = provider;
		this.testResults[provider] = "testing";
		this.error = "";

		try {
			const apiKey = await keyStore.getKey(provider);
			if (!apiKey) {
				this.testResults[provider] = "error";
				this.error = `No API key found for ${provider}`;
				return;
			}

			const isValid = await this.testApiKey(provider, apiKey);

			if (isValid) {
				this.testResults[provider] = "success";
			} else {
				this.testResults[provider] = "error";
				this.error = `API key for ${provider} is no longer valid`;
			}
		} catch (err: any) {
			this.testResults[provider] = "error";
			this.error = `Test failed for ${provider}: ${err.message}`;
		} finally {
			this.testingProvider = "";

			// Clear test result after 3 seconds
			setTimeout(() => {
				delete this.testResults[provider];
				this.requestUpdate();
			}, 3000);
		}
	}

	private async removeKey(provider: string) {
		if (!confirm(`Remove API key for ${provider}?`)) return;

		await keyStore.removeKey(provider);
		this.apiKeyInputs[provider] = "";
		await this.loadKeys();
	}

	protected override renderContent(): TemplateResult {
		const providers = getProviders();

		return html`
			<div class="flex flex-col h-full">
				<!-- Header -->
				<div class="p-6 pb-4 border-b border-border flex-shrink-0">
					${DialogHeader({ title: i18n("API Keys Configuration") })}
					<p class="text-sm text-muted-foreground mt-2">
						${i18n("Configure API keys for LLM providers. Keys are stored locally in your browser.")}
					</p>
				</div>

				<!-- Error message -->
				${
					this.error
						? html`
							<div class="px-6 pt-4">${Alert(this.error, "destructive")}</div>
						`
						: ""
				}

				<!-- Scrollable content -->
				<div class="flex-1 overflow-y-auto p-6">
					<div class="space-y-6">
						${providers.map(
							(provider) => html`
								<div class="space-y-3">
									<div class="flex items-center gap-2">
										<span class="text-sm font-medium capitalize">${provider}</span>
										${
											this.apiKeys[provider]
												? Badge({ children: i18n("Configured"), variant: "default" })
												: Badge({ children: i18n("Not configured"), variant: "secondary" })
										}
										${
											this.testResults[provider] === "success"
												? Badge({ children: i18n("✓ Valid"), variant: "default" })
												: this.testResults[provider] === "error"
													? Badge({ children: i18n("✗ Invalid"), variant: "destructive" })
													: this.testResults[provider] === "testing"
														? Badge({ children: i18n("Testing..."), variant: "secondary" })
														: ""
										}
									</div>

									<div class="flex gap-2">
										${Input({
											type: "password",
											placeholder: this.apiKeys[provider] ? i18n("Update API key") : i18n("Enter API key"),
											value: this.apiKeyInputs[provider] || "",
											onInput: (e: Event) => {
												this.apiKeyInputs[provider] = (e.target as HTMLInputElement).value;
												this.requestUpdate();
											},
											className: "flex-1",
										})}

										${Button({
											onClick: () => this.saveKey(provider),
											variant: "default",
											size: "sm",
											disabled: !this.apiKeyInputs[provider] || this.savingProvider === provider,
											loading: this.savingProvider === provider,
											children:
												this.savingProvider === provider
													? i18n("Testing...")
													: this.apiKeys[provider]
														? i18n("Update")
														: i18n("Save"),
										})}

										${
											this.apiKeys[provider]
												? html`
													${Button({
														onClick: () => this.testExistingKey(provider),
														variant: "outline",
														size: "sm",
														loading: this.testingProvider === provider,
														disabled: this.testingProvider !== "" && this.testingProvider !== provider,
														children:
															this.testingProvider === provider ? i18n("Testing...") : i18n("Test"),
													})}
													${Button({
														onClick: () => this.removeKey(provider),
														variant: "ghost",
														size: "sm",
														children: i18n("Remove"),
													})}
												`
												: ""
										}
									</div>
								</div>
							`,
						)}
					</div>
				</div>

				<!-- Footer with help text -->
				<div class="p-6 pt-4 border-t border-border flex-shrink-0">
					<p class="text-xs text-muted-foreground">
						${i18n("API keys are required to use AI models. Get your keys from the provider's website.")}
					</p>
				</div>
			</div>
		`;
	}
}
