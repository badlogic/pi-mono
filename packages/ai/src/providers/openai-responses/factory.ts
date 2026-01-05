import type { AssistantMessage, Context, Model, OptionsForApi, StopReason, StreamFunction } from "../../types.js";
import { AssistantMessageEventStream } from "../../utils/event-stream.js";
import { consumeResponsesEvents, type ResponsesEngineEvent } from "./engine.js";

type ResponsesApi = "openai-responses" | "openai-codex-responses";

export type ResponsesDriver<TApi extends ResponsesApi> = {
	api: TApi;
	createEventStream: (
		model: Model<TApi>,
		context: Context,
		options: OptionsForApi<TApi>,
	) => Promise<AsyncIterable<ResponsesEngineEvent>>;
	mapStopReason: (status: unknown) => StopReason;
	unknownErrorMessage?: string;
};

export function createResponsesStreamFunction<TApi extends ResponsesApi>(
	driver: ResponsesDriver<TApi>,
): StreamFunction<TApi> {
	return (model: Model<TApi>, context: Context, options: OptionsForApi<TApi>) => {
		const stream = new AssistantMessageEventStream();

		(async () => {
			const output: AssistantMessage = {
				role: "assistant",
				content: [],
				api: driver.api,
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
				const events = await driver.createEventStream(model, context, options);
				stream.push({ type: "start", partial: output });

				await consumeResponsesEvents({
					events,
					stream,
					output,
					model,
					mapStopReason: driver.mapStopReason,
				});

				if (options?.signal?.aborted) {
					throw new Error("Request was aborted");
				}

				if (output.stopReason === "aborted" || output.stopReason === "error") {
					throw new Error(driver.unknownErrorMessage ?? "An unknown error occurred");
				}

				stream.push({ type: "done", reason: output.stopReason, message: output });
				stream.end();
			} catch (error) {
				for (const block of output.content) delete (block as { index?: number }).index;
				output.stopReason = options?.signal?.aborted ? "aborted" : "error";
				output.errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
				stream.push({ type: "error", reason: output.stopReason, error: output });
				stream.end();
			}
		})();

		return stream;
	};
}
