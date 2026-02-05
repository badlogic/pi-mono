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
	let ref: string | undefined;

	// Try hosted-git-info, converting @ref to #ref if needed
	let info = hostedGitInfo.fromUrl(url);
	const lastAt = url.lastIndexOf("@");

	// If the parsed project contains '@' or parsing failed, there may be a trailing @ref
	if ((info?.project?.includes("@") || !info) && lastAt > 0) {
		// Extract the ref (everything after the last '@')
		ref = url.slice(lastAt + 1);
		const withoutRef = url.slice(0, lastAt);
		// Re-parse using '#ref' syntax that hosted-git-info understands
		info = hostedGitInfo.fromUrl(`${withoutRef}#${ref}`) ?? info;
		if (info) {
			url = withoutRef; // use clean URL for repo field
		}
	}

	// If still no info, try adding https:// prefix for shorthand URLs (e.g., host/path)
	if (!info) {
		const withHttps = `https://${url}`;
		info = hostedGitInfo.fromUrl(withHttps);
		if (info) {
			url = withHttps; // use full URL
		}
	}

	if (info) {
		// Ensure repo is a valid clone URL (has scheme or is SSH)
		let repoUrl = url;
		if (!url.includes("://") && !url.includes("@")) {
			repoUrl = `https://${url}`;
		}
		return {
			type: "git",
			repo: repoUrl,
			host: info.domain || "",
			path: `${info.user}/${info.project}`.replace(/\.git$/, ""),
			ref: info.committish || ref,
			pinned: Boolean(info.committish || ref),
		};
	}

	// Fallback for codeberg (not in hosted-git-info)
	const normalized = url.replace(/^https?:\/\//, "").replace(/\.git$/, "");
	const codebergHost = "codeberg.org";
	if (normalized.startsWith(`${codebergHost}/`)) {
		const parts = normalized.slice(codebergHost.length + 1).split("/");
		if (parts.length >= 2) {
			const [owner, project] = parts;
			const repoUrl = url.startsWith("http") || url.includes("@") ? url : `https://${url}`;
			return {
				type: "git",
				repo: repoUrl,
				host: codebergHost,
				path: `${owner}/${project}`.replace(/\.git$/, ""),
				ref,
				pinned: Boolean(ref),
			};
		}
	}

	return null;
}
