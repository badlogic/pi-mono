import {
	type Api,
	type AssistantMessageEventStream,
	type Context,
	type Model,
	type SimpleStreamOptions,
	streamSimpleOpenAICompletions,
} from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { EnvSource } from "./src/env.js";
import { loadX402Env } from "./src/env.js";

const X402_API = "x402-openai-completions";

function withV1Path(origin: string): string {
	return origin.endsWith("/") ? `${origin}v1` : `${origin}/v1`;
}

function streamX402(model: Model<Api>, context: Context, options?: SimpleStreamOptions): AssistantMessageEventStream {
	const openAIModel = {
		...model,
		api: "openai-completions",
	} as Model<"openai-completions">;
	// OpenAI client adds Authorization from apiKey; set null to explicitly clear it.
	const headers = {
		...(options?.headers ?? {}),
		Authorization: null,
	} as unknown as Record<string, string>;

	return streamSimpleOpenAICompletions(openAIModel, context, {
		...options,
		apiKey: options?.apiKey ?? "x402-placeholder",
		headers,
	});
}

export function registerX402Provider(pi: ExtensionAPI, envSource: EnvSource = process.env): void {
	const env = loadX402Env(envSource);
	const staticPaymentSignature = envSource.X402_PAYMENT_SIGNATURE?.trim();
	const headers =
		staticPaymentSignature && staticPaymentSignature.length > 0
			? {
					[env.paymentHeader]: staticPaymentSignature,
				}
			: undefined;

	pi.registerProvider("x402", {
		baseUrl: withV1Path(env.routerUrl),
		apiKey: "x402-placeholder",
		api: X402_API,
		streamSimple: streamX402,
		headers,
		models: [
			{
				id: env.modelId,
				name: env.modelName,
				reasoning: true,
				input: ["text", "image"],
				cost: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
				},
				contextWindow: 200000,
				maxTokens: 32768,
			},
		],
	});
}

export default function registerX402(pi: ExtensionAPI): void {
	registerX402Provider(pi, process.env);
}
