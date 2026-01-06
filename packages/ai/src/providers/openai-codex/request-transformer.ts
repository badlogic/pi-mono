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

const MODEL_MAP: Record<string, string> = {
	"gpt-5.1-codex": "gpt-5.1-codex",
	"gpt-5.1-codex-low": "gpt-5.1-codex",
	"gpt-5.1-codex-medium": "gpt-5.1-codex",
	"gpt-5.1-codex-high": "gpt-5.1-codex",
	"gpt-5.1-codex-max": "gpt-5.1-codex-max",
	"gpt-5.1-codex-max-low": "gpt-5.1-codex-max",
	"gpt-5.1-codex-max-medium": "gpt-5.1-codex-max",
	"gpt-5.1-codex-max-high": "gpt-5.1-codex-max",
	"gpt-5.1-codex-max-xhigh": "gpt-5.1-codex-max",
	"gpt-5.2": "gpt-5.2",
	"gpt-5.2-none": "gpt-5.2",
	"gpt-5.2-low": "gpt-5.2",
	"gpt-5.2-medium": "gpt-5.2",
	"gpt-5.2-high": "gpt-5.2",
	"gpt-5.2-xhigh": "gpt-5.2",
	"gpt-5.2-codex": "gpt-5.2-codex",
	"gpt-5.2-codex-low": "gpt-5.2-codex",
	"gpt-5.2-codex-medium": "gpt-5.2-codex",
	"gpt-5.2-codex-high": "gpt-5.2-codex",
	"gpt-5.2-codex-xhigh": "gpt-5.2-codex",
	"gpt-5.1-codex-mini": "gpt-5.1-codex-mini",
	"gpt-5.1-codex-mini-medium": "gpt-5.1-codex-mini",
	"gpt-5.1-codex-mini-high": "gpt-5.1-codex-mini",
	"gpt-5.1": "gpt-5.1",
	"gpt-5.1-none": "gpt-5.1",
	"gpt-5.1-low": "gpt-5.1",
	"gpt-5.1-medium": "gpt-5.1",
	"gpt-5.1-high": "gpt-5.1",
	"gpt-5.1-chat-latest": "gpt-5.1",
	"gpt-5-codex": "gpt-5.1-codex",
	"codex-mini-latest": "gpt-5.1-codex-mini",
	"gpt-5-codex-mini": "gpt-5.1-codex-mini",
	"gpt-5-codex-mini-medium": "gpt-5.1-codex-mini",
	"gpt-5-codex-mini-high": "gpt-5.1-codex-mini",
	"gpt-5": "gpt-5.1",
	"gpt-5-mini": "gpt-5.1",
	"gpt-5-nano": "gpt-5.1",
};

function getNormalizedModel(modelId: string): string | undefined {
	if (MODEL_MAP[modelId]) return MODEL_MAP[modelId];
	const lowerModelId = modelId.toLowerCase();
	const match = Object.keys(MODEL_MAP).find((key) => key.toLowerCase() === lowerModelId);
	return match ? MODEL_MAP[match] : undefined;
}

export function normalizeModel(model: string | undefined): string {
	if (!model) return "gpt-5.1";

	const modelId = model.includes("/") ? model.split("/").pop()! : model;
	const mappedModel = getNormalizedModel(modelId);
	if (mappedModel) return mappedModel;

	const normalized = modelId.toLowerCase();

	if (normalized.includes("gpt-5.2-codex") || normalized.includes("gpt 5.2 codex")) {
		return "gpt-5.2-codex";
	}
	if (normalized.includes("gpt-5.2") || normalized.includes("gpt 5.2")) {
		return "gpt-5.2";
	}
	if (normalized.includes("gpt-5.1-codex-max") || normalized.includes("gpt 5.1 codex max")) {
		return "gpt-5.1-codex-max";
	}
	if (normalized.includes("gpt-5.1-codex-mini") || normalized.includes("gpt 5.1 codex mini")) {
		return "gpt-5.1-codex-mini";
	}
	if (
		normalized.includes("codex-mini-latest") ||
		normalized.includes("gpt-5-codex-mini") ||
		normalized.includes("gpt 5 codex mini")
	) {
		return "codex-mini-latest";
	}
	if (normalized.includes("gpt-5.1-codex") || normalized.includes("gpt 5.1 codex")) {
		return "gpt-5.1-codex";
	}
	if (normalized.includes("gpt-5.1") || normalized.includes("gpt 5.1")) {
		return "gpt-5.1";
	}
	if (normalized.includes("codex")) {
		return "gpt-5.1-codex";
	}
	if (normalized.includes("gpt-5") || normalized.includes("gpt 5")) {
		return "gpt-5.1";
	}

	return "gpt-5.1";
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

export async function transformRequestBody(
	body: RequestBody,
	options: CodexRequestOptions = {},
	prompt?: { instructions: string; developerMessages: string[] },
): Promise<RequestBody> {
	const normalizedModel = normalizeModel(body.model);

	body.model = normalizedModel;
	body.store = false;
	body.stream = true;

	if (body.input && Array.isArray(body.input)) {
		body.input = filterInput(body.input);

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

	if (prompt?.developerMessages && prompt.developerMessages.length > 0 && Array.isArray(body.input)) {
		const developerMessages = prompt.developerMessages.map(
			(text) =>
				({
					type: "message",
					role: "developer",
					content: [{ type: "input_text", text }],
				}) as InputItem,
		);
		body.input = [...developerMessages, ...body.input];
	}

	if (options.reasoningEffort !== undefined) {
		const reasoningConfig = getReasoningConfig(normalizedModel, options);
		body.reasoning = {
			...body.reasoning,
			...reasoningConfig,
		};
	} else {
		delete body.reasoning;
	}

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
