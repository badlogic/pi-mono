import type { AgentState } from "@mariozechner/pi-agent";
import type { Message } from "@mariozechner/pi-ai";
import { readFileSync, writeFileSync } from "fs";
import type { SessionManager } from "./session-manager.js";

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
}

/**
 * Convert ANSI color codes to HTML spans
 */
function ansiToHtml(text: string): string {
	// Simple ANSI color code to HTML conversion
	// This is a basic implementation - could be enhanced with a library
	const ansiColors: Record<string, string> = {
		"30": "#000000", // black
		"31": "#cd3131", // red
		"32": "#0dbc79", // green
		"33": "#e5e510", // yellow
		"34": "#2472c8", // blue
		"35": "#bc3fbc", // magenta
		"36": "#11a8cd", // cyan
		"37": "#e5e5e5", // white
		"90": "#666666", // bright black (gray)
		"91": "#f14c4c", // bright red
		"92": "#23d18b", // bright green
		"93": "#f5f543", // bright yellow
		"94": "#3b8eea", // bright blue
		"95": "#d670d6", // bright magenta
		"96": "#29b8db", // bright cyan
		"97": "#ffffff", // bright white
	};

	let html = escapeHtml(text);

	// Replace ANSI codes with HTML spans
	html = html.replace(/\x1b\[([0-9;]+)m/g, (_match, codes) => {
		const codeList = codes.split(";");
		if (codeList.includes("0")) {
			return "</span>"; // Reset
		}
		for (const code of codeList) {
			if (ansiColors[code]) {
				return `<span style="color: ${ansiColors[code]}">`;
			}
			if (code === "1") {
				return '<span style="font-weight: bold">';
			}
			if (code === "2") {
				return '<span style="opacity: 0.6">';
			}
		}
		return "";
	});

	return html;
}

/**
 * Format a message as HTML
 */
function formatMessage(message: Message): string {
	const role = message.role;
	const roleClass =
		role === "user" ? "user-message" : role === "toolResult" ? "tool-result-message" : "assistant-message";
	const roleLabel = role === "user" ? "User" : role === "assistant" ? "Assistant" : "Tool Result";

	let html = `<div class="message ${roleClass}">`;
	html += `<div class="message-role">${roleLabel}</div>`;
	html += `<div class="message-content">`;

	// Handle ToolResultMessage separately
	if (role === "toolResult") {
		const isError = message.isError;
		html += `<div class="tool-result ${isError ? "error" : "success"}">`;
		html += `<div class="tool-result-header">${isError ? "❌" : "✅"} ${escapeHtml(message.toolName)}</div>`;

		for (const content of message.content) {
			if (content.type === "text") {
				html += `<pre class="tool-result-output">${ansiToHtml(content.text)}</pre>`;
			} else if (content.type === "image") {
				const imageData = content.data;
				const mimeType = content.mimeType || "image/png";
				html += `<img src="data:${mimeType};base64,${imageData}" alt="Tool result image" class="tool-result-image">`;
			}
		}
		html += `</div>`;
	}
	// Handle string content (for user messages)
	else if (typeof message.content === "string") {
		const text = escapeHtml(message.content);
		html += `<div class="text-content">${text.replace(/\n/g, "<br>")}</div>`;
	} else {
		// Handle array content
		for (const content of message.content) {
			if (typeof content === "string") {
				// Handle legacy string content
				const text = escapeHtml(content);
				html += `<div class="text-content">${text.replace(/\n/g, "<br>")}</div>`;
			} else if (content.type === "text") {
				// Format text with markdown-like rendering
				const text = escapeHtml(content.text);
				html += `<div class="text-content">${text.replace(/\n/g, "<br>")}</div>`;
			} else if (content.type === "thinking") {
				html += `<details class="thinking-block">`;
				html += `<summary>Thinking...</summary>`;
				html += `<div class="thinking-content">${escapeHtml(content.thinking).replace(/\n/g, "<br>")}</div>`;
				html += `</details>`;
			} else if (content.type === "toolCall") {
				html += `<div class="tool-call">`;
				html += `<div class="tool-call-header">🔧 ${escapeHtml(content.name)}</div>`;
				html += `<pre class="tool-call-args">${escapeHtml(JSON.stringify(content.arguments, null, 2))}</pre>`;
				html += `</div>`;
			} else if (content.type === "image") {
				const imageData = content.data;
				const mimeType = content.mimeType || "image/png";
				html += `<img src="data:${mimeType};base64,${imageData}" alt="User image" class="user-image">`;
			}
		}
	}

	html += `</div></div>`;
	return html;
}

/**
 * Export session to a self-contained HTML file
 */
export function exportSessionToHtml(sessionManager: SessionManager, state: AgentState, outputPath?: string): string {
	const sessionFile = sessionManager.getSessionFile();
	const timestamp = new Date().toISOString();

	// Generate output filename if not provided
	if (!outputPath) {
		const dateStr = new Date().toISOString().replace(/[:.]/g, "-").split("T")[0];
		outputPath = `coding-session-${dateStr}.html`;
	}

	// Read session data
	const sessionContent = readFileSync(sessionFile, "utf8");
	const lines = sessionContent.trim().split("\n");

	// Parse session metadata
	let sessionHeader: any = null;
	const messages: Message[] = [];

	for (const line of lines) {
		try {
			const entry = JSON.parse(line);
			if (entry.type === "session") {
				sessionHeader = entry;
			} else if (entry.type === "message") {
				messages.push(entry.message);
			}
		} catch {
			// Skip malformed lines
		}
	}

	// Generate HTML
	const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Coding Session Export - ${timestamp}</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #e4e4e7;
            background: #09090b;
            padding: 2rem;
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
        }

        .header {
            margin-bottom: 3rem;
            padding: 2rem;
            background: #18181b;
            border-radius: 0.5rem;
            border: 1px solid #27272a;
        }

        .header h1 {
            font-size: 2rem;
            margin-bottom: 1rem;
            color: #fafafa;
        }

        .header-info {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 1rem;
            margin-top: 1.5rem;
        }

        .info-item {
            padding: 0.75rem;
            background: #09090b;
            border-radius: 0.375rem;
            border: 1px solid #27272a;
        }

        .info-label {
            font-size: 0.875rem;
            color: #a1a1aa;
            margin-bottom: 0.25rem;
        }

        .info-value {
            font-size: 1rem;
            color: #fafafa;
            font-weight: 500;
        }

        .messages {
            display: flex;
            flex-direction: column;
            gap: 1.5rem;
        }

        .message {
            background: #18181b;
            border-radius: 0.5rem;
            padding: 1.5rem;
            border: 1px solid #27272a;
        }

        .message-role {
            font-weight: 600;
            margin-bottom: 1rem;
            font-size: 0.875rem;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }

        .user-message .message-role {
            color: #60a5fa;
        }

        .assistant-message .message-role {
            color: #34d399;
        }

        .message-content {
            display: flex;
            flex-direction: column;
            gap: 1rem;
        }

        .text-content {
            color: #e4e4e7;
            white-space: pre-wrap;
            word-wrap: break-word;
        }

        .thinking-block {
            background: #27272a;
            border-radius: 0.375rem;
            padding: 1rem;
            border-left: 3px solid #a855f7;
        }

        .thinking-block summary {
            cursor: pointer;
            font-weight: 500;
            color: #a855f7;
            margin-bottom: 0.5rem;
        }

        .thinking-content {
            margin-top: 0.75rem;
            color: #d4d4d8;
            font-size: 0.875rem;
            line-height: 1.6;
        }

        .tool-call {
            background: #27272a;
            border-radius: 0.375rem;
            padding: 1rem;
            border-left: 3px solid #3b82f6;
        }

        .tool-call-header {
            font-weight: 600;
            color: #3b82f6;
            margin-bottom: 0.5rem;
        }

        .tool-call-args {
            background: #18181b;
            padding: 0.75rem;
            border-radius: 0.25rem;
            overflow-x: auto;
            font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
            font-size: 0.875rem;
            color: #d4d4d8;
        }

        .tool-result {
            background: #27272a;
            border-radius: 0.375rem;
            padding: 1rem;
        }

        .tool-result.success {
            border-left: 3px solid #10b981;
        }

        .tool-result.error {
            border-left: 3px solid #ef4444;
        }

        .tool-result-header {
            font-weight: 600;
            margin-bottom: 0.5rem;
        }

        .tool-result.success .tool-result-header {
            color: #10b981;
        }

        .tool-result.error .tool-result-header {
            color: #ef4444;
        }

        .tool-result-output {
            background: #18181b;
            padding: 0.75rem;
            border-radius: 0.25rem;
            overflow-x: auto;
            font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
            font-size: 0.875rem;
            color: #d4d4d8;
            white-space: pre-wrap;
            word-wrap: break-word;
        }

        .tool-result-image,
        .user-image {
            max-width: 100%;
            height: auto;
            border-radius: 0.375rem;
            margin-top: 0.5rem;
        }

        .footer {
            margin-top: 3rem;
            padding: 2rem;
            text-align: center;
            color: #71717a;
            font-size: 0.875rem;
        }

        @media (max-width: 768px) {
            body {
                padding: 1rem;
            }

            .header {
                padding: 1rem;
            }

            .header h1 {
                font-size: 1.5rem;
            }

            .header-info {
                grid-template-columns: 1fr;
            }

            .message {
                padding: 1rem;
            }
        }

        @media print {
            body {
                background: white;
                color: black;
            }

            .message {
                page-break-inside: avoid;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Coding Session Export</h1>
            <div class="header-info">
                <div class="info-item">
                    <div class="info-label">Session ID</div>
                    <div class="info-value">${sessionHeader?.id || "unknown"}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Date</div>
                    <div class="info-value">${sessionHeader?.timestamp ? new Date(sessionHeader.timestamp).toLocaleString() : timestamp}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Model</div>
                    <div class="info-value">${escapeHtml(sessionHeader?.model || state.model.id)}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Messages</div>
                    <div class="info-value">${messages.length}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Working Directory</div>
                    <div class="info-value">${escapeHtml(sessionHeader?.cwd || process.cwd())}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Thinking Level</div>
                    <div class="info-value">${escapeHtml(sessionHeader?.thinkingLevel || state.thinkingLevel)}</div>
                </div>
            </div>
        </div>

        <div class="messages">
            ${messages.map((msg) => formatMessage(msg)).join("\n")}
        </div>

        <div class="footer">
            Generated by pi coding-agent v${sessionHeader?.version || "unknown"} on ${new Date().toLocaleString()}
        </div>
    </div>
</body>
</html>`;

	// Write HTML file
	writeFileSync(outputPath, html, "utf8");

	return outputPath;
}
