import type { CustomToolFactory } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

const factory: CustomToolFactory = (_pi) => ({
	name: "hello",
	label: "Hello",
	description: "A simple greeting tool",
	parameters: Type.Object({
		name: Type.String({ description: "Name to greet" }),
	}),

	async execute(_toolCallId, params) {
		const { name } = params as { name: string };
		return {
			content: [{ type: "text", text: `Hello, ${name}!` }],
			details: { greeted: name },
		};
	},
});

export default factory;
