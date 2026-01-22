/**
 * uv Python Interceptor
 *
 * Demonstrates before_bash_exec by redirecting python invocations through uv.
 * This is a simple example that assumes basic whitespace-separated arguments.
 *
 * Usage:
 *   pi -e examples/extensions/uv.ts
 */

import { type ExtensionAPI, isBashToolResult } from "@mariozechner/pi-coding-agent";

const PYTHON_PREFIX = /^python3?(\s+|$)/;
const UV_RUN_PYTHON_PREFIX = /^uv\s+run\s+python3?(\s+|$)/;
const PIP_PREFIX = /^pip3?(\s+|$)/;
const PIP_MODULE_PATTERN = /\s-m\s+pip3?(\s|$)/;
const TRACEBACK_PATTERN = /Traceback \(most recent call last\):/;
const IMPORT_ERROR_PATTERN = /\b(ModuleNotFoundError|ImportError):/;
const MODULE_NOT_FOUND_PATTERN = /No module named ['"]([^'"]+)['"]/;

const PIP_BLOCK_REASON =
	"pip is disabled. Use uv run instead, particularly --with and --script for throwaway work. Do not use uv pip!";

export default function (pi: ExtensionAPI) {
	pi.on("before_bash_exec", (event) => {
		const trimmed = event.originalCommand.trim();
		const isPythonCommand = PYTHON_PREFIX.test(trimmed);
		const isUvRunPythonCommand = UV_RUN_PYTHON_PREFIX.test(trimmed);
		const isPipModule = PIP_MODULE_PATTERN.test(trimmed);

		if (PIP_PREFIX.test(trimmed) || (isPipModule && (isPythonCommand || isUvRunPythonCommand))) {
			return {
				block: true,
				reason: PIP_BLOCK_REASON,
			};
		}

		if (!isPythonCommand) {
			return;
		}

		const normalizedCommand = trimmed.replace(PYTHON_PREFIX, "python ").trimEnd();
		const uvCommand = `uv run ${normalizedCommand}`;

		return {
			command: uvCommand,
		};
	});

	pi.on("tool_result", (event) => {
		if (!isBashToolResult(event)) return;

		const text = event.content
			.filter((item) => item.type === "text")
			.map((item) => item.text)
			.join("");

		if (!TRACEBACK_PATTERN.test(text) || !IMPORT_ERROR_PATTERN.test(text)) {
			return;
		}

		const moduleMatch = text.match(MODULE_NOT_FOUND_PATTERN);
		const moduleName = moduleMatch?.[1];
		const hintTarget = moduleName ? ` --with ${moduleName}` : "";
		const hint =
			"\n\nHint: Python import failed. Use uv to fetch dependencies automatically without changing the system, " +
			`e.g. \`uv run${hintTarget} python -c '...'\` or \`uv run --script\` for throwaway scripts.`;

		return {
			content: [...event.content, { type: "text", text: hint }],
			isError: true,
		};
	});
}
