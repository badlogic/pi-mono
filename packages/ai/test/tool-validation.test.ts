import { Type } from "@sinclair/typebox";
import AjvModule from "ajv";
import addFormatsModule from "ajv-formats";

// Handle both default and named exports
const Ajv = (AjvModule as any).default || AjvModule;
const addFormats = (addFormatsModule as any).default || addFormatsModule;

import { describe, expect, it } from "vitest";
import type { Tool } from "../src/types.js";

describe("Tool Validation with TypeBox and AJV", () => {
	// Define a test tool with TypeBox schema
	const testSchema = Type.Object({
		name: Type.String({ minLength: 1 }),
		age: Type.Integer({ minimum: 0, maximum: 150 }),
		email: Type.String({ format: "email" }),
		tags: Type.Optional(Type.Array(Type.String())),
	});

	const testTool = {
		name: "test_tool",
		description: "A test tool for validation",
		parameters: testSchema,
	} satisfies Tool<typeof testSchema>;

	// Create AJV instance for validation
	const ajv = new Ajv({ allErrors: true });
	addFormats(ajv);

	it("should validate correct input", () => {
		const validInput = {
			name: "John Doe",
			age: 30,
			email: "john@example.com",
			tags: ["developer", "typescript"],
		};

		// Validate with AJV
		const validate = ajv.compile(testTool.parameters);
		const isValid = validate(validInput);
		expect(isValid).toBe(true);
	});

	it("should reject invalid email", () => {
		const invalidInput = {
			name: "John Doe",
			age: 30,
			email: "not-an-email",
		};

		const validate = ajv.compile(testTool.parameters);
		const isValid = validate(invalidInput);
		expect(isValid).toBe(false);
		expect(validate.errors).toBeDefined();
	});

	it("should reject missing required fields", () => {
		const invalidInput = {
			age: 30,
			email: "john@example.com",
		};

		const validate = ajv.compile(testTool.parameters);
		const isValid = validate(invalidInput);
		expect(isValid).toBe(false);
		expect(validate.errors).toBeDefined();
	});

	it("should reject invalid age", () => {
		const invalidInput = {
			name: "John Doe",
			age: -5,
			email: "john@example.com",
		};

		const validate = ajv.compile(testTool.parameters);
		const isValid = validate(invalidInput);
		expect(isValid).toBe(false);
		expect(validate.errors).toBeDefined();
	});

	it("should format validation errors nicely", () => {
		const invalidInput = {
			name: "",
			age: 200,
			email: "invalid",
		};

		const validate = ajv.compile(testTool.parameters);
		const isValid = validate(invalidInput);
		expect(isValid).toBe(false);
		expect(validate.errors).toBeDefined();

		if (validate.errors) {
			const errors = validate.errors
				.map((err: any) => {
					const path = err.instancePath ? err.instancePath.substring(1) : err.params.missingProperty || "root";
					return `  - ${path}: ${err.message}`;
				})
				.join("\n");

			// AJV error messages are different from Zod
			expect(errors).toContain("name: must NOT have fewer than 1 characters");
			expect(errors).toContain("age: must be <= 150");
			expect(errors).toContain('email: must match format "email"');
		}
	});
});
