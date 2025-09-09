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

export const calculateTool: AgentTool<undefined> = {
	label: "Calculator",
	name: "calculate",
	description: "Evaluate mathematical expressions",
	parameters: {
		type: "object",
		properties: {
			expression: {
				type: "string",
				description: "The mathematical expression to evaluate",
			},
		},
		required: ["expression"],
	},
	execute: async (args: { expression: string }) => {
		return calculate(args.expression);
	},
};
