/**
 * Shutdown Command Extension
 *
 * Adds a /quit command that allows extensions to trigger clean shutdown.
 * Demonstrates how extensions can use ctx.shutdown() to exit pi cleanly.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

export default function (pi: ExtensionAPI) {
	// Register a /quit command that cleanly exits pi
	pi.registerCommand("quit", {
		description: "Exit pi cleanly",
		handler: async (_args, ctx) => {
			await ctx.shutdown();
		},
	});

	// You can also create a tool that shuts down after completing work
	pi.registerTool({
		name: "finish_and_exit",
		label: "Finish and Exit",
		description: "Complete a task and exit pi",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _onUpdate, ctx, _signal) {
			// Do any final work here...
			// Then shutdown
			await ctx.shutdown();

			// This return won't be reached, but required by type
			return {
				content: [{ type: "text", text: "Shutting down..." }],
				details: {},
			};
		},
	});

	// You could also create a more complex tool with parameters
	pi.registerTool({
		name: "deploy_and_exit",
		label: "Deploy and Exit",
		description: "Deploy the application and exit pi",
		parameters: Type.Object({
			environment: Type.String({ description: "Target environment (e.g., production, staging)" }),
		}),
		async execute(_toolCallId, params, onUpdate, ctx, _signal) {
			onUpdate?.({ content: [{ type: "text", text: `Deploying to ${params.environment}...` }], details: {} });

			// Example deployment logic
			// const result = await pi.exec("npm", ["run", "deploy", params.environment], { signal });

			// On success, shutdown
			onUpdate?.({ content: [{ type: "text", text: "Deployment complete, exiting..." }], details: {} });
			await ctx.shutdown();

			return {
				content: [{ type: "text", text: "Done!" }],
				details: { environment: params.environment },
			};
		},
	});
}
