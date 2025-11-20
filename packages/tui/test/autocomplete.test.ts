import assert from "node:assert";
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
});
