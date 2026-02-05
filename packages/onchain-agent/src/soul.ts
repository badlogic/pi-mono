import { existsSync, readdirSync, readFileSync } from "fs";
import { basename, join } from "path";

export function loadSoul(soulPath: string): string {
	const content = readFileSync(soulPath, "utf-8");
	return stripFrontmatter(content);
}

export function loadTaskLists(taskListDir: string): Map<string, string> {
	if (!existsSync(taskListDir)) return new Map();
	const files = readdirSync(taskListDir)
		.filter((f) => f.endsWith(".md"))
		.sort();
	const result = new Map<string, string>();
	for (const file of files) {
		const domain = basename(file, ".md");
		const content = readFileSync(join(taskListDir, file), "utf-8");
		result.set(domain, stripFrontmatter(content));
	}
	return result;
}

export function buildGamePrompt(options: {
	soul: string;
	taskLists: Map<string, string>;
	worldStateSummary?: string;
}): { systemPrompt: string; appendSections: string[] } {
	const appendSections: string[] = [];

	if (options.taskLists.size > 0) {
		let taskListXml = "<task_lists>\n";
		for (const [domain, content] of options.taskLists) {
			taskListXml += `<domain name="${domain}">\n${content}\n</domain>\n`;
		}
		taskListXml += "</task_lists>";
		appendSections.push(taskListXml);
	}

	if (options.worldStateSummary) {
		appendSections.push(`## Current World State\n${options.worldStateSummary}`);
	}

	return { systemPrompt: options.soul, appendSections };
}

function stripFrontmatter(content: string): string {
	const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
	if (match) return match[2].trimStart();
	return normalized;
}
