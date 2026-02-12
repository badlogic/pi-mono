import type { X402EnvConfig } from "./types.js";

const PRIVATE_KEY_REGEX = /^0[xX][0-9a-fA-F]{64}$/;
const POSITIVE_INTEGER_REGEX = /^[1-9][0-9]*$/;

const DEFAULT_ROUTER_URL = "http://localhost:8080";
const DEFAULT_NETWORK = "eip155:8453";
const DEFAULT_PERMIT_CAP = "10000000";
const DEFAULT_PAYMENT_HEADER = "PAYMENT-SIGNATURE";
const DEFAULT_MODEL_ID = "x402/gpt-4.1-mini";
const DEFAULT_MODEL_NAME = "x402 GPT-4.1 Mini";

export type EnvSource = Record<string, string | undefined>;

function readTrimmed(env: EnvSource, key: string): string | undefined {
	const value = env[key];
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function normalizePrivateKey(privateKey: string): string {
	if (!PRIVATE_KEY_REGEX.test(privateKey)) {
		throw new Error("X402_PRIVATE_KEY must be a 0x-prefixed 64-byte hex string");
	}
	return privateKey.startsWith("0X") ? `0x${privateKey.slice(2)}` : privateKey;
}

function normalizeRouterUrl(routerUrl: string): string {
	let parsed: URL;
	try {
		parsed = new URL(routerUrl);
	} catch {
		throw new Error("X402_ROUTER_URL must be a valid URL");
	}
	return parsed.origin;
}

function normalizePermitCap(permitCap: string): string {
	if (!POSITIVE_INTEGER_REGEX.test(permitCap)) {
		throw new Error("X402_PERMIT_CAP must be a positive integer string");
	}
	return permitCap;
}

export function loadX402Env(env: EnvSource = process.env): X402EnvConfig {
	const privateKeyRaw = readTrimmed(env, "X402_PRIVATE_KEY");
	if (!privateKeyRaw) {
		throw new Error("X402_PRIVATE_KEY is required");
	}

	const routerUrlRaw = readTrimmed(env, "X402_ROUTER_URL") ?? DEFAULT_ROUTER_URL;
	const permitCapRaw = readTrimmed(env, "X402_PERMIT_CAP") ?? DEFAULT_PERMIT_CAP;
	const network = readTrimmed(env, "X402_NETWORK") ?? DEFAULT_NETWORK;
	const paymentHeader = readTrimmed(env, "X402_PAYMENT_HEADER") ?? DEFAULT_PAYMENT_HEADER;
	const modelId = readTrimmed(env, "X402_MODEL_ID") ?? DEFAULT_MODEL_ID;
	const modelName = readTrimmed(env, "X402_MODEL_NAME") ?? DEFAULT_MODEL_NAME;

	return {
		privateKey: normalizePrivateKey(privateKeyRaw),
		routerUrl: normalizeRouterUrl(routerUrlRaw),
		network,
		permitCap: normalizePermitCap(permitCapRaw),
		paymentHeader,
		modelId,
		modelName,
	};
}
