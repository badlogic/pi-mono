// Global storage for attachments and helper functions
window.attachments = [];

window.listFiles = () =>
	(window.attachments || []).map((a) => ({
		id: a.id,
		fileName: a.fileName,
		mimeType: a.mimeType,
		size: a.size,
	}));

window.readTextFile = (attachmentId) => {
	const a = (window.attachments || []).find((x) => x.id === attachmentId);
	if (!a) throw new Error("Attachment not found: " + attachmentId);
	if (a.extractedText) return a.extractedText;
	try {
		return atob(a.content);
	} catch {
		throw new Error("Failed to decode text content for: " + attachmentId);
	}
};

window.readBinaryFile = (attachmentId) => {
	const a = (window.attachments || []).find((x) => x.id === attachmentId);
	if (!a) throw new Error("Attachment not found: " + attachmentId);
	const bin = atob(a.content);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return bytes;
};

// Console capture - forward to parent
window.__artifactLogs = [];
const originalConsole = {
	log: console.log,
	error: console.error,
	warn: console.warn,
	info: console.info,
};

["log", "error", "warn", "info"].forEach((method) => {
	console[method] = (...args) => {
		const text = args
			.map((arg) => {
				try {
					return typeof arg === "object" ? JSON.stringify(arg) : String(arg);
				} catch {
					return String(arg);
				}
			})
			.join(" ");

		window.__artifactLogs.push({ type: method === "error" ? "error" : "log", text });

		window.parent.postMessage(
			{
				type: "console",
				method,
				text,
				artifactId: window.__currentArtifactId,
			},
			"*",
		);

		originalConsole[method].apply(console, args);
	};
});

// Error handlers
window.addEventListener("error", (e) => {
	const text = (e.error?.stack || e.message || String(e)) + " at line " + (e.lineno || "?") + ":" + (e.colno || "?");
	window.__artifactLogs.push({ type: "error", text });
	window.parent.postMessage(
		{
			type: "console",
			method: "error",
			text,
			artifactId: window.__currentArtifactId,
		},
		"*",
	);
	return false;
});

window.addEventListener("unhandledrejection", (e) => {
	const text = "Unhandled promise rejection: " + (e.reason?.message || e.reason || "Unknown error");
	window.__artifactLogs.push({ type: "error", text });
	window.parent.postMessage(
		{
			type: "console",
			method: "error",
			text,
			artifactId: window.__currentArtifactId,
		},
		"*",
	);
});

// Listen for content from parent
window.addEventListener("message", (event) => {
	if (event.data.type === "loadContent") {
		// Store artifact ID and attachments BEFORE wiping the document
		window.__currentArtifactId = event.data.artifactId;
		window.attachments = event.data.attachments || [];

		// Clear logs for new content
		window.__artifactLogs = [];

		// Inject helper functions into the user's HTML
		const helperScript =
			"<" +
			"script>\n" +
			"// Artifact ID\n" +
			"window.__currentArtifactId = " +
			JSON.stringify(event.data.artifactId) +
			";\n\n" +
			"// Attachments\n" +
			"window.attachments = " +
			JSON.stringify(event.data.attachments || []) +
			";\n\n" +
			"// Logs\n" +
			"window.__artifactLogs = [];\n\n" +
			"// Helper functions\n" +
			"window.listFiles = " +
			window.listFiles.toString() +
			";\n" +
			"window.readTextFile = " +
			window.readTextFile.toString() +
			";\n" +
			"window.readBinaryFile = " +
			window.readBinaryFile.toString() +
			";\n\n" +
			"// Console capture\n" +
			"const originalConsole = {\n" +
			"    log: console.log,\n" +
			"    error: console.error,\n" +
			"    warn: console.warn,\n" +
			"    info: console.info\n" +
			"};\n\n" +
			"['log', 'error', 'warn', 'info'].forEach(method => {\n" +
			"    console[method] = function(...args) {\n" +
			"        const text = args.map(arg => {\n" +
			"            try { return typeof arg === 'object' ? JSON.stringify(arg) : String(arg); }\n" +
			"            catch { return String(arg); }\n" +
			"        }).join(' ');\n\n" +
			"        window.__artifactLogs.push({ type: method === 'error' ? 'error' : 'log', text });\n\n" +
			"        window.parent.postMessage({\n" +
			"            type: 'console',\n" +
			"            method,\n" +
			"            text,\n" +
			"            artifactId: window.__currentArtifactId\n" +
			"        }, '*');\n\n" +
			"        originalConsole[method].apply(console, args);\n" +
			"    };\n" +
			"});\n\n" +
			"// Error handlers\n" +
			"window.addEventListener('error', (e) => {\n" +
			"    const text = (e.error?.stack || e.message || String(e)) + ' at line ' + (e.lineno || '?') + ':' + (e.colno || '?');\n" +
			"    window.__artifactLogs.push({ type: 'error', text });\n" +
			"    window.parent.postMessage({\n" +
			"        type: 'console',\n" +
			"        method: 'error',\n" +
			"        text,\n" +
			"        artifactId: window.__currentArtifactId\n" +
			"    }, '*');\n" +
			"    return false;\n" +
			"});\n\n" +
			"window.addEventListener('unhandledrejection', (e) => {\n" +
			"    const text = 'Unhandled promise rejection: ' + (e.reason?.message || e.reason || 'Unknown error');\n" +
			"    window.__artifactLogs.push({ type: 'error', text });\n" +
			"    window.parent.postMessage({\n" +
			"        type: 'console',\n" +
			"        method: 'error',\n" +
			"        text,\n" +
			"        artifactId: window.__currentArtifactId\n" +
			"    }, '*');\n" +
			"});\n\n" +
			"// Send completion after 2 seconds to collect all logs and errors\n" +
			"let completionSent = false;\n" +
			"const sendCompletion = function() {\n" +
			"    if (completionSent) return;\n" +
			"    completionSent = true;\n" +
			"    window.parent.postMessage({\n" +
			"        type: 'execution-complete',\n" +
			"        logs: window.__artifactLogs || [],\n" +
			"        artifactId: window.__currentArtifactId\n" +
			"    }, '*');\n" +
			"};\n\n" +
			"if (document.readyState === 'complete' || document.readyState === 'interactive') {\n" +
			"    setTimeout(sendCompletion, 2000);\n" +
			"} else {\n" +
			"    window.addEventListener('load', function() {\n" +
			"        setTimeout(sendCompletion, 2000);\n" +
			"    });\n" +
			"}\n" +
			"</" +
			"script>";

		// Inject helper script into the HTML content
		let content = event.data.content;

		// Try to inject at the start of <head>, or at the start of document
		const headMatch = content.match(/<head[^>]*>/i);
		if (headMatch) {
			const index = headMatch.index + headMatch[0].length;
			content = content.slice(0, index) + helperScript + content.slice(index);
		} else {
			const htmlMatch = content.match(/<html[^>]*>/i);
			if (htmlMatch) {
				const index = htmlMatch.index + htmlMatch[0].length;
				content = content.slice(0, index) + helperScript + content.slice(index);
			} else {
				content = helperScript + content;
			}
		}

		// Write the HTML content to the document
		document.open();
		document.write(content);
		document.close();
	}
});

// Signal ready to parent
window.parent.postMessage({ type: "sandbox-ready" }, "*");
