/**
 * Test for issue #1872: ctrl+enter keybinding not working
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { matchesKey, setKittyProtocolActive } from '../src/keys.js';

describe('Issue #1872: ctrl+enter keybinding', () => {
	it('should match ctrl+enter with modifyOtherKeys sequence', () => {
		setKittyProtocolActive(false);

		// modifyOtherKeys format: ESC [ codepoint ; modifier u
		// enter = 13, ctrl modifier = 5 (4+1)
		const modifyOtherKeysSequence = '\x1b[13;5u';

		const matches = matchesKey(modifyOtherKeysSequence, 'ctrl+enter');

		// After fix, this should match
		assert.strictEqual(matches, true, 'ctrl+enter should match modifyOtherKeys sequence');
	});

	it('should match ctrl+enter with Kitty protocol', () => {
		setKittyProtocolActive(true);

		const kittySequence = '\x1b[13;5u';
		const matches = matchesKey(kittySequence, 'ctrl+enter');

		// This works because of the Kitty protocol fallback
		assert.strictEqual(matches, true, 'ctrl+enter should match with Kitty protocol');

		setKittyProtocolActive(false);
	});

	it('should not confuse plain enter with ctrl+enter', () => {
		setKittyProtocolActive(false);

		const plainEnter = '\r';

		const matchesCtrlEnter = matchesKey(plainEnter, 'ctrl+enter');
		const matchesEnter = matchesKey(plainEnter, 'enter');

		assert.strictEqual(matchesCtrlEnter, false, 'plain enter should not match ctrl+enter');
		assert.strictEqual(matchesEnter, true, 'plain enter should match enter');
	});
});
