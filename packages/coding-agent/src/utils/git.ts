const GIT_HOSTS = ["github.com", "gitlab.com", "bitbucket.org", "codeberg.org"];

export function looksLikeGitUrl(source: string): boolean {
	const normalized = source.replace(/^https?:\/\//, "");
	return GIT_HOSTS.some((host) => normalized.startsWith(`${host}/`));
}

/**
 * Check if a string looks like an SSH git URL.
 * Matches patterns like:
 * - git@github.com:user/repo
 * - ssh://git@github.com/user/repo
 */
export function looksLikeSshGitUrl(source: string): boolean {
	// ssh:// protocol
	if (source.startsWith("ssh://")) {
		return true;
	}
	// git@host:path pattern
	if (/^[^@]+@[^:]+:.+/.test(source)) {
		return true;
	}
	return false;
}

/**
 * Parse SSH git URL into host and path components.
 * Returns normalized format suitable for storage/comparison.
 * Handles refs like: git@github.com:user/repo@v1.0.0
 */
export function parseSshGitUrl(source: string): { host: string; path: string; ref?: string } | null {
	// ssh://git@github.com/user/repo or ssh://git@github.com:port/user/repo
	if (source.startsWith("ssh://")) {
		// Find last @ for ref
		const lastAtIndex = source.lastIndexOf("@");
		const firstAtIndex = source.indexOf("@");

		let urlPart = source;
		let ref: string | undefined;

		// If there are multiple @, the last one might be a ref
		if (lastAtIndex > firstAtIndex && lastAtIndex > source.indexOf("/")) {
			urlPart = source.slice(0, lastAtIndex);
			ref = source.slice(lastAtIndex + 1);
		}

		const match = urlPart.match(/^ssh:\/\/(?:[^@]+@)?([^/:]+)(?::\d+)?\/(.+)$/);
		if (match) {
			return { host: match[1]!, path: match[2]!.replace(/\.git$/, ""), ref };
		}
		return null;
	}

	// git@github.com:user/repo or git@github.com:user/repo@v1.0.0
	// Need to find the @ after the : for the ref
	const colonIndex = source.indexOf(":");
	if (colonIndex === -1) return null;

	const beforeColon = source.slice(0, colonIndex);
	const afterColon = source.slice(colonIndex + 1);

	// Check for ref (@ after the path starts)
	const refAtIndex = afterColon.indexOf("@");
	let path = afterColon;
	let ref: string | undefined;

	if (refAtIndex !== -1) {
		path = afterColon.slice(0, refAtIndex);
		ref = afterColon.slice(refAtIndex + 1);
	}

	const match = beforeColon.match(/^[^@]+@(.+)$/);
	if (match) {
		return { host: match[1]!, path: path.replace(/\.git$/, ""), ref };
	}

	return null;
}
