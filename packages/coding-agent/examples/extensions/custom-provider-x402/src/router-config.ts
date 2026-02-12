import type { RouterConfig, RouterConfigResponse } from "./types.js";

const DEFAULT_NETWORK = "eip155:8453";
const DEFAULT_PAYMENT_HEADER = "PAYMENT-SIGNATURE";
const DEFAULT_TOKEN_NAME = "USD Coin";
const DEFAULT_TOKEN_VERSION = "2";

const USDC_ADDRESSES: Record<string, string> = {
	"eip155:8453": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
	"eip155:84532": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
	"eip155:1": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
};

function asRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object") return null;
	return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
	return typeof value === "boolean" ? value : undefined;
}

function parseRouterConfigResponse(value: unknown): RouterConfigResponse {
	const root = asRecord(value);
	if (!root) return {};

	const networksRaw = Array.isArray(root.networks) ? root.networks : [];
	const networks: RouterConfigResponse["networks"] = networksRaw.map((networkValue) => {
		const network = asRecord(networkValue);
		if (!network) return {};
		const asset = asRecord(network.asset);
		return {
			network_id: asString(network.network_id),
			active: asBoolean(network.active),
			asset: asset ? { address: asString(asset.address) } : undefined,
			pay_to: asString(network.pay_to),
		};
	});

	const eip712 = asRecord(root.eip712_config);
	return {
		networks,
		eip712_config: eip712
			? {
					domain_name: asString(eip712.domain_name),
					domain_version: asString(eip712.domain_version),
				}
			: undefined,
		payment_header: asString(root.payment_header),
	};
}

function defaultAssetForNetwork(network: string): string {
	return USDC_ADDRESSES[network] ?? USDC_ADDRESSES[DEFAULT_NETWORK];
}

export function normalizeRouterConfig(
	value: unknown,
	defaults: { network?: string; paymentHeader?: string } = {},
): RouterConfig {
	const parsed = parseRouterConfigResponse(value);
	const fallbackNetwork = defaults.network ?? DEFAULT_NETWORK;
	const fallbackPaymentHeader = defaults.paymentHeader ?? DEFAULT_PAYMENT_HEADER;

	const selectedNetwork =
		parsed.networks?.find((network) => network.active) ??
		(parsed.networks && parsed.networks.length > 0 ? parsed.networks[0] : undefined);
	const network = selectedNetwork?.network_id ?? fallbackNetwork;
	const payTo = selectedNetwork?.pay_to ?? "";
	const asset = selectedNetwork?.asset?.address ?? defaultAssetForNetwork(network);

	return {
		network,
		asset,
		payTo,
		facilitatorSigner: payTo,
		tokenName: parsed.eip712_config?.domain_name ?? DEFAULT_TOKEN_NAME,
		tokenVersion: parsed.eip712_config?.domain_version ?? DEFAULT_TOKEN_VERSION,
		paymentHeader: parsed.payment_header ?? fallbackPaymentHeader,
	};
}
