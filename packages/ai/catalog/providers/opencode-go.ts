import { defineProvider } from "../define.ts";
import { finalizeOpencodeModel, OPENCODE_COMPLETIONS_COMPAT, opencodeModels } from "./opencode.ts";

export default defineProvider({
	id: "opencode-go",
	models: (ctx) => opencodeModels(ctx, "https://opencode.ai/inference/go"),
	compat: { "openai-completions": OPENCODE_COMPLETIONS_COMPAT },
	finalize: finalizeOpencodeModel,
});
