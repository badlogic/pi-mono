import type { Api, AssistantMessage, Model } from "../types.ts";

/**
 * Whether an assistant response is trusted as produced by `model`'s route.
 *
 * The message's requested model and the provider-reported concrete model must both be the model's
 * own id or one of its declared `responseModelAliases`. A response that names a different concrete
 * model is a genuine fallback and must not drive same-model recovery with the selected model's
 * context and output limits.
 */
export function isResponseFromModel(model: Model<Api>, message: AssistantMessage): boolean {
	if (model.provider !== message.provider) return false;
	const aliases = model.responseModelAliases;
	const trusted = (candidate: string | undefined): boolean =>
		candidate === undefined || candidate === model.id || (aliases?.includes(candidate) ?? false);
	return trusted(message.model) && trusted(message.responseModel);
}
