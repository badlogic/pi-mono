import type { Model, ModelCost } from "../../src/types.ts";
import { defineProvider, modelsDevModels } from "../define.ts";
import { KIMI_K3_COST, KIMI_K3_OPENAI_COMPAT, KIMI_OPENAI_COMPAT } from "../families/kimi.ts";
import { getEffortThinkingLevelMap } from "../reasoning.ts";

// Kimi Coding is subscription-backed, so models.dev reports zero cost. Use the
// equivalent Moonshot API rates to estimate the value of subscription usage.
const IMPLIED_COSTS: Record<string, ModelCost> = {
	k3: KIMI_K3_COST,
	"kimi-for-coding": { input: 0.95, output: 4, cacheRead: 0.19, cacheWrite: 0 },
	"kimi-for-coding-highspeed": { input: 1.9, output: 8, cacheRead: 0.38, cacheWrite: 0 },
};
// Models whose https://api.kimi.com/coding/v1/models entry reports effort levels and
// dynamic tool loading (tools declared in later system messages). Highspeed reports
// neither and rejects tool-bearing system messages with a 400.
const K3_STYLE_MODEL_IDS = new Set(["k3", "k3-256k", "kimi-for-coding"]);

// Kimi Coding uses Chat Completions, the same protocol as the official Kimi Code client.
export default defineProvider({
	id: "kimi-coding",
	models: (ctx) =>
		modelsDevModels(ctx, "kimi-code-plan-global", {
			api: "openai-completions",
			baseUrl: "https://api.kimi.com/coding/v1",
			recordReasoning: false,
			map: (model, source): Model<"openai-completions"> => {
				const isK3Style = K3_STYLE_MODEL_IDS.has(model.id);
				const impliedCost = IMPLIED_COSTS[model.id];
				// K3-style models send reasoning_effort, so expose the effort values models.dev lists.
				const effortLevels =
					isK3Style && source.reasoningOptions ? getEffortThinkingLevelMap(source.reasoningOptions) : undefined;
				return {
					...model,
					compat: {
						...(isK3Style ? KIMI_K3_OPENAI_COMPAT : KIMI_OPENAI_COMPAT),
						// All models accept system text after the conversation starts.
						supportsMidConvoSystemMessages: true,
						...(isK3Style ? { supportsMidConvoToolAdditions: true } : {}),
					},
					cost: {
						input: source.cost.input || impliedCost?.input || 0,
						output: source.cost.output || impliedCost?.output || 0,
						cacheRead: source.cost.cacheRead || impliedCost?.cacheRead || 0,
						cacheWrite: source.cost.cacheWrite || impliedCost?.cacheWrite || 0,
					},
					// Kimi Code reports every model as always-thinking.
					thinkingLevelMap: { ...effortLevels, off: null },
				};
			},
		}),
	compat: { "openai-completions": { supportsStrictMode: true } },
});
