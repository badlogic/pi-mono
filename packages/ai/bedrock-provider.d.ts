import type {
	AssistantMessageEvent,
	Context,
	Model,
	SimpleStreamOptions,
	StreamOptions,
} from "@mariozechner/pi-ai";

export declare const bedrockProviderModule: {
	streamBedrock: (
		model: Model<"bedrock-converse-stream">,
		context: Context,
		options?: StreamOptions,
	) => AsyncIterable<AssistantMessageEvent>;
	streamSimpleBedrock: (
		model: Model<"bedrock-converse-stream">,
		context: Context,
		options?: SimpleStreamOptions,
	) => AsyncIterable<AssistantMessageEvent>;
};
