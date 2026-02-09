import { contextBridge, ipcRenderer } from "electron";
import type { CommandResult, RendererCommand, RendererEvent } from "./ipc.js";

const IPC_COMMAND_CHANNEL = "video-agent:command";
const IPC_EVENT_CHANNEL = "video-agent:event";
const IPC_PICK_VIDEO_FILE_CHANNEL = "video-agent:pick-video-file";

console.info("[video-preload] preload initialized");

export interface VideoFileSelection {
	projectRoot: string;
	videoPath: string;
}

export interface VideoAgentPreloadApi {
	sendCommand(command: RendererCommand): Promise<CommandResult>;
	pickVideoFile(): Promise<VideoFileSelection | null>;
	onEvent(listener: (event: RendererEvent) => void): () => void;
}

const api: VideoAgentPreloadApi = {
	sendCommand: async (command) => {
		console.info("[video-preload] sendCommand invoke", { type: command.type });
		try {
			const response = await ipcRenderer.invoke(IPC_COMMAND_CHANNEL, command);
			console.info("[video-preload] sendCommand result", { type: command.type });
			return response as CommandResult;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error("[video-preload] sendCommand failed", { type: command.type, message });
			throw error;
		}
	},
	pickVideoFile: async () => {
		console.info("[video-preload] pickVideoFile invoke");
		try {
			const response = await ipcRenderer.invoke(IPC_PICK_VIDEO_FILE_CHANNEL, null);
			console.info("[video-preload] pickVideoFile result", { canceled: response === null });
			return response as VideoFileSelection | null;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error("[video-preload] pickVideoFile failed", { message });
			throw error;
		}
	},
	onEvent: (listener) => {
		console.info("[video-preload] onEvent subscribe");
		const wrapped = (_event: unknown, payload: unknown): void => {
			listener(payload as RendererEvent);
		};
		ipcRenderer.on(IPC_EVENT_CHANNEL, wrapped);
		return () => {
			console.info("[video-preload] onEvent unsubscribe");
			ipcRenderer.removeListener(IPC_EVENT_CHANNEL, wrapped);
		};
	},
};

contextBridge.exposeInMainWorld("videoAgent", api);
console.info("[video-preload] bridge exposed as window.videoAgent");
