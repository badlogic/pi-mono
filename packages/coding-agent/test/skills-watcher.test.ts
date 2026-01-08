import { afterEach, describe, expect, it, vi } from "vitest";

type MockWatcher = {
	path: string;
	handler: () => void;
	closed: boolean;
};

const watchers: MockWatcher[] = [];

vi.mock("fs", () => {
	const existsSync = (path: string): boolean => path === "/root" || path === "/root/alpha";

	const readdirSync = (path: string): Array<{ name: string; isDirectory: () => boolean }> => {
		if (path === "/root") {
			return [{ name: "alpha", isDirectory: () => true }];
		}
		return [];
	};

	const watch = (path: string, optionsOrListener: unknown, maybeListener?: unknown): { close: () => void } => {
		const hasOptions = typeof optionsOrListener === "object" && optionsOrListener !== null;
		const options = hasOptions ? (optionsOrListener as { recursive?: boolean }) : undefined;
		const handler = (
			typeof (hasOptions ? maybeListener : optionsOrListener) === "function"
				? hasOptions
					? maybeListener
					: optionsOrListener
				: undefined
		) as (() => void) | undefined;

		if (options?.recursive) {
			throw new Error("ERR_FEATURE_UNAVAILABLE_ON_PLATFORM");
		}
		if (!handler) {
			throw new Error("Missing handler");
		}

		const w: MockWatcher = { path, handler, closed: false };
		watchers.push(w);
		return {
			close: () => {
				w.closed = true;
			},
		};
	};

	return { existsSync, readdirSync, watch };
});

import { SkillsWatcher } from "../src/core/skills-watcher.js";

describe("SkillsWatcher", () => {
	afterEach(() => {
		watchers.length = 0;
		vi.useRealTimers();
	});

	it("falls back to watching subdirectories when recursive watch is unavailable", () => {
		vi.useFakeTimers();
		let changes = 0;
		const watcher = new SkillsWatcher({
			roots: ["/root"],
			debounceMs: 10,
			onChange: () => {
				changes++;
			},
		});

		const watchedPaths = watchers.map((w) => w.path).sort();
		expect(watchedPaths).toEqual(["/root", "/root/alpha"]);

		// Trigger a change in a nested directory watcher.
		const alphaWatcher = watchers.find((w) => w.path === "/root/alpha");
		expect(alphaWatcher).toBeDefined();
		alphaWatcher!.handler();

		vi.advanceTimersByTime(9);
		expect(changes).toBe(0);
		vi.advanceTimersByTime(1);
		expect(changes).toBe(1);

		watcher.close();
	});
});
