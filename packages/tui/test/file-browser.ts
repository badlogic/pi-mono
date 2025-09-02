import { readdirSync, statSync } from "fs";
import { join } from "path";
import { SelectList, TUI } from "../src/index.js";

const ui = new TUI();
ui.start();
let currentPath = process.cwd();

function createFileList(path: string) {
	const entries = readdirSync(path).map((entry) => {
		const fullPath = join(path, entry);
		const isDir = statSync(fullPath).isDirectory();
		return {
			value: entry,
			label: entry,
			description: isDir ? "directory" : "file",
		};
	});

	// Add parent directory option
	if (path !== "/") {
		entries.unshift({
			value: "..",
			label: "..",
			description: "parent directory",
		});
	}

	return entries;
}

function showDirectory(path: string) {
	ui.clear();

	const entries = createFileList(path);
	const fileList = new SelectList(entries, 10);

	fileList.onSelect = (item) => {
		if (item.value === "..") {
			currentPath = join(currentPath, "..");
			showDirectory(currentPath);
		} else if (item.description === "directory") {
			currentPath = join(currentPath, item.value);
			showDirectory(currentPath);
		} else {
			console.log(`Selected file: ${join(currentPath, item.value)}`);
			ui.stop();
		}
	};

	ui.addChild(fileList);
	ui.setFocus(fileList);
}

showDirectory(currentPath);
