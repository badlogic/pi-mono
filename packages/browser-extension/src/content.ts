// Content script - runs in isolated world with JailJS interpreter for CSP-restricted pages
import { Interpreter } from "@mariozechner/jailjs";
import { transformToES5 } from "@mariozechner/jailjs/transform";

console.log("[pi-ai] Content script loaded - JailJS interpreter available");

// Listen for code execution requests
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	if (message.type === "EXECUTE_CODE") {
		const mode = message.mode || "jailjs";
		console.log(`[pi-ai:${mode}] Executing code`);

		// Execute in async context to support returnFile
		(async () => {
			try {
				// Capture console output
				const consoleOutput: Array<{ type: string; args: unknown[] }> = [];
				const files: Array<{ fileName: string; content: string | Uint8Array; mimeType: string }> = [];

				// Create interpreter with console capture and returnFile support
				const interpreter = new Interpreter({
					// Expose controlled DOM access
					document: document,
					window: window,

					// Console that captures output
					console: {
						log: (...args: unknown[]) => {
							consoleOutput.push({ type: "log", args });
							console.log("[Sandbox]", ...args);
						},
						error: (...args: unknown[]) => {
							consoleOutput.push({ type: "error", args });
							console.error("[Sandbox]", ...args);
						},
						warn: (...args: unknown[]) => {
							consoleOutput.push({ type: "warn", args });
							console.warn("[Sandbox]", ...args);
						},
					},

					// returnFile function
					returnFile: async (
						fileName: string,
						content: string | Uint8Array | Blob | Record<string, unknown>,
						mimeType?: string,
					) => {
						let finalContent: string | Uint8Array;
						let finalMimeType: string;

						if (content instanceof Blob) {
							// Convert Blob to Uint8Array
							const arrayBuffer = await content.arrayBuffer();
							finalContent = new Uint8Array(arrayBuffer);
							finalMimeType = mimeType || content.type || "application/octet-stream";

							// Enforce MIME type requirement for binary data
							if (!mimeType && !content.type) {
								throw new Error(
									`returnFile: MIME type is required for Blob content. Please provide a mimeType parameter (e.g., "image/png").`,
								);
							}
						} else if (content instanceof Uint8Array) {
							finalContent = content;
							if (!mimeType) {
								throw new Error(
									`returnFile: MIME type is required for Uint8Array content. Please provide a mimeType parameter (e.g., "image/png").`,
								);
							}
							finalMimeType = mimeType;
						} else if (typeof content === "string") {
							finalContent = content;
							finalMimeType = mimeType || "text/plain";
						} else {
							// Assume it's an object to be JSON stringified
							finalContent = JSON.stringify(content, null, 2);
							finalMimeType = mimeType || "application/json";
						}

						files.push({
							fileName,
							content: finalContent,
							mimeType: finalMimeType,
						});
					},

					// Timers
					setTimeout: setTimeout.bind(window),
					setInterval: setInterval.bind(window),
					clearTimeout: clearTimeout.bind(window),
					clearInterval: clearInterval.bind(window),

					// DOM Event Constructors
					Event: Event,
					CustomEvent: CustomEvent,
					MouseEvent: MouseEvent,
					KeyboardEvent: KeyboardEvent,
					InputEvent: InputEvent,
					FocusEvent: FocusEvent,
					UIEvent: UIEvent,
					WheelEvent: WheelEvent,
					TouchEvent: typeof TouchEvent !== "undefined" ? TouchEvent : undefined,
					PointerEvent: typeof PointerEvent !== "undefined" ? PointerEvent : undefined,
					DragEvent: DragEvent,
					ClipboardEvent: ClipboardEvent,
					MessageEvent: MessageEvent,
					StorageEvent: StorageEvent,
					PopStateEvent: PopStateEvent,
					HashChangeEvent: HashChangeEvent,
					ProgressEvent: ProgressEvent,
					AnimationEvent: AnimationEvent,
					TransitionEvent: TransitionEvent,

					// DOM Element Constructors
					HTMLElement: HTMLElement,
					HTMLDivElement: HTMLDivElement,
					HTMLSpanElement: HTMLSpanElement,
					HTMLInputElement: HTMLInputElement,
					HTMLButtonElement: HTMLButtonElement,
					HTMLFormElement: HTMLFormElement,
					HTMLAnchorElement: HTMLAnchorElement,
					HTMLImageElement: HTMLImageElement,
					HTMLCanvasElement: HTMLCanvasElement,
					HTMLVideoElement: HTMLVideoElement,
					HTMLAudioElement: HTMLAudioElement,
					HTMLTextAreaElement: HTMLTextAreaElement,
					HTMLSelectElement: HTMLSelectElement,
					HTMLOptionElement: HTMLOptionElement,
					HTMLIFrameElement: HTMLIFrameElement,
					HTMLTableElement: HTMLTableElement,
					HTMLTableRowElement: HTMLTableRowElement,
					HTMLTableCellElement: HTMLTableCellElement,

					// Other DOM types
					Node: Node,
					Element: Element,
					DocumentFragment: DocumentFragment,
					Text: Text,
					Comment: Comment,
					NodeList: NodeList,
					HTMLCollection: HTMLCollection,
					DOMTokenList: DOMTokenList,
					CSSStyleDeclaration: CSSStyleDeclaration,
					XMLHttpRequest: XMLHttpRequest,
					FormData: FormData,
					Blob: Blob,
					File: File,
					FileReader: FileReader,
					URL: URL,
					URLSearchParams: URLSearchParams,
					Headers: Headers,
					Request: Request,
					Response: Response,
					AbortController: AbortController,
					AbortSignal: AbortSignal,

					// Utilities
					Math: Math,
					JSON: JSON,
					Date: Date,
					Set: Set,
					Map: Map,
					WeakSet: WeakSet,
					WeakMap: WeakMap,
					ArrayBuffer: ArrayBuffer,
					DataView: DataView,
					Int8Array: Int8Array,
					Uint8Array: Uint8Array,
					Uint8ClampedArray: Uint8ClampedArray,
					Int16Array: Int16Array,
					Uint16Array: Uint16Array,
					Int32Array: Int32Array,
					Uint32Array: Uint32Array,
					Float32Array: Float32Array,
					Float64Array: Float64Array,
				});

				// Wrap code in async IIFE to support top-level await
				// JailJS supports await inside async functions but not at top level
				const wrappedCode = `(async function() {\n${message.code}\n})();`;

				// Transform ES6+ to ES5 AST and execute
				const ast = transformToES5(wrappedCode);
				const result = interpreter.evaluate(ast);

				// Wait for async operations to complete
				if (result instanceof Promise) {
					await result;
				}

				console.log(`[pi-ai:${mode}] Execution success`);
				sendResponse({
					success: true,
					result: result,
					console: consoleOutput,
					files: files,
				});
			} catch (error: unknown) {
				const err = error as Error;
				console.error(`[pi-ai:${mode}] Execution error:`, err);
				sendResponse({
					success: false,
					error: err.message,
					stack: err.stack,
				});
			}
		})();

		return true; // Keep channel open for async response
	}

	return false;
});
