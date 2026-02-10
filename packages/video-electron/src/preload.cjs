const { contextBridge, ipcRenderer, webUtils } = require("electron");

const IPC_COMMAND_CHANNEL = "video-agent:command";
const IPC_EVENT_CHANNEL = "video-agent:event";
const IPC_PICK_VIDEO_FILE_CHANNEL = "video-agent:pick-video-file";

console.info("[video-preload-cjs] preload initialized");

const api = {
	sendCommand: async (command) => {
		const type = command && typeof command === "object" ? command.type : "unknown";
		console.info("[video-preload-cjs] sendCommand invoke", { type });
		try {
			const response = await ipcRenderer.invoke(IPC_COMMAND_CHANNEL, command);
			console.info("[video-preload-cjs] sendCommand result", { type });
			return response;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error("[video-preload-cjs] sendCommand failed", { type, message });
			throw error;
		}
	},
	pickVideoFile: async () => {
		console.info("[video-preload-cjs] pickVideoFile invoke");
		try {
			const response = await ipcRenderer.invoke(IPC_PICK_VIDEO_FILE_CHANNEL, null);
			console.info("[video-preload-cjs] pickVideoFile result", { canceled: response === null });
			return response;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error("[video-preload-cjs] pickVideoFile failed", { message });
			throw error;
		}
	},
	getPathForFile: (file) => {
		try {
			return webUtils.getPathForFile(file);
		} catch {
			return null;
		}
	},
	onEvent: (listener) => {
		console.info("[video-preload-cjs] onEvent subscribe");
		const wrapped = (_event, payload) => {
			listener(payload);
		};
		ipcRenderer.on(IPC_EVENT_CHANNEL, wrapped);
		return () => {
			console.info("[video-preload-cjs] onEvent unsubscribe");
			ipcRenderer.removeListener(IPC_EVENT_CHANNEL, wrapped);
		};
	},
};

contextBridge.exposeInMainWorld("videoAgent", api);
console.info("[video-preload-cjs] bridge exposed as window.videoAgent");
