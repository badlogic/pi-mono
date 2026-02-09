/**
 * LSP server definitions.
 */

import { existsSync } from "node:fs";
import { dirname, extname, join } from "node:path";

// ============================================================================
// LSP Diagnostic Types
// ============================================================================

/** Position in a document (0-based line and character) */
export interface LspPosition {
	line: number;
	character: number;
}

/** Range in a document */
export interface LspRange {
	start: LspPosition;
	end: LspPosition;
}

/** Diagnostic severity (per LSP spec) */
export const DiagnosticSeverity = {
	Error: 1,
	Warning: 2,
	Information: 3,
	Hint: 4,
} as const;

export type DiagnosticSeverityValue = (typeof DiagnosticSeverity)[keyof typeof DiagnosticSeverity];

/** A single diagnostic from an LSP server */
export interface LspDiagnostic {
	range: LspRange;
	severity?: DiagnosticSeverityValue;
	code?: number | string;
	source?: string;
	message: string;
}

// ============================================================================
// Server Definitions
// ============================================================================

export interface LspServerDefinition {
	/** Unique identifier */
	id: string;
	/** LSP language IDs this server handles */
	languageIds: string[];
	/** File extensions this server handles (with dot, e.g., ".ts") */
	extensions: string[];
	/** Command and arguments to spawn the server */
	command: string[];
	/** Root markers to detect project root */
	rootMarkers: string[];
	/** Environment variables to set */
	env?: Record<string, string>;
}

/**
 * Built-in server definitions.
 * Servers are tried in order; the first one whose command exists on PATH wins.
 */
const SERVER_DEFINITIONS: LspServerDefinition[] = [
	// TypeScript / JavaScript
	{
		id: "typescript",
		languageIds: ["typescript", "typescriptreact", "javascript", "javascriptreact"],
		extensions: [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"],
		command: ["typescript-language-server", "--stdio"],
		rootMarkers: ["tsconfig.json", "jsconfig.json", "package.json"],
	},
	// Go
	{
		id: "gopls",
		languageIds: ["go", "gomod"],
		extensions: [".go"],
		command: ["gopls", "serve"],
		rootMarkers: ["go.mod", "go.sum"],
	},
	// Rust
	{
		id: "rust-analyzer",
		languageIds: ["rust"],
		extensions: [".rs"],
		command: ["rust-analyzer"],
		rootMarkers: ["Cargo.toml", "Cargo.lock"],
	},
	// Python
	{
		id: "pyright",
		languageIds: ["python"],
		extensions: [".py", ".pyi"],
		command: ["pyright-langserver", "--stdio"],
		rootMarkers: ["pyproject.toml", "setup.py", "setup.cfg", "requirements.txt", "pyrightconfig.json"],
	},
	// C/C++
	{
		id: "clangd",
		languageIds: ["c", "cpp", "objc", "objcpp"],
		extensions: [".c", ".cpp", ".cc", ".cxx", ".h", ".hpp", ".hxx", ".m", ".mm"],
		command: ["clangd", "--background-index"],
		rootMarkers: ["compile_commands.json", "CMakeLists.txt", ".clangd", "Makefile"],
	},
	// Ruby
	{
		id: "solargraph",
		languageIds: ["ruby"],
		extensions: [".rb", ".rake"],
		command: ["solargraph", "stdio"],
		rootMarkers: ["Gemfile", ".ruby-version"],
	},
	// Elixir
	{
		id: "elixir-ls",
		languageIds: ["elixir"],
		extensions: [".ex", ".exs"],
		command: ["elixir-ls"],
		rootMarkers: ["mix.exs"],
	},
	// Zig
	{
		id: "zls",
		languageIds: ["zig"],
		extensions: [".zig"],
		command: ["zls"],
		rootMarkers: ["build.zig", "build.zig.zon"],
	},
	// Lua
	{
		id: "lua-language-server",
		languageIds: ["lua"],
		extensions: [".lua"],
		command: ["lua-language-server"],
		rootMarkers: [".luarc.json", ".luarc.jsonc"],
	},
	// Java
	{
		id: "jdtls",
		languageIds: ["java"],
		extensions: [".java"],
		command: ["jdtls"],
		rootMarkers: ["pom.xml", "build.gradle", "build.gradle.kts", ".project"],
	},
	// Kotlin
	{
		id: "kotlin-language-server",
		languageIds: ["kotlin"],
		extensions: [".kt", ".kts"],
		command: ["kotlin-language-server"],
		rootMarkers: ["build.gradle", "build.gradle.kts", "pom.xml"],
	},
	// Swift
	{
		id: "sourcekit-lsp",
		languageIds: ["swift"],
		extensions: [".swift"],
		command: ["sourcekit-lsp"],
		rootMarkers: ["Package.swift", ".build"],
	},
	// CSS/SCSS/LESS
	{
		id: "css-languageserver",
		languageIds: ["css", "scss", "less"],
		extensions: [".css", ".scss", ".less"],
		command: ["css-languageserver", "--stdio"],
		rootMarkers: ["package.json"],
	},
	// HTML
	{
		id: "html-languageserver",
		languageIds: ["html"],
		extensions: [".html", ".htm"],
		command: ["html-languageserver", "--stdio"],
		rootMarkers: ["package.json"],
	},
	// JSON
	{
		id: "json-languageserver",
		languageIds: ["json", "jsonc"],
		extensions: [".json", ".jsonc"],
		command: ["json-languageserver", "--stdio"],
		rootMarkers: ["package.json"],
	},
	// YAML
	{
		id: "yaml-language-server",
		languageIds: ["yaml"],
		extensions: [".yaml", ".yml"],
		command: ["yaml-language-server", "--stdio"],
		rootMarkers: ["package.json"],
	},
	// Terraform
	{
		id: "terraform-ls",
		languageIds: ["terraform"],
		extensions: [".tf", ".tfvars"],
		command: ["terraform-ls", "serve"],
		rootMarkers: [".terraform", "main.tf"],
	},
	// Dockerfile
	{
		id: "docker-langserver",
		languageIds: ["dockerfile"],
		extensions: [".dockerfile"],
		command: ["docker-langserver", "--stdio"],
		rootMarkers: ["Dockerfile", "docker-compose.yml"],
	},
];

// ============================================================================
// Lookup Functions
// ============================================================================

/**
 * Find the server definition for a given file extension.
 * Returns undefined if no server is configured for the extension.
 */
export function findServerForExtension(ext: string): LspServerDefinition | undefined {
	const normalizedExt = ext.startsWith(".") ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
	return SERVER_DEFINITIONS.find((def) => def.extensions.includes(normalizedExt));
}

/**
 * Get the LSP language ID for a file extension.
 */
export function getLanguageId(ext: string): string {
	const normalizedExt = ext.startsWith(".") ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
	for (const def of SERVER_DEFINITIONS) {
		const idx = def.extensions.indexOf(normalizedExt);
		if (idx !== -1) {
			return def.languageIds[0];
		}
	}
	return "plaintext";
}

/**
 * Walk up from filePath to find a root directory containing one of the rootMarkers.
 * Returns the directory or undefined if no marker is found.
 */
export function findProjectRoot(filePath: string, rootMarkers: string[]): string | undefined {
	let dir = dirname(filePath);
	const root = dirname(dir) === dir ? dir : undefined;

	while (true) {
		for (const marker of rootMarkers) {
			if (existsSync(join(dir, marker))) {
				return dir;
			}
		}
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}

	return root;
}

/**
 * Convert a file path to an LSP URI.
 */
export function pathToUri(filePath: string): string {
	// Ensure forward slashes on Windows
	const normalized = filePath.replace(/\\/g, "/");
	return `file://${normalized.startsWith("/") ? "" : "/"}${normalized}`;
}

/**
 * Convert an LSP URI back to a file path.
 */
export function uriToPath(uri: string): string {
	if (!uri.startsWith("file://")) return uri;
	const path = uri.slice(7);
	// On Windows, file:///C:/... -> C:/...
	if (path.match(/^\/[A-Z]:/i)) return path.slice(1);
	return path;
}

/**
 * Get the file extension from a path, including the dot.
 */
export function getFileExtension(filePath: string): string {
	return extname(filePath).toLowerCase();
}
