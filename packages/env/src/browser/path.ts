/**
 * Browser path implementation using POSIX semantics.
 */

export const sep = "/";
export const delimiter = ":";

export function basename(p: string, ext?: string): string {
	const parts = p.replace(/\/+$/, "").split("/");
	let base = parts[parts.length - 1] || "";
	if (ext && base.endsWith(ext)) {
		base = base.slice(0, -ext.length);
	}
	return base;
}

export function dirname(p: string): string {
	const normalized = p.replace(/\/+$/, "");
	const idx = normalized.lastIndexOf("/");
	if (idx === -1) return ".";
	if (idx === 0) return "/";
	return normalized.slice(0, idx);
}

export function isAbsolute(p: string): boolean {
	return p.startsWith("/");
}

export function join(...segments: string[]): string {
	const joined = segments.filter(Boolean).join("/");
	return normalize(joined);
}

export function resolve(...segments: string[]): string {
	let resolved = "";
	for (let i = segments.length - 1; i >= 0; i--) {
		const segment = segments[i];
		if (!segment) continue;
		resolved = resolved ? segment + "/" + resolved : segment;
		if (segment.startsWith("/")) break;
	}
	if (!resolved.startsWith("/")) {
		resolved = "/" + resolved;
	}
	return normalize(resolved);
}

export function relative(from: string, to: string): string {
	const fromParts = resolve(from).split("/").filter(Boolean);
	const toParts = resolve(to).split("/").filter(Boolean);

	let common = 0;
	while (common < fromParts.length && common < toParts.length && fromParts[common] === toParts[common]) {
		common++;
	}

	const ups = fromParts.length - common;
	const downs = toParts.slice(common);
	const parts = [...Array(ups).fill(".."), ...downs];
	return parts.join("/") || ".";
}

function normalize(p: string): string {
	const isAbs = p.startsWith("/");
	const parts = p.split("/");
	const normalized: string[] = [];

	for (const part of parts) {
		if (part === "." || part === "") continue;
		if (part === "..") {
			if (normalized.length > 0 && normalized[normalized.length - 1] !== "..") {
				normalized.pop();
			} else if (!isAbs) {
				normalized.push("..");
			}
		} else {
			normalized.push(part);
		}
	}

	const result = normalized.join("/");
	return isAbs ? "/" + result : result || ".";
}

const pathModule = {
	sep,
	delimiter,
	basename,
	dirname,
	isAbsolute,
	join,
	resolve,
	relative,
};

export default pathModule;
