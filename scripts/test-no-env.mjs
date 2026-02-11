#!/usr/bin/env node

import { existsSync, renameSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const authFile = join(homedir(), ".pi", "agent", "auth.json");
const authBackup = `${authFile}.bak`;

const envVarsToUnset = [
	"ANTHROPIC_API_KEY",
	"ANTHROPIC_OAUTH_TOKEN",
	"OPENAI_API_KEY",
	"GEMINI_API_KEY",
	"GROQ_API_KEY",
	"CEREBRAS_API_KEY",
	"XAI_API_KEY",
	"OPENROUTER_API_KEY",
	"ZAI_API_KEY",
	"MISTRAL_API_KEY",
	"MINIMAX_API_KEY",
	"MINIMAX_CN_API_KEY",
	"KIMI_API_KEY",
	"HF_TOKEN",
	"AI_GATEWAY_API_KEY",
	"OPENCODE_API_KEY",
	"COPILOT_GITHUB_TOKEN",
	"GH_TOKEN",
	"GITHUB_TOKEN",
	"GOOGLE_APPLICATION_CREDENTIALS",
	"GOOGLE_CLOUD_PROJECT",
	"GCLOUD_PROJECT",
	"GOOGLE_CLOUD_LOCATION",
	"AWS_PROFILE",
	"AWS_ACCESS_KEY_ID",
	"AWS_SECRET_ACCESS_KEY",
	"AWS_SESSION_TOKEN",
	"AWS_REGION",
	"AWS_DEFAULT_REGION",
	"AWS_BEARER_TOKEN_BEDROCK",
	"AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
	"AWS_CONTAINER_CREDENTIALS_FULL_URI",
	"AWS_WEB_IDENTITY_TOKEN_FILE",
	"BEDROCK_EXTENSIVE_MODEL_TEST",
];

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

let movedAuth = false;

try {
	if (existsSync(authFile)) {
		renameSync(authFile, authBackup);
		movedAuth = true;
		console.log("Moved auth.json to backup");
	}

	const env = { ...process.env, PI_NO_LOCAL_LLM: "1" };
	for (const key of envVarsToUnset) {
		delete env[key];
	}

	console.log("Running tests without API keys...");
	const result = spawnSync(npmCommand, ["test"], { stdio: "inherit", env });

	if (result.error) {
		throw result.error;
	}

	process.exit(result.status ?? 1);
} finally {
	if (movedAuth && existsSync(authBackup)) {
		if (existsSync(authFile)) {
			rmSync(authFile, { force: true });
		}
		renameSync(authBackup, authFile);
		console.log("Restored auth.json");
	}
}
