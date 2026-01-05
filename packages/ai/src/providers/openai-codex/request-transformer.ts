import { TOOL_REMAP_MESSAGE } from "./prompts/codex.js";
import { CODEX_PI_BRIDGE } from "./prompts/pi-codex-bridge.js";

export interface ReasoningConfig {
	effort: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
	summary: "auto" | "concise" | "detailed" | "off" | "on";
}

export interface CodexRequestOptions {
	reasoningEffort?: ReasoningConfig["effort"];
	reasoningSummary?: ReasoningConfig["summary"] | null;
	textVerbosity?: "low" | "medium" | "high";
	include?: string[];
}

export interface InputItem {
	id?: string | null;
	type?: string | null;
	role?: string;
	content?: unknown;
	call_id?: string | null;
	name?: string;
	output?: unknown;
	arguments?: string;
}

export interface RequestBody {
	model: string;
	store?: boolean;
	stream?: boolean;
	instructions?: string;
	input?: InputItem[];
	tools?: unknown;
	temperature?: number;
	reasoning?: Partial<ReasoningConfig>;
	text?: {
		verbosity?: "low" | "medium" | "high";
	};
	include?: string[];
	prompt_cache_key?: string;
	max_output_tokens?: number;
	max_completion_tokens?: number;
	[key: string]: unknown;
}

function getReasoningConfig(modelName: string | undefined, options: CodexRequestOptions = {}): ReasoningConfig {
	const normalizedName = modelName?.toLowerCase() ?? "";

	const isGpt52Codex = normalizedName.includes("gpt-5.2-codex") || normalizedName.includes("gpt 5.2 codex");
	const isGpt52General = (normalizedName.includes("gpt-5.2") || normalizedName.includes("gpt 5.2")) && !isGpt52Codex;
	const isCodexMax = normalizedName.includes("codex-max") || normalizedName.includes("codex max");
	const isCodexMini =
		normalizedName.includes("codex-mini") ||
		normalizedName.includes("codex mini") ||
		normalizedName.includes("codex_mini") ||
		normalizedName.includes("codex-mini-latest");
	const isCodex = normalizedName.includes("codex") && !isCodexMini;
	const isLightweight = !isCodexMini && (normalizedName.includes("nano") || normalizedName.includes("mini"));
	const isGpt51General =
		(normalizedName.includes("gpt-5.1") || normalizedName.includes("gpt 5.1")) &&
		!isCodex &&
		!isCodexMax &&
		!isCodexMini;

	const supportsXhigh = isGpt52General || isGpt52Codex || isCodexMax;
	const supportsNone = isGpt52General || isGpt51General;

	const defaultEffort: ReasoningConfig["effort"] = isCodexMini
		? "medium"
		: supportsXhigh
			? "high"
			: isLightweight
				? "minimal"
				: "medium";

	let effort = options.reasoningEffort || defaultEffort;

	if (isCodexMini) {
		if (effort === "minimal" || effort === "low" || effort === "none") {
			effort = "medium";
		}
		if (effort === "xhigh") {
			effort = "high";
		}
		if (effort !== "high" && effort !== "medium") {
			effort = "medium";
		}
	}

	if (!supportsXhigh && effort === "xhigh") {
		effort = "high";
	}

	if (!supportsNone && effort === "none") {
		effort = "low";
	}

	if (isCodex && effort === "minimal") {
		effort = "low";
	}

	return {
		effort,
		summary: options.reasoningSummary ?? "auto",
	};
}

function filterInput(input: InputItem[] | undefined): InputItem[] | undefined {
	if (!Array.isArray(input)) return input;

	return input
		.filter((item) => item.type !== "item_reference")
		.map((item) => {
			if (item.id != null) {
				const { id: _id, ...rest } = item;
				return rest as InputItem;
			}
			return item;
		});
}

function addCodexBridgeMessage(
	input: InputItem[] | undefined,
	hasTools: boolean,
	systemPrompt?: string,
): InputItem[] | undefined {
	if (!hasTools || !Array.isArray(input)) return input;

	const bridgeText = systemPrompt ? `${CODEX_PI_BRIDGE}\n\n${systemPrompt}` : CODEX_PI_BRIDGE;

	const bridgeMessage: InputItem = {
		type: "message",
		role: "developer",
		content: [
			{
				type: "input_text",
				text: bridgeText,
			},
		],
	};

	return [bridgeMessage, ...input];
}

function addToolRemapMessage(input: InputItem[] | undefined, hasTools: boolean): InputItem[] | undefined {
	if (!hasTools || !Array.isArray(input)) return input;

	const toolRemapMessage: InputItem = {
		type: "message",
		role: "developer",
		content: [
			{
				type: "input_text",
				text: TOOL_REMAP_MESSAGE,
			},
		],
	};

	return [toolRemapMessage, ...input];
}

export async function transformRequestBody(
	body: RequestBody,
	codexInstructions: string,
	options: CodexRequestOptions = {},
	codexMode = true,
	systemPrompt?: string,
): Promise<RequestBody> {
	// Ensure defaults
	body.store = false;
	body.stream = true;
	body.instructions = codexInstructions;

	if (body.input && Array.isArray(body.input)) {
		body.input = filterInput(body.input);

		if (codexMode) {
			body.input = addCodexBridgeMessage(body.input, !!body.tools, systemPrompt);
		} else {
			body.input = addToolRemapMessage(body.input, !!body.tools);
		}

		if (body.input) {
			const functionCallIds = new Set(
				body.input
					.filter((item) => item.type === "function_call" && typeof item.call_id === "string")
					.map((item) => item.call_id as string),
			);

			body.input = body.input.map((item) => {
				if (item.type === "function_call_output" && typeof item.call_id === "string") {
					const callId = item.call_id as string;
					if (!functionCallIds.has(callId)) {
						const itemRecord = item as unknown as Record<string, unknown>;
						const toolName = typeof itemRecord.name === "string" ? itemRecord.name : "tool";
						let text = "";
						try {
							const output = itemRecord.output;
							text = typeof output === "string" ? output : JSON.stringify(output);
						} catch {
							text = String(itemRecord.output ?? "");
						}
						if (text.length > 16000) {
							text = `${text.slice(0, 16000)}\n...[truncated]`;
						}
						return {
							type: "message",
							role: "assistant",
							content: `[Previous ${toolName} result; call_id=${callId}]: ${text}`,
						} as InputItem;
					}
				}
				return item;
			});
		}
	}

	const reasoningConfig = getReasoningConfig(body.model, options);
	body.reasoning = {
		...body.reasoning,
		...reasoningConfig,
	};

	body.text = {
		...body.text,
		verbosity: options.textVerbosity || "medium",
	};

	const include = Array.isArray(options.include) ? [...options.include] : [];
	include.push("reasoning.encrypted_content");
	body.include = Array.from(new Set(include));

	delete body.max_output_tokens;
	delete body.max_completion_tokens;

	return body;
}
