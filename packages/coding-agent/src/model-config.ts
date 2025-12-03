import { type Api, getApiKey, getModels, getProviders, type KnownProvider, type Model } from "@mariozechner/pi-ai";
import { type Static, Type } from "@sinclair/typebox";
import AjvModule from "ajv";
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { getOAuthToken, type SupportedOAuthProvider } from "./oauth/index.js";
import { loadOAuthCredentials } from "./oauth/storage.js";
import { detectVibeProxy, generateVibeProxyConfig } from "./vibeproxy.js";

// Handle both default and named exports
const Ajv = (AjvModule as any).default || AjvModule;

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
	models: Type.Array(ModelDefinitionSchema),
});

const ModelsConfigSchema = Type.Object({
	providers: Type.Record(Type.String(), ProviderConfigSchema),
});

type ModelsConfig = Static<typeof ModelsConfigSchema>;
type ProviderConfig = Static<typeof ProviderConfigSchema>;
type ModelDefinition = Static<typeof ModelDefinitionSchema>;

// Custom provider API key mappings (provider name -> apiKey config)
const customProviderApiKeys: Map<string, string> = new Map();

/**
 * Resolve an API key config value to an actual key.
 * First checks if it's an environment variable, then treats as literal.
 */
export function resolveApiKey(keyConfig: string): string | undefined {
	// First check if it's an env var name
	const envValue = process.env[keyConfig];
	if (envValue) return envValue;

	// Otherwise treat as literal API key
	return keyConfig;
}

/**
 * Load custom models from ~/.pi/agent/models.json
 * Returns { models, error } - either models array or error message
 */
function loadCustomModels(): { models: Model<Api>[]; error: string | null } {
	const configPath = join(homedir(), ".pi", "agent", "models.json");
	if (!existsSync(configPath)) {
		return { models: [], error: null };
	}

	try {
		const content = readFileSync(configPath, "utf-8");
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
				error: `Invalid models.json schema:\n${errors}\n\nFile: ${configPath}`,
			};
		}

		// Additional validation
		try {
			validateConfig(config);
		} catch (error) {
			return {
				models: [],
				error: `Invalid models.json: ${error instanceof Error ? error.message : error}\n\nFile: ${configPath}`,
			};
		}

		// Parse models
		return { models: parseModels(config), error: null };
	} catch (error) {
		if (error instanceof SyntaxError) {
			return {
				models: [],
				error: `Failed to parse models.json: ${error.message}\n\nFile: ${configPath}`,
			};
		}
		return {
			models: [],
			error: `Failed to load models.json: ${error instanceof Error ? error.message : error}\n\nFile: ${configPath}`,
		};
	}
}

/**
 * Validate config structure and requirements
 */
function validateConfig(config: ModelsConfig): void {
	for (const [providerName, providerConfig] of Object.entries(config.providers)) {
		const hasProviderApi = !!providerConfig.api;

		for (const modelDef of providerConfig.models) {
			const hasModelApi = !!modelDef.api;

			if (!hasProviderApi && !hasModelApi) {
				throw new Error(
					`Provider ${providerName}, model ${modelDef.id}: no "api" specified. ` +
						`Set at provider or model level.`,
				);
			}

			// Validate required fields
			if (!modelDef.id) throw new Error(`Provider ${providerName}: model missing "id"`);
			if (!modelDef.name) throw new Error(`Provider ${providerName}: model missing "name"`);
			if (modelDef.contextWindow <= 0)
				throw new Error(`Provider ${providerName}, model ${modelDef.id}: invalid contextWindow`);
			if (modelDef.maxTokens <= 0)
				throw new Error(`Provider ${providerName}, model ${modelDef.id}: invalid maxTokens`);
		}
	}
}

/**
 * Parse config into Model objects
 */
function parseModels(config: ModelsConfig): Model<Api>[] {
	const models: Model<Api>[] = [];

	// Clear and rebuild custom provider API key mappings
	customProviderApiKeys.clear();

	for (const [providerName, providerConfig] of Object.entries(config.providers)) {
		// Store API key config for this provider
		customProviderApiKeys.set(providerName, providerConfig.apiKey);

		for (const modelDef of providerConfig.models) {
			// Model-level api overrides provider-level api
			const api = modelDef.api || providerConfig.api;

			if (!api) {
				// This should have been caught by validateConfig, but be safe
				continue;
			}

			// Merge headers: provider headers are base, model headers override
			const headers =
				providerConfig.headers || modelDef.headers ? { ...providerConfig.headers, ...modelDef.headers } : undefined;

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
			});
		}
	}

	return models;
}

/**
 * Get all models (built-in + custom), freshly loaded
 * Returns { models, error } - either models array or error message
 */
export function loadAndMergeModels(): { models: Model<Api>[]; error: string | null } {
	const builtInModels: Model<Api>[] = [];
	const providers = getProviders();

	// Load all built-in models
	for (const provider of providers) {
		const providerModels = getModels(provider as KnownProvider);
		builtInModels.push(...(providerModels as Model<Api>[]));
	}

	// Load custom models
	const { models: customModels, error } = loadCustomModels();

	if (error) {
		return { models: [], error };
	}

	// Merge: custom models come after built-in
	return { models: [...builtInModels, ...customModels], error: null };
}

/**
 * Load VibeProxy models through auto-detection
 */
async function loadVibeProxyModels(): Promise<Model<Api>[]> {
	try {
		const vibeproxyInfo = await detectVibeProxy();

		if (vibeproxyInfo.running) {
			const models = generateVibeProxyConfig(vibeproxyInfo.models || []);

			// Register the VibeProxy API key config
			customProviderApiKeys.set("vibeproxy", "dummy");

			return models;
		}
	} catch (error) {
		// VibeProxy detection failed, silently continue without it
		console.debug("VibeProxy detection failed:", error);
	}

	return [];
}

/**
 * Get all models (built-in + custom), freshly loaded
 * Returns { models, error } - either models array or error message
 * @deprecated Use loadAndMergeModels instead for VibeProxy support
 */
export function loadAndMergeModelsWithoutVibeProxy(): { models: Model<Api>[]; error: string | null } {
	const builtInModels: Model<Api>[] = [];
	const providers = getProviders();

	// Load all built-in models
	for (const provider of providers) {
		const providerModels = getModels(provider as KnownProvider);
		builtInModels.push(...(providerModels as Model<Api>[]));
	}

	// Load custom models
	const { models: customModels, error } = loadCustomModels();

	if (error) {
		return { models: [], error };
	}

	// Merge: custom models come after built-in
	return { models: [...builtInModels, ...customModels], error: null };
}

/**
 * Get API key for a model (checks custom providers first, then built-in)
 * Now async to support OAuth token refresh
 */
export async function getApiKeyForModel(model: Model<Api>): Promise<string | undefined> {
	// For custom providers, check their apiKey config
	const customKeyConfig = customProviderApiKeys.get(model.provider);
	if (customKeyConfig) {
		return resolveApiKey(customKeyConfig);
	}

	// For Anthropic, check OAuth first
	if (model.provider === "anthropic") {
		// 1. Check OAuth storage (auto-refresh if needed)
		const oauthToken = await getOAuthToken("anthropic");
		if (oauthToken) {
			return oauthToken;
		}

		// 2. Check ANTHROPIC_OAUTH_TOKEN env var (manual OAuth token)
		const oauthEnv = process.env.ANTHROPIC_OAUTH_TOKEN;
		if (oauthEnv) {
			return oauthEnv;
		}

		// 3. Fall back to ANTHROPIC_API_KEY env var
	}

	// For built-in providers, use getApiKey from @mariozechner/pi-ai
	return getApiKey(model.provider as KnownProvider);
}

/**
 * Get all models (built-in + custom), freshly loaded with VibeProxy auto-discovery
 * Returns { models, error } - either models array or error message
 * Use this for VibeProxy-aware functionality
 */
export async function loadAndMergeModelsAsync(): Promise<{ models: Model<Api>[]; error: string | null }> {
	const builtInModels: Model<Api>[] = [];
	const providers = getProviders();

	// Load all built-in models
	for (const provider of providers) {
		const providerModels = getModels(provider as KnownProvider);
		builtInModels.push(...(providerModels as Model<Api>[]));
	}

	// Load custom models (including VibeProxy if configured)
	const { models: customModels, error } = loadCustomModels();

	if (error) {
		return { models: [], error };
	}

	// Auto-detect VibeProxy and add it if available
	const vibeproxyModels = await loadVibeProxyModels();

	// Merge: built-in -> vibeproxy -> custom (custom takes precedence)
	return { models: [...builtInModels, ...vibeproxyModels, ...customModels], error: null };
}

/**
 * Get only models that have valid API keys available (synchronous version)
 * Returns { models, error } - either models array or error message
 */
export function getAvailableModelsSync(): { models: Model<Api>[]; error: string | null } {
	const { models: allModels, error } = loadAndMergeModels();

	if (error) {
		return { models: [], error };
	}

	const availableModels: Model<Api>[] = [];
	for (const model of allModels) {
		// For sync version, skip async API key validation
		// VibeProxy and other local providers don't need real API keys
		const isLocalProvider = model.provider === "vibeproxy" || model.baseUrl?.includes("localhost");
		if (isLocalProvider || syncGetApiKey(model.provider as KnownProvider)) {
			availableModels.push(model);
		}
	}

	return { models: availableModels, error: null };
}

/**
 * Sync version of getApiKey for simple validation
 */
function syncGetApiKey(provider: KnownProvider): string | undefined {
	switch (provider) {
		case "anthropic":
			return process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_OAUTH_TOKEN;
		case "openai":
			return process.env.OPENAI_API_KEY;
		case "google":
			return process.env.GEMINI_API_KEY;
		case "groq":
			return process.env.GROQ_API_KEY;
		case "cerebras":
			return process.env.CEREBRAS_API_KEY;
		case "xai":
			return process.env.XAI_API_KEY;
		case "openrouter":
			return process.env.OPENROUTER_API_KEY;
		case "zai":
			return process.env.ZAI_API_KEY;
		default:
			return undefined;
	}
}

/**
 * Get only models that have valid API keys available (async version with full validation)
 * Returns { models, error } - either models array or error message
 */
export async function getAvailableModels(): Promise<{ models: Model<Api>[]; error: string | null }> {
	const { models: allModels, error } = await loadAndMergeModelsAsync();

	if (error) {
		return { models: [], error };
	}

	const availableModels: Model<Api>[] = [];
	for (const model of allModels) {
		const apiKey = await getApiKeyForModel(model);
		if (apiKey) {
			availableModels.push(model);
		}
	}

	return { models: availableModels, error: null };
}

/**
 * Find a specific model by provider and ID (synchronous version without VibeProxy)
 * Returns { model, error } - either model or error message
 * @deprecated Use findModelAsync for VibeProxy support
 */
export function findModelSync(provider: string, modelId: string): { model: Model<Api> | null; error: string | null } {
	const { models: allModels, error } = loadAndMergeModelsWithoutVibeProxy();

	if (error) {
		return { model: null, error };
	}

	const model = allModels.find((m) => m.provider === provider && m.id === modelId) || null;
	return { model, error: null };
}

/**
 * Find a specific model by provider and ID (async version with VibeProxy support)
 * Returns { model, error } - either model or error message
 */
export async function findModelAsync(
	provider: string,
	modelId: string,
): Promise<{ model: Model<Api> | null; error: string | null }> {
	const { models: allModels, error } = await loadAndMergeModels();

	if (error) {
		return { model: null, error };
	}

	const model = allModels.find((m) => m.provider === provider && m.id === modelId) || null;
	return { model, error: null };
}

/**
 * Find a specific model by provider and ID
 * Returns { model, error } - either model or error message
 */
export function findModel(provider: string, modelId: string): { model: Model<Api> | null; error: string | null } {
	return findModelSync(provider, modelId);
}

/**
 * Mapping from model provider to OAuth provider ID.
 * Only providers that support OAuth are listed here.
 */
const providerToOAuthProvider: Record<string, SupportedOAuthProvider> = {
	anthropic: "anthropic",
	// Add more mappings as OAuth support is added for other providers
};

// Cache for OAuth status per provider (avoids file reads on every render)
const oauthStatusCache: Map<string, boolean> = new Map();

/**
 * Invalidate the OAuth status cache.
 * Call this after login/logout operations.
 */
export function invalidateOAuthCache(): void {
	oauthStatusCache.clear();
}

/**
 * Check if a model is using OAuth credentials (subscription).
 * This checks if OAuth credentials exist and would be used for the model,
 * without actually fetching or refreshing the token.
 * Results are cached until invalidateOAuthCache() is called.
 */
export function isModelUsingOAuth(model: Model<Api>): boolean {
	const oauthProvider = providerToOAuthProvider[model.provider];
	if (!oauthProvider) {
		return false;
	}

	// Check cache first
	if (oauthStatusCache.has(oauthProvider)) {
		return oauthStatusCache.get(oauthProvider)!;
	}

	// Check if OAuth credentials exist for this provider
	let usingOAuth = false;
	const credentials = loadOAuthCredentials(oauthProvider);
	if (credentials) {
		usingOAuth = true;
	}

	// Also check for manual OAuth token env var (for Anthropic)
	if (!usingOAuth && model.provider === "anthropic" && process.env.ANTHROPIC_OAUTH_TOKEN) {
		usingOAuth = true;
	}

	oauthStatusCache.set(oauthProvider, usingOAuth);
	return usingOAuth;
}
