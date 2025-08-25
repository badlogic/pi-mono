import chalk from "chalk";
import { GeminiLLM, GeminiLLMOptions } from "../../src/providers/gemini.js";
import { Context, Tool } from "../../src/types.js";

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

const options: GeminiLLMOptions = {
    onText: (t, complete) => process.stdout.write(t + (complete ? "\n" : "")),
    onThinking: (t, complete) => process.stdout.write(chalk.dim(t + (complete ? "\n" : ""))),
    toolChoice: "auto",
    thinking: {
         enabled: true,
         budgetTokens: -1 // Dynamic thinking
    }
};

const ai = new GeminiLLM("gemini-2.5-flash", process.env.GEMINI_API_KEY);
const context: Context = {
    systemPrompt: "You are a helpful assistant that can use tools to answer questions.",
    messages: [
        {
            role: "user",
            content: "Think about birds briefly. Then give me a list of 10 birds. Finally, calculate 42 * 17 + 123 and 453 + 434 in parallel using the calculator tool.",
        }
    ],
    tools
}

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