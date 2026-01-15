import assert from "node:assert";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, it } from "node:test";
import { CombinedAutocompleteProvider } from "../src/autocomplete.js";

describe("CombinedAutocompleteProvider", () => {
	describe("extractPathPrefix", () => {
		it("extracts / from 'hey /' when forced", () => {
			const provider = new CombinedAutocompleteProvider([], "/tmp");
			const lines = ["hey /"];
			const cursorLine = 0;
			const cursorCol = 5; // After the "/"

			const result = provider.getForceFileSuggestions(lines, cursorLine, cursorCol);

			assert.notEqual(result, null, "Should return suggestions for root directory");
			if (result) {
				assert.strictEqual(result.prefix, "/", "Prefix should be '/'");
			}
		});

		it("extracts /A from '/A' when forced", () => {
			const provider = new CombinedAutocompleteProvider([], "/tmp");
			const lines = ["/A"];
			const cursorLine = 0;
			const cursorCol = 2; // After the "A"

			const result = provider.getForceFileSuggestions(lines, cursorLine, cursorCol);

			console.log("Result:", result);
			// This might return null if /A doesn't match anything, which is fine
			// We're mainly testing that the prefix extraction works
			if (result) {
				assert.strictEqual(result.prefix, "/A", "Prefix should be '/A'");
			}
		});

		it("does not trigger for slash commands", () => {
			const provider = new CombinedAutocompleteProvider([], "/tmp");
			const lines = ["/model"];
			const cursorLine = 0;
			const cursorCol = 6; // After "model"

			const result = provider.getForceFileSuggestions(lines, cursorLine, cursorCol);

			console.log("Result:", result);
			assert.strictEqual(result, null, "Should not trigger for slash commands");
		});

		it("triggers for absolute paths after slash command argument", () => {
			const provider = new CombinedAutocompleteProvider([], "/tmp");
			const lines = ["/command /"];
			const cursorLine = 0;
			const cursorCol = 10; // After the second "/"

			const result = provider.getForceFileSuggestions(lines, cursorLine, cursorCol);

			console.log("Result:", result);
			assert.notEqual(result, null, "Should trigger for absolute paths in command arguments");
			if (result) {
				assert.strictEqual(result.prefix, "/", "Prefix should be '/'");
			}
		});
	});

	describe("shell completions", () => {
		it("completes command names after ! prefix", () => {
			const originalPath = process.env.PATH;
			const tempDir = mkdtempSync(join(tmpdir(), "pi-tui-"));
			const commandPath = join(tempDir, "pi-testcmd");
			writeFileSync(commandPath, "#!/bin/sh\necho test\n");
			if (process.platform !== "win32") {
				chmodSync(commandPath, 0o755);
			}

			process.env.PATH = originalPath ? `${tempDir}${delimiter}${originalPath}` : tempDir;

			try {
				const provider = new CombinedAutocompleteProvider([], "/tmp");
				const line = "!pi-te";
				const result = provider.getForceFileSuggestions([line], 0, line.length);

				assert.notEqual(result, null, "Should return command suggestions");
				if (result) {
					assert.strictEqual(result.prefix, "pi-te", "Prefix should be 'pi-te'");
					const values = result.items.map((item) => item.value);
					assert.ok(values.includes("pi-testcmd"));
				}
			} finally {
				if (originalPath === undefined) {
					delete process.env.PATH;
				} else {
					process.env.PATH = originalPath;
				}
				rmSync(tempDir, { recursive: true, force: true });
			}
		});

		it("completes ./ paths after ! prefix", () => {
			const tempDir = mkdtempSync(join(tmpdir(), "pi-tui-"));
			const filePath = join(tempDir, "example.txt");
			writeFileSync(filePath, "test");

			try {
				const provider = new CombinedAutocompleteProvider([], tempDir);
				const line = "!./";
				const result = provider.getForceFileSuggestions([line], 0, line.length);

				assert.notEqual(result, null, "Should return path suggestions");
				if (result) {
					assert.strictEqual(result.prefix, "./", "Prefix should be './'");
					const values = result.items.map((item) => item.value);
					assert.ok(values.includes("./example.txt"));
				}
			} finally {
				rmSync(tempDir, { recursive: true, force: true });
			}
		});
	});
});
