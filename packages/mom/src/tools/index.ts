import type { AgentTool } from "@mariozechner/pi-ai";
import type { Executor } from "../sandbox.js";
import { createAttachTool, type UploadFunction } from "./attach.js";
import { createBashTool } from "./bash.js";
import { createEditTool } from "./edit.js";
import { createReadTool } from "./read.js";
import { createWriteTool } from "./write.js";

export function createMomTools(executor: Executor, getUploadFunction: () => UploadFunction | null): AgentTool<any>[] {
	return [
		createReadTool(executor),
		createBashTool(executor),
		createEditTool(executor),
		createWriteTool(executor),
		createAttachTool(getUploadFunction),
	];
}
