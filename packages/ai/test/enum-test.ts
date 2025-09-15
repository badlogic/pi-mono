import { Type } from "@sinclair/typebox";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { StringEnum } from "../src/typebox-helpers.js";

// Zod version
const zodSchema = z.object({
	operation: z.enum(["add", "subtract", "multiply", "divide"]),
});

// TypeBox with our StringEnum helper
const typeboxHelper = Type.Object({
	operation: StringEnum(["add", "subtract", "multiply", "divide"]),
});

console.log("Zod:", JSON.stringify(zodToJsonSchema(zodSchema), null, 2));
console.log("\nTypeBox.StringEnum:", JSON.stringify(typeboxHelper, null, 2));
