export { bashTool } from "./bash.js";
export { editTool } from "./edit.js";
export { findTool } from "./find.js";
export { grepTool } from "./grep.js";
export { lsTool } from "./ls.js";
export { readTool } from "./read.js";
export { createWaitForEventTool } from "./wait-for-event.js";
export { writeTool } from "./write.js";

import { bashTool } from "./bash.js";
import { editTool } from "./edit.js";
import { findTool } from "./find.js";
import { grepTool } from "./grep.js";
import { lsTool } from "./ls.js";
import { readTool } from "./read.js";
import { writeTool } from "./write.js";

// Default tools for full access mode
export const codingTools = [readTool, bashTool, editTool, writeTool];

// All available tools (including read-only exploration tools)
// Note: wait_for_event is not included here as it needs to be created with an EventReceiver
export const allTools = {
	read: readTool,
	bash: bashTool,
	edit: editTool,
	write: writeTool,
	grep: grepTool,
	find: findTool,
	ls: lsTool,
};

export type ToolName = keyof typeof allTools;
