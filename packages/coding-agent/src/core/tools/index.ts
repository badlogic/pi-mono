export {
	type AsyncJob,
	AsyncJobManager,
	type AsyncJobManagerOptions,
	type AsyncJobRegisterOptions,
	type AsyncJobStatus,
	type AsyncJobType,
} from "./async-jobs.js";
export {
	type AwaitJobResult,
	type AwaitToolDetails,
	type AwaitToolInput,
	type AwaitToolOptions,
	createAwaitTool,
} from "./await.js";
export {
	type BashOperations,
	type BashSpawnContext,
	type BashSpawnHook,
	type BashToolDetails,
	type BashToolInput,
	type BashToolOptions,
	bashTool,
	createBashTool,
} from "./bash.js";
export {
	type CancelJobToolDetails,
	type CancelJobToolInput,
	type CancelJobToolOptions,
	createCancelJobTool,
} from "./cancel-job.js";
export {
	createEditTool,
	type EditOperations,
	type EditToolDetails,
	type EditToolInput,
	type EditToolOptions,
	editTool,
} from "./edit.js";
export {
	createFindTool,
	type FindOperations,
	type FindToolDetails,
	type FindToolInput,
	type FindToolOptions,
	findTool,
} from "./find.js";
export {
	createGrepTool,
	type GrepOperations,
	type GrepToolDetails,
	type GrepToolInput,
	type GrepToolOptions,
	grepTool,
} from "./grep.js";
export {
	createLsTool,
	type LsOperations,
	type LsToolDetails,
	type LsToolInput,
	type LsToolOptions,
	lsTool,
} from "./ls.js";
export {
	createReadTool,
	type ReadOperations,
	type ReadToolDetails,
	type ReadToolInput,
	type ReadToolOptions,
	readTool,
} from "./read.js";
export {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	type TruncationOptions,
	type TruncationResult,
	truncateHead,
	truncateLine,
	truncateTail,
} from "./truncate.js";
export {
	createWriteTool,
	type WriteOperations,
	type WriteToolInput,
	type WriteToolOptions,
	writeTool,
} from "./write.js";

import type { AgentTool } from "@mariozechner/pi-agent-core";
import { AsyncJobManager } from "./async-jobs.js";
import { createAwaitTool } from "./await.js";
import { type BashToolOptions, bashTool, createBashTool } from "./bash.js";
import { createCancelJobTool } from "./cancel-job.js";
import { createEditTool, editTool } from "./edit.js";
import { createFindTool, findTool } from "./find.js";
import { createGrepTool, grepTool } from "./grep.js";
import { createLsTool, lsTool } from "./ls.js";
import { createReadTool, type ReadToolOptions, readTool } from "./read.js";
import { createWriteTool, writeTool } from "./write.js";

/** Tool type (AgentTool from pi-ai) */
export type Tool = AgentTool<any>;

const defaultAsyncJobManager = new AsyncJobManager();
const awaitTool = createAwaitTool({ asyncEnabled: false, asyncJobManager: defaultAsyncJobManager });
const cancelJobTool = createCancelJobTool({ asyncEnabled: false, asyncJobManager: defaultAsyncJobManager });

// Default tools for full access mode (using process.cwd())
export const codingTools: Tool[] = [readTool, bashTool, editTool, writeTool];

// Read-only tools for exploration without modification (using process.cwd())
export const readOnlyTools: Tool[] = [readTool, grepTool, findTool, lsTool];

// All available tools (using process.cwd())
export const allTools = {
	read: readTool,
	bash: bashTool,
	edit: editTool,
	write: writeTool,
	grep: grepTool,
	find: findTool,
	ls: lsTool,
	await: awaitTool,
	cancel_job: cancelJobTool,
};

export type ToolName = keyof typeof allTools;

export interface ToolsOptions {
	/** Options for the read tool */
	read?: ReadToolOptions;
	/** Options for the bash tool */
	bash?: BashToolOptions;
	/** Async tool options */
	async?: {
		enabled?: boolean;
		maxJobs?: number;
		jobManager?: AsyncJobManager;
	};
}

function resolveAsyncContext(options?: ToolsOptions): {
	asyncEnabled: boolean;
	asyncJobManager: AsyncJobManager;
} {
	const asyncEnabled = options?.async?.enabled ?? false;
	const asyncJobManager =
		options?.async?.jobManager ?? new AsyncJobManager({ maxRunningJobs: options?.async?.maxJobs ?? 100 });

	if (options?.async?.maxJobs !== undefined) {
		asyncJobManager.setMaxRunningJobs(options.async.maxJobs);
	}

	return { asyncEnabled, asyncJobManager };
}

/**
 * Create coding tools configured for a specific working directory.
 */
export function createCodingTools(cwd: string, options?: ToolsOptions): Tool[] {
	const { asyncEnabled, asyncJobManager } = resolveAsyncContext(options);
	const tools: Tool[] = [
		createReadTool(cwd, { ...options?.read, asyncEnabled, asyncJobManager }),
		createBashTool(cwd, { ...options?.bash, asyncEnabled, asyncJobManager }),
		createEditTool(cwd),
		createWriteTool(cwd),
	];
	if (asyncEnabled) {
		tools.push(createAwaitTool({ asyncEnabled, asyncJobManager }));
		tools.push(createCancelJobTool({ asyncEnabled, asyncJobManager }));
	}
	return tools;
}

/**
 * Create read-only tools configured for a specific working directory.
 */
export function createReadOnlyTools(cwd: string, options?: ToolsOptions): Tool[] {
	const { asyncEnabled, asyncJobManager } = resolveAsyncContext(options);
	return [
		createReadTool(cwd, { ...options?.read, asyncEnabled, asyncJobManager }),
		createGrepTool(cwd),
		createFindTool(cwd),
		createLsTool(cwd),
	];
}

/**
 * Create all tools configured for a specific working directory.
 */
export function createAllTools(cwd: string, options?: ToolsOptions): Record<ToolName, Tool> {
	const { asyncEnabled, asyncJobManager } = resolveAsyncContext(options);
	return {
		read: createReadTool(cwd, { ...options?.read, asyncEnabled, asyncJobManager }),
		bash: createBashTool(cwd, { ...options?.bash, asyncEnabled, asyncJobManager }),
		edit: createEditTool(cwd),
		write: createWriteTool(cwd),
		grep: createGrepTool(cwd),
		find: createFindTool(cwd),
		ls: createLsTool(cwd),
		await: createAwaitTool({ asyncEnabled, asyncJobManager }),
		cancel_job: createCancelJobTool({ asyncEnabled, asyncJobManager }),
	};
}
