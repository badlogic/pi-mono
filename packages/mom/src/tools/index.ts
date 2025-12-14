import type { AgentTool } from "@mariozechner/pi-ai";
import type { Executor } from "../sandbox.js";
import { createAttachTool } from "./attach.js";
import { createBashTool } from "./bash.js";
import { createEditTool } from "./edit.js";
import { createReadTool } from "./read.js";
import { createWriteTool } from "./write.js";

export { clearUploadFunction, setUploadFunction } from "./attach.js";

export function createMomTools(executor: Executor, channelId: string): AgentTool<any>[] {
	return [
		createReadTool(executor),
		createBashTool(executor),
		createEditTool(executor),
		createWriteTool(executor),
		createAttachTool(channelId),
	];
}
