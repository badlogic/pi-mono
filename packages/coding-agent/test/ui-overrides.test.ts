import { describe, expect, test } from "vitest";
import { OwnerOverrideSlot } from "../src/modes/interactive/ui-overrides.ts";

describe("OwnerOverrideSlot", () => {
	test("restores the preceding owner and ignores stale releases", () => {
		const slot = new OwnerOverrideSlot<string>();
		const ownerA = {};
		const ownerB = {};

		expect(slot.set(ownerA, "A")).toEqual({
			effectiveOwner: ownerA,
			previousOwner: undefined,
			conflictedOwner: undefined,
		});
		expect(slot.set(ownerB, "B")).toEqual({ effectiveOwner: ownerB, previousOwner: ownerA, conflictedOwner: ownerA });
		expect(slot.release(ownerA)).toEqual({
			effectiveOwner: ownerB,
			previousOwner: ownerB,
			conflictedOwner: undefined,
		});
		expect(slot.current).toEqual({ owner: ownerB, value: "B" });
		expect(slot.release(ownerB)).toEqual({
			effectiveOwner: undefined,
			previousOwner: ownerB,
			conflictedOwner: undefined,
		});
		expect(slot.current).toBeUndefined();
	});

	test("keeps independent slots independent", () => {
		const theme = new OwnerOverrideSlot<string>();
		const footer = new OwnerOverrideSlot<string>();
		const editor = new OwnerOverrideSlot<string>();
		const themeOwner = {};
		const footerOwner = {};
		const editorOwner = {};

		theme.set(themeOwner, "dark");
		footer.set(footerOwner, "footer");
		editor.set(editorOwner, "editor");
		footer.release(footerOwner);

		expect(theme.current?.value).toBe("dark");
		expect(footer.current).toBeUndefined();
		expect(editor.current?.value).toBe("editor");
	});
});
