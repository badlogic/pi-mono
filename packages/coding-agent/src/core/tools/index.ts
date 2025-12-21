import type { AgentTool } from "@mariozechner/pi-ai";

export { type BashToolDetails, bashTool } from "./bash.js";
export { editTool } from "./edit.js";
export { type FindToolDetails, findTool } from "./find.js";
export { type GrepToolDetails, grepTool } from "./grep.js";
export { type LsToolDetails, lsTool } from "./ls.js";
export { type ReadToolDetails, readTool } from "./read.js";
export type { TruncationResult } from "./truncate.js";
export { writeTool } from "./write.js";

import { bashTool } from "./bash.js";
import { editTool } from "./edit.js";
import { findTool } from "./find.js";
import { grepTool } from "./grep.js";
import { lsTool } from "./ls.js";
import { readTool } from "./read.js";
import { writeTool } from "./write.js";

/** Tool type (AgentTool from pi-ai) */
export type Tool = AgentTool<any>;

// Default tools for full access mode
export const codingTools: Tool[] = [readTool, bashTool, editTool, writeTool];

// Read-only tools for exploration without modification
export const readOnlyTools: Tool[] = [readTool, grepTool, findTool, lsTool];

// All available tools (including read-only exploration tools)
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
