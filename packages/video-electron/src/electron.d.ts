declare module "electron" {
	export interface BrowserWindowOptions {
		width?: number;
		height?: number;
		show?: boolean;
		webPreferences?: {
			preload?: string;
			contextIsolation?: boolean;
			sandbox?: boolean;
			nodeIntegration?: boolean;
		};
	}

	export interface IpcMainInvokeEvent {
		readonly processId: number;
	}

	export interface WebContents {
		send(channel: string, payload: unknown): void;
		on(
			event: "console-message",
			handler: (_event: unknown, level: number, message: string, line: number, sourceId: string) => void,
		): void;
		on(event: "did-fail-load", handler: (_event: unknown, errorCode: number, errorDescription: string) => void): void;
		on(event: "did-finish-load", handler: () => void): void;
		on(event: "preload-error", handler: (_event: unknown, preloadPath: string, error: Error) => void): void;
		executeJavaScript(code: string): Promise<unknown>;
	}

	export class BrowserWindow {
		public constructor(options?: BrowserWindowOptions);
		public loadFile(path: string): Promise<void>;
		public loadURL(url: string): Promise<void>;
		public once(event: "ready-to-show", handler: () => void): void;
		public show(): void;
		public readonly webContents: WebContents;
	}

	export const app: {
		whenReady(): Promise<void>;
		on(event: "activate" | "window-all-closed", handler: () => void): void;
		quit(): void;
	};

	export interface OpenDialogReturnValue {
		canceled: boolean;
		filePaths: string[];
	}

	export interface OpenDialogOptions {
		title?: string;
		properties?: ("openFile" | "openDirectory" | "createDirectory")[];
		filters?: Array<{
			name: string;
			extensions: string[];
		}>;
	}

	export const ipcMain: {
		handle(
			channel: string,
			handler: (event: IpcMainInvokeEvent, payload: unknown) => Promise<unknown> | unknown,
		): void;
	};

	export const dialog: {
		showOpenDialog(options: OpenDialogOptions): Promise<OpenDialogReturnValue>;
	};

	export interface IpcRendererEvent {
		readonly senderId: number;
	}

	export const ipcRenderer: {
		invoke(channel: string, payload: unknown): Promise<unknown>;
		on(channel: string, listener: (event: IpcRendererEvent, payload: unknown) => void): void;
		removeListener(channel: string, listener: (event: IpcRendererEvent, payload: unknown) => void): void;
	};

	export const contextBridge: {
		exposeInMainWorld(apiKey: string, api: unknown): void;
	};
}
