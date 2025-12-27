/**
 * Test hook that registers a /greet command.
 * Usage: /greet [name]
 */
import type { HookAPI } from "@mariozechner/pi-coding-agent/hooks";

export default function (pi: HookAPI) {
	pi.registerCommand("greet", {
		description: "Send a greeting message to the LLM",
		handler: async (ctx) => {
			const name = ctx.args.trim() || "world";

			// Insert a custom message and trigger LLM response
			ctx.sendMessage(
				{
					customType: "greeting",
					content: `Hello, ${name}! Please say something nice about them.`,
					display: true,
				},
				true, // triggerTurn - get LLM to respond
			);
		},
	});
}
