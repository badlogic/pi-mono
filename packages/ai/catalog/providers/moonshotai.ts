import type { Model } from "../../src/types.ts";
import {
	type ChatModel,
	defineProvider,
	mergeCompat,
	mergeThinking,
	modelsDevModels,
	type ProviderContext,
} from "../define.ts";
import { KIMI_K3_COST, KIMI_K3_OPENAI_COMPAT, KIMI_OPENAI_COMPAT } from "../families/kimi.ts";

const ALWAYS_THINKING_MODEL_IDS = new Set(["kimi-k2.7-code", "kimi-k2.7-code-highspeed"]);
// Kimi K2.6/K2.7 accept system text after the conversation starts but reject
// tool-bearing system messages.
const TEXT_ONLY_MID_CONVO_MODEL_IDS = new Set(["kimi-k2.6", ...ALWAYS_THINKING_MODEL_IDS]);

export function moonshotModels(ctx: ProviderContext, source: string, baseUrl: string) {
	return modelsDevModels(ctx, source, {
		api: "openai-completions",
		baseUrl,
		map: (model, source): Model<"openai-completions"> => {
			const isKimiK3 = model.id === "kimi-k3";
			return {
				...model,
				reasoning: isKimiK3 || source.reasoning,
				// Moonshot does not bill cache writes; models.dev lists the input rate as cache_write for Kimi K3.
				cost: isKimiK3
					? { ...KIMI_K3_COST }
					: {
							input: source.cost.input || 0,
							output: source.cost.output || 0,
							cacheRead: source.cost.cacheRead || 0,
							cacheWrite: source.cost.cacheWrite || 0,
						},
				compat: { ...(isKimiK3 ? KIMI_K3_OPENAI_COMPAT : KIMI_OPENAI_COMPAT) },
			};
		},
	});
}

export const MOONSHOT_COMPLETIONS_COMPAT = {
	supportsStore: false,
	supportsDeveloperRole: false,
	supportsReasoningEffort: false,
	maxTokensField: "max_tokens",
} as const;

export function finalizeMoonshotModel(model: ChatModel): void {
	if (ALWAYS_THINKING_MODEL_IDS.has(model.id)) {
		// Kimi K2.7 Code is always-thinking. Official docs say
		// `thinking: { type: "disabled" }` is rejected, and callers can omit
		// the thinking parameter to use the enabled default.
		mergeThinking(model, { off: null });
	}
	if (model.id === "kimi-k3" || TEXT_ONLY_MID_CONVO_MODEL_IDS.has(model.id)) {
		mergeCompat(model as Model<"openai-completions">, {
			supportsMidConvoSystemMessages: true,
			// Kimi K3 also accepts tool-bearing system messages.
			...(model.id === "kimi-k3" ? { supportsMidConvoToolAdditions: true } : {}),
		});
	}
}

export default defineProvider({
	id: "moonshotai",
	models: (ctx) => moonshotModels(ctx, "moonshotai", "https://api.moonshot.ai/v1"),
	compat: { "openai-completions": MOONSHOT_COMPLETIONS_COMPAT },
	finalize: finalizeMoonshotModel,
});
