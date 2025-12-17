import type { AgentTool } from "@mariozechner/pi-ai";
import type { Executor } from "../sandbox.js";
import { attachTool } from "./attach.js";
import { createBashTool } from "./bash.js";
import { createEditTool } from "./edit.js";
import { createReadTool } from "./read.js";
import { createWebFetchTool, createWebSearchTool } from "./web.js";
import { createWriteTool } from "./write.js";

export { setUploadFunction } from "./attach.js";

export function createMomTools(executor: Executor): AgentTool<any>[] {
	return [
		// Core file tools
		createReadTool(executor),
		createBashTool(executor),
		createEditTool(executor),
		createWriteTool(executor),
		attachTool,
		// Web tools (EXA_API_KEY optional)
		createWebSearchTool(),
		createWebFetchTool(),
	];
}
