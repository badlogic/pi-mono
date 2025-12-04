/**
 * Wrapper Script Generator
 * Generates CLI wrapper scripts using Pi
 */

import { execSync } from "child_process";
import { unlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { McpTool } from "./discovery.js";
import type { ToolGroup } from "./grouping.js";

/**
 * Generate the wrapper generation prompt for Pi
 * @param group - Group object with filename, description, mcp_tools
 * @param tools - Full tool definitions from MCP
 * @param serverName - MCP server name
 * @param mcpCommand - npx command for MCP server
 * @returns Prompt for Pi
 */
function generateWrapperPrompt(group: ToolGroup, tools: McpTool[], serverName: string, mcpCommand: string): string {
	// Get full tool definitions for tools in this group
	const groupTools = tools.filter((t) => group.mcp_tools.includes(t.name));

	const toolDefs = groupTools
		.map((t) => {
			const propsStr = t.inputSchema?.properties ? JSON.stringify(t.inputSchema.properties, null, 2) : "{}";
			const required = t.inputSchema?.required || [];
			return `Tool: ${t.name}
Description: ${t.description || "No description"}
Required params: ${required.join(", ") || "none"}
Parameters: ${propsStr}`;
		})
		.join("\n\n");

	return `Generate a Node.js CLI wrapper script for these MCP tools.

Filename: ${group.filename}
Purpose: ${group.description}
MCP Server Command: ${mcpCommand}
Server Name: ${serverName}

MCP Tools to wrap:
${toolDefs}

Requirements:
1. MUST start with: #!/usr/bin/env node
2. MUST use ES modules (import, not require)
3. MUST implement --help flag showing usage, options, and examples
4. MUST use manual argument parsing (for loop over process.argv, NO yargs/commander)
5. Call MCP via execSync: npx mcporter call --stdio "${mcpCommand}" "${serverName}.<tool_name>" param:value
6. Errors to stderr with console.error(), then exit(1)
7. Minimal token-efficient output
8. If multiple tools, use flags or positional args to select action

CRITICAL - Complex parameters (array/object types):
- For array/object params, MUST expose via BOTH:
  - --<param> <json> for inline JSON (e.g., --items '[1,2,3]')
  - --<param>-file <path> for reading JSON from file (e.g., --items-file data.json)
- NEVER skip complex parameters - all MCP params must be accessible from CLI
- Use fs.readFileSync for file-based input

Key patterns:
- Parameters are passed as: paramName:JSON.stringify(value)
- Boolean flags like --flag set variables
- Required args should error if missing
- Help text should show correct invocation: ${group.filename} <args>

Example mcporter call helper:
function callMcp(tool, params = {}) {
  const paramStr = Object.entries(params)
    .map(([k, v]) => \`\${k}:\${JSON.stringify(v)}\`)
    .join(" ");
  const cmd = \`npx mcporter call --stdio "${mcpCommand}" "${serverName}.\${tool}" \${paramStr}\`;
  try {
    return execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
  } catch (error) {
    throw new Error(error.stderr || error.message);
  }
}

Output ONLY the complete JavaScript code, no explanations or markdown fences.`;
}

/**
 * Clean the generated code from Pi
 * @param output - Pi output
 * @returns Cleaned JavaScript code
 */
function cleanGeneratedCode(output: string): string {
	let code = output.trim();

	// Remove markdown code fences if present
	code = code.replace(/^```(?:javascript|js)?\n?/i, "");
	code = code.replace(/\n?```$/i, "");

	// Ensure shebang is at the start
	if (!code.startsWith("#!/usr/bin/env node")) {
		if (code.includes("#!/usr/bin/env node")) {
			// Remove misplaced shebang and add at start
			code = code.replace(/^#!\/usr\/bin\/env node\n?/gm, "");
		}
		code = "#!/usr/bin/env node\n\n" + code;
	}

	return code;
}

/**
 * Validate generated code
 * @param code - Generated JavaScript code
 * @param filename - Expected filename
 */
function validateGeneratedCode(code: string, filename: string): void {
	// Check shebang
	if (!code.startsWith("#!/usr/bin/env node")) {
		throw new Error(`${filename}: Missing shebang`);
	}

	// Check for require() (should use import)
	if (/\brequire\s*\(/.test(code)) {
		throw new Error(`${filename}: Uses require() instead of import`);
	}

	// Check for CLI library imports (not allowed)
	if (/import.*from\s+['"](?:yargs|commander|meow|minimist)['"]/.test(code)) {
		throw new Error(`${filename}: Uses forbidden CLI library`);
	}

	// Check for --help implementation
	if (!code.includes("--help")) {
		throw new Error(`${filename}: Missing --help implementation`);
	}

	// Check for execSync or mcporter call
	if (!code.includes("execSync") && !code.includes("mcporter")) {
		throw new Error(`${filename}: Missing mcporter call`);
	}
}

/**
 * Generate a wrapper script using Pi
 * @param group - Group object
 * @param tools - Full tool definitions
 * @param serverName - MCP server name
 * @param mcpCommand - npx command for MCP server
 * @returns Generated JavaScript code
 */
export async function generateWrapper(
	group: ToolGroup,
	tools: McpTool[],
	serverName: string,
	mcpCommand: string,
): Promise<string> {
	const prompt = generateWrapperPrompt(group, tools, serverName, mcpCommand);
	const tempFile = join(tmpdir(), `pi-wrap-mcp-wrapper-${Date.now()}.md`);

	try {
		writeFileSync(tempFile, prompt, "utf-8");

		const output = execSync(`pi -p --no-session --tools "" @"${tempFile}"`, {
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
			timeout: 60000, // 1 minute per wrapper
			maxBuffer: 10 * 1024 * 1024,
		});

		const code = cleanGeneratedCode(output);
		validateGeneratedCode(code, group.filename);

		return code;
	} catch (error: any) {
		if (error.killed) {
			throw new Error(`${group.filename}: Generation timed out`);
		}
		throw new Error(`${group.filename}: ${error.message}`);
	} finally {
		try {
			unlinkSync(tempFile);
		} catch {
			// Ignore cleanup errors
		}
	}
}

/**
 * Escape a string for use in JavaScript double-quoted string
 */
function escapeForJs(str: string): string {
	return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r");
}

/**
 * Check if a schema type represents a complex parameter (array/object)
 */
function isComplexType(schema: any): boolean {
	if (!schema) return false;
	const type = schema.type;
	return (
		type === "array" ||
		type === "object" ||
		(Array.isArray(type) && (type.includes("array") || type.includes("object")))
	);
}

/**
 * Generate a basic wrapper without Pi (fallback)
 * @param group - Group object
 * @param tools - Full tool definitions
 * @param serverName - Server name
 * @param mcpCommand - MCP command
 * @returns Generated code
 */
export function generateFallbackWrapper(
	group: ToolGroup,
	tools: McpTool[],
	serverName: string,
	mcpCommand: string,
): string {
	const tool = tools.find((t) => t.name === group.mcp_tools[0]);
	const params = tool?.inputSchema?.properties || {};
	const required = tool?.inputSchema?.required || [];

	// Escape values for safe JavaScript string interpolation
	const safeFilename = escapeForJs(group.filename);
	const safeDescription = escapeForJs(group.description);
	const safeMcpCommand = escapeForJs(mcpCommand);
	const safeServerName = escapeForJs(serverName);
	const safeToolName = escapeForJs(tool?.name || group.mcp_tools[0]);

	// Build help text for parameters, noting complex types
	const paramLines: string[] = [];

	for (const [name, schema] of Object.entries(params) as [string, any][]) {
		const req = required.includes(name) ? " (required)" : "";
		const desc = escapeForJs(schema.description || schema.type || "value");
		const safeName = escapeForJs(name);

		if (isComplexType(schema)) {
			paramLines.push(`  console.log("  --${safeName}${req}: ${desc} (JSON)");`);
			paramLines.push(`  console.log("  --${safeName}-file: Read ${safeName} from JSON file");`);
		} else {
			paramLines.push(`  console.log("  --${safeName}${req}: ${desc}");`);
		}
	}

	const paramDocsCode = paramLines.length > 0 ? "\n" + paramLines.join("\n") : "";

	// Always import fs for --param-file support (even if no complex params detected,
	// the user might still try to use --param-file syntax)
	return `#!/usr/bin/env node

import { execSync } from "child_process";
import { readFileSync } from "fs";

const args = process.argv.slice(2);

if (args.length === 0 || args[0] === "--help") {
  console.log("Usage: ${safeFilename} [options]");
  console.log("");
  console.log("${safeDescription}");
  console.log("");
  console.log("Options:");
  console.log("  --help: Show this help message");${paramDocsCode}
  process.exit(0);
}

const MCP_CMD = "${safeMcpCommand}";
const SERVER = "${safeServerName}";

function callMcp(tool, params = {}) {
  const paramStr = Object.entries(params)
    .map(([k, v]) => \`\${k}:\${JSON.stringify(v)}\`)
    .join(" ");

  const cmd = \`npx mcporter call --stdio "\${MCP_CMD}" "\${SERVER}.\${tool}" \${paramStr}\`;

  try {
    return execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
  } catch (error) {
    throw new Error(error.stderr || error.message);
  }
}

// Parse arguments
const params = {};
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg.startsWith("--") && i + 1 < args.length) {
    let key = arg.slice(2);
    const value = args[++i];

    // Handle --param-file for complex parameters
    if (key.endsWith("-file")) {
      const actualKey = key.slice(0, -5); // Remove "-file" suffix
      try {
        const fileContent = readFileSync(value, "utf-8");
        params[actualKey] = JSON.parse(fileContent);
      } catch (err) {
        console.error(\`Error reading file for --\${key}: \${err.message}\`);
        process.exit(1);
      }
    } else {
      // Try to parse as JSON, otherwise use as string
      try {
        params[key] = JSON.parse(value);
      } catch {
        params[key] = value;
      }
    }
  }
}

try {
  const result = callMcp("${safeToolName}", params);
  console.log(result);
} catch (error) {
  console.error("Error:", error.message);
  process.exit(1);
}
`;
}

/**
 * Generate package.json content
 * @param name - Package name
 * @param description - Package description
 * @returns JSON string
 */
export function generatePackageJson(name: string, description: string): string {
	return JSON.stringify(
		{
			name,
			version: "1.0.0",
			type: "module",
			description: `Token-efficient ${description} for AI agents via MCP`,
			author: "Generated by pi /wrap-mcp",
			license: "MIT",
			dependencies: {},
		},
		null,
		2,
	);
}

/**
 * Escape a string for safe use in bash single-quoted string
 * Single quotes in bash can't contain single quotes, so we end the string,
 * add an escaped single quote, and restart the string.
 */
function escapeForBash(str: string): string {
	return str.replace(/'/g, "'\\''");
}

/**
 * Generate install.sh content
 * @param name - Package name
 * @returns Shell script
 */
export function generateInstallScript(name: string): string {
	const safeName = escapeForBash(name);
	const prefix = escapeForBash(name.split("-")[0]);

	return `#!/bin/bash

set -e

echo 'Installing ${safeName}...'

INSTALL_DIR="$HOME/.local/bin"
mkdir -p "$INSTALL_DIR"

for script in *.js; do
  if [ -f "$script" ]; then
    chmod +x "$script"
    ln -sf "$(pwd)/$script" "$INSTALL_DIR/$script"
    echo "  Linked $script"
  fi
done

echo ""
echo "Installation complete!"
echo ""
echo "Make sure $INSTALL_DIR is in your PATH."
echo "Add this to your ~/.zshrc or ~/.bashrc if needed:"
echo '  export PATH="$HOME/.local/bin:$PATH"'
echo ""
echo 'Test with:'
echo '  ${prefix}-*.js --help'
`;
}

/**
 * Generate .gitignore content
 * @returns gitignore content
 */
export function generateGitignore(): string {
	return `node_modules/
.DS_Store
*.log
`;
}

/**
 * Generate README.md content (basic version)
 * @param name - Package name
 * @param groups - Tool groups
 * @returns README content
 */
export function generateReadme(name: string, groups: ToolGroup[]): string {
	const toolList = groups.map((g) => `| \`${g.filename}\` | ${g.description} |`).join("\n");

	return `# ${name}

Token-efficient CLI tools for AI agents via MCP.

## Setup

\`\`\`bash
cd ~/agent-tools/${name}
./install.sh
\`\`\`

Ensure \`~/.local/bin\` is in your PATH:

\`\`\`bash
export PATH="$HOME/.local/bin:$PATH"
\`\`\`

## How to Invoke

**CORRECT:**
\`\`\`bash
${groups[0]?.filename || "tool.js"} --help
\`\`\`

**INCORRECT:**
\`\`\`bash
node ${groups[0]?.filename || "tool.js"}  # Don't use 'node' prefix
./${groups[0]?.filename || "tool.js"}     # Don't use './' prefix
\`\`\`

## Available Tools

| Tool | Purpose |
|------|---------|
${toolList}

Run any tool with \`--help\` for usage information.

## Credits

These CLI tools are powered by [mcporter](https://github.com/steipete/mcporter),
which provides the core MCP-to-CLI bridge functionality.

Generated by \`pi /wrap-mcp\` command.
`;
}

/**
 * Generate AGENTS.md entry snippet
 * @param name - Package name
 * @param groups - Tool groups
 * @returns AGENTS entry markdown
 */
export function generateAgentsEntry(name: string, groups: ToolGroup[]): string {
	const toolTable = groups.map((g) => `| \`${g.filename}\` | ${g.description} |`).join("\n");

	const displayName = name
		.split("-")
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(" ");

	return `### ${displayName} Tools
\`~/agent-tools/${name}/README.md\`

${groups.length} executable tools via MCP:

| Tool | Purpose |
|------|---------|
${toolTable}

**Usage:** Direct invocation (scripts are in PATH after install)
\`\`\`bash
${groups[0]?.filename || "tool.js"} --help
\`\`\`
`;
}
