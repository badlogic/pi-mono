import { clearApiProviders, registerApiProvider } from "../api-registry.js";
import type { AssistantMessage, AssistantMessageEvent, Context, Model, SimpleStreamOptions } from "../types.js";
import { AssistantMessageEventStream } from "../utils/event-stream.js";
import type { BedrockOptions } from "./amazon-bedrock.js";
import { streamAnthropic, streamSimpleAnthropic } from "./anthropic.js";
import { streamAzureOpenAIResponses, streamSimpleAzureOpenAIResponses } from "./azure-openai-responses.js";
import { streamGoogle, streamSimpleGoogle } from "./google.js";
import { streamGoogleGeminiCli, streamSimpleGoogleGeminiCli } from "./google-gemini-cli.js";
import { streamGoogleVertex, streamSimpleGoogleVertex } from "./google-vertex.js";
import { streamMistral, streamSimpleMistral } from "./mistral.js";
import { streamOpenAICodexResponses, streamSimpleOpenAICodexResponses } from "./openai-codex-responses.js";
import { streamOpenAICompletions, streamSimpleOpenAICompletions } from "./openai-completions.js";
import { streamOpenAIResponses, streamSimpleOpenAIResponses } from "./openai-responses.js";

interface BedrockProviderModule {
	streamBedrock: (
		model: Model<"bedrock-converse-stream">,
		context: Context,
		options?: BedrockOptions,
	) => AsyncIterable<AssistantMessageEvent>;
	streamSimpleBedrock: (
		model: Model<"bedrock-converse-stream">,
		context: Context,
		options?: SimpleStreamOptions,
	) => AsyncIterable<AssistantMessageEvent>;
}

type DynamicImport = (specifier: string) => Promise<unknown>;

const dynamicImport: DynamicImport = (specifier) => import(specifier);
const BEDROCK_PROVIDER_SPECIFIER = "./amazon-" + "bedrock.js";

let bedrockProviderModuleOverride: BedrockProviderModule | undefined;

export function setBedrockProviderModule(module: BedrockProviderModule): void {
	bedrockProviderModuleOverride = module;
}

async function loadBedrockProviderModule(): Promise<BedrockProviderModule> {
	if (bedrockProviderModuleOverride) {
		return bedrockProviderModuleOverride;
	}
	const module = await dynamicImport(BEDROCK_PROVIDER_SPECIFIER);
	return module as BedrockProviderModule;
}

function forwardStream(target: AssistantMessageEventStream, source: AsyncIterable<AssistantMessageEvent>): void {
	(async () => {
		for await (const event of source) {
			target.push(event);
		}
		target.end();
	})();
}

function createLazyLoadErrorMessage(model: Model<"bedrock-converse-stream">, error: unknown): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: "bedrock-converse-stream",
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
		errorMessage: error instanceof Error ? error.message : String(error),
		timestamp: Date.now(),
	};
}

function streamBedrockLazy(
	model: Model<"bedrock-converse-stream">,
	context: Context,
	options?: BedrockOptions,
): AssistantMessageEventStream {
	const outer = new AssistantMessageEventStream();

	loadBedrockProviderModule()
		.then((module) => {
			const inner = module.streamBedrock(model, context, options);
			forwardStream(outer, inner);
		})
		.catch((error) => {
			const message = createLazyLoadErrorMessage(model, error);
			outer.push({ type: "error", reason: "error", error: message });
			outer.end(message);
		});

	return outer;
}

function streamSimpleBedrockLazy(
	model: Model<"bedrock-converse-stream">,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	const outer = new AssistantMessageEventStream();

	loadBedrockProviderModule()
		.then((module) => {
			const inner = module.streamSimpleBedrock(model, context, options);
			forwardStream(outer, inner);
		})
		.catch((error) => {
			const message = createLazyLoadErrorMessage(model, error);
			outer.push({ type: "error", reason: "error", error: message });
			outer.end(message);
		});

	return outer;
}

export function registerBuiltInApiProviders(): void {
	registerApiProvider({
		api: "anthropic-messages",
		stream: streamAnthropic,
		streamSimple: streamSimpleAnthropic,
	});

	registerApiProvider({
		api: "openai-completions",
		stream: streamOpenAICompletions,
		streamSimple: streamSimpleOpenAICompletions,
	});

	registerApiProvider({
		api: "mistral-conversations",
		stream: streamMistral,
		streamSimple: streamSimpleMistral,
	});

	registerApiProvider({
		api: "openai-responses",
		stream: streamOpenAIResponses,
		streamSimple: streamSimpleOpenAIResponses,
	});

	registerApiProvider({
		api: "azure-openai-responses",
		stream: streamAzureOpenAIResponses,
		streamSimple: streamSimpleAzureOpenAIResponses,
	});

	registerApiProvider({
		api: "openai-codex-responses",
		stream: streamOpenAICodexResponses,
		streamSimple: streamSimpleOpenAICodexResponses,
	});

	registerApiProvider({
		api: "google-generative-ai",
		stream: streamGoogle,
		streamSimple: streamSimpleGoogle,
	});

	registerApiProvider({
		api: "google-gemini-cli",
		stream: streamGoogleGeminiCli,
		streamSimple: streamSimpleGoogleGeminiCli,
	});

	registerApiProvider({
		api: "google-vertex",
		stream: streamGoogleVertex,
		streamSimple: streamSimpleGoogleVertex,
	});

	registerApiProvider({
		api: "bedrock-converse-stream",
		stream: streamBedrockLazy,
		streamSimple: streamSimpleBedrockLazy,
	});
}

export function resetApiProviders(): void {
	clearApiProviders();
	registerBuiltInApiProviders();
}

registerBuiltInApiProviders();
