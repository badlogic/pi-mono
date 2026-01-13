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
			Type.Literal("openai-codex-responses"),
			Type.Literal("anthropic-messages"),
			Type.Literal("google-generative-ai"),
			Type.Literal("bedrock-converse-stream"),
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
	baseUrl: Type.Optional(Type.String({ minLength: 1 })),
	apiKey: Type.Optional(Type.String({ minLength: 1 })),
	api: Type.Optional(
		Type.Union([
			Type.Literal("openai-completions"),
			Type.Literal("openai-responses"),
			Type.Literal("openai-codex-responses"),
			Type.Literal("anthropic-messages"),
			Type.Literal("google-generative-ai"),
			Type.Literal("bedrock-converse-stream"),
		]),
	),
	headers: Type.Optional(Type.Record(Type.String(), Type.String())),
	authHeader: Type.Optional(Type.Boolean()),
	models: Type.Optional(Type.Array(ModelDefinitionSchema)),
});

const ModelsConfigSchema = Type.Object({
	providers: Type.Record(Type.String(), ProviderConfigSchema),
});

type ModelsConfig = Static<typeof ModelsConfigSchema>;

/** Provider override config (baseUrl, headers, apiKey) without custom models */
interface ProviderOverride {
	baseUrl?: string;
	headers?: Record<string, string>;
	apiKey?: string;
}

/** Result of loading custom models from models.json */
interface CustomModelsResult {
	models: Model<Api>[];
	/** Providers with custom models (full replacement) */
	replacedProviders: Set<string>;
	/** Providers with only baseUrl/headers override (no custom models) */
	overrides: Map<string, ProviderOverride>;
	error: string | undefined;
}

function emptyCustomModelsResult(error?: string): CustomModelsResult {
	return { models: [], replacedProviders: new Set(), overrides: new Map(), error };
}

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
	private loadError: string | undefined = undefined;

	constructor(
		readonly authStorage: AuthStorage,
		private modelsJsonPath: string | undefined = undefined,
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
		this.loadError = undefined;
		this.loadModels();
	}

	/**
	 * Get any error from loading models.json (undefined if no error).
	 */
	getError(): string | undefined {
		return this.loadError;
	}

	private loadModels(): void {
		// Load custom models from models.json first (to know which providers to skip/override)
		const {
			models: customModels,
			replacedProviders,
			overrides,
			error,
		} = this.modelsJsonPath ? this.loadCustomModels(this.modelsJsonPath) : emptyCustomModelsResult();

		if (error) {
			this.loadError = error;
			// Keep built-in models even if custom models failed to load
		}

		const builtInModels = this.loadBuiltInModels(replacedProviders, overrides);
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

	/** Load built-in models, skipping replaced providers and applying overrides */
	private loadBuiltInModels(replacedProviders: Set<string>, overrides: Map<string, ProviderOverride>): Model<Api>[] {
		return getProviders()
			.filter((provider) => !replacedProviders.has(provider))
			.flatMap((provider) => {
				const models = getModels(provider as KnownProvider) as Model<Api>[];
				const override = overrides.get(provider);
				if (!override) return models;

				// Apply baseUrl/headers override to all models of this provider
				return models.map((m) => ({
					...m,
					baseUrl: override.baseUrl ?? m.baseUrl,
					headers: override.headers ? { ...m.headers, ...override.headers } : m.headers,
				}));
			});
	}

	private loadCustomModels(modelsJsonPath: string): CustomModelsResult {
		if (!existsSync(modelsJsonPath)) {
			return emptyCustomModelsResult();
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
				return emptyCustomModelsResult(`Invalid models.json schema:\n${errors}\n\nFile: ${modelsJsonPath}`);
			}

			// Additional validation
			this.validateConfig(config);

			// Separate providers into "full replacement" (has models) vs "override-only" (no models)
			const replacedProviders = new Set<string>();
			const overrides = new Map<string, ProviderOverride>();

			for (const [providerName, providerConfig] of Object.entries(config.providers)) {
				if (providerConfig.models && providerConfig.models.length > 0) {
					// Has custom models -> full replacement
					replacedProviders.add(providerName);
				} else {
					// No models -> just override baseUrl/headers on built-in
					overrides.set(providerName, {
						baseUrl: providerConfig.baseUrl,
						headers: providerConfig.headers,
						apiKey: providerConfig.apiKey,
					});
					// Store API key for fallback resolver
					if (providerConfig.apiKey) {
						this.customProviderApiKeys.set(providerName, providerConfig.apiKey);
					}
				}
			}

			return { models: this.parseModels(config), replacedProviders, overrides, error: undefined };
		} catch (error) {
			if (error instanceof SyntaxError) {
				return emptyCustomModelsResult(`Failed to parse models.json: ${error.message}\n\nFile: ${modelsJsonPath}`);
			}
			return emptyCustomModelsResult(
				`Failed to load models.json: ${error instanceof Error ? error.message : error}\n\nFile: ${modelsJsonPath}`,
			);
		}
	}

	private validateConfig(config: ModelsConfig): void {
		for (const [providerName, providerConfig] of Object.entries(config.providers)) {
			const hasProviderApi = !!providerConfig.api;
			const models = providerConfig.models ?? [];

			if (models.length === 0) {
				// Override-only config: just needs baseUrl (to override built-in)
				if (!providerConfig.baseUrl) {
					throw new Error(
						`Provider ${providerName}: must specify either "baseUrl" (for override) or "models" (for replacement).`,
					);
				}
			} else {
				// Full replacement: needs baseUrl and apiKey
				if (!providerConfig.baseUrl) {
					throw new Error(`Provider ${providerName}: "baseUrl" is required when defining custom models.`);
				}
				if (!providerConfig.apiKey) {
					throw new Error(`Provider ${providerName}: "apiKey" is required when defining custom models.`);
				}
			}

			for (const modelDef of models) {
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
			const modelDefs = providerConfig.models ?? [];
			if (modelDefs.length === 0) continue; // Override-only, no custom models

			// Store API key config for fallback resolver
			if (providerConfig.apiKey) {
				this.customProviderApiKeys.set(providerName, providerConfig.apiKey);
			}

			for (const modelDef of modelDefs) {
				const api = modelDef.api || providerConfig.api;
				if (!api) continue;

				// Merge headers: provider headers are base, model headers override
				let headers =
					providerConfig.headers || modelDef.headers
						? { ...providerConfig.headers, ...modelDef.headers }
						: undefined;

				// If authHeader is true, add Authorization header with resolved API key
				if (providerConfig.authHeader && providerConfig.apiKey) {
					const resolvedKey = resolveApiKeyConfig(providerConfig.apiKey);
					if (resolvedKey) {
						headers = { ...headers, Authorization: `Bearer ${resolvedKey}` };
					}
				}

				// baseUrl is validated to exist for providers with models
				models.push({
					id: modelDef.id,
					name: modelDef.name,
					api: api as Api,
					provider: providerName,
					baseUrl: providerConfig.baseUrl!,
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
	 * Get only models that have auth configured.
	 * This is a fast check that doesn't refresh OAuth tokens.
	 */
	getAvailable(): Model<Api>[] {
		return this.models.filter((m) => this.authStorage.hasAuth(m.provider));
	}

	/**
	 * Find a model by provider and ID.
	 */
	find(provider: string, modelId: string): Model<Api> | undefined {
		return this.models.find((m) => m.provider === provider && m.id === modelId);
	}

	/**
	 * Get API key for a model.
	 */
	async getApiKey(model: Model<Api>): Promise<string | undefined> {
		return this.authStorage.getApiKey(model.provider);
	}

	/**
	 * Get API key for a provider.
	 */
	async getApiKeyForProvider(provider: string): Promise<string | undefined> {
		return this.authStorage.getApiKey(provider);
	}

	/**
	 * Check if a model is using OAuth credentials (subscription).
	 */
	isUsingOAuth(model: Model<Api>): boolean {
		const cred = this.authStorage.get(model.provider);
		return cred?.type === "oauth";
	}
}
