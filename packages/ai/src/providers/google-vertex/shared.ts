import { randomUUID } from "crypto";
import { GoogleAuth } from "google-auth-library";
import type { GoogleVertexOptions } from "./types.js";

const VERTEX_AUTH = new GoogleAuth({
	scopes: ["https://www.googleapis.com/auth/cloud-platform"],
});

const DEFAULT_TOKEN_TTL_MS = 5 * 60 * 1000;
const TOKEN_EXPIRY_BUFFER_MS = 60 * 1000;

type CachedAccessToken = {
	value: string;
	expiresAt: number;
};

let cachedAccessToken: CachedAccessToken | null = null;
let accessTokenPromise: Promise<string> | null = null;

const TOOL_CALL_ID_PREFIX_REGEX = /[^a-zA-Z0-9_-]/g;

export function resolveProject(options?: GoogleVertexOptions): string {
	const project = options?.project || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
	if (!project) {
		throw new Error(
			"Vertex AI requires a project ID. Set GOOGLE_CLOUD_PROJECT/GCLOUD_PROJECT or pass project in options.",
		);
	}
	return project;
}

export function resolveLocation(options?: GoogleVertexOptions): string {
	const location = options?.location || process.env.GOOGLE_CLOUD_LOCATION;
	if (!location) {
		throw new Error("Vertex AI requires a location. Set GOOGLE_CLOUD_LOCATION or pass location in options.");
	}
	return location;
}

export function createVertexToolCallId(prefix: string): string {
	const safePrefix = prefix.replace(TOOL_CALL_ID_PREFIX_REGEX, "_");
	const finalPrefix = safePrefix.length > 0 ? safePrefix : "tool";
	return `${finalPrefix}_${randomUUID()}`;
}

export async function getVertexAccessToken(): Promise<string> {
	const now = Date.now();
	if (cachedAccessToken && now < cachedAccessToken.expiresAt) {
		return cachedAccessToken.value;
	}
	if (accessTokenPromise) {
		return accessTokenPromise;
	}

	accessTokenPromise = (async () => {
		const client = await VERTEX_AUTH.getClient();
		const tokenResponse = await client.getAccessToken();
		const token = typeof tokenResponse === "string" ? tokenResponse : tokenResponse?.token;
		if (!token) {
			throw new Error(
				"Vertex ADC access token unavailable. Run `gcloud auth application-default login` or configure GOOGLE_APPLICATION_CREDENTIALS.",
			);
		}

		const expiryDate = client.credentials.expiry_date;
		const expiryWithBuffer =
			typeof expiryDate === "number" && Number.isFinite(expiryDate)
				? expiryDate - TOKEN_EXPIRY_BUFFER_MS
				: now + DEFAULT_TOKEN_TTL_MS;
		const expiresAt = expiryWithBuffer > now ? expiryWithBuffer : now + DEFAULT_TOKEN_TTL_MS;
		cachedAccessToken = { value: token, expiresAt };
		return token;
	})();

	try {
		return await accessTokenPromise;
	} finally {
		accessTokenPromise = null;
	}
}
