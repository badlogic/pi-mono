import hostedGitInfo from "hosted-git-info";

/**
 * Parsed git URL information.
 */
export type GitSource = {
	/** Always "git" for git sources */
	type: "git";
	/** Clone URL (always valid for git clone, without ref suffix) */
	repo: string;
	/** Git host domain (e.g., "github.com") */
	host: string;
	/** Repository path (e.g., "user/repo") */
	path: string;
	/** Git ref (branch, tag, commit) if specified */
	ref?: string;
	/** True if ref was specified (package won't be auto-updated) */
	pinned: boolean;
};

function splitRef(url: string): { repo: string; ref?: string } {
	const lastAt = url.lastIndexOf("@");
	if (lastAt <= 0) {
		return { repo: url };
	}

	const lastSlash = url.lastIndexOf("/");
	const hasScheme = url.includes("://");
	const scpLikeMatch = url.match(/^[^@]+@[^:]+:/);
	if (scpLikeMatch) {
		const separatorIndex = scpLikeMatch[0].length - 1;
		if (lastAt <= separatorIndex || lastAt <= lastSlash) {
			return { repo: url };
		}
	} else if (hasScheme) {
		const schemeIndex = url.indexOf("://");
		const pathStart = url.indexOf("/", schemeIndex + 3);
		if (pathStart < 0 || lastAt <= pathStart || lastAt <= lastSlash) {
			return { repo: url };
		}
	} else if (lastAt <= lastSlash) {
		return { repo: url };
	}

	return {
		repo: url.slice(0, lastAt),
		ref: url.slice(lastAt + 1),
	};
}

function parseGenericGitUrl(url: string): GitSource | null {
	const { repo: repoWithoutRef, ref } = splitRef(url);
	let repo = repoWithoutRef;
	let host = "";
	let path = "";

	const scpLikeMatch = repoWithoutRef.match(/^git@([^:]+):(.+)$/);
	if (scpLikeMatch) {
		host = scpLikeMatch[1] ?? "";
		path = scpLikeMatch[2] ?? "";
	} else if (
		repoWithoutRef.startsWith("https://") ||
		repoWithoutRef.startsWith("http://") ||
		repoWithoutRef.startsWith("ssh://")
	) {
		try {
			const parsed = new URL(repoWithoutRef);
			host = parsed.hostname;
			path = parsed.pathname.replace(/^\/+/, "");
		} catch {
			return null;
		}
	} else {
		const slashIndex = repoWithoutRef.indexOf("/");
		if (slashIndex < 0) {
			return null;
		}
		host = repoWithoutRef.slice(0, slashIndex);
		path = repoWithoutRef.slice(slashIndex + 1);
		if (!host.includes(".") && host !== "localhost") {
			return null;
		}
		repo = `https://${repoWithoutRef}`;
	}

	const normalizedPath = path.replace(/\.git$/, "").replace(/^\/+/, "");
	if (!host || !normalizedPath || normalizedPath.split("/").length < 2) {
		return null;
	}

	return {
		type: "git",
		repo,
		host,
		path: normalizedPath,
		ref,
		pinned: Boolean(ref),
	};
}

/**
 * Parse any git URL (SSH or HTTPS) into a GitSource.
 */
export function parseGitUrl(source: string): GitSource | null {
	const url = source.startsWith("git:") ? source.slice(4).trim() : source;
	const split = splitRef(url);

	const hostedCandidates = [url, split.ref ? `${split.repo}#${split.ref}` : undefined].filter(
		(value): value is string => Boolean(value),
	);
	for (const candidate of hostedCandidates) {
		const info = hostedGitInfo.fromUrl(candidate);
		if (info) {
			const useHttpsPrefix =
				!split.repo.startsWith("http://") &&
				!split.repo.startsWith("https://") &&
				!split.repo.startsWith("ssh://") &&
				!split.repo.startsWith("git@");
			return {
				type: "git",
				repo: useHttpsPrefix ? `https://${split.repo}` : split.repo,
				host: info.domain || "",
				path: `${info.user}/${info.project}`,
				ref: info.committish || split.ref || undefined,
				pinned: Boolean(info.committish || split.ref),
			};
		}
	}

	const httpsCandidates = [`https://${url}`, split.ref ? `https://${split.repo}#${split.ref}` : undefined].filter(
		(value): value is string => Boolean(value),
	);
	for (const candidate of httpsCandidates) {
		const info = hostedGitInfo.fromUrl(candidate);
		if (info) {
			return {
				type: "git",
				repo: `https://${split.repo}`,
				host: info.domain || "",
				path: `${info.user}/${info.project}`,
				ref: info.committish || split.ref || undefined,
				pinned: Boolean(info.committish || split.ref),
			};
		}
	}

	return parseGenericGitUrl(url);
}
