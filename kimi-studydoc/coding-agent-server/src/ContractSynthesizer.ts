import { z } from "zod";
import { complete, getModel } from "@mariozechner/pi-ai";
import type { ExecutionContract } from "./types.js";

const ContractSchema = z.object({
  requiredInputs: z.array(z.string()),
  requiredFiles: z.array(z.string()),
  requiredTools: z.array(z.string()),
  requiredScripts: z.array(z.string()),
  missingInformation: z.array(z.string()),
});

export interface ContractSynthesizerOptions {
  provider?: string;
  modelId?: string;
  apiKey?: string;
}

export class ContractSynthesizer {
  private provider: string;
  private modelId: string;

  constructor(options: ContractSynthesizerOptions = {}) {
    this.provider = options.provider ?? "anthropic";
    this.modelId = options.modelId ?? "claude-sonnet-4-5";
  }

  async synthesize(userPrompt: string, skillText: string): Promise<ExecutionContract> {
    const systemPrompt = `You are a contract synthesizer for a coding agent system.
Your task is to analyze a user's request and a skill definition to determine:
1. What inputs are required
2. What files need to be accessed
3. What tools will be used
4. What scripts might be referenced
5. What information is missing

You must output a valid JSON object with this exact structure:
{
  "requiredInputs": ["list of required input parameters"],
  "requiredFiles": ["list of file paths or patterns that will be accessed"],
  "requiredTools": ["list of tools that will be used: read, write, edit, bash, grep, etc."],
  "requiredScripts": ["list of script paths referenced in the skill"],
  "missingInformation": ["list of missing information that would prevent execution"]
}

Rules:
- If missingInformation is non-empty, execution CANNOT proceed
- Be thorough but conservative - only list what is actually needed
- File paths can be patterns like "src/**/*.ts"
- Tools should be from: read, write, edit, bash, grep, find, ls, question`;

    const userMessage = `## User Request
${userPrompt}

## Skill Definition
${skillText}

Analyze the above and output the execution contract as JSON.`;

    try {
      const model = getModel(this.provider as any, this.modelId);
      if (!model) {
        throw new Error(`Model ${this.provider}/${this.modelId} not found`);
      }

      const response = await complete(
        model,
        {
          systemPrompt,
          messages: [{ role: "user", content: userMessage, timestamp: Date.now() }],
        }
      );

      // Extract text from response content
      let jsonText = "";
      
      if (response.content && response.content.length > 0) {
        // Find text content blocks
        const textBlocks = response.content.filter(c => c.type === "text");
        if (textBlocks.length > 0) {
          jsonText = textBlocks.map(c => (c as { text: string }).text).join("");
        }
      }

      // Try to extract JSON from markdown code block
      const jsonMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonText = jsonMatch[1].trim();
      }

      // Parse and validate
      const parsed = JSON.parse(jsonText);
      const validated = ContractSchema.parse(parsed);

      return {
        requiredInputs: validated.requiredInputs,
        requiredFiles: validated.requiredFiles,
        requiredTools: validated.requiredTools,
        requiredScripts: validated.requiredScripts,
        missingInformation: validated.missingInformation,
        canExecute: validated.missingInformation.length === 0,
      };
    } catch (error) {
      console.error("[ContractSynthesizer] Failed to synthesize contract:", error);
      
      // Return a safe fallback that blocks execution
      return {
        requiredInputs: [],
        requiredFiles: [],
        requiredTools: [],
        requiredScripts: [],
        missingInformation: ["Failed to synthesize contract: " + String(error)],
        canExecute: false,
      };
    }
  }

  /**
   * Check if the contract has missing information that would prevent execution
   */
  hasMissingInformation(contract: ExecutionContract): boolean {
    return contract.missingInformation.length > 0;
  }

  /**
   * Format missing information as a readable message
   */
  formatMissingInfo(contract: ExecutionContract): string {
    if (contract.missingInformation.length === 0) {
      return "No missing information - ready to execute";
    }

    const lines = [
      "Cannot execute due to missing information:",
      "",
      ...contract.missingInformation.map((info) => `  - ${info}`),
      "",
      "Please provide the missing information and retry.",
    ];

    return lines.join("\n");
  }
}
