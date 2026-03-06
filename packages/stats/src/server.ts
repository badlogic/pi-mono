import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import {
	getDashboardStats,
	getRecentErrors,
	getRecentRequests,
	getRequestDetails,
	getTotalMessageCount,
	syncAllSessions,
} from "./aggregator.js";

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
	const body = JSON.stringify(payload);
	response.writeHead(statusCode, {
		"Access-Control-Allow-Origin": "*",
		"Access-Control-Allow-Methods": "GET, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type",
		"Content-Type": "application/json; charset=utf-8",
		"Content-Length": Buffer.byteLength(body).toString(),
	});
	response.end(body);
}

function sendHtml(response: ServerResponse, body: string): void {
	response.writeHead(200, {
		"Content-Type": "text/html; charset=utf-8",
		"Content-Length": Buffer.byteLength(body).toString(),
	});
	response.end(body);
}

function getDashboardHtml(): string {
	return `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>pi-stats</title>
	<style>
		:root {
			color-scheme: dark;
			--bg: #0f1115;
			--panel: #171a21;
			--panel-alt: #1e2430;
			--border: #2c3443;
			--text: #eef2f8;
			--muted: #9eabc3;
			--accent: #7cc6ff;
			--success: #81d4a6;
			--warning: #ffc76d;
			--error: #ff8a7a;
		}

		* { box-sizing: border-box; }
		body {
			margin: 0;
			font: 14px/1.45 ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, monospace;
			background: linear-gradient(180deg, #0b0d12 0%, var(--bg) 100%);
			color: var(--text);
		}

		header, main { max-width: 1280px; margin: 0 auto; padding: 20px; }
		header { padding-bottom: 8px; }
		h1, h2 { margin: 0 0 12px; font-weight: 700; }
		h1 { font-size: 24px; }
		h2 { font-size: 15px; color: var(--accent); text-transform: uppercase; letter-spacing: 0.08em; }
		p, .muted { color: var(--muted); }
		.toolbar { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; margin-top: 12px; }
		button {
			border: 1px solid var(--border);
			background: var(--panel-alt);
			color: var(--text);
			padding: 8px 12px;
			cursor: pointer;
			border-radius: 8px;
			font: inherit;
		}
		button:hover { border-color: var(--accent); }
		.grid {
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
			gap: 12px;
			margin-bottom: 20px;
		}
		.card, .panel {
			background: rgba(23, 26, 33, 0.92);
			border: 1px solid var(--border);
			border-radius: 12px;
			padding: 14px;
			backdrop-filter: blur(8px);
		}
		.metric { font-size: 22px; font-weight: 700; margin-top: 6px; }
		.layout {
			display: grid;
			grid-template-columns: minmax(0, 2fr) minmax(320px, 1fr);
			gap: 16px;
		}
		.stack { display: grid; gap: 16px; }
		table { width: 100%; border-collapse: collapse; }
		th, td {
			text-align: left;
			padding: 8px 10px;
			border-bottom: 1px solid rgba(44, 52, 67, 0.7);
			vertical-align: top;
		}
		th { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; }
		td.numeric { text-align: right; white-space: nowrap; }
		.error { color: var(--error); }
		.success { color: var(--success); }
		.warning { color: var(--warning); }
		code {
			background: rgba(255,255,255,0.04);
			border: 1px solid rgba(255,255,255,0.08);
			padding: 1px 4px;
			border-radius: 6px;
		}
		#timeseries-list li {
			display: flex;
			justify-content: space-between;
			gap: 12px;
			padding: 6px 0;
			border-bottom: 1px solid rgba(44, 52, 67, 0.6);
		}
		#timeseries-list { list-style: none; margin: 0; padding: 0; }
		@media (max-width: 960px) {
			.layout { grid-template-columns: 1fr; }
		}
	</style>
</head>
<body>
	<header>
		<h1>pi-stats</h1>
		<p>Local observability dashboard for pi session usage.</p>
		<div class="toolbar">
			<button id="refresh-button" type="button">Refresh</button>
			<button id="sync-button" type="button">Force Sync</button>
			<span id="status" class="muted">Loading…</span>
		</div>
	</header>
	<main class="stack">
		<section id="overall-grid" class="grid"></section>
		<section class="layout">
			<div class="stack">
				<div class="panel">
					<h2>By Model</h2>
					<div id="models-table"></div>
				</div>
				<div class="panel">
					<h2>By Folder</h2>
					<div id="folders-table"></div>
				</div>
				<div class="panel">
					<h2>Recent Requests</h2>
					<div id="recent-table"></div>
				</div>
			</div>
			<div class="stack">
				<div class="panel">
					<h2>Recent Errors</h2>
					<div id="errors-table"></div>
				</div>
				<div class="panel">
					<h2>Time Series</h2>
					<ul id="timeseries-list"></ul>
				</div>
			</div>
		</section>
	</main>
	<script type="module">
		const statusNode = document.getElementById("status");
		const overallGrid = document.getElementById("overall-grid");
		const modelsTable = document.getElementById("models-table");
		const foldersTable = document.getElementById("folders-table");
		const recentTable = document.getElementById("recent-table");
		const errorsTable = document.getElementById("errors-table");
		const timeseriesList = document.getElementById("timeseries-list");

		const formatNumber = (value) => {
			if (value == null) return "-";
			if (Math.abs(value) >= 1000000) return (value / 1000000).toFixed(1) + "M";
			if (Math.abs(value) >= 1000) return (value / 1000).toFixed(1) + "k";
			return String(Math.round(value * 100) / 100);
		};

		const formatPercent = (value) => {
			if (value == null) return "-";
			return (value * 100).toFixed(1) + "%";
		};

		const formatCost = (value) => {
			if (value == null) return "-";
			if (value < 0.01) return "$" + value.toFixed(4);
			if (value < 1) return "$" + value.toFixed(3);
			return "$" + value.toFixed(2);
		};

		const formatDuration = (value) => {
			if (value == null) return "-";
			if (value < 1000) return value.toFixed(0) + "ms";
			const totalSeconds = Math.floor(value / 1000);
			const minutes = Math.floor(totalSeconds / 60);
			const seconds = totalSeconds % 60;
			return minutes > 0 ? minutes + "m " + seconds + "s" : seconds + "s";
		};

		const formatTime = (value) => {
			if (!value) return "-";
			return new Date(value).toLocaleString();
		};

		const escapeHtml = (value) => String(value)
			.replaceAll('&', '&amp;')
			.replaceAll('<', '&lt;')
			.replaceAll('>', '&gt;')
			.replaceAll('"', '&quot;')
			.replaceAll("'", '&#39;');

		function renderTable(container, columns, rows) {
			if (!rows.length) {
				container.innerHTML = '<p class="muted">No data.</p>';
				return;
			}

			const head = columns.map((column) => '<th>' + column.label + '</th>').join("");
			const body = rows.map((row) => {
				const cells = columns.map((column) => {
					const value = column.render(row);
					const className = column.numeric ? "numeric" : "";
					return '<td class="' + className + '">' + value + '</td>';
				}).join("");
				return '<tr>' + cells + '</tr>';
			}).join("");

			container.innerHTML = '<table><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table>';
		}

		function renderOverall(overall) {
			const items = [
				["Requests", formatNumber(overall.totalRequests)],
				["Errors", formatNumber(overall.failedRequests)],
				["Error Rate", formatPercent(overall.errorRate)],
				["Input Tokens", formatNumber(overall.totalInputTokens)],
				["Output Tokens", formatNumber(overall.totalOutputTokens)],
				["Cache Read", formatNumber(overall.totalCacheReadTokens)],
				["Cache Write", formatNumber(overall.totalCacheWriteTokens)],
				["Cache Rate", formatPercent(overall.cacheRate)],
				["Cost", formatCost(overall.totalCost)],
				["Premium Requests", formatNumber(overall.totalPremiumRequests)],
				["Avg Duration", formatDuration(overall.avgDuration)],
				["Avg TTFT", formatDuration(overall.avgTtft)],
				["Avg Tokens/s", overall.avgTokensPerSecond == null ? "-" : overall.avgTokensPerSecond.toFixed(1)],
				["First Seen", formatTime(overall.firstTimestamp)],
				["Last Seen", formatTime(overall.lastTimestamp)],
			];

			overallGrid.innerHTML = items.map(([label, value]) =>
				'<div class="card"><div class="muted">' + label + '</div><div class="metric">' + value + '</div></div>'
			).join("");
		}

		function renderTimeSeries(points) {
			if (!points.length) {
				timeseriesList.innerHTML = '<li class="muted">No data.</li>';
				return;
			}
			timeseriesList.innerHTML = points.slice(-24).reverse().map((point) => {
				return '<li><span>' + formatTime(point.timestamp) + '</span><span>' +
					formatNumber(point.requests) + ' req · ' +
					formatNumber(point.tokens) + ' tok · ' +
					formatCost(point.cost) +
				'</span></li>';
			}).join("");
		}

		async function fetchJson(path) {
			const response = await fetch(path);
			if (!response.ok) {
				throw new Error(path + ' failed: ' + response.status);
			}
			return response.json();
		}

		async function refresh(forceSync = false) {
			statusNode.textContent = forceSync ? "Syncing..." : "Refreshing...";
			try {
				if (forceSync) {
					await fetchJson("/api/sync");
				}

				const [stats, recent, errors] = await Promise.all([
					fetchJson("/api/stats"),
					fetchJson("/api/stats/recent?limit=20"),
					fetchJson("/api/stats/errors?limit=20"),
				]);

				renderOverall(stats.overall);
				renderTimeSeries(stats.timeSeries);
				renderTable(modelsTable, [
					{ label: "Model", render: (row) => '<code>' + escapeHtml(row.provider + ':' + row.model) + '</code>' },
					{ label: "Req", render: (row) => formatNumber(row.totalRequests), numeric: true },
					{ label: "Cost", render: (row) => formatCost(row.totalCost), numeric: true },
					{ label: "Cache", render: (row) => formatPercent(row.cacheRate), numeric: true },
				], stats.byModel.slice(0, 20));
				renderTable(foldersTable, [
					{ label: "Folder", render: (row) => '<code>' + escapeHtml(row.folder) + '</code>' },
					{ label: "Req", render: (row) => formatNumber(row.totalRequests), numeric: true },
					{ label: "Cost", render: (row) => formatCost(row.totalCost), numeric: true },
				], stats.byFolder.slice(0, 20));
				renderTable(recentTable, [
					{ label: "Time", render: (row) => formatTime(row.timestamp) },
					{ label: "Model", render: (row) => '<code>' + escapeHtml(row.model) + '</code>' },
					{ label: "Stop", render: (row) => row.stopReason === 'error' ? '<span class="error">error</span>' : '<span class="success">' + escapeHtml(row.stopReason) + '</span>' },
					{ label: "Out", render: (row) => formatNumber(row.usage.output), numeric: true },
					{ label: "Cost", render: (row) => formatCost(row.usage.cost.total), numeric: true },
				], recent);
				renderTable(errorsTable, [
					{ label: "Time", render: (row) => formatTime(row.timestamp) },
					{ label: "Model", render: (row) => '<code>' + escapeHtml(row.model) + '</code>' },
					{ label: "Error", render: (row) => '<span class="error">' + escapeHtml(row.errorMessage || row.stopReason) + '</span>' },
				], errors);
				statusNode.textContent = 'Last refresh: ' + new Date().toLocaleTimeString();
			} catch (error) {
				statusNode.textContent = error instanceof Error ? error.message : String(error);
				statusNode.className = 'error';
			}
		}

		document.getElementById("refresh-button")?.addEventListener("click", () => refresh(false));
		document.getElementById("sync-button")?.addEventListener("click", () => refresh(true));
		void refresh(false);
		window.setInterval(() => void refresh(false), 30000);
	</script>
</body>
</html>`;
}

async function handleApi(request: IncomingMessage, response: ServerResponse): Promise<void> {
	const url = new URL(request.url ?? "/", "http://127.0.0.1");
	const pathname = url.pathname;

	await syncAllSessions();

	if (pathname === "/api/stats") {
		sendJson(response, 200, await getDashboardStats());
		return;
	}

	if (pathname === "/api/stats/recent") {
		const limit = url.searchParams.get("limit");
		sendJson(response, 200, await getRecentRequests(limit ? Number.parseInt(limit, 10) : undefined));
		return;
	}

	if (pathname === "/api/stats/errors") {
		const limit = url.searchParams.get("limit");
		sendJson(response, 200, await getRecentErrors(limit ? Number.parseInt(limit, 10) : undefined));
		return;
	}

	if (pathname === "/api/stats/models") {
		sendJson(response, 200, (await getDashboardStats()).byModel);
		return;
	}

	if (pathname === "/api/stats/folders") {
		sendJson(response, 200, (await getDashboardStats()).byFolder);
		return;
	}

	if (pathname === "/api/stats/timeseries") {
		sendJson(response, 200, (await getDashboardStats()).timeSeries);
		return;
	}

	if (pathname.startsWith("/api/request/")) {
		const rawId = pathname.split("/").pop();
		const requestId = rawId ? Number.parseInt(rawId, 10) : Number.NaN;
		if (!Number.isFinite(requestId)) {
			sendJson(response, 400, { error: "Invalid request id." });
			return;
		}

		const details = await getRequestDetails(requestId);
		if (!details) {
			sendJson(response, 404, { error: "Request not found." });
			return;
		}

		sendJson(response, 200, details);
		return;
	}

	if (pathname === "/api/sync") {
		const syncResult = await syncAllSessions();
		sendJson(response, 200, { ...syncResult, totalMessages: await getTotalMessageCount() });
		return;
	}

	sendJson(response, 404, { error: "Not found." });
}

export async function startServer(port = 3847): Promise<{ port: number; stop: () => Promise<void> }> {
	const server = createServer(async (request, response) => {
		if (request.method === "OPTIONS") {
			response.writeHead(204, {
				"Access-Control-Allow-Origin": "*",
				"Access-Control-Allow-Methods": "GET, OPTIONS",
				"Access-Control-Allow-Headers": "Content-Type",
			});
			response.end();
			return;
		}

		try {
			const url = new URL(request.url ?? "/", "http://127.0.0.1");
			if (url.pathname.startsWith("/api/")) {
				await handleApi(request, response);
				return;
			}

			sendHtml(response, getDashboardHtml());
		} catch (error) {
			sendJson(response, 500, {
				error: error instanceof Error ? error.message : "Unknown server error.",
			});
		}
	});

	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(port, () => {
			server.off("error", reject);
			resolve();
		});
	});

	const address = server.address();
	const actualPort =
		typeof address === "object" && address && "port" in address ? (address as AddressInfo).port : port;

	return {
		port: actualPort,
		stop: () =>
			new Promise<void>((resolve, reject) => {
				server.close((error) => {
					if (error) {
						reject(error);
						return;
					}
					resolve();
				});
			}),
	};
}
