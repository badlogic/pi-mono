import chalk from "chalk";
import { OpenAIResponsesLLMOptions, OpenAIResponsesLLM } from "../../src/providers/openai-responses.js";
import type { Context, Tool } from "../../src/types.js";

// Define a simple calculator tool
const tools: Tool[] = [
    {
        name: "calculate",
        description: "Perform a mathematical calculation",
        parameters: {
            type: "object" as const,
            properties: {
                expression: {
                    type: "string",
                    description: "The mathematical expression to evaluate"
                }
            },
            required: ["expression"]
        }
    }
];

const ai = new OpenAIResponsesLLM("gpt-5");
const context: Context = {
    messages: [
        {
            role: "user",
            content: "Think about birds briefly. Then give me a list of 10 birds. Finally, calculate 42 * 17 + 123 and 453 + 434 in parallel using the calculator tool.",
        }
    ],
    tools,
}

const options: OpenAIResponsesLLMOptions = {
    onText: (t) => process.stdout.write(t),
    onThinking: (t) => process.stdout.write(chalk.dim(t)),
    reasoningEffort: "low",
    reasoningSummary: "auto"
};
let msg = await ai.complete(context, options)
context.messages.push(msg);
console.log();
console.log(chalk.yellow(JSON.stringify(msg, null, 2)));

for (const toolCall of msg.toolCalls || []) {
    if (toolCall.name === "calculate") {
        const expression = toolCall.arguments.expression;
        const result = eval(expression);
        context.messages.push({
            role: "toolResult",
            content: `The result of ${expression} is ${result}.`,
            toolCallId: toolCall.id,
            isError: false
        });
    }
}

msg = await ai.complete(context, options);
console.log();
console.log(chalk.yellow(JSON.stringify(msg, null, 2)));