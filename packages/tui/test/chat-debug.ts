/**
 * Debug version of chat-simple with logging
 */

import fs from "fs";
import { ProcessTerminal } from "../src/terminal.js";
import { Input, Text, TUI } from "../src/tui-new.js";

// Clear debug log
fs.writeFileSync("debug.log", "");

function log(msg: string) {
	fs.appendFileSync("debug.log", msg + "\n");
}

// Create terminal
const terminal = new ProcessTerminal();

// Wrap terminal methods to log
const originalWrite = terminal.write.bind(terminal);
const originalMoveBy = terminal.moveBy.bind(terminal);

terminal.write = (data: string) => {
	log(`WRITE: ${JSON.stringify(data)}`);
	originalWrite(data);
};

terminal.moveBy = (lines: number) => {
	log(`MOVEBY: ${lines}`);
	originalMoveBy(lines);
};

// Create TUI
const tui = new TUI(terminal);

// Create chat container with some initial messages
tui.addChild(new Text("Welcome to Simple Chat!"));
tui.addChild(new Text("Type your messages below. Press Ctrl+C to exit.\n"));

// Create input field
const input = new Input();
tui.addChild(input);

// Focus the input
tui.setFocus(input);

// Start the TUI
tui.start();
