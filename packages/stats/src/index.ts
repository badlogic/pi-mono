#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { closeDb, getDashboardStats, getTotalMessageCount, syncAllSessions } from "./aggregator.js";
import { startServer } from "./server.js";

export { closeDb, getDashboardStats, getTotalMessageCount, syncAllSessions } from "./aggregator.js";
export { startServer } from "./server.js";
export type {
	AggregatedStats,
	DashboardStats,
	FolderStats,
	MessageStats,
	ModelPerformancePoint,
	ModelStats,
	ModelTimeSeriesPoint,
	RequestDetails,
	TimeSeriesPoint,
} from "./types.js";

function formatNumber(value: number): string {
	if (value < 1_000) return String(value);
	if (value < 10_000) return `${(value / 1_000).toFixed(1)}k`;
	if (value < 1_000_000) return `${Math.round(value / 1_000)}k`;
	if (value < 10_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
	return `${Math.round(value / 1_000_000)}M`;
}

function formatPercent(value: number): string {
	return `${(value * 100).toFixed(1)}%`;
}

function formatCost(value: number): string {
	if (value < 0.01) return `$${value.toFixed(4)}`;
	if (value < 1) return `$${value.toFixed(3)}`;
	return `$${value.toFixed(2)}`;
}

function formatDuration(value: number | null): string {
	if (value === null) return "-";
	if (value < 1_000) return `${Math.round(value)}ms`;
	const totalSeconds = Math.floor(value / 1_000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

async function printStats(): Promise<void> {
	const stats = await getDashboardStats();
	const { overall, byModel, byFolder } = stats;

	console.log("\n=== pi-stats ===\n");
	console.log(`Requests: ${formatNumber(overall.totalRequests)} (${formatNumber(overall.failedRequests)} errors)`);
	console.log(`Error Rate: ${formatPercent(overall.errorRate)}`);
	console.log(`Input Tokens: ${formatNumber(overall.totalInputTokens)}`);
	console.log(`Output Tokens: ${formatNumber(overall.totalOutputTokens)}`);
	console.log(`Cache Rate: ${formatPercent(overall.cacheRate)}`);
	console.log(`Total Cost: ${formatCost(overall.totalCost)}`);
	console.log(`Premium Requests: ${formatNumber(overall.totalPremiumRequests)}`);
	console.log(`Avg Duration: ${formatDuration(overall.avgDuration)}`);
	console.log(`Avg TTFT: ${formatDuration(overall.avgTtft)}`);
	if (overall.avgTokensPerSecond !== null) {
		console.log(`Avg Tokens/s: ${overall.avgTokensPerSecond.toFixed(1)}`);
	}

	if (byModel.length > 0) {
		console.log("\nTop Models:");
		for (const model of byModel.slice(0, 10)) {
			console.log(
				`  ${model.provider}:${model.model}  ${formatNumber(model.totalRequests)} req  ${formatCost(model.totalCost)}  ${formatPercent(model.cacheRate)} cache`,
			);
		}
	}

	if (byFolder.length > 0) {
		console.log("\nTop Folders:");
		for (const folder of byFolder.slice(0, 10)) {
			console.log(`  ${folder.folder}  ${formatNumber(folder.totalRequests)} req  ${formatCost(folder.totalCost)}`);
		}
	}

	console.log("");
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
	const { values } = parseArgs({
		args: argv,
		options: {
			port: { type: "string", short: "p", default: "3847" },
			json: { type: "boolean", short: "j", default: false },
			sync: { type: "boolean", short: "s", default: false },
			help: { type: "boolean", short: "h", default: false },
		},
		allowPositionals: false,
	});

	if (values.help) {
		console.log(`pi-stats

Usage:
  pi-stats [options]

Options:
  -p, --port <port>  Port for the dashboard server (default: 3847)
  -j, --json         Sync and print full stats JSON
  -s, --sync         Sync and print a text summary
  -h, --help         Show this help
`);
		return;
	}

	const syncResult = await syncAllSessions();
	const totalMessages = await getTotalMessageCount();

	if (values.json) {
		console.log(JSON.stringify(await getDashboardStats(), null, 2));
		return;
	}

	if (values.sync) {
		console.log(
			`Synced ${syncResult.processed} new entries from ${syncResult.files} files (${totalMessages} total).`,
		);
		await printStats();
		return;
	}

	const requestedPort = Number.parseInt(values.port ?? "3847", 10);
	if (!Number.isFinite(requestedPort) || requestedPort <= 0 || requestedPort > 65535) {
		throw new Error(`Invalid port: ${values.port}`);
	}

	const server = await startServer(requestedPort);
	console.log(`Synced ${syncResult.processed} new entries from ${syncResult.files} files (${totalMessages} total).`);
	console.log(`Dashboard available at http://localhost:${server.port}`);

	const shutdown = async (): Promise<void> => {
		await server.stop();
		closeDb();
	};

	process.once("SIGINT", () => {
		void shutdown().finally(() => process.exit(0));
	});
	process.once("SIGTERM", () => {
		void shutdown().finally(() => process.exit(0));
	});
}

const isDirectRun = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
	void main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		closeDb();
		process.exit(1);
	});
}
