import { type Static, Type } from "@sinclair/typebox";
import { StringEnum } from "../utils/typebox-helpers.js";

export const CLASSIFIER_SYSTEM_PROMPT = `
You are a Task Complexity Classifier. Analyze the user's request and classify it as SIMPLE or COMPLEX.

COMPLEX (Use PRO model):
- High operational complexity (4+ coordinated steps)
- Strategic planning or architectural decisions
- Ambiguous scope requiring investigation
- Debugging unknown problems

SIMPLE (Use FLASH model):
- Specific, bounded, clear tasks
- 1-3 sequential steps
- Direct commands (read, list, simple edit)
- Well-defined operations

Output JSON:
{
  "reasoning": "Step-by-step explanation",
  "classification": "flash" | "pro"
}
`;

export const ClassifierSchema = Type.Object({
	reasoning: Type.String({ description: "Step-by-step explanation of the classification" }),
	classification: StringEnum(["flash", "pro"], { description: "The model classification to use" }),
});

export type ClassifierResult = Static<typeof ClassifierSchema>;
