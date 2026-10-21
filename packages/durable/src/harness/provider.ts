import type { Context } from "@earendil-works/chord";
import type { Api, Model, ModelsRequestTransforms, ProviderHeaders } from "@earendil-works/pi-ai";
import {
	getProviderAttributionHeaders,
	getProviderSessionHeaders,
	type ProviderAttributionClient,
} from "@earendil-works/pi-ai/utils/provider-attribution";
import { uuidv7 } from "@earendil-works/pi-ai/utils/uuid";
import { defineDoc } from "../documents.ts";
import type { TaskRuntime } from "../types.ts";

/** Stable provider-facing identity of one conversation. */
export type ProviderState = {
	sessionId: string;
};

/** Built-in provider state; every fork starts with a fresh identity instead of copying its parent. */
export const ProviderDoc = defineDoc<ProviderState>({
	kind: "pi.provider",
	version: 1,
	scope: "conversation",
	history: "latest",
	fork: "initial",
	initial: () => ({ sessionId: uuidv7() }),
	checkpointWhen: () => true,
});

/**
 * Return the persisted identity without writing in the normal path. A legacy conversation without `pi.provider` gets
 * one migration commit whose `tx.doc()` runs `initial()` before the provider request starts.
 */
export async function ensureProviderSessionId<I, S, R, H extends object>(
	runtime: TaskRuntime<I, S, R, H>,
	context: Context,
): Promise<string> {
	const existing = await runtime.snapshot(ProviderDoc, runtime.conversationId, context);
	if (existing !== undefined) return existing.sessionId;
	let created: string | undefined;
	await runtime.commit(async (tx) => {
		created = (await tx.doc(ProviderDoc, runtime.conversationId)).sessionId;
		return undefined;
	}, context);
	if (created === undefined) throw new Error(`Conversation ${runtime.conversationId} has no provider session ID`);
	return created;
}

/** How pi-durable identifies itself to providers; for now the coding agent's values. */
const PI_DURABLE_ATTRIBUTION: ProviderAttributionClient = {
	openRouter: { referer: "https://pi.dev", title: "pi", categories: "cli-agent" },
	nvidia: { billingOrigin: "Pi" },
	cloudflare: { userAgent: "pi-coding-agent" },
	opencode: { client: "pi" },
};

/**
 * A `transformHeaders` that puts pi-durable's provider attribution headers (`PI_DURABLE_ATTRIBUTION`) under the
 * request's own; none when the model's provider gets no such headers. pi-ai passes the transform the auth headers
 * merged with `settings.stream.headers`, so a host replaces a default by setting the same header (any case) and
 * removes one by setting it to `null`.
 */
export function attributionHeaders(model: Model<Api>, sessionId: string): ModelsRequestTransforms {
	const defaults = {
		...getProviderSessionHeaders(model, sessionId, PI_DURABLE_ATTRIBUTION),
		...getProviderAttributionHeaders(model, PI_DURABLE_ATTRIBUTION),
	};
	if (Object.keys(defaults).length === 0) return {};
	const transformHeaders = (headers: ProviderHeaders): ProviderHeaders => {
		const merged: ProviderHeaders = { ...defaults };
		for (const [name, value] of Object.entries(headers)) {
			const lowerName = name.toLowerCase();
			for (const existing of Object.keys(merged)) {
				if (existing.toLowerCase() === lowerName) delete merged[existing];
			}
			merged[name] = value;
		}
		return merged;
	};
	return { transformHeaders };
}
