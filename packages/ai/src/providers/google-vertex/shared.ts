import { GoogleAuth } from "google-auth-library";
import type { GoogleVertexOptions } from "./types.js";

const VERTEX_AUTH = new GoogleAuth({
	scopes: ["https://www.googleapis.com/auth/cloud-platform"],
});

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

export async function getVertexAccessToken(): Promise<string> {
	const client = await VERTEX_AUTH.getClient();
	const tokenResponse = await client.getAccessToken();
	const token = typeof tokenResponse === "string" ? tokenResponse : tokenResponse?.token;
	if (!token) {
		throw new Error(
			"Vertex ADC access token unavailable. Run `gcloud auth application-default login` or configure GOOGLE_APPLICATION_CREDENTIALS.",
		);
	}
	return token;
}
