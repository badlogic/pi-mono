#!/usr/bin/env node
/**
 * Pi Agent GitHub Action Entrypoint
 *
 * Handles GitHub event context, builds prompts, and executes pi-coding-agent
 */

import { spawn } from "child_process";
import { appendFileSync, writeFileSync } from "fs";

interface GitHubContext {
	repo: string;
	eventName: string;
	prNumber?: string;
	issueNumber?: string;
	commentBody?: string;
	issueTitle?: string;
	issueBody?: string;
	actor: string;
}

interface AgentConfig {
	mode: string;
	model: string;
	maxTurns: number;
	enableLearning: boolean;
	allowedTools: string[];
	customPrompt?: string;
}

function getGitHubContext(): GitHubContext {
	return {
		repo: process.env.REPO || "",
		eventName: process.env.EVENT_NAME || "",
		prNumber: process.env.PR_NUMBER,
		issueNumber: process.env.ISSUE_NUMBER,
		commentBody: process.env.COMMENT_BODY,
		issueTitle: process.env.ISSUE_TITLE,
		issueBody: process.env.ISSUE_BODY,
		actor: process.env.ACTOR || "unknown",
	};
}

function getAgentConfig(): AgentConfig {
	return {
		mode: process.env.PI_AGENT_MODE || "auto",
		model: process.env.PI_AGENT_MODEL || "anthropic/claude-sonnet-4",
		maxTurns: parseInt(process.env.PI_AGENT_MAX_TURNS || "25", 10),
		enableLearning: process.env.PI_AGENT_ENABLE_LEARNING !== "false",
		allowedTools: (process.env.PI_AGENT_ALLOWED_TOOLS || "Read,Write,Edit,Glob,Grep,Bash").split(","),
		customPrompt: process.env.CUSTOM_PROMPT,
	};
}

function buildPrompt(ctx: GitHubContext, config: AgentConfig): string {
	// Custom prompt takes precedence
	if (config.customPrompt) {
		return config.customPrompt;
	}

	const number = ctx.prNumber || ctx.issueNumber;

	// PR Review mode
	if (config.mode === "review" || ctx.eventName === "pull_request") {
		return `Review PR #${ctx.prNumber} in ${ctx.repo}.

Analyze the changes and provide feedback on:
- Code quality and best practices
- Potential bugs or issues
- Security implications
- Performance considerations

Use the gh CLI to:
1. View the diff: gh pr diff ${ctx.prNumber}
2. Post comments: gh pr comment ${ctx.prNumber} -b "your feedback"
3. Add inline comments for specific code issues

Be constructive and specific in your feedback.`;
	}

	// Comment response mode
	if (ctx.commentBody) {
		// Extract the actual request (remove trigger phrase)
		const request = ctx.commentBody.replace(/@pi\s*/gi, "").trim();

		return `User request from @${ctx.actor}:

${request}

Context:
- Repository: ${ctx.repo}
- Issue/PR: #${number}

Please help with this request. You have access to the codebase and can:
- Read and analyze files
- Make code changes if requested
- Run commands via bash
- Use gh CLI for GitHub operations

Respond helpfully and take action as needed.`;
	}

	// Issue triage mode
	if (ctx.issueTitle && ctx.issueBody) {
		return `New issue opened in ${ctx.repo}:

**Title:** ${ctx.issueTitle}

**Description:**
${ctx.issueBody}

**Author:** @${ctx.actor}

Please:
1. Analyze the issue to understand what's being requested
2. Categorize it (bug, feature, question, enhancement)
3. Suggest appropriate labels using: gh issue edit ${ctx.issueNumber} --add-label "label"
4. If it's a simple fix, you may implement it and create a PR
5. If clarification is needed, post a comment asking for more details`;
	}

	// Default: analyze repository
	return `Analyze the current repository (${ctx.repo}) and provide insights about:
- Project structure
- Recent changes
- Any obvious issues or improvements

Use available tools to explore the codebase.`;
}

async function runAgent(prompt: string, config: AgentConfig): Promise<void> {
	const args = ["pi", "--print", "--max-turns", config.maxTurns.toString()];

	// Add model if not default
	if (config.model && config.model !== "anthropic/claude-sonnet-4") {
		args.push("--model", config.model);
	}

	// Add the prompt
	args.push(prompt);

	console.log("Executing Pi Agent...");
	console.log(`Mode: ${config.mode}`);
	console.log(`Model: ${config.model}`);
	console.log(`Max turns: ${config.maxTurns}`);
	console.log("---");

	return new Promise((resolve, reject) => {
		const child = spawn("npx", args, {
			stdio: ["pipe", "pipe", "pipe"],
			env: process.env,
		});

		let output = "";

		child.stdout?.on("data", (data) => {
			const text = data.toString();
			output += text;
			process.stdout.write(text);
		});

		child.stderr?.on("data", (data) => {
			process.stderr.write(data);
		});

		child.on("close", (code) => {
			// Write output for GitHub Actions
			const outputFile = process.env.GITHUB_OUTPUT;
			if (outputFile) {
				appendFileSync(outputFile, `conclusion=${code === 0 ? "success" : "failure"}\n`);
			}

			if (code === 0) {
				resolve();
			} else {
				reject(new Error(`Agent exited with code ${code}`));
			}
		});

		child.on("error", (err) => {
			reject(err);
		});
	});
}

async function main(): Promise<void> {
	console.log("🤖 Pi Agent Action Starting...\n");

	const ctx = getGitHubContext();
	const config = getAgentConfig();

	console.log(`Repository: ${ctx.repo}`);
	console.log(`Event: ${ctx.eventName}`);
	console.log(`Actor: ${ctx.actor}`);
	console.log("");

	const prompt = buildPrompt(ctx, config);
	console.log("Built prompt:");
	console.log("---");
	console.log(prompt.slice(0, 500) + (prompt.length > 500 ? "..." : ""));
	console.log("---\n");

	try {
		await runAgent(prompt, config);
		console.log("\n✅ Pi Agent completed successfully");
	} catch (error) {
		console.error("\n❌ Pi Agent failed:", error);
		process.exit(1);
	}
}

main().catch(console.error);
