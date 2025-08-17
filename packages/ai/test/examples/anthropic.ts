import Anthropic from "@anthropic-ai/sdk";
import { MessageCreateParamsBase } from "@anthropic-ai/sdk/resources/messages.mjs";
import chalk from "chalk";
import { AnthropicAI } from "../../src/providers/anthropic";
import { Request, Message, Tool } from "../../src/types";

const anthropic = new Anthropic();

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

const ai = new AnthropicAI("claude-sonnet-4-0");
const context: Request = {
        messages: [
        {
            role: "user",
            content: "Think about birds briefly. Then give me a list of 10 birds. Finally, calculate 42 * 17 + 123 and 453 + 434 in parallel using the calculator tool.",
        }
    ],
    tools,
    onText: (t) => process.stdout.write(t),
    onThinking: (t) => process.stdout.write(chalk.dim(t))
}

const options = {thinking: { enabled: true }};
let msg = await ai.complete(context, options)
context.messages.push(msg);
console.log(JSON.stringify(msg, null, 2));

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
console.log(JSON.stringify(msg, null, 2));




