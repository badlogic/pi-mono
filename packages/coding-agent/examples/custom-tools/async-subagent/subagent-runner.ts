import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

interface SubagentStep {
	agent: string;
	task: string;
	cwd?: string;
	model?: string;
	tools?: string[];
	systemPrompt?: string | null;
}

interface SubagentRunConfig {
	id: string;
	steps: SubagentStep[];
	resultPath: string;
	cwd: string;
	placeholder: string;
	taskIndex?: number;
	totalTasks?: number;
}

interface StepResult {
	agent: string;
	output: string;
	success: boolean;
}

function runSubagent(config: SubagentRunConfig): void {
	const { id, steps, resultPath, cwd, placeholder, taskIndex, totalTasks } = config;
	let previousOutput = "";
	const results: StepResult[] = [];

	for (const step of steps) {
		const args = ["-p", "--no-session"];
		if (step.model) args.push("--model", step.model);
		if (step.tools?.length) args.push("--tools", step.tools.join(","));

		let tmpDir: string | null = null;
		if (step.systemPrompt) {
			tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-"));
			const promptPath = path.join(tmpDir, "prompt.md");
			fs.writeFileSync(promptPath, step.systemPrompt);
			args.push("--append-system-prompt", promptPath);
		}

		const placeholderRegex = new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
		const task = step.task.replace(placeholderRegex, () => previousOutput);
		args.push(`Task: ${task}`);

		const result = spawnSync("pi", args, {
			cwd: step.cwd ?? cwd,
			encoding: "utf-8",
			maxBuffer: 10 * 1024 * 1024,
		});

		if (tmpDir) {
			try {
				fs.rmSync(tmpDir, { recursive: true });
			} catch {}
		}

		const output = (result.stdout || "").trim();
		previousOutput = output;
		results.push({ agent: step.agent, output, success: result.status === 0 });

		if (result.status !== 0) break;
	}

	const summary = results.map((r) => `${r.agent}:\n${r.output}`).join("\n\n");
	const agentName = steps.length === 1 ? steps[0].agent : `chain:${steps.map((s) => s.agent).join("->")}`;
	fs.mkdirSync(path.dirname(resultPath), { recursive: true });
	fs.writeFileSync(
		resultPath,
		JSON.stringify({
			id,
			agent: agentName,
			success: results.every((r) => r.success),
			summary,
			results,
			exitCode: results.every((r) => r.success) ? 0 : 1,
			timestamp: Date.now(),
			...(taskIndex !== undefined && { taskIndex }),
			...(totalTasks !== undefined && { totalTasks }),
		}),
	);
}

const configArg = process.argv[2];
if (configArg) {
	try {
		const configJson = fs.readFileSync(configArg, "utf-8");
		const config = JSON.parse(configJson) as SubagentRunConfig;
		try {
			fs.unlinkSync(configArg);
		} catch {}
		runSubagent(config);
	} catch (err) {
		console.error("Subagent runner error:", err);
		process.exit(1);
	}
} else {
	let input = "";
	process.stdin.setEncoding("utf-8");
	process.stdin.on("data", (chunk) => {
		input += chunk;
	});
	process.stdin.on("end", () => {
		try {
			const config = JSON.parse(input) as SubagentRunConfig;
			runSubagent(config);
		} catch (err) {
			console.error("Subagent runner error:", err);
			process.exit(1);
		}
	});
}
