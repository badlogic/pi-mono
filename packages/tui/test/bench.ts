#!/usr/bin/env npx tsx
import chalk from "chalk";
import { Container, LoadingAnimation, TextComponent, TextEditor, TUI, WhitespaceComponent } from "../src/index.js";

/**
 * Test the new smart double-buffered TUI implementation
 */
async function main() {
	const ui = new TUI();

	// Track render timings
	let renderCount = 0;
	let totalRenderTime = 0n;
	const renderTimings: bigint[] = [];

	// Monkey-patch requestRender to measure performance
	const originalRequestRender = ui.requestRender.bind(ui);
	ui.requestRender = () => {
		const startTime = process.hrtime.bigint();
		originalRequestRender();
		process.nextTick(() => {
			const endTime = process.hrtime.bigint();
			const duration = endTime - startTime;
			renderTimings.push(duration);
			totalRenderTime += duration;
			renderCount++;
		});
	};

	// Add header
	const header = new TextComponent(
		chalk.bold.green("Smart Double Buffer TUI Test") +
			"\n" +
			chalk.dim("Testing new implementation with component-level caching and smart diffing") +
			"\n" +
			chalk.dim("Press CTRL+C to exit"),
		{ bottom: 1 },
	);
	ui.addChild(header);

	// Add container for animation and editor
	const container = new Container();

	// Add loading animation (should NOT cause flicker with smart diffing)
	const animation = new LoadingAnimation(ui);
	container.addChild(animation);

	// Add some spacing
	container.addChild(new WhitespaceComponent(1));

	// Add text editor
	const editor = new TextEditor();
	editor.setText(
		"Type here to test the text editor.\n\nWith smart diffing, only changed lines are redrawn!\n\nThe animation above updates every 80ms but the editor stays perfectly still.",
	);
	container.addChild(editor);

	// Add the container to UI
	ui.addChild(container);

	// Add performance stats display
	const statsComponent = new TextComponent("", { top: 1 });
	ui.addChild(statsComponent);

	// Update stats every second
	const statsInterval = setInterval(() => {
		if (renderCount > 0) {
			const avgRenderTime = Number(totalRenderTime / BigInt(renderCount)) / 1_000_000; // Convert to ms
			const lastRenderTime =
				renderTimings.length > 0 ? Number(renderTimings[renderTimings.length - 1]) / 1_000_000 : 0;
			const avgLinesRedrawn = ui.getAverageLinesRedrawn();

			statsComponent.setText(
				chalk.yellow(`Performance Stats:`) +
					"\n" +
					chalk.dim(
						`Renders: ${renderCount} | Avg Time: ${avgRenderTime.toFixed(2)}ms | Last: ${lastRenderTime.toFixed(2)}ms`,
					) +
					"\n" +
					chalk.dim(
						`Lines Redrawn: ${ui.getLinesRedrawn()} total | Avg per render: ${avgLinesRedrawn.toFixed(1)}`,
					),
			);
		}
	}, 1000);

	// Set focus to the editor
	ui.setFocus(editor);

	// Handle global keypresses
	ui.onGlobalKeyPress = (data: string) => {
		// CTRL+C to exit
		if (data === "\x03") {
			animation.stop();
			clearInterval(statsInterval);
			ui.stop();
			console.log("\n" + chalk.green("Exited double-buffer test"));
			console.log(chalk.dim(`Total renders: ${renderCount}`));
			console.log(
				chalk.dim(
					`Average render time: ${renderCount > 0 ? (Number(totalRenderTime / BigInt(renderCount)) / 1_000_000).toFixed(2) : 0}ms`,
				),
			);
			console.log(chalk.dim(`Total lines redrawn: ${ui.getLinesRedrawn()}`));
			console.log(chalk.dim(`Average lines redrawn per render: ${ui.getAverageLinesRedrawn().toFixed(1)}`));
			process.exit(0);
		}
		return true; // Forward other keys to focused component
	};

	// Start the UI
	ui.start();
}

// Run the test
main().catch((error) => {
	console.error("Error:", error);
	process.exit(1);
});
