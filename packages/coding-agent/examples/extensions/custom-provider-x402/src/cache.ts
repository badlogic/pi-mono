import type { CachedPermit, ErrorResponse } from "./types.js";

export type { CachedPermit } from "./types.js";

const CLOCK_SKEW_SECONDS = 5;

function cacheKey(network: string, asset: string, payTo: string, maxValue: string): string {
	return `${network.toLowerCase()}::${asset.toLowerCase()}::${payTo.toLowerCase()}::${maxValue}`;
}

export class PermitCache {
	private readonly cache = new Map<string, CachedPermit>();

	constructor(private readonly now: () => number = () => Math.floor(Date.now() / 1000)) {}

	get(network: string, asset: string, payTo: string, maxValue: string): CachedPermit | undefined {
		const key = cacheKey(network, asset, payTo, maxValue);
		const permit = this.cache.get(key);
		if (!permit) return undefined;
		if (permit.deadline <= this.now() + CLOCK_SKEW_SECONDS) {
			this.cache.delete(key);
			return undefined;
		}
		return permit;
	}

	set(permit: CachedPermit): void {
		this.cache.set(cacheKey(permit.network, permit.asset, permit.payTo, permit.maxValue), permit);
	}

	invalidate(network: string, asset: string, payTo: string, maxValue: string): void {
		this.cache.delete(cacheKey(network, asset, payTo, maxValue));
	}

	clear(): void {
		this.cache.clear();
	}
}

export function shouldInvalidatePermit(error: ErrorResponse | null | undefined): boolean {
	if (!error) return false;

	const combined = `${error.code ?? ""} ${error.error ?? ""} ${error.message ?? ""}`.toLowerCase();
	return (
		combined.includes("invalid_payment_signature") ||
		combined.includes("invalid payment signature") ||
		combined.includes("invalid permit") ||
		combined.includes("permit expired") ||
		combined.includes("nonce too low")
	);
}
