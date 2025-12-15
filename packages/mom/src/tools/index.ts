import type { AgentTool } from "@mariozechner/pi-ai";
import type { Executor } from "../sandbox.js";
import type { TransportContext } from "../transport/types.js";
import { createAttachTool, type UploadFunction } from "./attach.js";
import { createBashTool } from "./bash.js";
import { createEditTool } from "./edit.js";
import { createProfileTool, type ProfileRuntime } from "./profile.js";
import { createReadTool } from "./read.js";
import { createWriteTool } from "./write.js";

export function createMomTools(
	executor: Executor,
	getUploadFunction: () => UploadFunction | null,
	getCtx: () => TransportContext | null,
	getProfileRuntime: () => ProfileRuntime | null,
): AgentTool<any>[] {
	return [
		createReadTool(executor),
		createBashTool(executor),
		createEditTool(executor),
		createWriteTool(executor),
		createAttachTool(getUploadFunction),
		createProfileTool(getCtx, getProfileRuntime),
	];
}
