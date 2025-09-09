import { z } from "zod";
import type { AgentTool } from "../../agent";

export interface CalculateResult {
	output: string;
	details: undefined;
}

export function calculate(expression: string): CalculateResult {
	try {
		const result = new Function("return " + expression)();
		return { output: `${expression} = ${result}`, details: undefined };
	} catch (e: any) {
		throw new Error(e.message || String(e));
	}
}

const calculateSchema = z.object({
	expression: z.string().describe("The mathematical expression to evaluate"),
});

export const calculateTool: AgentTool<typeof calculateSchema, undefined> = {
	label: "Calculator",
	name: "calculate",
	description: "Evaluate mathematical expressions",
	parameters: calculateSchema,
	execute: async (_toolCallId, args) => {
		return calculate(args.expression);
	},
};
