import type { JsonObject, ServiceErrorCode, ServiceErrorShape } from "./types.js";

export class ServiceError extends Error {
	readonly code: ServiceErrorCode;
	readonly retryable: boolean;
	readonly details: JsonObject;
	readonly status: number;

	constructor(code: ServiceErrorCode, message: string, status: number, retryable: boolean, details: JsonObject = {}) {
		super(message);
		this.name = "ServiceError";
		this.code = code;
		this.retryable = retryable;
		this.details = details;
		this.status = status;
	}

	toResponse(): ServiceErrorShape {
		return {
			code: this.code,
			message: this.message,
			retryable: this.retryable,
			details: this.details,
		};
	}
}

function getMessage(error: Error | string): string {
	if (typeof error === "string") return error;
	return error.message;
}

export function toServiceError(error: Error | string): ServiceError {
	if (error instanceof ServiceError) return error;

	const message = getMessage(error);

	if (message.includes("SESSION_BUSY")) {
		return new ServiceError("SESSION_BUSY", message, 409, false);
	}

	if (message.includes("POLICY_DENIED")) {
		return new ServiceError("POLICY_DENIED", message, 403, false);
	}

	if (message.includes("No API key") || message.includes("Model not found") || message.includes("set_model")) {
		return new ServiceError("MODEL_ERROR", message, 400, false);
	}

	if (message.includes("Tool") || message.includes("Command exited") || message.includes("timed out")) {
		return new ServiceError("TOOL_EXEC_ERROR", message, 422, true);
	}

	return new ServiceError("INTERNAL_ERROR", message, 500, true);
}

export function authError(): ServiceError {
	return new ServiceError("AUTH_INVALID", "Invalid API key", 401, false);
}

export function sessionNotFoundError(sessionId: string): ServiceError {
	return new ServiceError("SESSION_NOT_FOUND", `Session not found: ${sessionId}`, 404, false, { sessionId });
}

export function sessionBusyError(): ServiceError {
	return new ServiceError("SESSION_BUSY", "SESSION_BUSY: prompt already in progress", 409, false);
}

export function modelNotFoundError(provider: string, modelId: string): ServiceError {
	return new ServiceError("MODEL_ERROR", `Model not found: ${provider}/${modelId}`, 400, false, {
		provider,
		modelId,
	});
}

export function parseErrorMessage(error: Error | string): string {
	if (typeof error === "string") return error;
	return error.message;
}
