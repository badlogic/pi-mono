import type { AgentTool } from "../../agent";
import type { AgentToolResult } from "../types";

export interface GetCurrentTimeResult extends AgentToolResult<{ utcTimestamp: number }> {}

export async function getCurrentTime(timezone?: string): Promise<GetCurrentTimeResult> {
	const date = new Date();
	if (timezone) {
		try {
			return {
				output: date.toLocaleString("en-US", {
					timeZone: timezone,
					dateStyle: "full",
					timeStyle: "long",
				}),
				details: { utcTimestamp: date.getTime() },
			};
		} catch (e) {
			throw new Error(`Invalid timezone: ${timezone}. Current UTC time: ${date.toISOString()}`);
		}
	}
	return {
		output: date.toLocaleString("en-US", { dateStyle: "full", timeStyle: "long" }),
		details: { utcTimestamp: date.getTime() },
	};
}

export const getCurrentTimeTool: AgentTool<{ utcTimestamp: number }> = {
	label: "Current Time",
	name: "get_current_time",
	description: "Get the current date and time",
	parameters: {
		type: "object",
		properties: {
			timezone: {
				type: "string",
				description: "Optional timezone (e.g., 'America/New_York', 'Europe/London')",
			},
		},
	},
	execute: async (args: { timezone?: string }) => {
		return getCurrentTime(args.timezone);
	},
};
