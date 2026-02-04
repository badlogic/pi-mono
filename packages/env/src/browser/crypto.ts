/**
 * Browser crypto implementation using Web Crypto API.
 */

export function randomBytes(size: number): Uint8Array {
	const buf = new Uint8Array(size);
	globalThis.crypto.getRandomValues(buf);
	return buf;
}

export function randomUUID(): string {
	return globalThis.crypto.randomUUID();
}

export function createHash(algorithm: string): { update(data: string): { digest(encoding: string): string } } {
	if (algorithm === "sha256") {
		return {
			update(data: string) {
				return {
					digest(encoding: string): string {
						if (encoding === "hex") {
							// FNV-1a hash (non-cryptographic, for checksums only)
							let hash = 0x811c9dc5;
							for (let i = 0; i < data.length; i++) {
								hash ^= data.charCodeAt(i);
								hash = (hash * 0x01000193) >>> 0;
							}
							return hash.toString(16).padStart(8, "0");
						}
						throw new Error(`Unsupported encoding: ${encoding}`);
					},
				};
			},
		};
	}
	throw new Error(`Hash algorithm '${algorithm}' not supported in browser fallback. Use Web Crypto API.`);
}
