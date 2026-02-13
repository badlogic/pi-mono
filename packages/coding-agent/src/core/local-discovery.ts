/**
 * Auto-discovery for local LLM servers (Ollama, vLLM, LM Studio, llama.cpp).
 *
 * Probes well-known localhost ports, queries available models, and returns
 * them in a format ready for ModelRegistry.registerProvider().
 */

import type { Api, Model, OpenAICompletionsCompat } from "@mariozechner/pi-ai";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LocalProviderType = "ollama" | "vllm" | "lmstudio" | "llama.cpp";

export interface LocalProviderConfig {
	type: LocalProviderType;
	baseUrl: string;
	name: string;
}

export interface DiscoveredModel {
	id: string;
	name: string;
	provider: string;
	providerType: LocalProviderType;
	baseUrl: string;
	reasoning: boolean;
	input: ("text" | "image")[];
	contextWindow: number;
	maxTokens: number;
	compat?: OpenAICompletionsCompat;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_PROVIDERS: LocalProviderConfig[] = [
	{ type: "ollama", baseUrl: "http://localhost:11434", name: "ollama" },
	{ type: "vllm", baseUrl: "http://localhost:8000", name: "vllm" },
	{ type: "lmstudio", baseUrl: "http://localhost:1234", name: "lmstudio" },
	{ type: "llama.cpp", baseUrl: "http://localhost:8080", name: "llamacpp" },
];

/** Sentinel API key used for local providers that don't require authentication. */
export const LOCAL_API_KEY = "local";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	return Promise.race([
		promise,
		new Promise<T>((_, reject) => setTimeout(() => reject(new Error("Discovery timeout")), ms)),
	]);
}

/**
 * Detect appropriate compat settings based on a local model's ID.
 * This is a lightweight version – Phase 4 adds the full `local-compat.ts` in the ai package.
 */
function detectLocalModelCompat(modelId: string): OpenAICompletionsCompat {
	const id = modelId.toLowerCase();

	const base: OpenAICompletionsCompat = {
		supportsStore: false,
		supportsDeveloperRole: false,
		supportsReasoningEffort: false,
		supportsUsageInStreaming: false,
		maxTokensField: "max_tokens",
		supportsStrictMode: false,
	};

	if (id.includes("qwen")) {
		return { ...base, thinkingFormat: "qwen" };
	}

	if (id.includes("mistral") || id.includes("devstral")) {
		return {
			...base,
			requiresMistralToolIds: true,
			requiresToolResultName: true,
			requiresThinkingAsText: true,
		};
	}

	return base;
}

// ---------------------------------------------------------------------------
// Ollama discovery  (uses the `ollama` npm package)
// ---------------------------------------------------------------------------

async function discoverOllama(baseUrl: string, timeoutMs: number): Promise<DiscoveredModel[]> {
	// Dynamic import so the module is only loaded when Ollama discovery is actually used.
	const { Ollama } = await import("ollama");
	const ollama = new Ollama({ host: baseUrl });

	const listResult = await withTimeout(ollama.list(), timeoutMs);

	const results = await Promise.allSettled(
		listResult.models.map(async (entry: any): Promise<DiscoveredModel | null> => {
			try {
				const details = await withTimeout(ollama.show({ model: entry.name }), timeoutMs);

				// Filter out models that don't support tool calling
				const capabilities: string[] = (details as any).capabilities || [];
				if (!capabilities.includes("tools")) {
					return null;
				}

				const modelInfo: any = details.model_info || {};
				const architecture: string = modelInfo["general.architecture"] || "";
				const contextKey = `${architecture}.context_length`;
				const contextWindow = parseInt(modelInfo[contextKey] || "8192", 10);
				const maxTokens = contextWindow * 10;

				return {
					id: entry.name,
					name: entry.name,
					provider: "ollama",
					providerType: "ollama" as const,
					baseUrl: `${baseUrl}/v1`,
					reasoning: capabilities.includes("thinking"),
					input: ["text"] as ("text" | "image")[],
					contextWindow,
					maxTokens,
					compat: detectLocalModelCompat(entry.name),
				};
			} catch {
				return null;
			}
		}),
	);

	const discovered: DiscoveredModel[] = [];
	for (const r of results) {
		if (r.status === "fulfilled" && r.value != null) {
			discovered.push(r.value);
		}
	}
	return discovered;
}

// ---------------------------------------------------------------------------
// OpenAI-compatible discovery  (vLLM, llama.cpp, LM Studio)
// ---------------------------------------------------------------------------

async function discoverOpenAICompat(
	baseUrl: string,
	providerType: LocalProviderType,
	providerName: string,
	timeoutMs: number,
): Promise<DiscoveredModel[]> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const response = await fetch(`${baseUrl}/v1/models`, {
			signal: controller.signal,
		});

		if (!response.ok) return [];

		const data = (await response.json()) as any;
		if (!data.data || !Array.isArray(data.data)) return [];

		return data.data.map((model: any) => {
			const contextWindow = model.max_model_len || model.context_length || 8192;
			const maxTokens = Math.min(contextWindow, model.max_tokens || 4096);

			return {
				id: model.id,
				name: model.id,
				provider: providerName,
				providerType,
				baseUrl: `${baseUrl}/v1`,
				reasoning: false,
				input: ["text"] as ("text" | "image")[],
				contextWindow,
				maxTokens,
				compat: detectLocalModelCompat(model.id),
			};
		});
	} finally {
		clearTimeout(timer);
	}
}

// ---------------------------------------------------------------------------
// Provider-specific dispatcher
// ---------------------------------------------------------------------------

async function discoverFromProvider(
	provider: LocalProviderConfig,
	timeoutMs: number,
): Promise<DiscoveredModel[]> {
	switch (provider.type) {
		case "ollama":
			return discoverOllama(provider.baseUrl, timeoutMs);
		case "vllm":
		case "lmstudio":
		case "llama.cpp":
			return discoverOpenAICompat(provider.baseUrl, provider.type, provider.name, timeoutMs);
	}
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Probe all configured local providers and return every model discovered.
 *
 * Each provider is queried in parallel with an individual timeout.
 * Providers that are unreachable or error out are silently skipped.
 *
 * @param providers — Override the default provider list (useful for custom ports / settings).
 * @param timeoutMs — Per-provider timeout in milliseconds (default 2 000).
 */
export async function discoverLocalModels(
	providers?: LocalProviderConfig[],
	timeoutMs?: number,
): Promise<DiscoveredModel[]> {
	const targets = providers ?? DEFAULT_PROVIDERS;
	const timeout = timeoutMs ?? 2000;

	const results = await Promise.allSettled(targets.map((p) => discoverFromProvider(p, timeout)));

	return results
		.filter((r): r is PromiseFulfilledResult<DiscoveredModel[]> => r.status === "fulfilled")
		.flatMap((r) => r.value);
}

// ---------------------------------------------------------------------------
// Conversion helper  – turns DiscoveredModels into registerProvider() input
// ---------------------------------------------------------------------------

/**
 * Group discovered models by provider name and return them in a format that
 * can be fed directly to {@link ModelRegistry.registerProvider}.
 */
export function groupDiscoveredByProvider(models: DiscoveredModel[]): Map<
	string,
	{
		baseUrl: string;
		models: Array<{
			id: string;
			name: string;
			reasoning: boolean;
			input: ("text" | "image")[];
			cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
			contextWindow: number;
			maxTokens: number;
			compat?: Model<Api>["compat"];
		}>;
	}
> {
	const byProvider = new Map<
		string,
		{
			baseUrl: string;
			models: Array<{
				id: string;
				name: string;
				reasoning: boolean;
				input: ("text" | "image")[];
				cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
				contextWindow: number;
				maxTokens: number;
				compat?: Model<Api>["compat"];
			}>;
		}
	>();

	for (const model of models) {
		let entry = byProvider.get(model.provider);
		if (!entry) {
			entry = { baseUrl: model.baseUrl, models: [] };
			byProvider.set(model.provider, entry);
		}
		entry.models.push({
			id: model.id,
			name: model.name,
			reasoning: model.reasoning,
			input: model.input,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: model.contextWindow,
			maxTokens: model.maxTokens,
			compat: model.compat,
		});
	}

	return byProvider;
}
