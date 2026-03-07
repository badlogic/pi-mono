import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.js";

describe("InteractiveMode streaming UI updates", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	test("message updates schedule a buffered flush instead of rendering immediately", async () => {
		const fakeThis: any = {
			isInitialized: true,
			pendingStreamingFooterRefresh: false,
			footer: { invalidate: vi.fn() },
			updateEditorTopBorder: vi.fn(),
			streamingComponent: {},
			streamingMessage: undefined,
			scheduleStreamingUiFlush: vi.fn(),
			ui: { requestRender: vi.fn() },
			pendingTools: new Map(),
		};

		await (InteractiveMode as any).prototype.handleEvent.call(fakeThis, {
			type: "message_update",
			message: {
				role: "assistant",
				content: [],
			},
		});

		expect(fakeThis.scheduleStreamingUiFlush).toHaveBeenCalledWith();
		expect(fakeThis.footer.invalidate).not.toHaveBeenCalled();
		expect(fakeThis.updateEditorTopBorder).not.toHaveBeenCalled();
		expect(fakeThis.ui.requestRender).not.toHaveBeenCalled();
	});

	test("coalesces streaming flushes and applies the latest buffered updates once", () => {
		vi.setSystemTime(1000);

		const updateContent = vi.fn();
		const updateResult = vi.fn();
		const fakeThis: any = {
			streamingComponent: { updateContent },
			streamingMessage: {
				role: "assistant",
				content: [{ type: "text", text: "latest" }],
			},
			pendingStreamingUiTimer: undefined,
			pendingStreamingFooterRefresh: false,
			pendingToolExecutionUpdates: new Map([
				[
					"tool-1",
					{
						content: [{ type: "text", text: "partial" }],
					},
				],
			]),
			pendingTools: new Map([
				[
					"tool-1",
					{
						updateResult,
					},
				],
			]),
			lastStreamingUiFlushAt: 1000,
			footer: { invalidate: vi.fn() },
			updateEditorTopBorder: vi.fn(),
			ui: { requestRender: vi.fn() },
			syncStreamingToolComponents: vi.fn(),
			flushStreamingUiUpdates(forceFooterRefresh = false) {
				return (InteractiveMode as any).prototype.flushStreamingUiUpdates.call(this, forceFooterRefresh);
			},
		};

		(InteractiveMode as any).prototype.scheduleStreamingUiFlush.call(fakeThis);
		(InteractiveMode as any).prototype.scheduleStreamingUiFlush.call(fakeThis);

		expect(updateContent).not.toHaveBeenCalled();
		expect(fakeThis.ui.requestRender).not.toHaveBeenCalled();

		vi.advanceTimersByTime(32);
		expect(updateContent).not.toHaveBeenCalled();

		vi.advanceTimersByTime(1);
		expect(updateContent).toHaveBeenCalledTimes(1);
		expect(fakeThis.syncStreamingToolComponents).toHaveBeenCalledTimes(1);
		expect(updateResult).toHaveBeenCalledWith(
			{
				content: [{ type: "text", text: "partial" }],
				isError: false,
			},
			true,
		);
		expect(fakeThis.footer.invalidate).not.toHaveBeenCalled();
		expect(fakeThis.updateEditorTopBorder).not.toHaveBeenCalled();
		expect(fakeThis.ui.requestRender).toHaveBeenCalledTimes(1);
		expect(fakeThis.ui.requestRender).toHaveBeenCalledWith(false, "low");
		expect(fakeThis.pendingToolExecutionUpdates.size).toBe(0);
	});
});
