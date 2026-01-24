const GIT_HOSTS = ["github.com", "gitlab.com", "bitbucket.org", "codeberg.org"];

export function looksLikeGitUrl(source: string): boolean {
	const normalized = source.replace(/^https?:\/\//, "");
	return GIT_HOSTS.some((host) => normalized.startsWith(`${host}/`));
}
