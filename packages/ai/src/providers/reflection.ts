import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import { envApiKeyAuth } from "../auth/helpers.ts";
import { createProvider, type Provider } from "../models.ts";
import { REFLECTION_MODELS } from "./reflection.models.ts";

export function reflectionProvider(): Provider<"openai-completions"> {
	return createProvider({
		id: "reflection",
		name: "Reflection AI",
		baseUrl: "https://api.reflection.ai/openai/v1",
		auth: { apiKey: envApiKeyAuth("Reflection AI API key", ["REFLECTION_API_KEY"]) },
		models: Object.values(REFLECTION_MODELS),
		api: openAICompletionsApi(),
	});
}
