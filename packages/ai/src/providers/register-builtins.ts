import { clearApiProviders, registerApiProvider } from "../api-registry.js";
import type { Api, Context, Model, SimpleStreamOptions, StreamOptions } from "../types.js";
import { AssistantMessageEventStream } from "../utils/event-stream.js";

export function registerBuiltInApiProviders(): void {
	registerApiProvider({
		api: "anthropic-messages",
		stream: (...args) => lazyStream("anthropic", () => import("./anthropic.js"), "streamAnthropic", ...args),
		streamSimple: (...args) =>
			lazyStream("anthropic", () => import("./anthropic.js"), "streamSimpleAnthropic", ...args),
	});

	registerApiProvider({
		api: "openai-completions",
		stream: (...args) =>
			lazyStream("openai-completions", () => import("./openai-completions.js"), "streamOpenAICompletions", ...args),
		streamSimple: (...args) =>
			lazyStream(
				"openai-completions",
				() => import("./openai-completions.js"),
				"streamSimpleOpenAICompletions",
				...args,
			),
	});

	registerApiProvider({
		api: "openai-responses",
		stream: (...args) =>
			lazyStream("openai-responses", () => import("./openai-responses.js"), "streamOpenAIResponses", ...args),
		streamSimple: (...args) =>
			lazyStream("openai-responses", () => import("./openai-responses.js"), "streamSimpleOpenAIResponses", ...args),
	});

	registerApiProvider({
		api: "azure-openai-responses",
		stream: (...args) =>
			lazyStream(
				"azure-openai-responses",
				() => import("./azure-openai-responses.js"),
				"streamAzureOpenAIResponses",
				...args,
			),
		streamSimple: (...args) =>
			lazyStream(
				"azure-openai-responses",
				() => import("./azure-openai-responses.js"),
				"streamSimpleAzureOpenAIResponses",
				...args,
			),
	});

	registerApiProvider({
		api: "openai-codex-responses",
		stream: (...args) =>
			lazyStream(
				"openai-codex-responses",
				() => import("./openai-codex-responses.js"),
				"streamOpenAICodexResponses",
				...args,
			),
		streamSimple: (...args) =>
			lazyStream(
				"openai-codex-responses",
				() => import("./openai-codex-responses.js"),
				"streamSimpleOpenAICodexResponses",
				...args,
			),
	});

	registerApiProvider({
		api: "google-generative-ai",
		stream: (...args) => lazyStream("google", () => import("./google.js"), "streamGoogle", ...args),
		streamSimple: (...args) => lazyStream("google", () => import("./google.js"), "streamSimpleGoogle", ...args),
	});

	registerApiProvider({
		api: "google-gemini-cli",
		stream: (...args) =>
			lazyStream("google-gemini-cli", () => import("./google-gemini-cli.js"), "streamGoogleGeminiCli", ...args),
		streamSimple: (...args) =>
			lazyStream(
				"google-gemini-cli",
				() => import("./google-gemini-cli.js"),
				"streamSimpleGoogleGeminiCli",
				...args,
			),
	});

	registerApiProvider({
		api: "google-vertex",
		stream: (...args) =>
			lazyStream("google-vertex", () => import("./google-vertex.js"), "streamGoogleVertex", ...args),
		streamSimple: (...args) =>
			lazyStream("google-vertex", () => import("./google-vertex.js"), "streamSimpleGoogleVertex", ...args),
	});

	registerApiProvider({
		api: "bedrock-converse-stream",
		stream: (...args) => lazyStream("amazon-bedrock", () => import("./amazon-bedrock.js"), "streamBedrock", ...args),
		streamSimple: (...args) =>
			lazyStream("amazon-bedrock", () => import("./amazon-bedrock.js"), "streamSimpleBedrock", ...args),
	});
}

export function resetApiProviders(): void {
	clearApiProviders();
	registerBuiltInApiProviders();
}

registerBuiltInApiProviders();

const moduleCache = new Map<string, Promise<any>>();

function emitError(proxy: AssistantMessageEventStream, model: Model<Api>, err: unknown): void {
	proxy.push({
		type: "error",
		reason: "error",
		error: {
			role: "assistant",
			content: [],
			api: model.api,
			provider: model.provider,
			model: model.id,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "error",
			errorMessage: err instanceof Error ? err.message : String(err),
			timestamp: Date.now(),
		},
	});
}

function lazyStream(
	moduleKey: string,
	loader: () => Promise<any>,
	fnName: string,
	model: Model<Api>,
	context: Context,
	options?: StreamOptions | SimpleStreamOptions,
): AssistantMessageEventStream {
	const proxy = new AssistantMessageEventStream();

	let mod = moduleCache.get(moduleKey);
	if (!mod) {
		mod = loader();
		moduleCache.set(moduleKey, mod);
	}

	(async () => {
		try {
			const m = await mod;
			const real = m[fnName](model, context, options) as AssistantMessageEventStream;
			for await (const event of real) {
				proxy.push(event);
			}
		} catch (err) {
			emitError(proxy, model, err);
		}
	})();

	return proxy;
}
