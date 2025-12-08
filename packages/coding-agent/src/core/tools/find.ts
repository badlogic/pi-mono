import type { AgentTool } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { globSync } from "glob";
import { homedir } from "os";
import path from "path";
import { ensureTool } from "../../utils/tools-manager.js";
import { DEFAULT_MAX_BYTES, formatSize, type TruncationResult, truncateHead } from "./truncate.js";

/**
 * Expand ~ to home directory
 */
function expandPath(filePath: string): string {
	if (filePath === "~") {
		return homedir();
	}
	if (filePath.startsWith("~/")) {
		return homedir() + filePath.slice(1);
	}
	return filePath;
}

const findSchema = Type.Object({
	pattern: Type.String({
		description: "Glob pattern to match files, e.g. '*.ts', '**/*.json', or 'src/**/*.spec.ts'",
	}),
	path: Type.Optional(Type.String({ description: "Directory to search in (default: current directory)" })),
	limit: Type.Optional(Type.Number({ description: "Maximum number of results (default: 1000)" })),
});

const DEFAULT_LIMIT = 1000;

interface FindToolDetails {
	truncation?: TruncationResult;
	resultLimitReached?: number;
}

export const findTool: AgentTool<typeof findSchema> = {
	name: "find",
	label: "find",
	description: `Search for files by glob pattern. Returns matching file paths relative to the search directory. Respects .gitignore. Output is truncated to ${DEFAULT_LIMIT} results or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first).`,
	parameters: findSchema,
	execute: async (
		_toolCallId: string,
		{ pattern, path: searchDir, limit }: { pattern: string; path?: string; limit?: number },
		signal?: AbortSignal,
	) => {
		return new Promise((resolve, reject) => {
			if (signal?.aborted) {
				reject(new Error("Operation aborted"));
				return;
			}

			const onAbort = () => reject(new Error("Operation aborted"));
			signal?.addEventListener("abort", onAbort, { once: true });

			(async () => {
				try {
					// Ensure fd is available
					const fdPath = await ensureTool("fd", true);
					if (!fdPath) {
						reject(new Error("fd is not available and could not be downloaded"));
						return;
					}

					const searchPath = path.resolve(expandPath(searchDir || "."));
					const effectiveLimit = limit ?? DEFAULT_LIMIT;

					// Build fd arguments
					const args: string[] = [
						"--glob", // Use glob pattern
						"--color=never", // No ANSI colors
						"--hidden", // Search hidden files (but still respect .gitignore)
						"--max-results",
						String(effectiveLimit),
					];

					// Include .gitignore files (root + nested) so fd respects them even outside git repos
					const gitignoreFiles = new Set<string>();
					const rootGitignore = path.join(searchPath, ".gitignore");
					if (existsSync(rootGitignore)) {
						gitignoreFiles.add(rootGitignore);
					}

					try {
						const nestedGitignores = globSync("**/.gitignore", {
							cwd: searchPath,
							dot: true,
							absolute: true,
							ignore: ["**/node_modules/**", "**/.git/**"],
						});
						for (const file of nestedGitignores) {
							gitignoreFiles.add(file);
						}
					} catch {
						// Ignore glob errors
					}

					for (const gitignorePath of gitignoreFiles) {
						args.push("--ignore-file", gitignorePath);
					}

					// Pattern and path
					args.push(pattern, searchPath);

					// Run fd
					const result = spawnSync(fdPath, args, {
						encoding: "utf-8",
						maxBuffer: 10 * 1024 * 1024, // 10MB
					});

					signal?.removeEventListener("abort", onAbort);

					if (result.error) {
						reject(new Error(`Failed to run fd: ${result.error.message}`));
						return;
					}

					const output = result.stdout?.trim() || "";

					if (result.status !== 0) {
						const errorMsg = result.stderr?.trim() || `fd exited with code ${result.status}`;
						// fd returns non-zero for some errors but may still have partial output
						if (!output) {
							reject(new Error(errorMsg));
							return;
						}
					}

					if (!output) {
						resolve({
							content: [{ type: "text", text: "No files found matching pattern" }],
							details: undefined,
						});
						return;
					}

					const lines = output.split("\n");
					const relativized: string[] = [];

					for (const rawLine of lines) {
						const line = rawLine.replace(/\r$/, "").trim();
						if (!line) {
							continue;
						}

						const hadTrailingSlash = line.endsWith("/") || line.endsWith("\\");
						let relativePath = line;
						if (line.startsWith(searchPath)) {
							relativePath = line.slice(searchPath.length + 1); // +1 for the /
						} else {
							relativePath = path.relative(searchPath, line);
						}

						if (hadTrailingSlash && !relativePath.endsWith("/")) {
							relativePath += "/";
						}

						relativized.push(relativePath);
					}

					// Check if we hit the result limit
					const resultLimitReached = relativized.length >= effectiveLimit;

					// Apply byte truncation (no line limit since we already have result limit)
					const rawOutput = relativized.join("\n");
					const truncation = truncateHead(rawOutput, { maxLines: Number.MAX_SAFE_INTEGER });

					let resultOutput = truncation.content;
					const details: FindToolDetails = {};

					// Build notices
					const notices: string[] = [];

					if (resultLimitReached) {
						notices.push(
							`${effectiveLimit} results limit reached. Use limit=${effectiveLimit * 2} for more, or refine pattern`,
						);
						details.resultLimitReached = effectiveLimit;
					}

					if (truncation.truncated) {
						notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
						details.truncation = truncation;
					}

					if (notices.length > 0) {
						resultOutput += `\n\n[${notices.join(". ")}]`;
					}

					resolve({
						content: [{ type: "text", text: resultOutput }],
						details: Object.keys(details).length > 0 ? details : undefined,
					});
				} catch (e: any) {
					signal?.removeEventListener("abort", onAbort);
					reject(e);
				}
			})();
		});
	},
};
