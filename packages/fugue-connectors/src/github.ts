import type { FugueEvent } from "@fugue/shared";
import { type ConnectorSource, makeEvent } from "./bridge.js";

// ─── GitHub Event Types ───────────────────────────────────────────────────────

interface GitHubPushPayload {
	ref: string;
	repository: { full_name: string; html_url: string };
	pusher: { name: string };
	commits: Array<{ id: string; message: string; url: string; added: string[]; modified: string[]; removed: string[] }>;
}

interface GitHubPullRequestPayload {
	action: string;
	number: number;
	pull_request: {
		title: string;
		html_url: string;
		state: string;
		merged: boolean;
		user: { login: string };
		head: { ref: string };
		base: { ref: string };
	};
	repository: { full_name: string };
}

interface GitHubIssuePayload {
	action: string;
	issue: {
		number: number;
		title: string;
		html_url: string;
		state: string;
		user: { login: string };
	};
	repository: { full_name: string };
}

type GitHubWebhookPayload = {
	event: "push" | "pull_request" | "issues" | string;
	body: Record<string, unknown>;
};

// ─── GitHubConnector ──────────────────────────────────────────────────────────

/**
 * Transforms GitHub webhook payloads into FugueEvents.
 *
 * Supports: push, pull_request (opened/closed/merged), issues (opened/closed)
 *
 * Incoming format expected by EventBridge.ingest:
 *   { event: "pull_request", body: { ...github payload... } }
 */
export class GitHubConnector implements ConnectorSource {
	readonly name = "github";

	transform(raw: unknown): FugueEvent[] {
		if (!isGitHubPayload(raw)) return [];

		switch (raw.event) {
			case "push":
				return this.handlePush(raw.body as unknown as GitHubPushPayload);
			case "pull_request":
				return this.handlePullRequest(raw.body as unknown as GitHubPullRequestPayload);
			case "issues":
				return this.handleIssue(raw.body as unknown as GitHubIssuePayload);
			default:
				return [];
		}
	}

	private handlePush(body: GitHubPushPayload): FugueEvent[] {
		if (!body.commits?.length) return [];

		const branch = body.ref?.replace("refs/heads/", "") ?? "unknown";
		return [
			makeEvent("connector:github", "github.push", {
				repo: body.repository?.full_name,
				branch,
				pusher: body.pusher?.name,
				commitCount: body.commits.length,
				commits: body.commits.map((c) => ({
					id: c.id,
					message: c.message,
					url: c.url,
				})),
			}),
		];
	}

	private handlePullRequest(body: GitHubPullRequestPayload): FugueEvent[] {
		const action = body.action;
		if (!["opened", "closed", "reopened", "merged"].includes(action)) return [];

		const pr = body.pull_request;
		const isMerge = action === "closed" && pr?.merged;
		const type = isMerge ? "github.pr.merged" : `github.pr.${action}`;

		return [
			makeEvent("connector:github", type, {
				repo: body.repository?.full_name,
				number: body.number,
				title: pr?.title,
				url: pr?.html_url,
				author: pr?.user?.login,
				sourceBranch: pr?.head?.ref,
				targetBranch: pr?.base?.ref,
				state: pr?.state,
			}),
		];
	}

	private handleIssue(body: GitHubIssuePayload): FugueEvent[] {
		const action = body.action;
		if (!["opened", "closed"].includes(action)) return [];

		const issue = body.issue;
		return [
			makeEvent("connector:github", `github.issue.${action}`, {
				repo: body.repository?.full_name,
				number: issue?.number,
				title: issue?.title,
				url: issue?.html_url,
				author: issue?.user?.login,
				state: issue?.state,
			}),
		];
	}
}

function isGitHubPayload(raw: unknown): raw is GitHubWebhookPayload {
	return (
		typeof raw === "object" &&
		raw !== null &&
		"event" in raw &&
		"body" in raw &&
		typeof (raw as GitHubWebhookPayload).event === "string"
	);
}
