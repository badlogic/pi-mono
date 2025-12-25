/**
 * Model registry - manages built-in and custom models, provides API key resolution.
 */

import {
	type Api,
	getGitHubCopilotBaseUrl,
	getModels,
	getProviders,
	type KnownProvider,
	type Model,
	normalizeDomain,
} from "@mariozechner/pi-ai";
import { type Static, Type } from "@sinclair/typebox";
import AjvModule from "ajv";
import { existsSync, readFileSync } from "fs";
import type { AuthStorage } from "./auth-storage.js";

const Ajv = (AjvModule as any).default || AjvModule;

// Schema for OpenAI compatibility settings
const OpenAICompatSchema = Type.Object({
	supportsStore: Type.Optional(Type.Boolean()),
	supportsDeveloperRole: Type.Optional(Type.Boolean()),
	supportsReasoningEffort: Type.Optional(Type.Boolean()),
	maxTokensField: Type.Optional(Type.Union([Type.Literal("max_completion_tokens"), Type.Literal("max_tokens")])),
});

// Schema for custom model definition
const ModelDefinitionSchema = Type.Object({
	id: Type.String({ minLength: 1 }),
	name: Type.String({ minLength: 1 }),
	api: Type.Optional(
		Type.Union([
			Type.Literal("openai-completions"),
			Type.Literal("openai-responses"),
			Type.Literal("anthropic-messages"),
			Type.Literal("google-generative-ai"),
		]),
	),
	reasoning: Type.Boolean(),
	input: Type.Array(Type.Union([Type.Literal("text"), Type.Literal("image")])),
	cost: Type.Object({
		input: Type.Number(),
		output: Type.Number(),
		cacheRead: Type.Number(),
		cacheWrite: Type.Number(),
	}),
	contextWindow: Type.Number(),
	maxTokens: Type.Number(),
	headers: Type.Optional(Type.Record(Type.String(), Type.String())),
	compat: Type.Optional(OpenAICompatSchema),
});

const ProviderConfigSchema = Type.Object({
	baseUrl: Type.String({ minLength: 1 }),
	apiKey: Type.String({ minLength: 1 }),
	api: Type.Optional(
		Type.Union([
			Type.Literal("openai-completions"),
			Type.Literal("openai-responses"),
			Type.Literal("anthropic-messages"),
			Type.Literal("google-generative-ai"),
		]),
	),
	headers: Type.Optional(Type.Record(Type.String(), Type.String())),
	authHeader: Type.Optional(Type.Boolean()),
	models: Type.Array(ModelDefinitionSchema),
});

const ModelsConfigSchema = Type.Object({
	providers: Type.Record(Type.String(), ProviderConfigSchema),
});

type ModelsConfig = Static<typeof ModelsConfigSchema>;

/**
 * Resolve an API key config value to an actual key.
 * Checks environment variable first, then treats as literal.
 */
function resolveApiKeyConfig(keyConfig: string): string | undefined {
	const envValue = process.env[keyConfig];
	if (envValue) return envValue;
	return keyConfig;
}

/**
 * Model registry - loads and manages models, resolves API keys via AuthStorage.
 */
export class ModelRegistry {
	private models: Model<Api>[] = [];
	private customProviderApiKeys: Map<string, string> = new Map();
	private loadError: string | null = null;

	constructor(
		readonly authStorage: AuthStorage,
		private modelsJsonPath: string | null = null,
	) {
		// Set up fallback resolver for custom provider API keys
		this.authStorage.setFallbackResolver((provider) => {
			const keyConfig = this.customProviderApiKeys.get(provider);
			if (keyConfig) {
				return resolveApiKeyConfig(keyConfig);
			}
			return undefined;
		});

		// Load models
		this.loadModels();
	}

	/**
	 * Reload models from disk (built-in + custom from models.json).
	 */
	refresh(): void {
		this.customProviderApiKeys.clear();
		this.loadError = null;
		this.loadModels();
	}

	/**
	 * Get any error from loading models.json (null if no error).
	 */
	getError(): string | null {
		return this.loadError;
	}

	private loadModels(): void {
		// Load built-in models
		const builtInModels: Model<Api>[] = [];
		for (const provider of getProviders()) {
			const providerModels = getModels(provider as KnownProvider);
			builtInModels.push(...(providerModels as Model<Api>[]));
		}

		// Load custom models from models.json (if path provided)
		let customModels: Model<Api>[] = [];
		if (this.modelsJsonPath) {
			const result = this.loadCustomModels(this.modelsJsonPath);
			if (result.error) {
				this.loadError = result.error;
				// Keep built-in models even if custom models failed to load
			} else {
				customModels = result.models;
			}
		}

		const combined = [...builtInModels, ...customModels];

		// Update github-copilot base URL based on OAuth credentials
		const copilotCred = this.authStorage.get("github-copilot");
		if (copilotCred?.type === "oauth") {
			const domain = copilotCred.enterpriseUrl
				? (normalizeDomain(copilotCred.enterpriseUrl) ?? undefined)
				: undefined;
			const baseUrl = getGitHubCopilotBaseUrl(copilotCred.access, domain);
			this.models = combined.map((m) => (m.provider === "github-copilot" ? { ...m, baseUrl } : m));
		} else {
			this.models = combined;
		}
	}

	private loadCustomModels(modelsJsonPath: string): { models: Model<Api>[]; error: string | null } {
		if (!existsSync(modelsJsonPath)) {
			return { models: [], error: null };
		}

		try {
			const content = readFileSync(modelsJsonPath, "utf-8");
			const config: ModelsConfig = JSON.parse(content);

			// Validate schema
			const ajv = new Ajv();
			const validate = ajv.compile(ModelsConfigSchema);
			if (!validate(config)) {
				const errors =
					validate.errors?.map((e: any) => `  - ${e.instancePath || "root"}: ${e.message}`).join("\n") ||
					"Unknown schema error";
				return {
					models: [],
					error: `Invalid models.json schema:\n${errors}\n\nFile: ${modelsJsonPath}`,
				};
			}

			// Additional validation
			this.validateConfig(config);

			// Parse models
			return { models: this.parseModels(config), error: null };
		} catch (error) {
			if (error instanceof SyntaxError) {
				return {
					models: [],
					error: `Failed to parse models.json: ${error.message}\n\nFile: ${modelsJsonPath}`,
				};
			}
			return {
				models: [],
				error: `Failed to load models.json: ${error instanceof Error ? error.message : error}\n\nFile: ${modelsJsonPath}`,
			};
		}
	}

	private validateConfig(config: ModelsConfig): void {
		for (const [providerName, providerConfig] of Object.entries(config.providers)) {
			const hasProviderApi = !!providerConfig.api;

			for (const modelDef of providerConfig.models) {
				const hasModelApi = !!modelDef.api;

				if (!hasProviderApi && !hasModelApi) {
					throw new Error(
						`Provider ${providerName}, model ${modelDef.id}: no "api" specified. Set at provider or model level.`,
					);
				}

				if (!modelDef.id) throw new Error(`Provider ${providerName}: model missing "id"`);
				if (!modelDef.name) throw new Error(`Provider ${providerName}: model missing "name"`);
				if (modelDef.contextWindow <= 0)
					throw new Error(`Provider ${providerName}, model ${modelDef.id}: invalid contextWindow`);
				if (modelDef.maxTokens <= 0)
					throw new Error(`Provider ${providerName}, model ${modelDef.id}: invalid maxTokens`);
			}
		}
	}

	private parseModels(config: ModelsConfig): Model<Api>[] {
		const models: Model<Api>[] = [];

		for (const [providerName, providerConfig] of Object.entries(config.providers)) {
			// Store API key config for fallback resolver
			this.customProviderApiKeys.set(providerName, providerConfig.apiKey);

			for (const modelDef of providerConfig.models) {
				const api = modelDef.api || providerConfig.api;
				if (!api) continue;

				// Merge headers: provider headers are base, model headers override
				let headers =
					providerConfig.headers || modelDef.headers
						? { ...providerConfig.headers, ...modelDef.headers }
						: undefined;

				// If authHeader is true, add Authorization header with resolved API key
				if (providerConfig.authHeader) {
					const resolvedKey = resolveApiKeyConfig(providerConfig.apiKey);
					if (resolvedKey) {
						headers = { ...headers, Authorization: `Bearer ${resolvedKey}` };
					}
				}

				models.push({
					id: modelDef.id,
					name: modelDef.name,
					api: api as Api,
					provider: providerName,
					baseUrl: providerConfig.baseUrl,
					reasoning: modelDef.reasoning,
					input: modelDef.input as ("text" | "image")[],
					cost: modelDef.cost,
					contextWindow: modelDef.contextWindow,
					maxTokens: modelDef.maxTokens,
					headers,
					compat: modelDef.compat,
				} as Model<Api>);
			}
		}

		return models;
	}

	/**
	 * Get all models (built-in + custom).
	 * If models.json had errors, returns only built-in models.
	 */
	getAll(): Model<Api>[] {
		return this.models;
	}

	/**
	 * Get only models that have valid API keys available.
	 */
	async getAvailable(): Promise<Model<Api>[]> {
		const available: Model<Api>[] = [];
		for (const model of this.models) {
			const apiKey = await this.authStorage.getApiKey(model.provider);
			if (apiKey) {
				available.push(model);
			}
		}
		return available;
	}

	/**
	 * Find a model by provider and ID.
	 */
	find(provider: string, modelId: string): Model<Api> | null {
		return this.models.find((m) => m.provider === provider && m.id === modelId) ?? null;
	}

	/**
	 * Get API key for a model.
	 */
	async getApiKey(model: Model<Api>): Promise<string | null> {
		return this.authStorage.getApiKey(model.provider);
	}

	/**
	 * Check if a model is using OAuth credentials (subscription).
	 */
	isUsingOAuth(model: Model<Api>): boolean {
		const cred = this.authStorage.get(model.provider);
		return cred?.type === "oauth";
	}
}
