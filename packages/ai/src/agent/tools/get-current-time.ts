import { type Static, Type } from "@sinclair/typebox";
import type { AgentTool } from "../../agent/index.js";
import type { AgentToolResult } from "../types.js";

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

const getCurrentTimeSchema = Type.Object({
	timezone: Type.Optional(
		Type.String({ description: "Optional timezone (e.g., 'America/New_York', 'Europe/London')" }),
	),
});

type GetCurrentTimeParams = Static<typeof getCurrentTimeSchema>;

export const getCurrentTimeTool: AgentTool<typeof getCurrentTimeSchema, { utcTimestamp: number }> = {
	label: "Current Time",
	name: "get_current_time",
	description: "Get the current date and time",
	parameters: getCurrentTimeSchema,
	execute: async (_toolCallId: string, args: GetCurrentTimeParams) => {
		return getCurrentTime(args.timezone);
	},
};
