/**
 * Schema utilities for Standard Schema support.
 *
 * Converts Standard Schema (Zod v4+, Valibot v1+, ArkType v2+) to JSON Schema
 * for use with LLM tool definitions.
 */

import type { TSchema } from "@sinclair/typebox";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { FlexibleSchema } from "./types.js";

/**
 * Check if a schema is a Standard Schema (has ~standard property with validate).
 */
export function isStandardSchema(schema: unknown): schema is StandardSchemaV1 {
	return (
		typeof schema === "object" &&
		schema !== null &&
		"~standard" in schema &&
		typeof (schema as StandardSchemaV1)["~standard"] === "object" &&
		(schema as StandardSchemaV1)["~standard"] !== null &&
		"validate" in (schema as StandardSchemaV1)["~standard"]
	);
}

/**
 * Check if a Standard Schema also implements Standard JSON Schema (has jsonSchema converter).
 */
export function hasJSONSchemaConverter(
	schema: StandardSchemaV1,
): schema is StandardSchemaV1 & { "~standard": { jsonSchema: { input: (opts: { target: string }) => unknown } } } {
	const std = schema["~standard"] as unknown as Record<string, unknown>;
	return (
		"jsonSchema" in std &&
		typeof std.jsonSchema === "object" &&
		std.jsonSchema !== null &&
		"input" in (std.jsonSchema as Record<string, unknown>)
	);
}

/**
 * Convert a flexible schema (TypeBox or Standard Schema) to a JSON Schema object.
 *
 * - TypeBox schemas are already JSON Schema compatible
 * - Standard Schemas with jsonSchema converter use ~standard.jsonSchema.input()
 * - Standard Schemas without jsonSchema converter throw an error
 *
 * @param schema - A TypeBox or Standard Schema
 * @returns A JSON Schema object suitable for LLM tool definitions
 */
export function toJSONSchema(schema: FlexibleSchema): TSchema {
	if (isStandardSchema(schema)) {
		if (hasJSONSchemaConverter(schema)) {
			return schema["~standard"].jsonSchema.input({ target: "draft-07" }) as TSchema;
		}
		throw new Error(
			`Standard Schema from vendor "${schema["~standard"].vendor}" does not support JSON Schema conversion. ` +
				`The schema must implement StandardJSONSchemaV1 (have a ~standard.jsonSchema.input method). ` +
				`For Zod, use v4.2+. For Valibot, use @valibot/to-json-schema. For ArkType, use v2.1.28+.`,
		);
	}

	// TypeBox schema - already JSON Schema compatible
	return schema as TSchema;
}
