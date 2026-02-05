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

/**
 * Parse any git URL (SSH or HTTPS) into a GitSource.
 */
export function parseGitUrl(source: string): GitSource | null {
	let url = source.startsWith("git:") ? source.slice(4).trim() : source;

	// Try hosted-git-info, converting @ref to #ref if needed
	let info = hostedGitInfo.fromUrl(url);
	const lastAt = url.lastIndexOf("@");
	if ((info?.project?.includes("@") || !info) && lastAt > 0) {
		info = hostedGitInfo.fromUrl(`${url.slice(0, lastAt)}#${url.slice(lastAt + 1)}`) ?? info;
		url = url.slice(0, lastAt); // strip ref from url for repo field
	}

	// Try with https:// prefix for shorthand URLs
	if (!info) {
		info = hostedGitInfo.fromUrl(`https://${url}`);
		if (info) url = `https://${url}`; // make repo a valid clone URL
	}

	if (info) {
		return {
			type: "git",
			repo: url,
			host: info.domain || "",
			path: `${info.user}/${info.project}`,
			ref: info.committish || undefined,
			pinned: Boolean(info.committish),
		};
	}

	// Fallback for codeberg (not in hosted-git-info)
	const normalized = url.replace(/^https?:\/\//, "").replace(/@[^/]*$/, "");
	const codebergHost = "codeberg.org";
	if (normalized.startsWith(`${codebergHost}/`)) {
		const ref = url.match(/@([^/]+)$/)?.[1];
		const repoUrl = ref ? url.slice(0, url.lastIndexOf("@")) : url;
		// Ensure repo is a valid clone URL
		const cloneableRepo = repoUrl.startsWith("http") ? repoUrl : `https://${repoUrl}`;
		return {
			type: "git",
			repo: cloneableRepo,
			host: codebergHost,
			path: normalized.slice(codebergHost.length + 1).replace(/\.git$/, ""),
			ref,
			pinned: Boolean(ref),
		};
	}

	return null;
}
