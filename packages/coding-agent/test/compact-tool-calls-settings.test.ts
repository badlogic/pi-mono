import { Compile } from "typebox/compile";
import { describe, expect, it } from "vitest";
import { InMemorySettingsStorage, SettingsManager } from "../src/core/settings-manager.ts";
import { SettingsSchema } from "../src/core/settings-schema.ts";

// Grouping is opt-in; its preference follows normal settings precedence and persistence.
describe("compact tool-call settings", () => {
	it("keeps the standard tool display by default", () => {
		expect(SettingsManager.inMemory().getCompactToolCalls()).toBe(false);
	});

	it("persists the preference through reload", async () => {
		const settings = SettingsManager.inMemory();
		settings.setCompactToolCalls(true);
		expect(settings.getCompactToolCalls()).toBe(true);
		await settings.reload();
		expect(settings.getCompactToolCalls()).toBe(true);
		expect(settings.getGlobalSettings().compactToolCalls).toBe(true);
		settings.setCompactToolCalls(false);
		await settings.reload();
		expect(settings.getCompactToolCalls()).toBe(false);
	});

	it("lets a trusted project override the user preference", () => {
		const storage = new InMemorySettingsStorage();
		storage.withLock("global", () => JSON.stringify({ compactToolCalls: true }));
		storage.withLock("project", () => JSON.stringify({ compactToolCalls: false }));
		expect(SettingsManager.fromStorage(storage).getCompactToolCalls()).toBe(false);
		expect(SettingsManager.fromStorage(storage, { projectTrusted: false }).getCompactToolCalls()).toBe(true);
	});

	it("publishes a boolean setting with the same default", () => {
		const schema = SettingsSchema.properties.compactToolCalls;
		expect(schema).toMatchObject({ default: false });
		const validate = Compile(SettingsSchema);
		expect(validate.Check({ compactToolCalls: true })).toBe(true);
		expect(validate.Check({ compactToolCalls: false })).toBe(true);
		expect(validate.Check({ compactToolCalls: "true" })).toBe(false);
	});
});
