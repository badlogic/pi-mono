import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { AgentTool } from "../src/agent/types.js";

describe("Tool Validation with Zod", () => {
	// Define a test tool with Zod schema
	const testSchema = z.object({
		name: z.string().min(1, "Name is required"),
		age: z.number().int().min(0).max(150),
		email: z.string().email("Invalid email format"),
		tags: z.array(z.string()).optional(),
	});

	const testTool: AgentTool<typeof testSchema, void> = {
		label: "Test Tool",
		name: "test_tool",
		description: "A test tool for validation",
		parameters: testSchema,
		execute: async (_toolCallId, args) => {
			return {
				output: `Processed: ${args.name}, ${args.age}, ${args.email}`,
				details: undefined,
			};
		},
	};

	it("should validate correct input", () => {
		const validInput = {
			name: "John Doe",
			age: 30,
			email: "john@example.com",
			tags: ["developer", "typescript"],
		};

		// This should not throw
		const result = testTool.parameters.parse(validInput);
		expect(result).toEqual(validInput);
	});

	it("should reject invalid email", () => {
		const invalidInput = {
			name: "John Doe",
			age: 30,
			email: "not-an-email",
		};

		expect(() => testTool.parameters.parse(invalidInput)).toThrowError(z.ZodError);
	});

	it("should reject missing required fields", () => {
		const invalidInput = {
			age: 30,
			email: "john@example.com",
		};

		expect(() => testTool.parameters.parse(invalidInput)).toThrowError(z.ZodError);
	});

	it("should reject invalid age", () => {
		const invalidInput = {
			name: "John Doe",
			age: -5,
			email: "john@example.com",
		};

		expect(() => testTool.parameters.parse(invalidInput)).toThrowError(z.ZodError);
	});

	it("should format validation errors nicely", () => {
		const invalidInput = {
			name: "",
			age: 200,
			email: "invalid",
		};

		try {
			testTool.parameters.parse(invalidInput);
			// Should not reach here
			expect(true).toBe(false);
		} catch (e) {
			if (e instanceof z.ZodError) {
				const errors = e.issues
					.map((err) => {
						const path = err.path.length > 0 ? err.path.join(".") : "root";
						return `  - ${path}: ${err.message}`;
					})
					.join("\n");

				expect(errors).toContain("name: Name is required");
				expect(errors).toContain("age: Number must be less than or equal to 150");
				expect(errors).toContain("email: Invalid email format");
			} else {
				throw e;
			}
		}
	});

	it("should have type-safe execute function", async () => {
		const validInput = {
			name: "John Doe",
			age: 30,
			email: "john@example.com",
		};

		// Validate and execute
		const validated = testTool.parameters.parse(validInput);
		const result = await testTool.execute("test-id", validated);

		expect(result.output).toBe("Processed: John Doe, 30, john@example.com");
		expect(result.details).toBeUndefined();
	});
});
