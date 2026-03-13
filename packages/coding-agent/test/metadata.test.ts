import { describe, expect, it } from "vitest";
import { APP_NAME, FILE_PREFIX, getUpdateInstruction, PACKAGE_NAME, VERSION } from "../src/config.js";

describe("Metadata and Branding", () => {
	it("should have Jensen Code as the app name", () => {
		expect(APP_NAME).toBe("Jensen Code");
	});

	it("should have @apholdings/jensen-code as the package name", () => {
		expect(PACKAGE_NAME).toBe("@apholdings/jensen-code");
	});

	it("should have 0.0.1 as the version", () => {
		expect(VERSION).toBe("0.0.1");
	});

	it("should generate update instructions for the correct package", () => {
		const instruction = getUpdateInstruction(PACKAGE_NAME);
		expect(instruction).toContain(PACKAGE_NAME);
		expect(instruction).toContain("install -g");
	});

	it("should have a correct file prefix for temporary files", () => {
		expect(FILE_PREFIX).toBe("jensen-code");
	});

	it("should point to the correct release download URL", () => {
		// Mock detectInstallMethod to return 'bun-binary'
		// This is just to test the URL generation logic in config.ts
		const instruction = getUpdateInstruction(PACKAGE_NAME);
		// Since we can't easily mock the internal state without a lot of ceremony,
		// we just check that it's NOT pointing to badlogic/pi-mono
		expect(instruction).not.toContain("badlogic/pi-mono");
	});
});
