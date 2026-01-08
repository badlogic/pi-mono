/**
 * Google Gemini CLI / Antigravity provider.
 * Shared implementation for both google-gemini-cli and google-antigravity providers.
 * Uses the Cloud Code Assist API endpoint to access Gemini and Claude models.
 */

import type { Content, ThinkingConfig } from "@google/genai";
import { calculateCost } from "../models.js";
import type {
	Api,
	AssistantMessage,
	Context,
	Model,
	StreamFunction,
	StreamOptions,
	TextContent,
	ThinkingContent,
	ToolCall,
} from "../types.js";
import { AssistantMessageEventStream } from "../utils/event-stream.js";
import { sanitizeSurrogates } from "../utils/sanitize-unicode.js";
import {
	convertMessages,
	convertTools,
	isThinkingPart,
	mapStopReasonString,
	mapToolChoice,
	retainThoughtSignature,
} from "./google-shared.js";

/**
 * Thinking level for Gemini 3 models.
 * Mirrors Google's ThinkingLevel enum values.
 */
export type GoogleThinkingLevel = "THINKING_LEVEL_UNSPECIFIED" | "MINIMAL" | "LOW" | "MEDIUM" | "HIGH";

export interface GoogleGeminiCliOptions extends StreamOptions {
	toolChoice?: "auto" | "none" | "any";
	/**
	 * Thinking/reasoning configuration.
	 * - Gemini 2.x models: use `budgetTokens` to set the thinking budget
	 * - Gemini 3 models (gemini-3-pro-*, gemini-3-flash-*): use `level` instead
	 *
	 * When using `streamSimple`, this is handled automatically based on the model.
	 */
	thinking?: {
		enabled: boolean;
		/** Thinking budget in tokens. Use for Gemini 2.x models. */
		budgetTokens?: number;
		/** Thinking level. Use for Gemini 3 models (LOW/HIGH for Pro, MINIMAL/LOW/MEDIUM/HIGH for Flash). */
		level?: GoogleThinkingLevel;
	};
	projectId?: string;
}

const DEFAULT_ENDPOINT = "https://cloudcode-pa.googleapis.com";
// Headers for Gemini CLI (prod endpoint)
const GEMINI_CLI_HEADERS = {
	"User-Agent": "google-cloud-sdk vscode_cloudshelleditor/0.1",
	"X-Goog-Api-Client": "gl-node/22.17.0",
	"Client-Metadata": JSON.stringify({
		ideType: "IDE_UNSPECIFIED",
		platform: "PLATFORM_UNSPECIFIED",
		pluginType: "GEMINI",
	}),
};

// Headers for Antigravity (sandbox endpoint) - requires specific User-Agent
const ANTIGRAVITY_HEADERS = {
	"User-Agent": "antigravity/1.11.5 darwin/arm64",
	"X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
	"Client-Metadata": JSON.stringify({
		ideType: "IDE_UNSPECIFIED",
		platform: "PLATFORM_UNSPECIFIED",
		pluginType: "GEMINI",
	}),
};

// Antigravity system instruction (ported from CLIProxyAPI v6.6.89).
const ANTIGRAVITY_SYSTEM_INSTRUCTION = `<identity>
You are Antigravity, a powerful agentic AI coding assistant designed by the Google DeepMind team working on Advanced Agentic Coding.
You are pair programming with a USER to solve their coding task. The task may require creating a new codebase, modifying or debugging an existing codebase, or simply answering a question.
The USER will send you requests, which you must always prioritize addressing. Along with each USER request, we will attach additional metadata about their current state, such as what files they have open and where their cursor is.
This information may or may not be relevant to the coding task, it is up for you to decide.
</identity>

<tool_calling>
Call tools as you normally would. The following list provides additional guidance to help you avoid errors:
  - **Absolute paths only**. When using tools that accept file path arguments, ALWAYS use the absolute file path.
</tool_calling>

<web_application_development>
## Technology Stack
Your web applications should be built using the following technologies:
1. **Core**: Use HTML for structure and JavaScript for logic.
2. **Styling (CSS)**: Use Vanilla CSS for maximum flexibility and control. Avoid using TailwindCSS unless the USER explicitly requests it; in this case, first confirm which TailwindCSS version to use.
3. **Web App**: If the USER specifies that they want a more complex web app, use a framework like Next.js or Vite. Only do this if the USER explicitly requests a web app.
4. **New Project Creation**: If you need to use a framework for a new app, use \`npx\` with the appropriate script, but there are some rules to follow:
   - Use \`npx -y\` to automatically install the script and its dependencies
   - You MUST run the command with \`--help\` flag to see all available options first
   - Initialize the app in the current directory with \`./\` (example: \`npx -y create-vite-app@latest ./\`)
   - You should run in non-interactive mode so that the user doesn't need to input anything
5. **Running Locally**: When running locally, use \`npm run dev\` or equivalent dev server. Only build the production bundle if the USER explicitly requests it or you are validating the code for correctness.

# Design Aesthetics
1. **Use Rich Aesthetics**: The USER should be wowed at first glance by the design. Use best practices in modern web design (e.g. vibrant colors, dark modes, glassmorphism, and dynamic animations) to create a stunning first impression. Failure to do this is UNACCEPTABLE.
2. **Prioritize Visual Excellence**: Implement designs that will WOW the user and feel extremely premium:
   - Avoid generic colors (plain red, blue, green). Use curated, harmonious color palettes (e.g., HSL tailored colors, sleek dark modes).
   - Using modern typography (e.g., from Google Fonts like Inter, Roboto, or Outfit) instead of browser defaults.
   - Use smooth gradients
   - Add subtle micro-animations for enhanced user experience
3. **Use a Dynamic Design**: An interface that feels responsive and alive encourages interaction. Achieve this with hover effects and interactive elements. Micro-animations, in particular, are highly effective for improving user engagement.
4. **Premium Designs**: Make a design that feels premium and state of the art. Avoid creating simple minimum viable products.
5. **Don't use placeholders**: If you need an image, use your generate_image tool to create a working demonstration.

## Implementation Workflow
Follow this systematic approach when building web applications:
1. **Plan and Understand**:
   - Fully understand the user's requirements
   - Draw inspiration from modern, beautiful, and dynamic web designs
   - Outline the features needed for the initial version
2. **Build the Foundation**:
   - Start by creating/modifying \`index.css\`
   - Implement the core design system with all tokens and utilities
3. **Create Components**:
   - Build necessary components using your design system
   - Ensure all components use predefined styles, not ad-hoc utilities
   - Keep components focused and reusable
4. **Assemble Pages**:
   - Update the main application to incorporate your design and components
   - Ensure proper routing and navigation
   - Implement responsive layouts
5. **Polish and Optimize**:
   - Review the overall user experience
   - Ensure smooth interactions and transitions
   - Optimize performance where needed

## SEO Best Practices
Automatically implement SEO best practices on every page:
- **Title Tags**: Include proper, descriptive title tags for each page
- **Meta Descriptions**: Add compelling meta descriptions that accurately summarize page content
- **Heading Structure**: Use a single \`<h1>\` per page with proper heading hierarchy
- **Semantic HTML**: Use appropriate HTML5 semantic elements
- **Unique IDs**: Ensure all interactive elements have unique, descriptive IDs for browser testing
- **Performance**: Ensure fast page load times through optimization
CRITICAL REMINDER: AESTHETICS ARE VERY IMPORTANT. If your web app looks simple and basic then you have FAILED!
</web_application_development>
<ephemeral_message>
There will be an <EPHEMERAL_MESSAGE> appearing in the conversation at times. This is not coming from the user, but instead injected by the system as important information to pay attention to. 
Do not respond to nor acknowledge those messages, but do follow them strictly.
</ephemeral_message>

<communication_style>
- **Formatting**. Format your responses in github-style markdown to make your responses easier for the USER to parse. For example, use headers to organize your responses and bolded or italicized text to highlight important keywords. Use backticks to format file, directory, function, and class names. If providing a URL to the user, format this in markdown as well, for example \`[label](example.com)\`.
- **Proactiveness**. As an agent, you are allowed to be proactive, but only in the course of completing the user's task. For example, if the user asks you to add a new component, you can edit the code, verify build and test statuses, and take any other obvious follow-up actions, such as performing additional research. However, avoid surprising the user. For example, if the user asks HOW to approach something, you should answer their question and instead of jumping into editing a file.
- **Helpfulness**. Respond like a helpful software engineer who is explaining your work to a friendly collaborator on the project. Acknowledge mistakes or any backtracking you do as a result of new information.
- **Ask for clarification**. If you are unsure about the USER's intent, always ask for clarification rather than making assumptions.
</communication_style>`;

// Counter for generating unique tool call IDs
let toolCallCounter = 0;

// Retry configuration
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

/**
 * Extract retry delay from Gemini error response (in milliseconds).
 * Parses patterns like:
 * - "Your quota will reset after 39s"
 * - "Your quota will reset after 18h31m10s"
 * - "Please retry in Xs" or "Please retry in Xms"
 * - "retryDelay": "34.074824224s" (JSON field)
 */
function extractRetryDelay(errorText: string): number | undefined {
	// Pattern 1: "Your quota will reset after ..." (formats: "18h31m10s", "10m15s", "6s", "39s")
	const durationMatch = errorText.match(/reset after (?:(\d+)h)?(?:(\d+)m)?(\d+(?:\.\d+)?)s/i);
	if (durationMatch) {
		const hours = durationMatch[1] ? parseInt(durationMatch[1], 10) : 0;
		const minutes = durationMatch[2] ? parseInt(durationMatch[2], 10) : 0;
		const seconds = parseFloat(durationMatch[3]);
		if (!Number.isNaN(seconds)) {
			const totalMs = ((hours * 60 + minutes) * 60 + seconds) * 1000;
			if (totalMs > 0) {
				return Math.ceil(totalMs + 1000); // Add 1s buffer
			}
		}
	}

	// Pattern 2: "Please retry in X[ms|s]"
	const retryInMatch = errorText.match(/Please retry in ([0-9.]+)(ms|s)/i);
	if (retryInMatch?.[1]) {
		const value = parseFloat(retryInMatch[1]);
		if (!Number.isNaN(value) && value > 0) {
			const ms = retryInMatch[2].toLowerCase() === "ms" ? value : value * 1000;
			return Math.ceil(ms + 1000);
		}
	}

	// Pattern 3: "retryDelay": "34.074824224s" (JSON field in error details)
	const retryDelayMatch = errorText.match(/"retryDelay":\s*"([0-9.]+)(ms|s)"/i);
	if (retryDelayMatch?.[1]) {
		const value = parseFloat(retryDelayMatch[1]);
		if (!Number.isNaN(value) && value > 0) {
			const ms = retryDelayMatch[2].toLowerCase() === "ms" ? value : value * 1000;
			return Math.ceil(ms + 1000);
		}
	}

	return undefined;
}

/**
 * Check if an error is retryable (rate limit, server error, etc.)
 */
function isRetryableError(status: number, errorText: string): boolean {
	if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) {
		return true;
	}
	return /resource.?exhausted|rate.?limit|overloaded|service.?unavailable/i.test(errorText);
}

/**
 * Sleep for a given number of milliseconds, respecting abort signal.
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new Error("Request was aborted"));
			return;
		}
		const timeout = setTimeout(resolve, ms);
		signal?.addEventListener("abort", () => {
			clearTimeout(timeout);
			reject(new Error("Request was aborted"));
		});
	});
}

interface CloudCodeAssistRequest {
	project: string;
	model: string;
	request: {
		contents: Content[];
		systemInstruction?: { role?: string; parts: { text: string }[] };
		generationConfig?: {
			maxOutputTokens?: number;
			temperature?: number;
			thinkingConfig?: ThinkingConfig;
		};
		tools?: ReturnType<typeof convertTools>;
		toolConfig?: {
			functionCallingConfig: {
				mode: ReturnType<typeof mapToolChoice>;
			};
		};
	};
	requestType?: string;
	userAgent?: string;
	requestId?: string;
}

interface CloudCodeAssistResponseChunk {
	response?: {
		candidates?: Array<{
			content?: {
				role: string;
				parts?: Array<{
					text?: string;
					thought?: boolean;
					thoughtSignature?: string;
					functionCall?: {
						name: string;
						args: Record<string, unknown>;
						id?: string;
					};
				}>;
			};
			finishReason?: string;
		}>;
		usageMetadata?: {
			promptTokenCount?: number;
			candidatesTokenCount?: number;
			thoughtsTokenCount?: number;
			totalTokenCount?: number;
			cachedContentTokenCount?: number;
		};
		modelVersion?: string;
		responseId?: string;
	};
	traceId?: string;
}

export const streamGoogleGeminiCli: StreamFunction<"google-gemini-cli"> = (
	model: Model<"google-gemini-cli">,
	context: Context,
	options?: GoogleGeminiCliOptions,
): AssistantMessageEventStream => {
	const stream = new AssistantMessageEventStream();

	(async () => {
		const output: AssistantMessage = {
			role: "assistant",
			content: [],
			api: "google-gemini-cli" as Api,
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
			stopReason: "stop",
			timestamp: Date.now(),
		};

		try {
			// apiKey is JSON-encoded: { token, projectId }
			const apiKeyRaw = options?.apiKey;
			if (!apiKeyRaw) {
				throw new Error("Google Cloud Code Assist requires OAuth authentication. Use /login to authenticate.");
			}

			let accessToken: string;
			let projectId: string;

			try {
				const parsed = JSON.parse(apiKeyRaw) as { token: string; projectId: string };
				accessToken = parsed.token;
				projectId = parsed.projectId;
			} catch {
				throw new Error("Invalid Google Cloud Code Assist credentials. Use /login to re-authenticate.");
			}

			if (!accessToken || !projectId) {
				throw new Error("Missing token or projectId in Google Cloud credentials. Use /login to re-authenticate.");
			}

			const endpoint = model.baseUrl || DEFAULT_ENDPOINT;
			const url = `${endpoint}/v1internal:streamGenerateContent?alt=sse`;

			// Use Antigravity headers for sandbox endpoint, otherwise Gemini CLI headers
			const isAntigravity = endpoint.includes("sandbox.googleapis.com");
			const requestBody = buildRequest(model, context, projectId, options, isAntigravity);
			const headers = isAntigravity ? ANTIGRAVITY_HEADERS : GEMINI_CLI_HEADERS;

			// Fetch with retry logic for rate limits and transient errors
			let response: Response | undefined;
			let lastError: Error | undefined;

			for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
				if (options?.signal?.aborted) {
					throw new Error("Request was aborted");
				}

				try {
					response = await fetch(url, {
						method: "POST",
						headers: {
							Authorization: `Bearer ${accessToken}`,
							"Content-Type": "application/json",
							Accept: "text/event-stream",
							...headers,
						},
						body: JSON.stringify(requestBody),
						signal: options?.signal,
					});

					if (response.ok) {
						break; // Success, exit retry loop
					}

					const errorText = await response.text();

					// Check if retryable
					if (attempt < MAX_RETRIES && isRetryableError(response.status, errorText)) {
						// Use server-provided delay or exponential backoff
						const serverDelay = extractRetryDelay(errorText);
						const delayMs = serverDelay ?? BASE_DELAY_MS * 2 ** attempt;
						await sleep(delayMs, options?.signal);
						continue;
					}

					// Not retryable or max retries exceeded
					throw new Error(`Cloud Code Assist API error (${response.status}): ${errorText}`);
				} catch (error) {
					// Check for abort - fetch throws AbortError, our code throws "Request was aborted"
					if (error instanceof Error) {
						if (error.name === "AbortError" || error.message === "Request was aborted") {
							throw new Error("Request was aborted");
						}
					}
					lastError = error instanceof Error ? error : new Error(String(error));
					// Network errors are retryable
					if (attempt < MAX_RETRIES) {
						const delayMs = BASE_DELAY_MS * 2 ** attempt;
						await sleep(delayMs, options?.signal);
						continue;
					}
					throw lastError;
				}
			}

			if (!response || !response.ok) {
				throw lastError ?? new Error("Failed to get response after retries");
			}

			if (!response.body) {
				throw new Error("No response body");
			}

			stream.push({ type: "start", partial: output });

			let currentBlock: TextContent | ThinkingContent | null = null;
			const blocks = output.content;
			const blockIndex = () => blocks.length - 1;

			// Read SSE stream
			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = "";

			// Set up abort handler to cancel reader when signal fires
			const abortHandler = () => {
				void reader.cancel().catch(() => {});
			};
			options?.signal?.addEventListener("abort", abortHandler);

			try {
				while (true) {
					// Check abort signal before each read
					if (options?.signal?.aborted) {
						throw new Error("Request was aborted");
					}

					const { done, value } = await reader.read();
					if (done) break;

					buffer += decoder.decode(value, { stream: true });
					const lines = buffer.split("\n");
					buffer = lines.pop() || "";

					for (const line of lines) {
						if (!line.startsWith("data:")) continue;

						const jsonStr = line.slice(5).trim();
						if (!jsonStr) continue;

						let chunk: CloudCodeAssistResponseChunk;
						try {
							chunk = JSON.parse(jsonStr);
						} catch {
							continue;
						}

						// Unwrap the response
						const responseData = chunk.response;
						if (!responseData) continue;

						const candidate = responseData.candidates?.[0];
						if (candidate?.content?.parts) {
							for (const part of candidate.content.parts) {
								if (part.text !== undefined) {
									const isThinking = isThinkingPart(part);
									if (
										!currentBlock ||
										(isThinking && currentBlock.type !== "thinking") ||
										(!isThinking && currentBlock.type !== "text")
									) {
										if (currentBlock) {
											if (currentBlock.type === "text") {
												stream.push({
													type: "text_end",
													contentIndex: blocks.length - 1,
													content: currentBlock.text,
													partial: output,
												});
											} else {
												stream.push({
													type: "thinking_end",
													contentIndex: blockIndex(),
													content: currentBlock.thinking,
													partial: output,
												});
											}
										}
										if (isThinking) {
											currentBlock = { type: "thinking", thinking: "", thinkingSignature: undefined };
											output.content.push(currentBlock);
											stream.push({ type: "thinking_start", contentIndex: blockIndex(), partial: output });
										} else {
											currentBlock = { type: "text", text: "" };
											output.content.push(currentBlock);
											stream.push({ type: "text_start", contentIndex: blockIndex(), partial: output });
										}
									}
									if (currentBlock.type === "thinking") {
										currentBlock.thinking += part.text;
										currentBlock.thinkingSignature = retainThoughtSignature(
											currentBlock.thinkingSignature,
											part.thoughtSignature,
										);
										stream.push({
											type: "thinking_delta",
											contentIndex: blockIndex(),
											delta: part.text,
											partial: output,
										});
									} else {
										currentBlock.text += part.text;
										stream.push({
											type: "text_delta",
											contentIndex: blockIndex(),
											delta: part.text,
											partial: output,
										});
									}
								}

								if (part.functionCall) {
									if (currentBlock) {
										if (currentBlock.type === "text") {
											stream.push({
												type: "text_end",
												contentIndex: blockIndex(),
												content: currentBlock.text,
												partial: output,
											});
										} else {
											stream.push({
												type: "thinking_end",
												contentIndex: blockIndex(),
												content: currentBlock.thinking,
												partial: output,
											});
										}
										currentBlock = null;
									}

									const providedId = part.functionCall.id;
									const needsNewId =
										!providedId || output.content.some((b) => b.type === "toolCall" && b.id === providedId);
									const toolCallId = needsNewId
										? `${part.functionCall.name}_${Date.now()}_${++toolCallCounter}`
										: providedId;

									const toolCall: ToolCall = {
										type: "toolCall",
										id: toolCallId,
										name: part.functionCall.name || "",
										arguments: part.functionCall.args as Record<string, unknown>,
										...(part.thoughtSignature && { thoughtSignature: part.thoughtSignature }),
									};

									output.content.push(toolCall);
									stream.push({ type: "toolcall_start", contentIndex: blockIndex(), partial: output });
									stream.push({
										type: "toolcall_delta",
										contentIndex: blockIndex(),
										delta: JSON.stringify(toolCall.arguments),
										partial: output,
									});
									stream.push({ type: "toolcall_end", contentIndex: blockIndex(), toolCall, partial: output });
								}
							}
						}

						if (candidate?.finishReason) {
							output.stopReason = mapStopReasonString(candidate.finishReason);
							if (output.content.some((b) => b.type === "toolCall")) {
								output.stopReason = "toolUse";
							}
						}

						if (responseData.usageMetadata) {
							// promptTokenCount includes cachedContentTokenCount, so subtract to get fresh input
							const promptTokens = responseData.usageMetadata.promptTokenCount || 0;
							const cacheReadTokens = responseData.usageMetadata.cachedContentTokenCount || 0;
							output.usage = {
								input: promptTokens - cacheReadTokens,
								output:
									(responseData.usageMetadata.candidatesTokenCount || 0) +
									(responseData.usageMetadata.thoughtsTokenCount || 0),
								cacheRead: cacheReadTokens,
								cacheWrite: 0,
								totalTokens: responseData.usageMetadata.totalTokenCount || 0,
								cost: {
									input: 0,
									output: 0,
									cacheRead: 0,
									cacheWrite: 0,
									total: 0,
								},
							};
							calculateCost(model, output.usage);
						}
					}
				}
			} finally {
				options?.signal?.removeEventListener("abort", abortHandler);
			}

			if (currentBlock) {
				if (currentBlock.type === "text") {
					stream.push({
						type: "text_end",
						contentIndex: blockIndex(),
						content: currentBlock.text,
						partial: output,
					});
				} else {
					stream.push({
						type: "thinking_end",
						contentIndex: blockIndex(),
						content: currentBlock.thinking,
						partial: output,
					});
				}
			}

			if (options?.signal?.aborted) {
				throw new Error("Request was aborted");
			}

			if (output.stopReason === "aborted" || output.stopReason === "error") {
				throw new Error("An unknown error occurred");
			}

			stream.push({ type: "done", reason: output.stopReason, message: output });
			stream.end();
		} catch (error) {
			for (const block of output.content) {
				if ("index" in block) {
					delete (block as { index?: number }).index;
				}
			}
			output.stopReason = options?.signal?.aborted ? "aborted" : "error";
			output.errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
			stream.push({ type: "error", reason: output.stopReason, error: output });
			stream.end();
		}
	})();

	return stream;
};

function buildRequest(
	model: Model<"google-gemini-cli">,
	context: Context,
	projectId: string,
	options: GoogleGeminiCliOptions = {},
	isAntigravity = false,
): CloudCodeAssistRequest {
	const contents = convertMessages(model, context);

	const generationConfig: CloudCodeAssistRequest["request"]["generationConfig"] = {};
	if (options.temperature !== undefined) {
		generationConfig.temperature = options.temperature;
	}
	if (options.maxTokens !== undefined) {
		generationConfig.maxOutputTokens = options.maxTokens;
	}

	// Thinking config
	if (options.thinking?.enabled && model.reasoning) {
		generationConfig.thinkingConfig = {
			includeThoughts: true,
		};
		// Gemini 3 models use thinkingLevel, older models use thinkingBudget
		if (options.thinking.level !== undefined) {
			// Cast to any since our GoogleThinkingLevel mirrors Google's ThinkingLevel enum values
			generationConfig.thinkingConfig.thinkingLevel = options.thinking.level as any;
		} else if (options.thinking.budgetTokens !== undefined) {
			generationConfig.thinkingConfig.thinkingBudget = options.thinking.budgetTokens;
		}
	}

	const request: CloudCodeAssistRequest["request"] = {
		contents,
	};

	// System instruction must be object with parts, not plain string
	if (context.systemPrompt) {
		request.systemInstruction = {
			parts: [{ text: sanitizeSurrogates(context.systemPrompt) }],
		};
	}

	if (Object.keys(generationConfig).length > 0) {
		request.generationConfig = generationConfig;
	}

	if (context.tools && context.tools.length > 0) {
		request.tools = convertTools(context.tools);
		if (options.toolChoice) {
			request.toolConfig = {
				functionCallingConfig: {
					mode: mapToolChoice(options.toolChoice),
				},
			};
		}
	}

	if (isAntigravity) {
		const existingText = request.systemInstruction?.parts?.[0]?.text || "";
		request.systemInstruction = {
			role: "user",
			parts: [{ text: ANTIGRAVITY_SYSTEM_INSTRUCTION + (existingText ? `\n\n${existingText}` : "") }],
		};
	}

	return {
		project: projectId,
		model: model.id,
		request,
		...(isAntigravity ? { requestType: "agent" } : {}),
		userAgent: isAntigravity ? "antigravity" : "pi-coding-agent",
		requestId: `${isAntigravity ? "agent" : "pi"}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
	};
}
