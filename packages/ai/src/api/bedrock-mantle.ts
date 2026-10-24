// Bedrock Mantle: Amazon Bedrock's OpenAI-compatible endpoint, which serves
// models Converse does not (GPT, Grok, Gemma). This module reuses the OpenAI
// Responses implementation with the region filled into the catalog URL and a
// Bedrock API key as the bearer token.
// https://docs.aws.amazon.com/bedrock/latest/userguide/bedrock-mantle.html

import type { Model, ProviderEnv, SimpleStreamOptions, StreamFunction, TranscriptContext } from "../types.ts";
import type { AssistantMessageEventStream } from "../utils/event-stream.ts";
import { getProviderEnvValue } from "../utils/provider-env.ts";
import { lazyStream } from "./lazy.ts";
import {
	type OpenAIResponsesOptions,
	stream as responsesStream,
	streamSimple as responsesStreamSimple,
} from "./openai-responses.ts";

/** The region Mantle requests go to, resolved like Bedrock Converse requests. */
export function resolveMantleRegion(env: ProviderEnv | undefined): string {
	return getProviderEnvValue("AWS_REGION", env) || getProviderEnvValue("AWS_DEFAULT_REGION", env) || "us-east-1";
}

/** The Bedrock API key for Mantle: a stored credential or `AWS_BEARER_TOKEN_BEDROCK`. */
export function resolveMantleBearerToken(apiKey: string | undefined, env: ProviderEnv | undefined): string {
	const token = apiKey || getProviderEnvValue("AWS_BEARER_TOKEN_BEDROCK", env);
	if (!token) {
		throw new Error(
			"Bedrock Mantle models need an Amazon Bedrock API key. Set AWS_BEARER_TOKEN_BEDROCK or log in with a bearer token; AWS profiles and IAM credentials are not supported for these models yet.",
		);
	}
	return token;
}

function prepare<TOptions extends OpenAIResponsesOptions | SimpleStreamOptions>(
	model: Model<"openai-responses">,
	options: TOptions | undefined,
): { model: Model<"openai-responses">; options: TOptions } {
	return {
		model: { ...model, baseUrl: model.baseUrl.replace("{region}", resolveMantleRegion(options?.env)) },
		options: { ...options, apiKey: resolveMantleBearerToken(options?.apiKey, options?.env) } as TOptions,
	};
}

export const stream: StreamFunction<"openai-responses", OpenAIResponsesOptions> = (
	model: Model<"openai-responses">,
	context: TranscriptContext,
	options?: OpenAIResponsesOptions,
): AssistantMessageEventStream =>
	lazyStream(model, async () => {
		const prepared = prepare(model, options);
		return responsesStream(prepared.model, context, prepared.options);
	});

export const streamSimple: StreamFunction<"openai-responses", SimpleStreamOptions> = (
	model: Model<"openai-responses">,
	context: TranscriptContext,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream =>
	lazyStream(model, async () => {
		const prepared = prepare(model, options);
		return responsesStreamSimple(prepared.model, context, prepared.options);
	});
