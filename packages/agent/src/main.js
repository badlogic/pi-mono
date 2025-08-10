"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.main = main;
var chalk_1 = require("chalk");
var readline_1 = require("readline");
var agent_js_1 = require("./agent.js");
var args_js_1 = require("./args.js");
var console_renderer_js_1 = require("./renderers/console-renderer.js");
var json_renderer_js_1 = require("./renderers/json-renderer.js");
var tui_renderer_js_1 = require("./renderers/tui-renderer.js");
var session_manager_js_1 = require("./session-manager.js");
// Define argument structure
var argDefs = {
    "base-url": {
        type: "string",
        default: "https://api.openai.com/v1",
        description: "API base URL",
    },
    "api-key": {
        type: "string",
        default: process.env.OPENAI_API_KEY || "",
        description: "API key",
        showDefault: "$OPENAI_API_KEY",
    },
    model: {
        type: "string",
        default: "gpt-5-mini",
        description: "Model name",
    },
    api: {
        type: "string",
        default: "completions",
        description: "API type",
        choices: [
            { value: "completions", description: "OpenAI Chat Completions API (most models)" },
            { value: "responses", description: "OpenAI Responses API (GPT-OSS models)" },
        ],
    },
    "system-prompt": {
        type: "string",
        default: "You are a helpful assistant.",
        description: "System prompt",
    },
    continue: {
        type: "flag",
        alias: "c",
        description: "Continue previous session",
    },
    json: {
        type: "flag",
        description: "Output as JSONL",
    },
    help: {
        type: "flag",
        alias: "h",
        description: "Show this help message",
    },
};
function printHelp() {
    var usage = "Usage: pi-agent [options] [messages...]\n\nExamples:\n# Single message (default OpenAI, GPT-5 Mini, OPENAI_API_KEY env var)\npi-agent \"What is 2+2?\"\n\n# Multiple messages processed sequentially\npi-agent \"What is 2+2?\" \"What about 3+3?\"\n\n# Interactive chat mode (no messages = interactive)\npi-agent\n\n# Continue most recently modified session in current directory\npi-agent --continue \"Follow up question\"\n\n# GPT-OSS via Groq\npi-agent --base-url https://api.groq.com/openai/v1 --api-key $GROQ_API_KEY --model openai/gpt-oss-120b\n\n# GLM 4.5 via OpenRouter\npi-agent --base-url https://openrouter.ai/api/v1 --api-key $OPENROUTER_API_KEY --model z-ai/glm-4.5\n\n# Claude via Anthropic (no prompt caching support - see https://docs.anthropic.com/en/api/openai-sdk)\npi-agent --base-url https://api.anthropic.com/v1 --api-key $ANTHROPIC_API_KEY --model claude-opus-4-1-20250805";
    (0, args_js_1.printHelp)(argDefs, usage);
}
function runJsonInteractiveMode(config, sessionManager) {
    return __awaiter(this, void 0, void 0, function () {
        var rl, renderer, agent, isProcessing, pendingMessage, processMessage;
        var _this = this;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    rl = (0, readline_1.createInterface)({
                        input: process.stdin,
                        output: process.stdout,
                        terminal: false, // Don't interpret control characters
                    });
                    renderer = new json_renderer_js_1.JsonRenderer();
                    agent = new agent_js_1.Agent(config, renderer, sessionManager);
                    isProcessing = false;
                    pendingMessage = null;
                    processMessage = function (content) { return __awaiter(_this, void 0, void 0, function () {
                        var e_1, msg;
                        return __generator(this, function (_a) {
                            switch (_a.label) {
                                case 0:
                                    isProcessing = true;
                                    _a.label = 1;
                                case 1:
                                    _a.trys.push([1, 3, 5, 8]);
                                    return [4 /*yield*/, agent.ask(content)];
                                case 2:
                                    _a.sent();
                                    return [3 /*break*/, 8];
                                case 3:
                                    e_1 = _a.sent();
                                    return [4 /*yield*/, renderer.on({ type: "error", message: e_1.message })];
                                case 4:
                                    _a.sent();
                                    return [3 /*break*/, 8];
                                case 5:
                                    isProcessing = false;
                                    if (!pendingMessage) return [3 /*break*/, 7];
                                    msg = pendingMessage;
                                    pendingMessage = null;
                                    return [4 /*yield*/, processMessage(msg)];
                                case 6:
                                    _a.sent();
                                    _a.label = 7;
                                case 7: return [7 /*endfinally*/];
                                case 8: return [2 /*return*/];
                            }
                        });
                    }); };
                    // Listen for lines from stdin
                    rl.on("line", function (line) {
                        try {
                            var command = JSON.parse(line);
                            switch (command.type) {
                                case "interrupt":
                                    agent.interrupt();
                                    isProcessing = false;
                                    break;
                                case "message":
                                    if (!command.content) {
                                        renderer.on({ type: "error", message: "Message content is required" });
                                        return;
                                    }
                                    if (isProcessing) {
                                        // Queue the message for when the agent is done
                                        pendingMessage = command.content;
                                    }
                                    else {
                                        processMessage(command.content);
                                    }
                                    break;
                                default:
                                    renderer.on({ type: "error", message: "Unknown command type: ".concat(command.type) });
                            }
                        }
                        catch (e) {
                            renderer.on({ type: "error", message: "Invalid JSON: ".concat(e) });
                        }
                    });
                    // Wait for stdin to close
                    return [4 /*yield*/, new Promise(function (resolve) {
                            rl.on("close", function () {
                                resolve();
                            });
                        })];
                case 1:
                    // Wait for stdin to close
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    });
}
function runTuiInteractiveMode(agentConfig, sessionManager) {
    return __awaiter(this, void 0, void 0, function () {
        var sessionData, renderer, agent, _i, _a, sessionEvent, event_1, userInput, e_2;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    sessionData = sessionManager.getSessionData();
                    if (sessionData) {
                        console.log(chalk_1.default.dim("Resuming session with ".concat(sessionData.events.length, " events")));
                    }
                    renderer = new tui_renderer_js_1.TuiRenderer();
                    // Initialize TUI BEFORE creating the agent to prevent double init
                    return [4 /*yield*/, renderer.init()];
                case 1:
                    // Initialize TUI BEFORE creating the agent to prevent double init
                    _b.sent();
                    agent = new agent_js_1.Agent(agentConfig, renderer, sessionManager);
                    renderer.setInterruptCallback(function () {
                        agent.interrupt();
                    });
                    if (!sessionData) return [3 /*break*/, 6];
                    agent.setEvents(sessionData ? sessionData.events.map(function (e) { return e.event; }) : []);
                    _i = 0, _a = sessionData.events;
                    _b.label = 2;
                case 2:
                    if (!(_i < _a.length)) return [3 /*break*/, 6];
                    sessionEvent = _a[_i];
                    event_1 = sessionEvent.event;
                    if (!(event_1.type === "assistant_start")) return [3 /*break*/, 3];
                    renderer.renderAssistantLabel();
                    return [3 /*break*/, 5];
                case 3: return [4 /*yield*/, renderer.on(event_1)];
                case 4:
                    _b.sent();
                    _b.label = 5;
                case 5:
                    _i++;
                    return [3 /*break*/, 2];
                case 6:
                    if (!true) return [3 /*break*/, 13];
                    return [4 /*yield*/, renderer.getUserInput()];
                case 7:
                    userInput = _b.sent();
                    _b.label = 8;
                case 8:
                    _b.trys.push([8, 10, , 12]);
                    return [4 /*yield*/, agent.ask(userInput)];
                case 9:
                    _b.sent();
                    return [3 /*break*/, 12];
                case 10:
                    e_2 = _b.sent();
                    return [4 /*yield*/, renderer.on({ type: "error", message: e_2.message })];
                case 11:
                    _b.sent();
                    return [3 /*break*/, 12];
                case 12: return [3 /*break*/, 6];
                case 13: return [2 /*return*/];
            }
        });
    });
}
function runSingleShotMode(agentConfig, sessionManager, messages, jsonOutput) {
    return __awaiter(this, void 0, void 0, function () {
        var sessionData, renderer, agent, _i, messages_1, msg, e_3;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    sessionData = sessionManager.getSessionData();
                    renderer = jsonOutput ? new json_renderer_js_1.JsonRenderer() : new console_renderer_js_1.ConsoleRenderer();
                    agent = new agent_js_1.Agent(agentConfig, renderer, sessionManager);
                    if (sessionData) {
                        if (!jsonOutput) {
                            console.log(chalk_1.default.dim("Resuming session with ".concat(sessionData.events.length, " events")));
                        }
                        agent.setEvents(sessionData ? sessionData.events.map(function (e) { return e.event; }) : []);
                    }
                    _i = 0, messages_1 = messages;
                    _a.label = 1;
                case 1:
                    if (!(_i < messages_1.length)) return [3 /*break*/, 7];
                    msg = messages_1[_i];
                    _a.label = 2;
                case 2:
                    _a.trys.push([2, 4, , 6]);
                    return [4 /*yield*/, agent.ask(msg)];
                case 3:
                    _a.sent();
                    return [3 /*break*/, 6];
                case 4:
                    e_3 = _a.sent();
                    return [4 /*yield*/, renderer.on({ type: "error", message: e_3.message })];
                case 5:
                    _a.sent();
                    return [3 /*break*/, 6];
                case 6:
                    _i++;
                    return [3 /*break*/, 1];
                case 7: return [2 /*return*/];
            }
        });
    });
}
// Main function to use Agent as standalone CLI
function main(args) {
    return __awaiter(this, void 0, void 0, function () {
        var parsed, baseURL, apiKey, model, continueSession, api, systemPrompt, jsonOutput, messages, isInteractive, sessionManager, agentConfig, sessionData;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    parsed = (0, args_js_1.parseArgs)(argDefs, args);
                    // Show help if requested
                    if (parsed.help) {
                        printHelp();
                        return [2 /*return*/];
                    }
                    baseURL = parsed["base-url"];
                    apiKey = parsed["api-key"];
                    model = parsed.model;
                    continueSession = parsed.continue;
                    api = parsed.api;
                    systemPrompt = parsed["system-prompt"];
                    jsonOutput = parsed.json;
                    messages = parsed._;
                    if (!apiKey) {
                        throw new Error("API key required (use --api-key or set OPENAI_API_KEY)");
                    }
                    isInteractive = messages.length === 0;
                    sessionManager = new session_manager_js_1.SessionManager(continueSession);
                    agentConfig = {
                        apiKey: apiKey,
                        baseURL: baseURL,
                        model: model,
                        api: api,
                        systemPrompt: systemPrompt,
                    };
                    if (continueSession) {
                        sessionData = sessionManager.getSessionData();
                        if (sessionData) {
                            agentConfig = __assign(__assign({}, sessionData.config), { apiKey: apiKey });
                        }
                    }
                    if (!isInteractive) return [3 /*break*/, 5];
                    if (!jsonOutput) return [3 /*break*/, 2];
                    return [4 /*yield*/, runJsonInteractiveMode(agentConfig, sessionManager)];
                case 1:
                    _a.sent();
                    return [3 /*break*/, 4];
                case 2: return [4 /*yield*/, runTuiInteractiveMode(agentConfig, sessionManager)];
                case 3:
                    _a.sent();
                    _a.label = 4;
                case 4: return [3 /*break*/, 7];
                case 5: return [4 /*yield*/, runSingleShotMode(agentConfig, sessionManager, messages, jsonOutput)];
                case 6:
                    _a.sent();
                    _a.label = 7;
                case 7: return [2 /*return*/];
            }
        });
    });
}
