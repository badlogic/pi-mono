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
const inputFolderCount = document.getElementById("inputFolderCount");
const outputFolderCount = document.getElementById("outputFolderCount");
const ioPreviewTitle = document.getElementById("ioPreviewTitle");
const ioPreviewContent = document.getElementById("ioPreviewContent");
const processingOverlay = document.getElementById("processingOverlay");
const processingStatus = document.getElementById("processingStatus");
const processingPhase = document.getElementById("processingPhase");
const processingElapsed = document.getElementById("processingElapsed");
const processingTasks = document.getElementById("processingTasks");
const videoTimelineSegments = document.getElementById("videoTimelineSegments");
const audioTimelineSegments = document.getElementById("audioTimelineSegments");
const videoTimelineDeletes = document.getElementById("videoTimelineDeletes");
const audioTimelineDeletes = document.getElementById("audioTimelineDeletes");
const videoTimelinePlayhead = document.getElementById("videoTimelinePlayhead");
const audioTimelinePlayhead = document.getElementById("audioTimelinePlayhead");
const transcriptResize = document.getElementById("transcriptResize");
const transcriptCollapseBtn = document.getElementById("transcriptCollapseBtn");
const transcriptPanel = document.querySelector(".transcript-panel");
const appEl = document.querySelector(".app");
const timelineRulerMarks = document.getElementById("timelineRulerMarks");
const audioWaveform = document.getElementById("audioWaveform");
const timelineScrubber = document.getElementById("timelineScrubber");
const timelineScrubberThumb = document.getElementById("timelineScrubberThumb");
const timelineAddPinBtn = document.getElementById("timelineAddPinBtn");
const timelinePinsLayer = document.getElementById("timelinePinsLayer");
const timelinePinsRulerLayer = document.getElementById("timelinePinsRulerLayer");
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
let timelineSplitSecs = [];
let selectedPreviewEntry = null;
let isTranscriptCollapsed = false;
let isResizingTranscript = false;
let isScrubbing = false;
let timelinePins = [];
let waveformAmplitudes = null;
let resizeTranscriptStartX = 0;
let resizeTranscriptStartWidth = 0;
const undoStack = [];
const redoStack = [];
let isApplyingHistorySnapshot = false;
const HISTORY_LIMIT = 200;

// ---- Init ----
if (window.videoAgent) {
	window.videoAgent.onEvent((event) => {
		if (event?.type === "agent_event") {
			handleAgentEvent(event.event);
		}
	});
}

videoTimelineSegments?.parentElement?.addEventListener("dblclick", handleTimelineSplitDblClick);
audioTimelineSegments?.parentElement?.addEventListener("dblclick", handleTimelineSplitDblClick);
document.addEventListener("keydown", handleGlobalUndoRedoShortcut);

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
        const fileUrl = toFileUrl(videoPath);
        videoPreview.src = fileUrl;
        videoPreview.load();
        videoSourceLabel.textContent = videoPath.split("/").pop() || videoPath;
        transcriptWords = [];
        deletedIndices = new Set();
	timelineSplitSecs = [];
	timelinePins = [];
	waveformAmplitudes = null;
	undoStack.length = 0;
	redoStack.length = 0;
        pendingProcessingOutputPath = null;
        renderTranscript();
	renderTimelineSplitSegments();
	updateTimelinePlayheads();
	generateWaveform();
	renderTimelineRuler();
	renderTimelinePins();
	decodeAudioWaveform(fileUrl);
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
	renderTimelineSplitSegments();
	updateTimelinePlayheads();
	renderTimelineRuler();
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
	recordUndoSnapshot();
	if (deletedIndices.has(index)) {
		deletedIndices.delete(index);
	} else {
		deletedIndices.add(index);
	}
	renderTranscript();
}

clearDeletesBtn?.addEventListener("click", () => {
	if (deletedIndices.size === 0) return;
	recordUndoSnapshot();
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
	                                if (event.toolName === "run_votgo" && !pendingEditOutputPath) {
	                                        const actualPath = parseActualOutputPath(event.result);
	                                        if (actualPath) {
	                                                pendingProcessingOutputPath = actualPath;
	                                        }
	                                }
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

function parseActualOutputPath(result) {
        const text = extractTextFromToolResult(result);
        if (!text) return null;
        const arrowMatch = text.match(/(?:Cropped|Done|Converted|Extracted audio):\s*.+?\s*→\s*(.+?)(?:\s*\(|$)/m);
        if (arrowMatch) return arrowMatch[1].trim();
        const savedMatch = text.match(/Transcript saved:\s*(.+)/m);
        if (savedMatch) return savedMatch[1].trim();
        return null;
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
	if (!selectedPreviewEntry || direction === "output") {
		selectedPreviewEntry = { path, kind, direction };
	}
	renderMediaRegistry();
}

function renderMediaRegistry() {
	renderMediaList(videoInputsList, mediaRegistry.video.input, "video", "input");
	renderMediaList(audioInputsList, mediaRegistry.audio.input, "audio", "input");
	renderMediaList(videoOutputsList, mediaRegistry.video.output, "video", "output");
	renderMediaList(audioOutputsList, mediaRegistry.audio.output, "audio", "output");
	updateFolderCounts();
	renderSelectedPreview();
}

function renderMediaList(container, values, kind, direction) {
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
		const button = document.createElement("button");
		button.className = "io-item-btn";
		button.type = "button";
		button.textContent = basenameFromPath(entry);
		button.title = entry;
		if (
			selectedPreviewEntry &&
			selectedPreviewEntry.path === entry &&
			selectedPreviewEntry.kind === kind &&
			selectedPreviewEntry.direction === direction
		) {
			button.classList.add("selected");
		}
		button.addEventListener("click", () => {
			selectedPreviewEntry = { path: entry, kind, direction };
			renderMediaRegistry();
		});
		item.appendChild(button);
		container.appendChild(item);
	}
}

function updateFolderCounts() {
	const inputCount = mediaRegistry.video.input.size + mediaRegistry.audio.input.size;
	const outputCount = mediaRegistry.video.output.size + mediaRegistry.audio.output.size;
	if (inputFolderCount) inputFolderCount.textContent = String(inputCount);
	if (outputFolderCount) outputFolderCount.textContent = String(outputCount);
}

function renderSelectedPreview() {
	if (!ioPreviewTitle || !ioPreviewContent) return;
	ioPreviewContent.textContent = "";
	if (!selectedPreviewEntry) {
		ioPreviewTitle.textContent = "Preview";
		const empty = document.createElement("div");
		empty.className = "io-preview-empty";
		empty.textContent = "Choose a file from Inputs or Outputs.";
		ioPreviewContent.appendChild(empty);
		return;
	}

	ioPreviewTitle.textContent = `${selectedPreviewEntry.direction.toUpperCase()} / ${selectedPreviewEntry.kind.toUpperCase()}`;

	const meta = document.createElement("div");
	meta.className = "io-preview-meta";
	meta.textContent = selectedPreviewEntry.path;
	ioPreviewContent.appendChild(meta);

	if (selectedPreviewEntry.kind === "video") {
		const preview = document.createElement("video");
		preview.className = "io-preview-video";
		preview.controls = true;
		preview.preload = "metadata";
		preview.src = toFileUrl(selectedPreviewEntry.path);
		ioPreviewContent.appendChild(preview);
		return;
	}

	if (selectedPreviewEntry.kind === "audio") {
		const preview = document.createElement("audio");
		preview.className = "io-preview-audio";
		preview.controls = true;
		preview.preload = "metadata";
		preview.src = toFileUrl(selectedPreviewEntry.path);
		ioPreviewContent.appendChild(preview);
		return;
	}

	const fallback = document.createElement("div");
	fallback.className = "io-preview-empty";
	fallback.textContent = "Preview unavailable for this file type.";
	ioPreviewContent.appendChild(fallback);
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

function handleTimelineSplitDblClick(event) {
	const currentTarget = event.currentTarget;
	if (!(currentTarget instanceof HTMLElement)) return;
	const durationSec = getActiveDurationSeconds();
	if (!(durationSec > 0)) return;
	const rect = currentTarget.getBoundingClientRect();
	if (rect.width <= 0) return;
	const clickPct = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
	const splitSec = Number((clickPct * durationSec).toFixed(3));
	const edgePaddingSec = 0.05;
	if (splitSec <= edgePaddingSec || splitSec >= durationSec - edgePaddingSec) {
		return;
	}
	if (timelineSplitSecs.some((value) => Math.abs(value - splitSec) < 0.01)) {
		return;
	}
	recordUndoSnapshot();
	timelineSplitSecs.push(splitSec);
	timelineSplitSecs.sort((a, b) => a - b);
	renderTimelineSplitSegments();
	addBubbleMessage("agent", `Split added at ${splitSec.toFixed(2)}s`);
}

function renderTimelineSplitSegments() {
	const durationSec = getActiveDurationSeconds();
	renderTimelineSegmentsForTrack(videoTimelineSegments, "video", durationSec);
	renderTimelineSegmentsForTrack(audioTimelineSegments, "audio", durationSec);
}

function renderTimelineSegmentsForTrack(container, kind, durationSec) {
	if (!container) return;
	container.textContent = "";
	if (!(durationSec > 0)) return;
	const orderedSplits = timelineSplitSecs
		.filter((value) => value > 0 && value < durationSec)
		.sort((a, b) => a - b);
	const boundaries = [0, ...orderedSplits, durationSec];
	for (let i = 0; i < boundaries.length - 1; i++) {
		const start = boundaries[i];
		const end = boundaries[i + 1];
		if (!(end > start)) continue;
		const leftPct = (start / durationSec) * 100;
		const widthPct = ((end - start) / durationSec) * 100;
		const segment = document.createElement("div");
		segment.className = `timeline-segment ${kind}`;
		segment.style.left = `${leftPct}%`;
		segment.style.width = `${widthPct}%`;
		container.appendChild(segment);
	}
}

function recordUndoSnapshot() {
	if (isApplyingHistorySnapshot) return;
	undoStack.push(createEditorSnapshot());
	if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
	redoStack.length = 0;
}

function createEditorSnapshot() {
	return {
		deletedIndices: Array.from(deletedIndices).sort((a, b) => a - b),
		timelineSplitSecs: [...timelineSplitSecs],
		timelinePins: timelinePins.map((p) => ({ ...p })),
	};
}

function applyEditorSnapshot(snapshot) {
	isApplyingHistorySnapshot = true;
	deletedIndices = new Set(snapshot.deletedIndices);
	timelineSplitSecs = [...snapshot.timelineSplitSecs].sort((a, b) => a - b);
	timelinePins = (snapshot.timelinePins || []).map((p) => ({ ...p }));
	renderTranscript();
	renderTimelineSplitSegments();
	renderTimelinePins();
	isApplyingHistorySnapshot = false;
}

function undoEditorChange() {
	if (undoStack.length === 0) return;
	redoStack.push(createEditorSnapshot());
	const previous = undoStack.pop();
	if (!previous) return;
	applyEditorSnapshot(previous);
}

function redoEditorChange() {
	if (redoStack.length === 0) return;
	undoStack.push(createEditorSnapshot());
	const next = redoStack.pop();
	if (!next) return;
	applyEditorSnapshot(next);
}

function handleGlobalUndoRedoShortcut(event) {
	if (!(event.metaKey || event.ctrlKey)) return;
	if (shouldBypassGlobalShortcut(event.target)) return;

	const key = event.key.toLowerCase();
	if (key === "z" && !event.shiftKey) {
		event.preventDefault();
		undoEditorChange();
		return;
	}

	const isRedo = key === "y" || (key === "z" && event.shiftKey);
	if (isRedo) {
		event.preventDefault();
		redoEditorChange();
	}
}

function shouldBypassGlobalShortcut(target) {
	if (!(target instanceof HTMLElement)) return false;
	if (target.isContentEditable) return true;
	const tag = target.tagName.toLowerCase();
	return tag === "input" || tag === "textarea" || tag === "select";
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

// ---- Transcript Sidebar Resize ----
transcriptResize?.addEventListener("mousedown", (e) => {
	isResizingTranscript = true;
	resizeTranscriptStartX = e.clientX;
	resizeTranscriptStartWidth = transcriptPanel?.offsetWidth ?? 320;
	transcriptResize.classList.add("active");
	document.body.style.cursor = "col-resize";
	document.body.style.userSelect = "none";
	e.preventDefault();
});

document.addEventListener("mousemove", (e) => {
	if (!isResizingTranscript) return;
	const delta = e.clientX - resizeTranscriptStartX;
	const newWidth = Math.max(200, Math.min(600, resizeTranscriptStartWidth + delta));
	appEl?.style.setProperty("--transcript-width", `${newWidth}px`);
});

document.addEventListener("mouseup", () => {
	if (isResizingTranscript) {
		isResizingTranscript = false;
		transcriptResize?.classList.remove("active");
		document.body.style.cursor = "";
		document.body.style.userSelect = "";
	}
});

// ---- Transcript Sidebar Collapse ----
transcriptCollapseBtn?.addEventListener("click", () => {
	isTranscriptCollapsed = !isTranscriptCollapsed;
	appEl?.classList.toggle("transcript-collapsed", isTranscriptCollapsed);
	if (transcriptCollapseBtn) {
		transcriptCollapseBtn.textContent = isTranscriptCollapsed ? "\u00BB" : "\u00AB";
		transcriptCollapseBtn.title = isTranscriptCollapsed ? "Expand sidebar" : "Collapse sidebar";
	}
});

// ---- Audio Waveform Visualization ----
function generateWaveform() {
	if (!audioWaveform) return;
	if (waveformAmplitudes) {
		renderWaveformFromAmplitudes(waveformAmplitudes);
		return;
	}
	audioWaveform.textContent = "";
}

async function decodeAudioWaveform(videoUrl) {
	waveformAmplitudes = null;
	if (!audioWaveform) return;
	audioWaveform.textContent = "";

	try {
		const response = await fetch(videoUrl);
		const arrayBuffer = await response.arrayBuffer();
		const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
		const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
		const channelData = audioBuffer.getChannelData(0);

		const bucketCount = 2000;
		const bucketSize = Math.floor(channelData.length / bucketCount);
		const amplitudes = new Float32Array(bucketCount);

		for (let i = 0; i < bucketCount; i++) {
			const start = i * bucketSize;
			const end = Math.min(start + bucketSize, channelData.length);
			let sum = 0;
			for (let j = start; j < end; j++) {
				sum += Math.abs(channelData[j]);
			}
			amplitudes[i] = sum / (end - start);
		}

		let maxAmp = 0;
		for (let i = 0; i < amplitudes.length; i++) {
			if (amplitudes[i] > maxAmp) maxAmp = amplitudes[i];
		}
		if (maxAmp > 0) {
			for (let i = 0; i < amplitudes.length; i++) {
				amplitudes[i] /= maxAmp;
			}
		}

		waveformAmplitudes = amplitudes;
		audioCtx.close();
		renderWaveformFromAmplitudes(amplitudes);
	} catch {
		waveformAmplitudes = null;
	}
}

function renderWaveformFromAmplitudes(amplitudes) {
	if (!audioWaveform) return;
	audioWaveform.textContent = "";
	const containerWidth = audioWaveform.parentElement?.offsetWidth ?? 600;
	const barWidth = 2;
	const gap = 1;
	const barCount = Math.floor(containerWidth / (barWidth + gap));
	const maxHeight = 42;

	for (let i = 0; i < barCount; i++) {
		const ampIndex = Math.floor((i / barCount) * amplitudes.length);
		const amp = amplitudes[Math.min(ampIndex, amplitudes.length - 1)];
		const bar = document.createElement("div");
		bar.className = "timeline-waveform-bar";
		bar.style.height = `${Math.max(1, amp * maxHeight)}px`;
		audioWaveform.appendChild(bar);
	}
}

// ---- Timecode Ruler ----
function renderTimelineRuler() {
	if (!timelineRulerMarks) return;
	timelineRulerMarks.textContent = "";
	const durationSec = getActiveDurationSeconds();
	if (!(durationSec > 0)) return;

	let majorInterval;
	if (durationSec <= 30) majorInterval = 5;
	else if (durationSec <= 120) majorInterval = 15;
	else if (durationSec <= 600) majorInterval = 30;
	else majorInterval = 60;

	const minorInterval = majorInterval / 5;

	for (let t = 0; t <= durationSec; t += minorInterval) {
		const pct = (t / durationSec) * 100;
		const isMajor = Math.abs(t % majorInterval) < 0.01 || Math.abs(t % majorInterval - majorInterval) < 0.01;
		const mark = document.createElement("div");
		mark.className = `timeline-ruler-mark${isMajor ? " major" : ""}`;
		mark.style.left = `${pct}%`;

		const line = document.createElement("div");
		line.className = "timeline-ruler-mark-line";
		mark.appendChild(line);

		if (isMajor) {
			const label = document.createElement("div");
			label.className = "timeline-ruler-mark-label";
			label.textContent = formatTimecode(t);
			mark.appendChild(label);
		}

		timelineRulerMarks.appendChild(mark);
	}
}

function formatTimecode(sec) {
	const m = Math.floor(sec / 60);
	const s = Math.floor(sec % 60);
	return `${m}:${s.toString().padStart(2, "0")}`;
}

// ---- Timeline Scrubber (click/drag ruler to seek) ----
function scrubToPosition(clientX) {
	if (!timelineScrubber || !(videoPreview instanceof HTMLVideoElement)) return;
	const rect = timelineScrubber.getBoundingClientRect();
	if (rect.width <= 0) return;
	const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
	const durationSec = getActiveDurationSeconds();
	if (!(durationSec > 0)) return;
	videoPreview.currentTime = pct * durationSec;
	if (timelineScrubberThumb) {
		timelineScrubberThumb.style.left = `${pct * 100}%`;
	}
}

timelineScrubber?.addEventListener("mousedown", (e) => {
	isScrubbing = true;
	timelineScrubber.classList.add("active");
	scrubToPosition(e.clientX);
	e.preventDefault();
});

document.addEventListener("mousemove", (e) => {
	if (!isScrubbing) return;
	scrubToPosition(e.clientX);
});

document.addEventListener("mouseup", () => {
	if (isScrubbing) {
		isScrubbing = false;
		timelineScrubber?.classList.remove("active");
	}
});

timelineScrubber?.addEventListener("mousemove", (e) => {
	if (isScrubbing) return;
	if (!timelineScrubberThumb || !timelineScrubber) return;
	const rect = timelineScrubber.getBoundingClientRect();
	if (rect.width <= 0) return;
	const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
	timelineScrubberThumb.style.left = `${pct * 100}%`;
});

// ---- Timeline Pins ----
timelineAddPinBtn?.addEventListener("click", () => {
	const currentSec = getCurrentTimeSeconds();
	const durationSec = getActiveDurationSeconds();
	if (!(durationSec > 0)) return;
	if (timelinePins.some((p) => Math.abs(p.time - currentSec) < 0.05)) return;
	timelinePins.push({ time: currentSec });
	timelinePins.sort((a, b) => a.time - b.time);
	renderTimelinePins();
	addBubbleMessage("agent", `Pin added at ${formatTimecode(currentSec)}`);
});

function renderTimelinePins() {
	if (!timelinePinsLayer || !timelinePinsRulerLayer) return;
	timelinePinsLayer.textContent = "";
	timelinePinsRulerLayer.textContent = "";
	const durationSec = getActiveDurationSeconds();
	if (!(durationSec > 0)) return;

	for (let i = 0; i < timelinePins.length; i++) {
		const pin = timelinePins[i];
		const pct = (pin.time / durationSec) * 100;

		const trackLine = document.createElement("div");
		trackLine.className = "timeline-pin";
		trackLine.style.left = `${pct}%`;
		trackLine.title = `Pin at ${formatTimecode(pin.time)} (click to seek, right-click to remove)`;
		trackLine.addEventListener("click", () => {
			if (videoPreview instanceof HTMLVideoElement) {
				videoPreview.currentTime = pin.time;
			}
		});
		trackLine.addEventListener("contextmenu", (e) => {
			e.preventDefault();
			timelinePins.splice(i, 1);
			renderTimelinePins();
			addBubbleMessage("agent", `Pin removed at ${formatTimecode(pin.time)}`);
		});
		timelinePinsLayer.appendChild(trackLine);

		const rulerMark = document.createElement("div");
		rulerMark.className = "timeline-pin-ruler";
		rulerMark.style.left = `${pct}%`;
		rulerMark.title = `Pin at ${formatTimecode(pin.time)}`;
		rulerMark.addEventListener("click", () => {
			if (videoPreview instanceof HTMLVideoElement) {
				videoPreview.currentTime = pin.time;
			}
		});
		rulerMark.addEventListener("contextmenu", (e) => {
			e.preventDefault();
			timelinePins.splice(i, 1);
			renderTimelinePins();
		});
		timelinePinsRulerLayer.appendChild(rulerMark);
	}
}

// ---- Window resize ----
window.addEventListener("resize", () => {
	generateWaveform();
	renderTimelineRuler();
});

window.__setTranscriptData = setTranscriptData;
renderMediaRegistry();
renderTimelineDeletedSegments();
