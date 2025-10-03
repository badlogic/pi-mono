// Minimal sandbox.js - just listens for sandbox-load and writes the content
window.addEventListener("message", (event) => {
	if (event.data.type === "sandbox-load") {
		// Write the complete HTML (which includes runtime + user code)
		document.open();
		document.write(event.data.code);
		document.close();
	}
});

// Signal ready to parent
window.parent.postMessage({ type: "sandbox-ready" }, "*");
