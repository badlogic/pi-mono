import chalk from "chalk";
import { APP_NAME } from "../config.js";

type SearchProvider = "auto" | "duckduckgo";
type SearchRecency = "day" | "week" | "month" | "year";

interface SearchCommandArgs {
	query: string;
	provider: SearchProvider;
	recency?: SearchRecency;
	limit: number;
	compact: boolean;
	json: boolean;
}

interface SearchResultItem {
	title: string;
	url: string;
	snippet?: string;
}

interface SearchCommandDependencies {
	fetch?: typeof fetch;
}

const VALID_RECENCY: readonly SearchRecency[] = ["day", "week", "month", "year"];
const VALID_PROVIDERS: readonly SearchProvider[] = ["auto", "duckduckgo"];

function decodeHtml(value: string): string {
	return value
		.replace(/&amp;/g, "&")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&#x2F;/g, "/");
}

function stripHtml(value: string): string {
	return decodeHtml(
		value
			.replace(/<[^>]+>/g, " ")
			.replace(/\s+/g, " ")
			.trim(),
	);
}

function printSearchHelp(): void {
	console.log(`${APP_NAME} q

Usage:
  ${APP_NAME} q [options] <query>
  ${APP_NAME} search [options] <query>

Options:
  --provider <name>   Search provider: auto, duckduckgo
  --recency <value>   Recency filter: day, week, month, year
  -l, --limit <n>     Max results to return (default: 5)
  --compact           Render compact output
  --json              Output JSON
  --help              Show this help
`);
}

function parseSearchCommandArgs(args: string[]): SearchCommandArgs | undefined {
	if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
		printSearchHelp();
		return undefined;
	}

	const parsed: SearchCommandArgs = {
		query: "",
		provider: "auto",
		limit: 5,
		compact: false,
		json: false,
	};

	const positional: string[] = [];
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--provider") {
			const value = args[++i];
			if (!value || !VALID_PROVIDERS.includes(value as SearchProvider)) {
				console.error(chalk.red(`Invalid provider "${value ?? ""}". Use: ${VALID_PROVIDERS.join(", ")}`));
				process.exitCode = 1;
				return undefined;
			}
			parsed.provider = value as SearchProvider;
			continue;
		}
		if (arg === "--recency") {
			const value = args[++i];
			if (!value || !VALID_RECENCY.includes(value as SearchRecency)) {
				console.error(chalk.red(`Invalid recency "${value ?? ""}". Use: ${VALID_RECENCY.join(", ")}`));
				process.exitCode = 1;
				return undefined;
			}
			parsed.recency = value as SearchRecency;
			continue;
		}
		if (arg === "--limit" || arg === "-l") {
			const value = args[++i];
			const limit = Number.parseInt(value ?? "", 10);
			if (!Number.isFinite(limit) || limit < 1 || limit > 20) {
				console.error(chalk.red("Search limit must be an integer between 1 and 20"));
				process.exitCode = 1;
				return undefined;
			}
			parsed.limit = limit;
			continue;
		}
		if (arg === "--compact") {
			parsed.compact = true;
			continue;
		}
		if (arg === "--json") {
			parsed.json = true;
			continue;
		}
		if (arg === "--help" || arg === "-h") {
			printSearchHelp();
			return undefined;
		}
		if (arg.startsWith("-")) {
			console.error(chalk.red(`Unknown option for "${APP_NAME} q": ${arg}`));
			process.exitCode = 1;
			return undefined;
		}
		positional.push(arg);
	}

	parsed.query = positional.join(" ").trim();
	if (!parsed.query) {
		console.error(chalk.red("Search query is required"));
		process.exitCode = 1;
		return undefined;
	}

	return parsed;
}

function mapRecencyToDuckDuckGo(value: SearchRecency | undefined): string | undefined {
	switch (value) {
		case "day":
			return "d";
		case "week":
			return "w";
		case "month":
			return "m";
		case "year":
			return "y";
		default:
			return undefined;
	}
}

function parseDuckDuckGoResults(html: string, limit: number): SearchResultItem[] {
	const results: SearchResultItem[] = [];
	const blockRegex =
		/<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>|<div[^>]*class="[^"]*result__snippet[^"]*"[^>]*>)([\s\S]*?)(?:<\/a>|<\/div>)/g;

	for (const match of html.matchAll(blockRegex)) {
		const url = decodeHtml(match[1] ?? "").trim();
		const title = stripHtml(match[2] ?? "");
		const snippet = stripHtml(match[3] ?? "");
		if (!url || !title) {
			continue;
		}
		results.push({ title, url, snippet });
		if (results.length >= limit) {
			break;
		}
	}

	return results;
}

async function runDuckDuckGoSearch(
	query: string,
	limit: number,
	recency: SearchRecency | undefined,
	fetchImpl: typeof fetch,
): Promise<SearchResultItem[]> {
	const url = new URL("https://html.duckduckgo.com/html/");
	url.searchParams.set("q", query);
	const recencyValue = mapRecencyToDuckDuckGo(recency);
	if (recencyValue) {
		url.searchParams.set("df", recencyValue);
	}

	const response = await fetchImpl(url, {
		headers: {
			"user-agent": `${APP_NAME}/search`,
			"content-type": "application/x-www-form-urlencoded;charset=UTF-8",
		},
	});
	if (!response.ok) {
		throw new Error(`Search request failed with ${response.status}`);
	}

	const html = await response.text();
	return parseDuckDuckGoResults(html, limit);
}

function renderResults(query: string, results: SearchResultItem[], compact: boolean): void {
	if (results.length === 0) {
		console.log(chalk.dim(`No web results for "${query}"`));
		return;
	}

	console.log(chalk.bold(`Web results for "${query}":\n`));
	for (const [index, result] of results.entries()) {
		console.log(`${chalk.cyan(`${index + 1}.`)} ${result.title}`);
		console.log(chalk.dim(`   ${result.url}`));
		if (!compact && result.snippet) {
			console.log(`   ${result.snippet}`);
		}
	}
}

export async function runSearchCommand(args: string[], deps?: SearchCommandDependencies): Promise<void> {
	const parsed = parseSearchCommandArgs(args);
	if (!parsed) {
		return;
	}
	if (process.exitCode === 1) {
		return;
	}

	const fetchImpl = deps?.fetch ?? fetch;
	try {
		const results = await runDuckDuckGoSearch(parsed.query, parsed.limit, parsed.recency, fetchImpl);
		if (parsed.json) {
			console.log(
				JSON.stringify(
					{
						query: parsed.query,
						provider: parsed.provider === "auto" ? "duckduckgo" : parsed.provider,
						results,
					},
					null,
					2,
				),
			);
			return;
		}
		renderResults(parsed.query, results, parsed.compact);
	} catch (error) {
		console.error(chalk.red(`Search error: ${error instanceof Error ? error.message : String(error)}`));
		process.exitCode = 1;
	}
}
