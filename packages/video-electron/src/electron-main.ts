import { access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { VideoAgentController, type VideoAgentControllerOptions } from "./controller.js";
import type { CommandResult, RendererCommand } from "./ipc.js";

const IPC_COMMAND_CHANNEL = "video-agent:command";
const IPC_EVENT_CHANNEL = "video-agent:event";
const IPC_PICK_VIDEO_FILE_CHANNEL = "video-agent:pick-video-file";

export interface CreateVideoElectronAppOptions {
	controllerOptions?: VideoAgentControllerOptions;
	preloadPath?: string;
	indexFile?: string;
	indexUrl?: string;
}

export interface VideoElectronApp {
	controller: VideoAgentController;
}

export async function createVideoElectronApp(options: CreateVideoElectronAppOptions = {}): Promise<VideoElectronApp> {
	const preloadPath = resolve(options.preloadPath ?? defaultPreloadPath());
	const indexFile = resolve(options.indexFile ?? defaultIndexFilePath());
	console.info("[video-main] boot", { preloadPath, indexFile, hasIndexUrl: Boolean(options.indexUrl) });

	await app.whenReady();
	console.info("[video-main] app ready");
	await logPathReadability("preload", preloadPath);
	await logPathReadability("indexFile", indexFile);

	const window = new BrowserWindow({
		width: 1440,
		height: 960,
		show: false,
		webPreferences: {
			preload: preloadPath,
			contextIsolation: true,
			sandbox: true,
			nodeIntegration: false,
		},
	});

	const controller = new VideoAgentController(buildControllerOptions(window, options.controllerOptions));
	registerIpc(window, controller);
	registerDiagnostics(window);
	window.once("ready-to-show", () => window.show());
	console.info("[video-main] window created");

	if (options.indexUrl) {
		console.info("[video-main] loading URL", { indexUrl: options.indexUrl });
		await window.loadURL(options.indexUrl);
	} else {
		console.info("[video-main] loading file", { indexFile });
		await window.loadFile(indexFile);
	}
	console.info("[video-main] renderer load complete");

	app.on("activate", () => {
		// Keep no-op for now; window recreation strategy is app-specific.
	});

	app.on("window-all-closed", () => {
		console.info("[video-main] window-all-closed, disposing controller");
		controller.dispose();
		app.quit();
	});

	return { controller };
}

function buildControllerOptions(
	window: BrowserWindow,
	options: VideoAgentControllerOptions | undefined,
): VideoAgentControllerOptions {
	const settings = {
		...(options?.settings ?? {}),
	};
	if (settings.requireApproval === undefined) {
		settings.requireApproval = true;
	}
	return {
		...options,
		settings,
		approvalHandler: options?.approvalHandler ?? createDialogApprovalHandler(window),
	};
}

function createDialogApprovalHandler(
	window: BrowserWindow,
): NonNullable<VideoAgentControllerOptions["approvalHandler"]> {
	return async (request) => {
		const detailLines = [`Reason: ${request.reason}`, `Command: ${request.invocation.command}`];
		if (typeof request.invocation.input === "string" && request.invocation.input.length > 0) {
			detailLines.push(`Input: ${request.invocation.input}`);
		}
		if (typeof request.invocation.output === "string" && request.invocation.output.length > 0) {
			detailLines.push(`Output: ${request.invocation.output}`);
		}
		const result = await dialog.showMessageBox(window, {
			type: "warning",
			title: "Approve Video Edit Action",
			message: "The agent requested a command that can modify media files.",
			detail: detailLines.join("\n"),
			buttons: ["Approve", "Deny"],
			defaultId: 1,
			cancelId: 1,
			noLink: true,
			normalizeAccessKeys: true,
		});
		if (result.response === 0) {
			return { approved: true };
		}
		return { approved: false, reason: "User denied approval" };
	};
}

function registerDiagnostics(window: BrowserWindow): void {
	window.webContents.on("console-message", (_event, level, message, line, sourceId) => {
		console.info("[video-renderer-console]", {
			level,
			message,
			line,
			sourceId,
		});
	});
	window.webContents.on("did-fail-load", (_event, errorCode, errorDescription) => {
		console.error("[video-main] did-fail-load", { errorCode, errorDescription });
	});
	window.webContents.on("preload-error", (_event, preloadPath, error) => {
		console.error("[video-main] preload-error", {
			preloadPath,
			message: error.message,
			name: error.name,
		});
	});
	window.webContents.on("did-finish-load", async () => {
		try {
			const hasBridge = await window.webContents.executeJavaScript("typeof window.videoAgent !== 'undefined'");
			const bridgeKeys = await window.webContents.executeJavaScript(
				"typeof window.videoAgent === 'undefined' ? [] : Object.keys(window.videoAgent)",
			);
			console.info("[video-main] bridge probe", { hasBridge, bridgeKeys });
		} catch (error) {
			console.error("[video-main] bridge probe failed", {
				message: error instanceof Error ? error.message : String(error),
			});
		}
	});
}

function registerIpc(window: BrowserWindow, controller: VideoAgentController): void {
	controller.subscribe((event) => {
		window.webContents.send(IPC_EVENT_CHANNEL, event);
	});

	ipcMain.handle(IPC_COMMAND_CHANNEL, async (_event, payload): Promise<CommandResult> => {
		console.info("[video-main] command received");
		const command = parseRendererCommand(payload);
		console.info("[video-main] command parsed", { type: command.type });
		const result = await controller.handleCommand(command);
		console.info("[video-main] command completed", { type: command.type, ok: result.ok });
		return result;
	});

	ipcMain.handle(IPC_PICK_VIDEO_FILE_CHANNEL, async (): Promise<{ projectRoot: string; videoPath: string } | null> => {
		console.info("[video-main] pickVideoFile dialog open");
		const result = await dialog.showOpenDialog({
			title: "Select Video",
			properties: ["openFile"],
			filters: [
				{
					name: "Video Files",
					extensions: ["mp4", "mov", "mkv", "avi", "webm", "m4v", "mpg", "mpeg"],
				},
			],
		});
		if (result.canceled) {
			console.info("[video-main] pickVideoFile canceled");
			return null;
		}
		const videoPath = result.filePaths[0];
		if (!videoPath) {
			console.warn("[video-main] pickVideoFile empty selection");
			return null;
		}
		console.info("[video-main] pickVideoFile selected", { videoPath });
		return {
			projectRoot: dirname(videoPath),
			videoPath,
		};
	});
}

function parseRendererCommand(payload: unknown): RendererCommand {
	if (!isRecord(payload) || typeof payload.type !== "string") {
		throw new Error("Invalid renderer command payload");
	}
	return payload as RendererCommand;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function defaultPreloadPath(): string {
	const currentFile = fileURLToPath(import.meta.url);
	return join(dirname(currentFile), "preload.cjs");
}

function defaultIndexFilePath(): string {
	const currentFile = fileURLToPath(import.meta.url);
	return join(dirname(currentFile), "..", "renderer", "index.html");
}

async function logPathReadability(label: string, path: string): Promise<void> {
	try {
		await access(path);
		console.info("[video-main] path readable", { label, path });
	} catch (error) {
		console.error("[video-main] path not readable", {
			label,
			path,
			message: error instanceof Error ? error.message : String(error),
		});
	}
}
