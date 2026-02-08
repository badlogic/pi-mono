/**
 * A test suite to ensure Amazon Bedrock models work correctly with the agent loop.
 *
 * Some Bedrock models don't support all features (e.g., reasoning signatures).
 * This test suite verifies that the agent loop works with various Bedrock models.
 *
 * This test suite is not enabled by default unless AWS credentials and
 * `BEDROCK_EXTENSIVE_MODEL_TEST` environment variables are set.
 *
 * You can run this test suite with:
 * ```bash
 * $ AWS_REGION=us-east-1 BEDROCK_EXTENSIVE_MODEL_TEST=1 AWS_PROFILE=pi npm test -- ./test/bedrock-models.test.ts
 * ```
 *
 * ## Known Issues by Category
 *
 * 1. **Inference Profile Required**: Some models require an inference profile ARN instead of on-demand.
 * 2. **Invalid Model ID**: Model identifiers that don't exist in the current region.
 * 3. **Max Tokens Exceeded**: Model's maxTokens in our config exceeds the actual limit.
 * 4. **No Reasoning in User Messages**: Model rejects reasoning content when replayed in conversation.
 * 5. **Invalid Signature Format**: Model validates signature format (Anthropic newer models).
 */

import type { AssistantMessage } from "@mariozechner/pi-ai";
import { getModels } from "@mariozechner/pi-ai";
import { describe, expect, it } from "vitest";
import { Agent } from "../src/index.js";
import { hasBedrockCredentials } from "./bedrock-utils.js";

// =============================================================================
// Known Issue Categories
// =============================================================================

/** Models that require inference profile ARN (not available on-demand in us-east-1) */
const REQUIRES_INFERENCE_PROFILE = new Set([
	"anthropic.claude-3-5-haiku-20241022-v1:0",
	"anthropic.claude-3-5-sonnet-20241022-v2:0",
	"anthropic.claude-3-opus-20240229-v1:0",
	"meta.llama3-1-70b-instruct-v1:0",
	"meta.llama3-1-8b-instruct-v1:0",
]);

/** Models with invalid identifiers (not available in us-east-1 or don't exist) */
const INVALID_MODEL_ID = new Set([
	"deepseek.v3-v1:0",
	"eu.anthropic.claude-haiku-4-5-20251001-v1:0",
	"eu.anthropic.claude-opus-4-5-20251101-v1:0",
	"eu.anthropic.claude-sonnet-4-5-20250929-v1:0",
	"qwen.qwen3-235b-a22b-2507-v1:0",
	"qwen.qwen3-coder-480b-a35b-v1:0",
]);

/** Models where our maxTokens config exceeds the model's actual limit */
const MAX_TOKENS_EXCEEDED = new Set([
	"us.meta.llama4-maverick-17b-instruct-v1:0",
	"us.meta.llama4-scout-17b-instruct-v1:0",
]);

/**
 * Models that reject reasoning content in user messages (when replaying conversation).
 * These work for multi-turn but fail when synthetic thinking is injected.
 */
const NO_REASONING_IN_USER_MESSAGES = new Set([
	// Mistral models
	"mistral.ministral-3-14b-instruct",
	"mistral.ministral-3-8b-instruct",
	"mistral.mistral-large-2402-v1:0",
	"mistral.voxtral-mini-3b-2507",
	"mistral.voxtral-small-24b-2507",
	// Nvidia models
	"nvidia.nemotron-nano-12b-v2",
	"nvidia.nemotron-nano-9b-v2",
	// Qwen models
	"qwen.qwen3-coder-30b-a3b-v1:0",
	// Amazon Nova models
	"us.amazon.nova-lite-v1:0",
	"us.amazon.nova-micro-v1:0",
	"us.amazon.nova-premier-v1:0",
	"us.amazon.nova-pro-v1:0",
	// Meta Llama models
	"us.meta.llama3-2-11b-instruct-v1:0",
	"us.meta.llama3-2-1b-instruct-v1:0",
	"us.meta.llama3-2-3b-instruct-v1:0",
	"us.meta.llama3-2-90b-instruct-v1:0",
	"us.meta.llama3-3-70b-instruct-v1:0",
	// DeepSeek
	"us.deepseek.r1-v1:0",
	// Older Anthropic models
	"anthropic.claude-3-5-sonnet-20240620-v1:0",
	"anthropic.claude-3-haiku-20240307-v1:0",
	"anthropic.claude-3-sonnet-20240229-v1:0",
	// Cohere models
	"cohere.command-r-plus-v1:0",
	"cohere.command-r-v1:0",
	// Google models
	"google.gemma-3-27b-it",
	"google.gemma-3-4b-it",
	// Non-Anthropic models that don't support signatures (now handled by omitting signature)
	// but still reject reasoning content in user messages
	"global.amazon.nova-2-lite-v1:0",
	"minimax.minimax-m2",
	"moonshot.kimi-k2-thinking",
	"openai.gpt-oss-120b-1:0",
	"openai.gpt-oss-20b-1:0",
	"openai.gpt-oss-safeguard-120b",
	"openai.gpt-oss-safeguard-20b",
	"qwen.qwen3-32b-v1:0",
	"qwen.qwen3-next-80b-a3b",
	"qwen.qwen3-vl-235b-a22b",
]);

/**
 * Models that validate signature format (Anthropic newer models).
 * These work for multi-turn but fail when synthetic/invalid signature is injected.
 */
const VALIDATES_SIGNATURE_FORMAT = new Set([
	"global.anthropic.claude-haiku-4-5-20251001-v1:0",
	"global.anthropic.claude-opus-4-5-20251101-v1:0",
	"global.anthropic.claude-sonnet-4-20250514-v1:0",
	"global.anthropic.claude-sonnet-4-5-20250929-v1:0",
	"us.anthropic.claude-3-7-sonnet-20250219-v1:0",
	"us.anthropic.claude-opus-4-1-20250805-v1:0",
	"us.anthropic.claude-opus-4-20250514-v1:0",
]);

/**
 * DeepSeek R1 fails multi-turn because it rejects reasoning in the replayed assistant message.
 */
const REJECTS_REASONING_ON_REPLAY = new Set(["us.deepseek.r1-v1:0"]);

// =============================================================================
// Helper Functions
// =============================================================================

function isModelUnavailable(modelId: string): boolean {
	return REQUIRES_INFERENCE_PROFILE.has(modelId) || INVALID_MODEL_ID.has(modelId) || MAX_TOKENS_EXCEEDED.has(modelId);
}

function failsMultiTurnWithThinking(modelId: string): boolean {
	return REJECTS_REASONING_ON_REPLAY.has(modelId);
}

function failsSyntheticSignature(modelId: string): boolean {
	return NO_REASONING_IN_USER_MESSAGES.has(modelId) || VALIDATES_SIGNATURE_FORMAT.has(modelId);
}

// =============================================================================
// Tests
// =============================================================================

describe("Amazon Bedrock Models - Agent Loop", () => {
	const shouldRunExtensiveTests = hasBedrockCredentials() && process.env.BEDROCK_EXTENSIVE_MODEL_TEST;

	// Get all Amazon Bedrock models
	const allBedrockModels = getModels("amazon-bedrock");

	if (shouldRunExtensiveTests) {
		for (const model of allBedrockModels) {
			const modelId = model.id;

			describe(`Model: ${modelId}`, () => {
				// Skip entirely unavailable models
				const unavailable = isModelUnavailable(modelId);

				it.skipIf(unavailable)("should handle basic text prompt", { timeout: 60_000 }, async () => {
					const agent = new Agent({
						initialState: {
							systemPrompt: "You are a helpful assistant. Be extremely concise.",
							model,
							thinkingLevel: "off",
							tools: [],
						},
					});

					await agent.prompt("Reply with exactly: 'OK'");

					if (agent.state.error) {
						throw new Error(`Basic prompt error: ${agent.state.error}`);
					}

					expect(agent.state.isStreaming).toBe(false);
					expect(agent.state.messages.length).toBe(2);

					const assistantMessage = agent.state.messages[1];
					if (assistantMessage.role !== "assistant") throw new Error("Expected assistant message");

					console.log(`${modelId}: OK`);
				});

				// Skip if model is unavailable or known to fail multi-turn with thinking
				const skipMultiTurn = unavailable || failsMultiTurnWithThinking(modelId);

				it.skipIf(skipMultiTurn)(
					"should handle multi-turn conversation with thinking content in history",
					{ timeout: 120_000 },
					async () => {
						const agent = new Agent({
							initialState: {
								systemPrompt: "You are a helpful assistant. Be extremely concise.",
								model,
								thinkingLevel: "medium",
								tools: [],
							},
						});

						// First turn
						await agent.prompt("My name is Alice.");

						if (agent.state.error) {
							throw new Error(`First turn error: ${agent.state.error}`);
						}

						// Second turn - this should replay the first assistant message which may contain thinking
						await agent.prompt("What is my name?");

						if (agent.state.error) {
							throw new Error(`Second turn error: ${agent.state.error}`);
						}

						expect(agent.state.messages.length).toBe(4);
						console.log(`${modelId}: multi-turn OK`);
					},
				);

				// Skip if model is unavailable or known to fail synthetic signature
				const skipSynthetic = unavailable || failsSyntheticSignature(modelId);

				it.skipIf(skipSynthetic)(
					"should handle conversation with synthetic thinking signature in history",
					{ timeout: 60_000 },
					async () => {
						const agent = new Agent({
							initialState: {
								systemPrompt: "You are a helpful assistant. Be extremely concise.",
								model,
								thinkingLevel: "off",
								tools: [],
							},
						});

						// Inject a message with a thinking block that has a signature
						const syntheticAssistantMessage: AssistantMessage = {
							role: "assistant",
							content: [
								{
									type: "thinking",
									thinking: "I need to remember the user's name.",
									thinkingSignature: "synthetic-signature-123",
								},
								{ type: "text", text: "Nice to meet you, Alice!" },
							],
							api: "bedrock-converse-stream",
							provider: "amazon-bedrock",
							model: modelId,
							usage: {
								input: 10,
								output: 20,
								cacheRead: 0,
								cacheWrite: 0,
								totalTokens: 30,
								cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
							},
							stopReason: "stop",
							timestamp: Date.now(),
						};

						agent.replaceMessages([
							{ role: "user", content: "My name is Alice.", timestamp: Date.now() },
							syntheticAssistantMessage,
						]);

						await agent.prompt("What is my name?");

						if (agent.state.error) {
							throw new Error(`Synthetic signature error: ${agent.state.error}`);
						}

						expect(agent.state.messages.length).toBe(4);
						console.log(`${modelId}: synthetic signature OK`);
					},
				);
			});
		}
	} else {
		it.skip("skipped - set AWS credentials and BEDROCK_EXTENSIVE_MODEL_TEST=1 to run", () => {});
	}
});
