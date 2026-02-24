import type { JsonArray, JsonObject, JsonValue } from "./types.js";

export function isJsonObject(value: JsonValue): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseJsonObject(payload: string): JsonObject {
	if (payload.trim().length === 0) return {};
	const value = JSON.parse(payload) as JsonValue;
	if (!isJsonObject(value)) {
		throw new Error("Request body must be a JSON object");
	}
	return value;
}

export function getString(value: JsonValue | undefined, fieldName: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`Invalid field: ${fieldName}`);
	}
	return value;
}

export function getOptionalString(value: JsonValue | undefined): string | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "string") {
		throw new Error("Invalid string field");
	}
	return value;
}

export function getOptionalBoolean(value: JsonValue | undefined): boolean | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "boolean") {
		throw new Error("Invalid boolean field");
	}
	return value;
}

export function getOptionalJsonObject(value: JsonValue | undefined): JsonObject | undefined {
	if (value === undefined) return undefined;
	if (typeof value === "object" && value !== null && !Array.isArray(value)) {
		return value;
	}
	throw new Error("Invalid object field");
}

export function getOptionalJsonArray(value: JsonValue | undefined): JsonArray | undefined {
	if (value === undefined) return undefined;
	if (Array.isArray(value)) {
		return value;
	}
	throw new Error("Invalid array field");
}
