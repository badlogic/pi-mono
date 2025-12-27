/**
 * Snake game hook - play snake with /snake command
 */

import { isArrowDown, isArrowLeft, isArrowRight, isArrowUp, isEscape } from "@mariozechner/pi-tui";
import type { HookAPI } from "../../src/core/hooks/types.js";

const GAME_WIDTH = 40;
const GAME_HEIGHT = 15;
const TICK_MS = 100;

type Direction = "up" | "down" | "left" | "right";
type Point = { x: number; y: number };

interface GameState {
	snake: Point[];
	food: Point;
	direction: Direction;
	nextDirection: Direction;
	score: number;
	gameOver: boolean;
	highScore: number;
}

function createInitialState(): GameState {
	const startX = Math.floor(GAME_WIDTH / 2);
	const startY = Math.floor(GAME_HEIGHT / 2);
	return {
		snake: [
			{ x: startX, y: startY },
			{ x: startX - 1, y: startY },
			{ x: startX - 2, y: startY },
		],
		food: spawnFood([{ x: startX, y: startY }]),
		direction: "right",
		nextDirection: "right",
		score: 0,
		gameOver: false,
		highScore: 0,
	};
}

function spawnFood(snake: Point[]): Point {
	let food: Point;
	do {
		food = {
			x: Math.floor(Math.random() * GAME_WIDTH),
			y: Math.floor(Math.random() * GAME_HEIGHT),
		};
	} while (snake.some((s) => s.x === food.x && s.y === food.y));
	return food;
}

class SnakeComponent {
	private state: GameState;
	private interval: ReturnType<typeof setInterval> | null = null;
	private onClose: () => void;
	private onSave: (state: GameState | null) => void;
	private requestRender: () => void;
	private cachedLines: string[] = [];
	private cachedWidth = 0;
	private version = 0;
	private cachedVersion = -1;
	private paused: boolean;

	constructor(
		onClose: () => void,
		onSave: (state: GameState | null) => void,
		requestRender: () => void,
		savedState?: GameState,
	) {
		if (savedState && !savedState.gameOver) {
			// Resume from saved state, start paused
			this.state = savedState;
			this.paused = true;
		} else {
			// New game or saved game was over
			this.state = createInitialState();
			if (savedState) {
				this.state.highScore = savedState.highScore;
			}
			this.paused = false;
			this.startGame();
		}
		this.onClose = onClose;
		this.onSave = onSave;
		this.requestRender = requestRender;
	}

	private startGame(): void {
		this.interval = setInterval(() => {
			if (!this.state.gameOver) {
				this.tick();
				this.version++;
				this.requestRender();
			}
		}, TICK_MS);
	}

	private tick(): void {
		// Apply queued direction change
		this.state.direction = this.state.nextDirection;

		// Calculate new head position
		const head = this.state.snake[0];
		let newHead: Point;

		switch (this.state.direction) {
			case "up":
				newHead = { x: head.x, y: head.y - 1 };
				break;
			case "down":
				newHead = { x: head.x, y: head.y + 1 };
				break;
			case "left":
				newHead = { x: head.x - 1, y: head.y };
				break;
			case "right":
				newHead = { x: head.x + 1, y: head.y };
				break;
		}

		// Check wall collision
		if (newHead.x < 0 || newHead.x >= GAME_WIDTH || newHead.y < 0 || newHead.y >= GAME_HEIGHT) {
			this.state.gameOver = true;
			return;
		}

		// Check self collision
		if (this.state.snake.some((s) => s.x === newHead.x && s.y === newHead.y)) {
			this.state.gameOver = true;
			return;
		}

		// Move snake
		this.state.snake.unshift(newHead);

		// Check food collision
		if (newHead.x === this.state.food.x && newHead.y === this.state.food.y) {
			this.state.score += 10;
			if (this.state.score > this.state.highScore) {
				this.state.highScore = this.state.score;
			}
			this.state.food = spawnFood(this.state.snake);
		} else {
			this.state.snake.pop();
		}
	}

	handleInput(data: string): void {
		// If paused (resuming), wait for any key
		if (this.paused) {
			if (isEscape(data) || data === "q" || data === "Q") {
				// Quit without clearing save
				this.dispose();
				this.onClose();
				return;
			}
			// Any other key resumes
			this.paused = false;
			this.startGame();
			return;
		}

		// ESC to pause and save
		if (isEscape(data)) {
			this.dispose();
			this.onSave(this.state);
			this.onClose();
			return;
		}

		// Q to quit without saving (clears saved state)
		if (data === "q" || data === "Q") {
			this.dispose();
			this.onSave(null); // Clear saved state
			this.onClose();
			return;
		}

		// Arrow keys or WASD
		if (isArrowUp(data) || data === "w" || data === "W") {
			if (this.state.direction !== "down") this.state.nextDirection = "up";
		} else if (isArrowDown(data) || data === "s" || data === "S") {
			if (this.state.direction !== "up") this.state.nextDirection = "down";
		} else if (isArrowRight(data) || data === "d" || data === "D") {
			if (this.state.direction !== "left") this.state.nextDirection = "right";
		} else if (isArrowLeft(data) || data === "a" || data === "A") {
			if (this.state.direction !== "right") this.state.nextDirection = "left";
		}

		// Restart on game over
		if (this.state.gameOver && (data === "r" || data === "R" || data === " ")) {
			const highScore = this.state.highScore;
			this.state = createInitialState();
			this.state.highScore = highScore;
			this.onSave(null); // Clear saved state on restart
			this.version++;
			this.requestRender();
		}
	}

	invalidate(): void {
		this.cachedWidth = 0;
	}

	render(width: number): string[] {
		if (width === this.cachedWidth && this.cachedVersion === this.version) {
			return this.cachedLines;
		}

		const lines: string[] = [];

		// Each game cell is 2 chars wide to appear square (terminal cells are ~2:1 aspect)
		const cellWidth = 2;
		const effectiveWidth = Math.min(GAME_WIDTH, Math.floor((width - 4) / cellWidth));
		const effectiveHeight = GAME_HEIGHT;

		// Colors
		const dim = (s: string) => `\x1b[2m${s}\x1b[22m`;
		const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
		const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
		const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
		const bold = (s: string) => `\x1b[1m${s}\x1b[22m`;

		const boxWidth = effectiveWidth * cellWidth;

		// Helper to pad content inside box
		const boxLine = (content: string, contentLen: number) => {
			const padding = Math.max(0, boxWidth - contentLen);
			return dim(" │") + content + " ".repeat(padding) + dim("│");
		};

		// Top border
		lines.push(this.padLine(dim(` ╭${"─".repeat(boxWidth)}╮`), width));

		// Header with score
		const scoreText = `Score: ${bold(yellow(String(this.state.score)))}`;
		const highText = `High: ${bold(yellow(String(this.state.highScore)))}`;
		const title = `${bold(green("🐍 SNAKE"))} │ ${scoreText} │ ${highText}`;
		// Approximate visible length (emojis and formatting make this tricky)
		const titleLen = 8 + 3 + 7 + String(this.state.score).length + 3 + 6 + String(this.state.highScore).length;
		lines.push(this.padLine(boxLine(title, titleLen), width));

		// Separator
		lines.push(this.padLine(dim(` ├${"─".repeat(boxWidth)}┤`), width));

		// Game grid
		for (let y = 0; y < effectiveHeight; y++) {
			let row = "";
			for (let x = 0; x < effectiveWidth; x++) {
				const isHead = this.state.snake[0].x === x && this.state.snake[0].y === y;
				const isBody = this.state.snake.slice(1).some((s) => s.x === x && s.y === y);
				const isFood = this.state.food.x === x && this.state.food.y === y;

				if (isHead) {
					row += green("██"); // Snake head (2 chars)
				} else if (isBody) {
					row += green("▓▓"); // Snake body (2 chars)
				} else if (isFood) {
					row += red("◆ "); // Food (2 chars)
				} else {
					row += "  "; // Empty cell (2 spaces)
				}
			}
			lines.push(this.padLine(dim(" │") + row + dim("│"), width));
		}

		// Separator
		lines.push(this.padLine(dim(` ├${"─".repeat(boxWidth)}┤`), width));

		// Footer
		let footer: string;
		let footerLen: number;
		if (this.paused) {
			footer = `${yellow(bold("PAUSED"))} Press any key to continue, ${bold("Q")} to quit`;
			footerLen = 42;
		} else if (this.state.gameOver) {
			footer = `${red(bold("GAME OVER!"))} Press ${bold("R")} to restart, ${bold("Q")} to quit`;
			footerLen = 40;
		} else {
			footer = dim(`↑↓←→ or WASD to move, ${bold("ESC")} pause, ${bold("Q")} quit`);
			footerLen = 38;
		}
		lines.push(this.padLine(boxLine(footer, footerLen), width));

		// Bottom border
		lines.push(this.padLine(dim(` ╰${"─".repeat(boxWidth)}╯`), width));

		this.cachedLines = lines;
		this.cachedWidth = width;
		this.cachedVersion = this.version;

		return lines;
	}

	private padLine(line: string, width: number): string {
		// Calculate visible length (strip ANSI codes)
		const visibleLen = line.replace(/\x1b\[[0-9;]*m/g, "").length;
		const padding = Math.max(0, width - visibleLen);
		return line + " ".repeat(padding);
	}

	dispose(): void {
		if (this.interval) {
			clearInterval(this.interval);
			this.interval = null;
		}
	}
}

const SNAKE_SAVE_TYPE = "snake-save";

export default function (pi: HookAPI) {
	pi.registerCommand("snake", {
		description: "Play Snake!",
		immediate: true, // Run immediately, even during streaming
		handler: async (ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("Snake requires interactive mode", "error");
				return;
			}

			// Load saved state from session
			const entries = ctx.sessionManager.getEntries();
			let savedState: GameState | undefined;
			for (let i = entries.length - 1; i >= 0; i--) {
				const entry = entries[i];
				if (entry.type === "custom" && entry.customType === SNAKE_SAVE_TYPE) {
					savedState = entry.data as GameState;
					break;
				}
			}

			let ui: { close: () => void; requestRender: () => void } | null = null;

			const component = new SnakeComponent(
				() => ui?.close(),
				(state) => {
					// Save or clear state
					pi.appendEntry(SNAKE_SAVE_TYPE, state);
				},
				() => ui?.requestRender(),
				savedState,
			);

			ui = ctx.ui.custom(component);
		},
	});
}
