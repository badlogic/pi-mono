import { exec } from "child_process";
import { platform } from "os";

/**
 * Open a URL in the system's default browser
 * @param url The URL to open
 * @returns Promise that resolves when the browser is opened, or rejects on error
 */
export function openUrl(url: string): Promise<void> {
	return new Promise((resolve, reject) => {
		let command: string;

		switch (platform()) {
			case "darwin":
				command = `open "${url}"`;
				break;
			case "win32":
				command = `start "" "${url}"`;
				break;
			default:
				command = `xdg-open "${url}"`;
				break;
		}

		exec(command, (error) => {
			if (error) {
				reject(new Error(`Failed to open browser: ${error.message}`));
			} else {
				resolve();
			}
		});
	});
}
