import type { setBedrockProviderModule } from "@mariozechner/pi-ai";

declare module "@mariozechner/pi-ai/bedrock-provider" {
	export const bedrockProviderModule: Parameters<typeof setBedrockProviderModule>[0];
}
