import { type Context, createAssistantMessageEventStream, fauxAssistantMessage, Type } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { Agent } from "../src/agent.ts";
import type { AgentTool } from "../src/types.ts";

function tool(name: string): AgentTool {
	return {
		name,
		label: name,
		description: name,
		parameters: Type.Object({}),
		execute: async () => ({ content: [], details: {} }),
	};
}

describe("agent tool context boundary", () => {
	it("passes initial definitions to pi-ai while keeping the current execution registry", async () => {
		const read = tool("read");
		const edit = tool("edit");
		const requests: Context[] = [];
		const agent = new Agent({
			initialState: {
				tools: [edit],
				messages: [
					{ role: "user", content: "hello", timestamp: 1 },
					{ role: "system", content: "", toolsRemoved: [read], toolsAdded: [edit], timestamp: 2 },
				],
			},
			streamFn(_model, context) {
				requests.push(context);
				const stream = createAssistantMessageEventStream();
				stream.push({ type: "done", reason: "stop", message: fauxAssistantMessage("ok") });
				stream.end();
				return stream;
			},
		});
		await agent.prompt("continue");
		expect(requests[0].tools?.map((definition) => definition.name)).toEqual(["read"]);
		expect(agent.state.tools).toEqual([edit]);
		await agent.prompt("again");
		expect(requests[1].tools).toEqual(requests[0].tools);
	});
});
