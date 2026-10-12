import { afterEach, describe, expect, it, vi } from "vitest";

const workerSpecifiers = vi.hoisted((): Array<string | URL> => []);

vi.mock("node:worker_threads", () => ({
	Worker: class {
		constructor(specifier: string | URL) {
			workerSpecifiers.push(specifier);
		}

		on(event: string, listener: (value: unknown) => void): void {
			if (event !== "message") return;
			const specifier = workerSpecifiers.at(-1);
			queueMicrotask(() =>
				listener({
					type: "pi:image-resize-response",
					result:
						typeof specifier === "string"
							? null
							: {
									data: "resized",
									mimeType: "image/png",
									originalWidth: 1,
									originalHeight: 1,
									width: 1,
									height: 1,
									wasResized: false,
								},
				}),
			);
		}

		once(): void {}
		postMessage(): void {}
		terminate(): Promise<number> {
			return Promise.resolve(0);
		}
	},
}));

import { resizeImage } from "../src/utils/image-resize.ts";

describe("resizeImage", () => {
	afterEach(() => {
		workerSpecifiers.length = 0;
		delete (process.versions as Record<string, string | undefined>).bun;
	});

	it("falls through when the Bun worker returns null", async () => {
		Object.defineProperty(process.versions, "bun", {
			configurable: true,
			value: "1.0.0",
		});

		const result = await resizeImage(new Uint8Array([1]), "image/png");

		expect(result?.data).toBe("resized");
		expect(workerSpecifiers).toHaveLength(2);
		expect(workerSpecifiers[0]).toBe("./src/utils/image-resize-worker.ts");
		expect(workerSpecifiers[1]).toBeInstanceOf(URL);
	});
});
