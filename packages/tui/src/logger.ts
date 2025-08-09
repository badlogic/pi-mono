import { appendFileSync, writeFileSync } from "fs";
import { join } from "path";

export interface LoggerConfig {
	enabled: boolean;
	logFile: string;
	logLevel: "debug" | "info" | "warn" | "error";
}

class Logger {
	private config: LoggerConfig = {
		enabled: false,
		logFile: "tui-debug.log", // Will be resolved when needed
		logLevel: "debug",
	};

	configure(config: Partial<LoggerConfig>): void {
		this.config = { ...this.config, ...config };

		if (this.config.enabled) {
			// Clear log file on startup
			try {
				// Resolve log file path when needed
				const logFile = this.config.logFile.startsWith("/") 
					? this.config.logFile 
					: join(process.cwd(), this.config.logFile);
				
				writeFileSync(logFile, `=== TUI Debug Log Started ${new Date().toISOString()} ===\n`);
			} catch (error) {
				// Silently fail if we can't write to log file
			}
		}
	}

	private shouldLog(level: string): boolean {
		if (!this.config.enabled) return false;

		const levels = ["debug", "info", "warn", "error"];
		const currentLevel = levels.indexOf(this.config.logLevel);
		const messageLevel = levels.indexOf(level);

		return messageLevel >= currentLevel;
	}

	private log(level: string, component: string, message: string, data?: any): void {
		if (!this.shouldLog(level)) return;

		try {
			const timestamp = new Date().toISOString();
			const dataStr = data ? ` | Data: ${JSON.stringify(data)}` : "";
			const logLine = `[${timestamp}] ${level.toUpperCase()} [${component}] ${message}${dataStr}\n`;

			// Resolve log file path when needed
			const logFile = this.config.logFile.startsWith("/") 
				? this.config.logFile 
				: join(process.cwd(), this.config.logFile);
			
			appendFileSync(logFile, logLine);
		} catch (error) {
			// Silently fail if we can't write to log file
		}
	}

	debug(component: string, message: string, data?: any): void {
		this.log("debug", component, message, data);
	}

	info(component: string, message: string, data?: any): void {
		this.log("info", component, message, data);
	}

	warn(component: string, message: string, data?: any): void {
		this.log("warn", component, message, data);
	}

	error(component: string, message: string, data?: any): void {
		this.log("error", component, message, data);
	}

	// Specific TUI logging methods
	keyInput(component: string, keyData: string): void {
		this.debug(component, "Key input received", {
			keyData,
			charCodes: Array.from(keyData).map((c) => c.charCodeAt(0)),
		});
	}

	render(component: string, renderResult: any): void {
		this.debug(component, "Render result", renderResult);
	}

	focus(component: string, focused: boolean): void {
		this.info(component, `Focus ${focused ? "gained" : "lost"}`);
	}

	componentLifecycle(component: string, action: string, details?: any): void {
		this.info(component, `Component ${action}`, details);
	}

	stateChange(component: string, property: string, oldValue: any, newValue: any): void {
		this.debug(component, `State change: ${property}`, { oldValue, newValue });
	}
}

export const logger = new Logger();
