// ---- DOM refs ----
const videoPreview = document.getElementById("videoPreview");
const videoContainer = document.getElementById("videoContainer");
const videoEmpty = document.getElementById("videoEmpty");
const videoSourceLabel = document.getElementById("videoSourceLabel");
const currentTimeOut = document.getElementById("currentTimeOut");
const durationOut = document.getElementById("durationOut");
const openProjectButton = document.getElementById("openProject");
const videoPickerInput = document.getElementById("videoPicker");
const transcriptBody = document.getElementById("transcriptBody");
const transcriptEmpty = document.getElementById("transcriptEmpty");
const transcribeBtn = document.getElementById("transcribeBtn");
const applyEditsBtn = document.getElementById("applyEditsBtn");
const clearDeletesBtn = document.getElementById("clearDeletesBtn");
const wordCountEl = document.getElementById("wordCount");
const deletedCountEl = document.getElementById("deletedCount");
const videoInputsList = document.getElementById("videoInputsList");
const audioInputsList = document.getElementById("audioInputsList");
const videoOutputsList = document.getElementById("videoOutputsList");
const audioOutputsList = document.getElementById("audioOutputsList");
const processingOverlay = document.getElementById("processingOverlay");
const processingStatus = document.getElementById("processingStatus");
const processingPhase = document.getElementById("processingPhase");
const processingElapsed = document.getElementById("processingElapsed");
const processingTasks = document.getElementById("processingTasks");
const videoTimelineDeletes = document.getElementById("videoTimelineDeletes");
const audioTimelineDeletes = document.getElementById("audioTimelineDeletes");
const videoTimelinePlayhead = document.getElementById("videoTimelinePlayhead");
const audioTimelinePlayhead = document.getElementById("audioTimelinePlayhead");
const bubble = document.getElementById("bubble");
const bubbleTrigger = document.getElementById("bubbleTrigger");
const bubbleDrag = document.getElementById("bubbleDrag");
const bubbleMessages = document.getElementById("bubbleMessages");
const promptInput = document.getElementById("promptInput");
const sendPromptBtn = document.getElementById("sendPrompt");

// ---- State ----
let activeVideoPath = null;
let activeProjectRoot = null;
let transcriptWords = [];
let deletedIndices = new Set();
let isAgentProcessing = false;
let pendingEditOutputPath = null;
let pendingProcessingOutputPath = null;
let processingStartedAt = 0;
let processingTimerId = null;
let processingTaskLog = [];
const mediaRegistry = {
	video: {
		input: new Set(),
		output: new Set(),
	},
	audio: {
		input: new Set(),
		output: new Set(),
	},
};

// ---- Init ----
if (window.videoAgent) {
	window.videoAgent.onEvent((event) => {
		if (event?.type === "agent_event") {
			handleAgentEvent(event.event);
		}
	});
}

// ---- Set model to GLM-4.7 on startup ----
async function initModel() {
	if (!window.videoAgent?.sendCommand) return;
	const response = await window.videoAgent.sendCommand({
		type: "agent/set_model",
		provider: "zai",
		modelId: "glm-4.7",
	});
	if (response.ok) {
		addBubbleMessage("agent", "Model: Z.AI GLM-4.7");
	} else {
		addBubbleMessage("agent", `Model fallback: ${response.error}`);
	}
}

// ---- Video selection ----
openProjectButton?.addEventListener("click", openVideo);

async function openVideo() {
	const bridgeSelection = await pickVideoSelectionFromBridge();
	const selection = bridgeSelection ?? (await pickVideoSelectionFromInput());
	if (!selection) return;

	activeVideoPath = selection.videoPath;
	activeProjectRoot = selection.projectRoot;
	addMediaPath("video", "input", selection.videoPath);
	showVideoPreview(selection.videoPath);

	if (window.videoAgent?.sendCommand) {
		const response = await window.videoAgent.sendCommand({
			type: "project/open",
			projectRoot: selection.projectRoot,
		});
		if (response.ok && response.data.type === "project/open") {
			addBubbleMessage("agent", `Project opened: ${response.data.manifest.clips.length} clip(s)`);
			await initModel();
		}
	}
}

function showVideoPreview(videoPath) {
        videoEmpty.style.display = "none";
        videoPreview.style.display = "block";
        videoPreview.src = toFileUrl(videoPath);
        videoPreview.load();
        videoSourceLabel.textContent = videoPath.split("/").pop() || videoPath;
        transcriptWords = [];
        deletedIndices = new Set();
        pendingProcessingOutputPath = null;
        renderTranscript();
	updateTimelinePlayheads();
}

// ---- Video metrics ----
if (videoPreview instanceof HTMLVideoElement) {
	videoPreview.addEventListener("loadedmetadata", updateMetrics);
	videoPreview.addEventListener("timeupdate", updateMetrics);
}

function updateMetrics() {
	if (!(videoPreview instanceof HTMLVideoElement)) return;
	currentTimeOut.textContent = formatTime(videoPreview.currentTime);
	durationOut.textContent = formatTime(videoPreview.duration);
	updateTimelinePlayheads();
}

function formatTime(sec) {
	if (!Number.isFinite(sec)) return "0:00";
	const m = Math.floor(sec / 60);
	const s = Math.floor(sec % 60);
	return `${m}:${s.toString().padStart(2, "0")}`;
}

// ---- Transcript ----
transcribeBtn?.addEventListener("click", async () => {
	if (!activeVideoPath) return;
	if (!window.videoAgent?.sendCommand) return;

	addBubbleMessage("agent", "Transcribing video...");
	setProcessing(true);
	setProcessingPhaseLabel("Calling VotGO transcribe...");
	pushProcessingTask("run_votgo", { invocation: { command: "transcribe" } });

	const response = await window.videoAgent.sendCommand({
		type: "tools/votgo/run",
		invocation: {
			command: "transcribe",
			input: activeVideoPath,
			global: { yes: true },
		},
	});

	        if (!response.ok || response.data.type !== "tools/votgo/run") {
	                finishProcessingTask("run_votgo", "failed");
	                setProcessing(false);
	                const errorMessage = response.ok ? "Transcription failed." : response.error;
	                addBubbleMessage("agent", `Transcription failed: ${errorMessage}`);
	                return;
	        }

	if (response.data.result.exitCode !== 0) {
		finishProcessingTask("run_votgo", "failed");
		setProcessing(false);
		addBubbleMessage("agent", `Transcription error: ${response.data.result.stderr.slice(0, 200)}`);
		return;
	}

	const stdout = response.data.result.stdout;
	const savedMatch = stdout.match(/Transcript saved:\s*(.+)/);
	const transcriptPath = savedMatch ? savedMatch[1].trim() : deriveTranscriptPath(activeVideoPath);

	await loadTranscriptFile(transcriptPath);
	finishProcessingTask("run_votgo", "done");
	setProcessing(false);
});

async function loadTranscriptFile(path) {
	if (!window.videoAgent?.sendCommand) return;

	const response = await window.videoAgent.sendCommand({
		type: "fs/read_text",
		path,
	});

	if (!response.ok || response.data.type !== "fs/read_text") {
		addBubbleMessage("agent", `Could not read transcript file: ${path}`);
		return;
	}

	try {
		const data = JSON.parse(response.data.content);
		setTranscriptData(data);
	} catch {
		addBubbleMessage("agent", "Failed to parse transcript JSON.");
	}
}

function setTranscriptData(data) {
	transcriptWords = (data.words || []).filter(
		(w) => (w.type === "word" || w.type === "punctuation") && Number.isFinite(w.start) && Number.isFinite(w.end),
	);
	deletedIndices = new Set();
	renderTranscript();
	addBubbleMessage("agent", `Transcript loaded: ${transcriptWords.length} words`);
}

function renderTranscript() {
	const totalWords = transcriptWords.length;
	const deletedNum = deletedIndices.size;
	wordCountEl.textContent = String(totalWords);
	deletedCountEl.textContent = String(deletedNum);

	if (totalWords === 0) {
		transcriptEmpty.style.display = "flex";
		const existingWords = transcriptBody.querySelectorAll(".word, .word-space");
		existingWords.forEach((el) => el.remove());
		renderTimelineDeletedSegments();
		return;
	}

	transcriptEmpty.style.display = "none";

	const existingWords = transcriptBody.querySelectorAll(".word, .word-space");
	existingWords.forEach((el) => el.remove());

	const frag = document.createDocumentFragment();
	for (let i = 0; i < transcriptWords.length; i++) {
		const w = transcriptWords[i];
		const span = document.createElement("span");
		span.className = "word" + (deletedIndices.has(i) ? " selected" : "");
		span.textContent = w.text;
		span.dataset.index = String(i);
		span.addEventListener("click", () => toggleWord(i));
		span.title = `${w.start.toFixed(2)}s - ${w.end.toFixed(2)}s`;

		frag.appendChild(span);

		if (w.type === "word" && i < transcriptWords.length - 1) {
			frag.appendChild(document.createTextNode(" "));
		}
	}
	transcriptBody.appendChild(frag);
	renderTimelineDeletedSegments();
}

function toggleWord(index) {
	if (deletedIndices.has(index)) {
		deletedIndices.delete(index);
	} else {
		deletedIndices.add(index);
	}
	const wordEl = transcriptBody.querySelector(`[data-index="${index}"]`);
	if (wordEl) {
		wordEl.classList.toggle("selected", deletedIndices.has(index));
	}
	deletedCountEl.textContent = String(deletedIndices.size);
	renderTimelineDeletedSegments();
}

clearDeletesBtn?.addEventListener("click", () => {
	deletedIndices = new Set();
	renderTranscript();
});

// ---- Apply edits (build keep-ranges, trigger agent cut) ----
applyEditsBtn?.addEventListener("click", async () => {
	if (transcriptWords.length === 0 || deletedIndices.size === 0) return;
	if (!activeVideoPath || !window.videoAgent?.sendCommand) return;

	const keepRanges = buildKeepRanges();
	if (keepRanges.length === 0) return;

	setProcessing(true);
	addBubbleMessage("user", `Applying edits: removing ${deletedIndices.size} word(s)...`);

	const outputPath = deriveEditedPath(activeVideoPath);
	pendingEditOutputPath = outputPath;

	const prompt = [
		`Cut the video at "${activeVideoPath}" to keep only these time ranges:`,
		...keepRanges.map((r, i) => `  ${i + 1}. ${r.start.toFixed(3)}s - ${r.end.toFixed(3)}s`),
		`Save the result to "${outputPath}".`,
		`Use the run_votgo tool or ffmpeg commands to concatenate these segments.`,
	].join("\n");

	await window.videoAgent.sendCommand({
		type: "agent/prompt",
		message: prompt,
	});
});

function buildKeepRanges() {
	const PAD = 0.02;
	const ranges = [];
	let currentStart = null;
	let currentEnd = null;

	for (let i = 0; i < transcriptWords.length; i++) {
		if (deletedIndices.has(i)) {
			if (currentStart !== null) {
				ranges.push({ start: Math.max(0, currentStart - PAD), end: currentEnd + PAD });
				currentStart = null;
				currentEnd = null;
			}
			continue;
		}
		const w = transcriptWords[i];
		if (currentStart === null) {
			currentStart = w.start;
			currentEnd = w.end;
		} else {
			if (w.start - currentEnd < 0.5) {
				currentEnd = w.end;
			} else {
				ranges.push({ start: Math.max(0, currentStart - PAD), end: currentEnd + PAD });
				currentStart = w.start;
				currentEnd = w.end;
			}
		}
	}
	if (currentStart !== null) {
		ranges.push({ start: Math.max(0, currentStart - PAD), end: currentEnd + PAD });
	}
	return ranges;
}

// ---- Floating Bubble ----
let bubbleExpanded = false;

bubbleTrigger?.addEventListener("click", () => {
        bubbleExpanded = !bubbleExpanded;
        bubble.classList.toggle("expanded", bubbleExpanded);
        if (bubbleExpanded) {
                promptInput?.focus();
        }
});

sendPromptBtn?.addEventListener("click", sendBubblePrompt);
promptInput?.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
		sendBubblePrompt();
	}
});

async function sendBubblePrompt() {
        const message = promptInput?.value?.trim();
        if (!message) return;
        if (!window.videoAgent?.sendCommand) return;

	        addBubbleMessage("user", message);
	        promptInput.value = "";
	        setProcessing(true);
	        setProcessingPhaseLabel("Waiting for model response...");
	        pendingProcessingOutputPath = null;

	const response = await window.videoAgent.sendCommand({
		type: "agent/prompt",
		message,
	});

	if (!response.ok) {
		addBubbleMessage("agent", `Error: ${response.error}`);
		setProcessing(false);
	}
}

function addBubbleMessage(role, text) {
	const div = document.createElement("div");
	div.className = `bubble-msg ${role}`;
	div.textContent = role === "user" ? `> ${text}` : text;
	bubbleMessages.appendChild(div);
	bubbleMessages.scrollTop = bubbleMessages.scrollHeight;
}

function handleAgentEvent(event) {
        if (!event) return;

	switch (event.type) {
		case "agent_start":
			clearProcessingTasks();
			setProcessingPhaseLabel("Planning edits...");
			setProcessing(true);
			break;
		case "message_update": {
			const evt = event.assistantMessageEvent;
			if (evt?.type === "text" && evt.text) {
				addBubbleMessage("agent", evt.text.slice(0, 300));
			}
			break;
		}
	                case "tool_execution_start":
	                        noteProcessingOutputPath(event.args);
	                        pushProcessingTask(event.toolName, event.args);
	                        addBubbleMessage("agent", `Running: ${event.toolName}(${summarizeArgs(event.args)})`);
	                        setProcessingStatusLabel(buildProcessingLabel(event.toolName));
	                        setProcessingPhaseLabel(`Running ${event.toolName}...`);
	                        break;
                case "tool_execution_update":
                        if (event.partialResult) {
                                updateProcessingStatusFromPartial(event.partialResult);
                        }
                        break;
	                case "tool_execution_end":
	                        finishProcessingTask(event.toolName, event.isError ? "failed" : "done");
	                        if (event.isError) {
	                                const errorText = formatToolError(event.result);
	                                const suffix = errorText ? `: ${errorText}` : "";
	                                addBubbleMessage("agent", `Failed: ${event.toolName}${suffix}`);
	                                setProcessingPhaseLabel(`Failed on ${event.toolName}`);
	                        } else {
	                                setProcessingPhaseLabel(`Completed ${event.toolName}`);
	                        }
	                        break;
                case "turn_end":
                case "agent_end":
                        setProcessing(false);
                        if (pendingEditOutputPath) {
                                checkAndLoadEditedVideo(pendingEditOutputPath);
                                pendingEditOutputPath = null;
                        } else if (pendingProcessingOutputPath) {
                                checkAndLoadEditedVideo(pendingProcessingOutputPath);
                                pendingProcessingOutputPath = null;
                        }
                        break;
        }
}

function summarizeArgs(args) {
        if (!args) return "";
	try {
		const str = JSON.stringify(args);
		return str.length > 60 ? str.slice(0, 57) + "..." : str;
	} catch {
		return "";
	}
}

function setProcessing(active) {
	        isAgentProcessing = active;
	        bubble.classList.toggle("processing", active);
	        processingOverlay?.classList.toggle("active", active);
	        if (active) {
	                if (!processingStartedAt) {
	                        processingStartedAt = Date.now();
	                }
	                startProcessingTimer();
	                if (!processingTaskLog.length) {
	                        setProcessingPhaseLabel("Agent is processing...");
	                }
	        } else {
	                stopProcessingTimer();
	                processingStartedAt = 0;
	                clearProcessingTasks();
	                setProcessingPhaseLabel("Waiting for task...");
	        }
	        if (!active) {
	                setProcessingStatusLabel("Processing...");
	        }
}

function setProcessingStatusLabel(text) {
	        if (processingStatus) {
	                processingStatus.textContent = text;
	        }
}

function setProcessingPhaseLabel(text) {
	        if (processingPhase) {
	                processingPhase.textContent = text;
	        }
}

function buildProcessingLabel(toolName) {
        switch (toolName) {
                case "run_votgo":
                        return "Running video tool...";
                case "list_media_clips":
                        return "Loading project clips...";
                default:
                        return `Running ${toolName}...`;
        }
}

function noteProcessingOutputPath(args) {
	if (!args) return;
        const invocation = resolveInvocation(args);
        if (!invocation) return;
	trackInvocationMedia(invocation);
	if (pendingEditOutputPath) return;
        const derivedPath = deriveOutputPathForInvocation(invocation);
        if (derivedPath) {
                pendingProcessingOutputPath = derivedPath;
        }
}

function resolveInvocation(args) {
        if (typeof args === "string") {
                try {
                        return JSON.parse(args);
                } catch {
                        return null;
                }
        }
        if (args && typeof args === "object" && "invocation" in args) {
                const nested = args.invocation;
                if (typeof nested === "string") {
                        try {
                                return JSON.parse(nested);
                        } catch {
                                return null;
                        }
                }
                if (nested && typeof nested === "object") {
                        return nested;
                }
        }
        if (args && typeof args === "object") {
                return args;
        }
        return null;
}

function deriveOutputPathForInvocation(invocation) {
        if (!invocation || !invocation.command || !invocation.input) return null;
        if (typeof invocation.output === "string" && invocation.output.length > 0) {
                return invocation.output;
        }
        if (invocation.command === "crop-bars") {
                return deriveOutputPath(invocation.input, ".cropped");
        }
        if (invocation.command === "remove-silence") {
                return deriveOutputPath(invocation.input, ".clean");
        }
        if (invocation.command === "convert") {
                const format = typeof invocation.format === "string" ? invocation.format : "";
                return deriveOutputPath(invocation.input, "", format);
        }
        if (invocation.command === "extract-audio") {
                return deriveOutputPath(invocation.input, ".audio");
        }
        return null;
}

function deriveOutputPath(inputPath, suffix, formatOverride) {
        const splitIndex = Math.max(inputPath.lastIndexOf("/"), inputPath.lastIndexOf("\\"));
        const dir = splitIndex >= 0 ? inputPath.slice(0, splitIndex + 1) : "";
        const fileName = splitIndex >= 0 ? inputPath.slice(splitIndex + 1) : inputPath;
        const dotIndex = fileName.lastIndexOf(".");
        const baseName = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
        const extension = resolveExtension(formatOverride, fileName, dotIndex);
        return `${dir}${baseName}${suffix}${extension}`;
}

function resolveExtension(formatOverride, fileName, dotIndex) {
        if (formatOverride && typeof formatOverride === "string") {
                const trimmed = formatOverride.trim();
                if (trimmed) {
                        return `.${trimmed.replace(/^\./, "")}`;
                }
        }
        return dotIndex > 0 ? fileName.slice(dotIndex) : ".mp4";
}

function updateProcessingStatusFromPartial(partialResult) {
	        if (!partialResult) return;
	        const text = extractTextFromToolResult(partialResult);
	        if (text) {
	                setProcessingStatusLabel(text.slice(0, 120));
	        }
}

function startProcessingTimer() {
	        if (processingTimerId !== null) return;
	        updateProcessingElapsed();
	        processingTimerId = window.setInterval(updateProcessingElapsed, 250);
}

function stopProcessingTimer() {
	        if (processingTimerId === null) return;
	        window.clearInterval(processingTimerId);
	        processingTimerId = null;
}

function updateProcessingElapsed() {
	        if (!processingElapsed) return;
	        if (!processingStartedAt) {
	                processingElapsed.textContent = "Elapsed: 0s";
	                return;
	        }
	        const elapsedMs = Math.max(0, Date.now() - processingStartedAt);
	        processingElapsed.textContent = `Elapsed: ${formatElapsed(elapsedMs)}`;
}

function formatElapsed(elapsedMs) {
	        const totalSeconds = Math.floor(elapsedMs / 1000);
	        const mins = Math.floor(totalSeconds / 60);
	        const secs = totalSeconds % 60;
	        if (mins === 0) return `${secs}s`;
	        return `${mins}m ${secs.toString().padStart(2, "0")}s`;
}

function pushProcessingTask(toolName, args) {
	        const label = `${toolName}(${summarizeArgs(args)})`;
	        processingTaskLog.push({ toolName, label, status: "running" });
	        processingTaskLog = processingTaskLog.slice(-6);
	        renderProcessingTasks();
}

function finishProcessingTask(toolName, status) {
	        for (let i = processingTaskLog.length - 1; i >= 0; i--) {
	                const entry = processingTaskLog[i];
	                if (entry.status === "running" && entry.toolName === toolName) {
	                        entry.status = status;
	                        renderProcessingTasks();
	                        return;
	                }
	        }
	        if (processingTaskLog.length > 0) {
	                processingTaskLog[processingTaskLog.length - 1].status = status;
	                renderProcessingTasks();
	        }
}

function clearProcessingTasks() {
	        processingTaskLog = [];
	        renderProcessingTasks();
}

function renderProcessingTasks() {
	        if (!processingTasks) return;
	        processingTasks.textContent = "";
	        if (!processingTaskLog.length) {
	                const idle = document.createElement("div");
	                idle.className = "processing-task";
	                idle.textContent = "No active tool calls yet.";
	                processingTasks.appendChild(idle);
	                return;
	        }
	        for (const task of processingTaskLog) {
	                const row = document.createElement("div");
	                row.className = `processing-task ${task.status}`;
	                const prefix = task.status === "running" ? "•" : task.status === "done" ? "✓" : "!";
	                row.textContent = `${prefix} ${task.label}`;
	                processingTasks.appendChild(row);
	        }
}

function extractTextFromToolResult(result) {
        if (typeof result === "string") return result.trim();
        if (!result || !Array.isArray(result.content)) return "";
        return result.content
                .filter((entry) => entry?.type === "text" && typeof entry.text === "string")
                .map((entry) => entry.text.trim())
                .filter(Boolean)
                .join(" ");
}

function formatToolError(result) {
        if (!result) return "";
        if (typeof result === "string") return result.trim();
        const content = Array.isArray(result.content) ? result.content : [];
        const text = content
                .filter((entry) => entry?.type === "text" && typeof entry.text === "string")
                .map((entry) => entry.text.trim())
                .filter(Boolean)
                .join(" ");
        return text;
}

async function checkAndLoadEditedVideo(outputPath) {
	if (!window.videoAgent?.sendCommand) return;

	const response = await window.videoAgent.sendCommand({
		type: "fs/exists",
		path: outputPath,
	});

	if (response.ok && response.data.type === "fs/exists" && response.data.exists) {
		const outputKind = detectMediaKindFromPath(outputPath);
		if (outputKind === "audio") {
			addMediaPath("audio", "output", outputPath);
			addBubbleMessage("agent", "Audio output ready.");
			return;
		}
		addMediaPath("video", "output", outputPath);
		addBubbleMessage("agent", "Edit complete. Reloading video...");
		activeVideoPath = outputPath;
		showVideoPreview(outputPath);
	} else {
		addBubbleMessage("agent", "Edit finished but output file not found.");
	}
}

function trackInvocationMedia(invocation) {
	if (!invocation || typeof invocation !== "object") return;
	const command = typeof invocation.command === "string" ? invocation.command : "";
	const inputPath = typeof invocation.input === "string" ? invocation.input : null;
	const explicitOutput = typeof invocation.output === "string" ? invocation.output : null;
	const derivedOutput = explicitOutput || deriveOutputPathForInvocation(invocation);

	if (inputPath) {
		const inputKind = inferMediaKind(inputPath, command, "input");
		if (inputKind) {
			addMediaPath(inputKind, "input", inputPath);
		}
	}

	if (derivedOutput) {
		const outputKind = inferMediaKind(derivedOutput, command, "output");
		if (outputKind) {
			addMediaPath(outputKind, "output", derivedOutput);
		}
	}
}

function inferMediaKind(path, command, direction) {
	if (direction === "output") {
		if (command === "extract-audio") return "audio";
		if (command === "remove-silence" || command === "crop-bars") return "video";
	}
	if (direction === "input") {
		if (command === "extract-audio") return "video";
	}
	return detectMediaKindFromPath(path);
}

function detectMediaKindFromPath(path) {
	if (!path || typeof path !== "string") return null;
	const normalized = path.toLowerCase();
	const extIndex = normalized.lastIndexOf(".");
	if (extIndex === -1) return null;
	const ext = normalized.slice(extIndex);
	if (VIDEO_EXTENSIONS.has(ext)) return "video";
	if (AUDIO_EXTENSIONS.has(ext)) return "audio";
	return null;
}

function addMediaPath(kind, direction, path) {
	if (!kind || !direction || !path || typeof path !== "string") return;
	const bucket = mediaRegistry[kind]?.[direction];
	if (!bucket) return;
	if (bucket.has(path)) return;
	bucket.add(path);
	renderMediaRegistry();
}

function renderMediaRegistry() {
	renderMediaList(videoInputsList, mediaRegistry.video.input);
	renderMediaList(audioInputsList, mediaRegistry.audio.input);
	renderMediaList(videoOutputsList, mediaRegistry.video.output);
	renderMediaList(audioOutputsList, mediaRegistry.audio.output);
}

function renderMediaList(container, values) {
	if (!container) return;
	container.textContent = "";
	const entries = Array.from(values);
	if (entries.length === 0) {
		const empty = document.createElement("li");
		empty.className = "io-empty";
		empty.textContent = "none";
		container.appendChild(empty);
		return;
	}
	for (const entry of entries.slice().reverse()) {
		const item = document.createElement("li");
		item.className = "io-item";
		item.textContent = basenameFromPath(entry);
		item.title = entry;
		container.appendChild(item);
	}
}

function basenameFromPath(path) {
	const normalized = path.replace(/\\/g, "/");
	const segments = normalized.split("/");
	return segments[segments.length - 1] || normalized;
}

function renderTimelineDeletedSegments() {
	const durationSec = getActiveDurationSeconds();
	const deletedRanges = buildDeletedRanges();
	renderDeletedSegmentsForTrack(videoTimelineDeletes, deletedRanges, durationSec);
	renderDeletedSegmentsForTrack(audioTimelineDeletes, deletedRanges, durationSec);
	updateTimelinePlayheads();
}

function buildDeletedRanges() {
	if (deletedIndices.size === 0) return [];
	const sortedIndices = Array.from(deletedIndices).sort((a, b) => a - b);
	const ranges = [];
	let activeRange = null;

	for (const index of sortedIndices) {
		const word = transcriptWords[index];
		if (!word) continue;
		if (!activeRange) {
			activeRange = { start: word.start, end: word.end };
			continue;
		}
		if (word.start - activeRange.end <= 0.15) {
			activeRange.end = Math.max(activeRange.end, word.end);
			continue;
		}
		ranges.push(activeRange);
		activeRange = { start: word.start, end: word.end };
	}

	if (activeRange) ranges.push(activeRange);
	return ranges;
}

function renderDeletedSegmentsForTrack(container, ranges, durationSec) {
	if (!container) return;
	container.textContent = "";
	if (!durationSec || ranges.length === 0) return;

	for (const range of ranges) {
		const leftPct = Math.max(0, Math.min(100, (range.start / durationSec) * 100));
		const rightPct = Math.max(0, Math.min(100, (range.end / durationSec) * 100));
		const widthPct = Math.max(0.2, rightPct - leftPct);
		const seg = document.createElement("div");
		seg.className = "timeline-delete-segment";
		seg.style.left = `${leftPct}%`;
		seg.style.width = `${widthPct}%`;
		container.appendChild(seg);
	}
}

function updateTimelinePlayheads() {
	const durationSec = getActiveDurationSeconds();
	const currentTimeSec = getCurrentTimeSeconds();
	let pct = 0;
	if (durationSec > 0) {
		pct = Math.max(0, Math.min(100, (currentTimeSec / durationSec) * 100));
	}
	setPlayheadPosition(videoTimelinePlayhead, pct);
	setPlayheadPosition(audioTimelinePlayhead, pct);
}

function setPlayheadPosition(playhead, pct) {
	if (!playhead) return;
	playhead.style.left = `${pct}%`;
}

function getCurrentTimeSeconds() {
	if (videoPreview instanceof HTMLVideoElement && Number.isFinite(videoPreview.currentTime)) {
		return videoPreview.currentTime;
	}
	return 0;
}

function getActiveDurationSeconds() {
	if (videoPreview instanceof HTMLVideoElement && Number.isFinite(videoPreview.duration) && videoPreview.duration > 0) {
		return videoPreview.duration;
	}
	if (transcriptWords.length === 0) return 0;
	let maxEnd = 0;
	for (const word of transcriptWords) {
		if (Number.isFinite(word.end)) {
			maxEnd = Math.max(maxEnd, word.end);
		}
	}
	return maxEnd;
}

// ---- Bubble drag ----
let isDragging = false;
let dragOffsetX = 0;
let dragOffsetY = 0;

bubbleDrag?.addEventListener("mousedown", (e) => {
	isDragging = true;
	const rect = bubble.getBoundingClientRect();
	dragOffsetX = e.clientX - rect.left;
	dragOffsetY = e.clientY - rect.top;
	e.preventDefault();
});

document.addEventListener("mousemove", (e) => {
	if (!isDragging) return;
	const x = e.clientX - dragOffsetX;
	const y = e.clientY - dragOffsetY;
	bubble.style.left = `${x}px`;
	bubble.style.top = `${y}px`;
	bubble.style.right = "auto";
	bubble.style.bottom = "auto";
});

document.addEventListener("mouseup", () => {
	isDragging = false;
	isResizing = false;
});

// ---- Bubble resize ----
const bubbleResize = document.getElementById("bubbleResize");
const bubblePanel = bubble?.querySelector(".bubble-panel");
let isResizing = false;
let resizeStartX = 0;
let resizeStartY = 0;
let resizeStartW = 0;
let resizeStartH = 0;

bubbleResize?.addEventListener("mousedown", (e) => {
	if (!bubblePanel) return;
	isResizing = true;
	resizeStartX = e.clientX;
	resizeStartY = e.clientY;
	resizeStartW = bubblePanel.offsetWidth;
	resizeStartH = bubblePanel.offsetHeight;
	e.preventDefault();
	e.stopPropagation();
});

document.addEventListener("mousemove", (e) => {
	if (!isResizing || !bubblePanel) return;
	const dw = resizeStartX - e.clientX;
	const dh = resizeStartY - e.clientY;
	const newW = Math.max(260, resizeStartW + dw);
	const newH = Math.max(160, resizeStartH + dh);
	bubblePanel.style.width = `${newW}px`;
	bubblePanel.style.height = `${newH}px`;
});

// ---- Video file picking ----
async function pickVideoSelectionFromBridge() {
	if (!window.videoAgent || typeof window.videoAgent.pickVideoFile !== "function") return null;
	try {
		return await window.videoAgent.pickVideoFile();
	} catch {
		return null;
	}
}

async function pickVideoSelectionFromInput() {
	const input = videoPickerInput;
	if (!(input instanceof HTMLInputElement)) return null;

	input.value = "";
	const file = await new Promise((resolve) => {
		const onChange = () => {
			cleanup();
			resolve(input.files?.[0] ?? null);
		};
		const onFocus = () => {
			setTimeout(() => {
				cleanup();
				resolve(input.files?.[0] ?? null);
			}, 0);
		};
		const timeoutId = setTimeout(() => {
			cleanup();
			resolve(null);
		}, 60_000);
		function cleanup() {
			clearTimeout(timeoutId);
			input.removeEventListener("change", onChange);
			window.removeEventListener("focus", onFocus);
		}
		input.addEventListener("change", onChange);
		window.addEventListener("focus", onFocus);
		input.click();
	});

	if (!file) return null;
	const candidatePath = typeof file.path === "string" ? file.path : "";
	if (!candidatePath || candidatePath.includes("fakepath")) {
		return null;
	}
	return {
		videoPath: candidatePath,
		projectRoot: dirnameFromPath(candidatePath),
	};
}

// ---- Utilities ----
function toFileUrl(filePath) {
	const normalized = filePath.replace(/\\/g, "/");
	if (/^[a-z]:\//i.test(normalized)) return `file:///${encodeURI(normalized)}`;
	if (normalized.startsWith("/")) return `file://${encodeURI(normalized)}`;
	return `file://${encodeURI(`/${normalized}`)}`;
}

function dirnameFromPath(path) {
	const normalized = path.replace(/\\/g, "/");
	const parts = normalized.split("/").filter((p) => p.length > 0);
	if (parts.length <= 1) return path;
	const dirname = parts.slice(0, -1).join("/");
	if (path.startsWith("/")) return `/${dirname}`;
	return dirname;
}

function deriveTranscriptPath(inputPath) {
	const dotIndex = inputPath.lastIndexOf(".");
	const base = dotIndex > 0 ? inputPath.slice(0, dotIndex) : inputPath;
	return `${base}.transcript.json`;
}

function deriveEditedPath(inputPath) {
	const splitIndex = Math.max(inputPath.lastIndexOf("/"), inputPath.lastIndexOf("\\"));
	const dir = splitIndex >= 0 ? inputPath.slice(0, splitIndex + 1) : "";
	const fileName = splitIndex >= 0 ? inputPath.slice(splitIndex + 1) : inputPath;
	const dotIndex = fileName.lastIndexOf(".");
	const baseName = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
	const extension = dotIndex > 0 ? fileName.slice(dotIndex) : ".mp4";
	return `${dir}${baseName}.edited${extension}`;
}

const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v", ".mpg", ".mpeg"]);
const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".aac", ".m4a", ".flac", ".ogg", ".opus", ".wma"]);

window.__setTranscriptData = setTranscriptData;
renderMediaRegistry();
renderTimelineDeletedSegments();
