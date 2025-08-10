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
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Agent = void 0;
exports.callModelResponsesApi = callModelResponsesApi;
exports.callModelChatCompletionsApi = callModelChatCompletionsApi;
var openai_1 = require("openai");
var tools_js_1 = require("./tools/tools.js");
// Cache for model reasoning support detection per API type
var modelReasoningSupport = new Map();
// Provider detection based on base URL
function detectProvider(baseURL) {
    if (!baseURL)
        return "openai";
    if (baseURL.includes("api.openai.com"))
        return "openai";
    if (baseURL.includes("generativelanguage.googleapis.com"))
        return "gemini";
    if (baseURL.includes("api.groq.com"))
        return "groq";
    if (baseURL.includes("api.anthropic.com"))
        return "anthropic";
    if (baseURL.includes("openrouter.ai"))
        return "openrouter";
    return "other";
}
// Parse provider-specific reasoning from message content
function parseReasoningFromMessage(message, baseURL) {
    var provider = detectProvider(baseURL);
    var reasoningTexts = [];
    var cleanContent = message.content || "";
    switch (provider) {
        case "gemini":
            // Gemini returns thinking in <thought> tags
            if (cleanContent.includes("<thought>")) {
                var thoughtMatches = cleanContent.matchAll(/<thought>([\s\S]*?)<\/thought>/g);
                for (var _i = 0, thoughtMatches_1 = thoughtMatches; _i < thoughtMatches_1.length; _i++) {
                    var match = thoughtMatches_1[_i];
                    reasoningTexts.push(match[1].trim());
                }
                // Remove all thought tags from the response
                cleanContent = cleanContent.replace(/<thought>[\s\S]*?<\/thought>/g, "").trim();
            }
            break;
        case "groq":
            // Groq returns reasoning in a separate field when reasoning_format is "parsed"
            if (message.reasoning) {
                reasoningTexts.push(message.reasoning);
            }
            break;
        case "openrouter":
            // OpenRouter returns reasoning in message.reasoning field
            if (message.reasoning) {
                reasoningTexts.push(message.reasoning);
            }
            break;
        default:
            // Other providers don't embed reasoning in message content
            break;
    }
    return { cleanContent: cleanContent, reasoningTexts: reasoningTexts };
}
// Adjust request options based on provider-specific requirements
function adjustRequestForProvider(requestOptions, api, baseURL, supportsReasoning) {
    var provider = detectProvider(baseURL);
    // Handle provider-specific adjustments
    switch (provider) {
        case "gemini":
            if (api === "completions" && supportsReasoning && requestOptions.reasoning_effort) {
                // Gemini needs extra_body for thinking content
                // Can't use both reasoning_effort and thinking_config
                var budget = requestOptions.reasoning_effort === "low"
                    ? 1024
                    : requestOptions.reasoning_effort === "medium"
                        ? 8192
                        : 24576;
                requestOptions.extra_body = {
                    google: {
                        thinking_config: {
                            thinking_budget: budget,
                            include_thoughts: true,
                        },
                    },
                };
                // Remove reasoning_effort when using thinking_config
                delete requestOptions.reasoning_effort;
            }
            break;
        case "groq":
            if (api === "responses" && requestOptions.reasoning) {
                // Groq responses API doesn't support reasoning.summary
                delete requestOptions.reasoning.summary;
            }
            else if (api === "completions" && supportsReasoning && requestOptions.reasoning_effort) {
                // Groq Chat Completions uses reasoning_format instead of reasoning_effort alone
                requestOptions.reasoning_format = "parsed";
                // Keep reasoning_effort for Groq
            }
            break;
        case "anthropic":
            // Anthropic's OpenAI compatibility has its own quirks
            // But thinking content isn't available via OpenAI compat layer
            break;
        case "openrouter":
            // OpenRouter uses a unified reasoning parameter format
            if (api === "completions" && supportsReasoning && requestOptions.reasoning_effort) {
                // Convert reasoning_effort to OpenRouter's reasoning format
                requestOptions.reasoning = {
                    effort: requestOptions.reasoning_effort === "low"
                        ? "low"
                        : requestOptions.reasoning_effort === "minimal"
                            ? "low"
                            : requestOptions.reasoning_effort === "medium"
                                ? "medium"
                                : "high",
                };
                delete requestOptions.reasoning_effort;
            }
            break;
        default:
            // OpenAI and others use standard format
            break;
    }
    return requestOptions;
}
function checkReasoningSupport(client, model, api, baseURL) {
    return __awaiter(this, void 0, void 0, function () {
        var cacheKey, cached, supportsReasoning, provider, testRequest, error_1, testRequest, error_2, existing;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    cacheKey = model;
                    cached = modelReasoningSupport.get(cacheKey);
                    if (cached && cached[api] !== undefined) {
                        return [2 /*return*/, cached[api]];
                    }
                    supportsReasoning = false;
                    provider = detectProvider(baseURL);
                    if (!(api === "responses")) return [3 /*break*/, 5];
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 3, , 4]);
                    testRequest = {
                        model: model,
                        input: "test",
                        max_output_tokens: 1024,
                        reasoning: {
                            effort: "low", // Use low instead of minimal to ensure we get summaries
                        },
                    };
                    return [4 /*yield*/, client.responses.create(testRequest)];
                case 2:
                    _a.sent();
                    supportsReasoning = true;
                    return [3 /*break*/, 4];
                case 3:
                    error_1 = _a.sent();
                    supportsReasoning = false;
                    return [3 /*break*/, 4];
                case 4: return [3 /*break*/, 8];
                case 5:
                    _a.trys.push([5, 7, , 8]);
                    testRequest = {
                        model: model,
                        messages: [{ role: "user", content: "test" }],
                        max_completion_tokens: 1024,
                    };
                    // Add provider-specific reasoning parameters
                    if (provider === "gemini") {
                        // Gemini uses extra_body for thinking
                        testRequest.extra_body = {
                            google: {
                                thinking_config: {
                                    thinking_budget: 100, // Minimum viable budget for test
                                    include_thoughts: true,
                                },
                            },
                        };
                    }
                    else if (provider === "groq") {
                        // Groq uses both reasoning_format and reasoning_effort
                        testRequest.reasoning_format = "parsed";
                        testRequest.reasoning_effort = "low";
                    }
                    else {
                        // Others use reasoning_effort
                        testRequest.reasoning_effort = "minimal";
                    }
                    return [4 /*yield*/, client.chat.completions.create(testRequest)];
                case 6:
                    _a.sent();
                    supportsReasoning = true;
                    return [3 /*break*/, 8];
                case 7:
                    error_2 = _a.sent();
                    supportsReasoning = false;
                    return [3 /*break*/, 8];
                case 8:
                    existing = modelReasoningSupport.get(cacheKey) || {};
                    existing[api] = supportsReasoning;
                    modelReasoningSupport.set(cacheKey, existing);
                    return [2 /*return*/, supportsReasoning];
            }
        });
    });
}
function callModelResponsesApi(client, model, messages, signal, eventReceiver, supportsReasoning, baseURL) {
    return __awaiter(this, void 0, void 0, function () {
        var conversationDone, requestOptions, response, usage, output, _i, output_1, item, type, message, _a, reasoningItems, _b, reasoningItems_1, content, _c, _d, content, result, toolResultMsg, e_1, errorMsg;
        var _e, _f;
        return __generator(this, function (_g) {
            switch (_g.label) {
                case 0:
                    conversationDone = false;
                    _g.label = 1;
                case 1:
                    if (!!conversationDone) return [3 /*break*/, 31];
                    if (!(signal === null || signal === void 0 ? void 0 : signal.aborted)) return [3 /*break*/, 3];
                    return [4 /*yield*/, (eventReceiver === null || eventReceiver === void 0 ? void 0 : eventReceiver.on({ type: "interrupted" }))];
                case 2:
                    _g.sent();
                    throw new Error("Interrupted");
                case 3:
                    requestOptions = __assign({ model: model, input: messages, tools: tools_js_1.toolsForResponses, tool_choice: "auto", parallel_tool_calls: true, max_output_tokens: 2000 }, (supportsReasoning && {
                        reasoning: {
                            effort: "minimal", // Use minimal effort for responses API
                            summary: "detailed", // Request detailed reasoning summaries
                        },
                    }));
                    // Apply provider-specific adjustments
                    requestOptions = adjustRequestForProvider(requestOptions, "responses", baseURL, supportsReasoning);
                    return [4 /*yield*/, client.responses.create(requestOptions, { signal: signal })];
                case 4:
                    response = _g.sent();
                    // Report token usage if available (responses API format)
                    if (response.usage) {
                        usage = response.usage;
                        eventReceiver === null || eventReceiver === void 0 ? void 0 : eventReceiver.on({
                            type: "token_usage",
                            inputTokens: usage.input_tokens || 0,
                            outputTokens: usage.output_tokens || 0,
                            totalTokens: usage.total_tokens || 0,
                            cacheReadTokens: ((_e = usage.input_tokens_details) === null || _e === void 0 ? void 0 : _e.cached_tokens) || 0,
                            cacheWriteTokens: 0, // Not available in API
                            reasoningTokens: ((_f = usage.output_tokens_details) === null || _f === void 0 ? void 0 : _f.reasoning_tokens) || 0,
                        });
                    }
                    output = response.output;
                    if (!output)
                        return [3 /*break*/, 31];
                    _i = 0, output_1 = output;
                    _g.label = 5;
                case 5:
                    if (!(_i < output_1.length)) return [3 /*break*/, 30];
                    item = output_1[_i];
                    // gpt-oss vLLM quirk: need to remove type from "message" events
                    if (item.id === "message") {
                        type = item.type, message = __rest(item, ["type"]);
                        messages.push(item);
                    }
                    else {
                        messages.push(item);
                    }
                    _a = item.type;
                    switch (_a) {
                        case "reasoning": return [3 /*break*/, 6];
                        case "message": return [3 /*break*/, 11];
                        case "function_call": return [3 /*break*/, 19];
                    }
                    return [3 /*break*/, 28];
                case 6:
                    reasoningItems = item.content || item.summary || [];
                    _b = 0, reasoningItems_1 = reasoningItems;
                    _g.label = 7;
                case 7:
                    if (!(_b < reasoningItems_1.length)) return [3 /*break*/, 10];
                    content = reasoningItems_1[_b];
                    if (!(content.type === "reasoning_text" || content.type === "summary_text")) return [3 /*break*/, 9];
                    return [4 /*yield*/, (eventReceiver === null || eventReceiver === void 0 ? void 0 : eventReceiver.on({ type: "reasoning", text: content.text }))];
                case 8:
                    _g.sent();
                    _g.label = 9;
                case 9:
                    _b++;
                    return [3 /*break*/, 7];
                case 10: return [3 /*break*/, 29];
                case 11:
                    _c = 0, _d = item.content || [];
                    _g.label = 12;
                case 12:
                    if (!(_c < _d.length)) return [3 /*break*/, 18];
                    content = _d[_c];
                    if (!(content.type === "output_text")) return [3 /*break*/, 14];
                    return [4 /*yield*/, (eventReceiver === null || eventReceiver === void 0 ? void 0 : eventReceiver.on({ type: "assistant_message", text: content.text }))];
                case 13:
                    _g.sent();
                    return [3 /*break*/, 16];
                case 14:
                    if (!(content.type === "refusal")) return [3 /*break*/, 16];
                    return [4 /*yield*/, (eventReceiver === null || eventReceiver === void 0 ? void 0 : eventReceiver.on({ type: "error", message: "Refusal: ".concat(content.refusal) }))];
                case 15:
                    _g.sent();
                    _g.label = 16;
                case 16:
                    conversationDone = true;
                    _g.label = 17;
                case 17:
                    _c++;
                    return [3 /*break*/, 12];
                case 18: return [3 /*break*/, 29];
                case 19:
                    if (!(signal === null || signal === void 0 ? void 0 : signal.aborted)) return [3 /*break*/, 21];
                    return [4 /*yield*/, (eventReceiver === null || eventReceiver === void 0 ? void 0 : eventReceiver.on({ type: "interrupted" }))];
                case 20:
                    _g.sent();
                    throw new Error("Interrupted");
                case 21:
                    _g.trys.push([21, 25, , 27]);
                    return [4 /*yield*/, (eventReceiver === null || eventReceiver === void 0 ? void 0 : eventReceiver.on({
                            type: "tool_call",
                            toolCallId: item.call_id || "",
                            name: item.name,
                            args: item.arguments,
                        }))];
                case 22:
                    _g.sent();
                    return [4 /*yield*/, (0, tools_js_1.executeTool)(item.name, item.arguments, signal)];
                case 23:
                    result = _g.sent();
                    return [4 /*yield*/, (eventReceiver === null || eventReceiver === void 0 ? void 0 : eventReceiver.on({
                            type: "tool_result",
                            toolCallId: item.call_id || "",
                            result: result,
                            isError: false,
                        }))];
                case 24:
                    _g.sent();
                    toolResultMsg = {
                        type: "function_call_output",
                        call_id: item.call_id,
                        output: result,
                    };
                    messages.push(toolResultMsg);
                    return [3 /*break*/, 27];
                case 25:
                    e_1 = _g.sent();
                    return [4 /*yield*/, (eventReceiver === null || eventReceiver === void 0 ? void 0 : eventReceiver.on({
                            type: "tool_result",
                            toolCallId: item.call_id || "",
                            result: e_1.message,
                            isError: true,
                        }))];
                case 26:
                    _g.sent();
                    errorMsg = {
                        type: "function_call_output",
                        call_id: item.id,
                        output: e_1.message,
                        isError: true,
                    };
                    messages.push(errorMsg);
                    return [3 /*break*/, 27];
                case 27: return [3 /*break*/, 29];
                case 28:
                    {
                        eventReceiver === null || eventReceiver === void 0 ? void 0 : eventReceiver.on({ type: "error", message: "Unknown output type in LLM response: ".concat(item.type) });
                        return [3 /*break*/, 29];
                    }
                    _g.label = 29;
                case 29:
                    _i++;
                    return [3 /*break*/, 5];
                case 30: return [3 /*break*/, 1];
                case 31: return [2 /*return*/];
            }
        });
    });
}
function callModelChatCompletionsApi(client, model, messages, signal, eventReceiver, supportsReasoning, baseURL) {
    return __awaiter(this, void 0, void 0, function () {
        var assistantResponded, requestOptions, response, message, usage, assistantMsg, _i, _a, toolCall, funcName, funcArgs, result, toolMsg, e_2, errorMsg, _b, cleanContent, reasoningTexts, _c, reasoningTexts_1, reasoning, finalMsg;
        var _d, _e;
        return __generator(this, function (_f) {
            switch (_f.label) {
                case 0:
                    assistantResponded = false;
                    _f.label = 1;
                case 1:
                    if (!!assistantResponded) return [3 /*break*/, 23];
                    if (!(signal === null || signal === void 0 ? void 0 : signal.aborted)) return [3 /*break*/, 3];
                    return [4 /*yield*/, (eventReceiver === null || eventReceiver === void 0 ? void 0 : eventReceiver.on({ type: "interrupted" }))];
                case 2:
                    _f.sent();
                    throw new Error("Interrupted");
                case 3:
                    requestOptions = __assign({ model: model, messages: messages, tools: tools_js_1.toolsForChat, tool_choice: "auto", max_completion_tokens: 2000 }, (supportsReasoning && {
                        reasoning_effort: "low", // Use low effort for completions API
                    }));
                    // Apply provider-specific adjustments
                    requestOptions = adjustRequestForProvider(requestOptions, "completions", baseURL, supportsReasoning);
                    return [4 /*yield*/, client.chat.completions.create(requestOptions, { signal: signal })];
                case 4:
                    response = _f.sent();
                    message = response.choices[0].message;
                    if (!response.usage) return [3 /*break*/, 6];
                    usage = response.usage;
                    return [4 /*yield*/, (eventReceiver === null || eventReceiver === void 0 ? void 0 : eventReceiver.on({
                            type: "token_usage",
                            inputTokens: usage.prompt_tokens || 0,
                            outputTokens: usage.completion_tokens || 0,
                            totalTokens: usage.total_tokens || 0,
                            cacheReadTokens: ((_d = usage.prompt_tokens_details) === null || _d === void 0 ? void 0 : _d.cached_tokens) || 0,
                            cacheWriteTokens: 0, // Not available in API
                            reasoningTokens: ((_e = usage.completion_tokens_details) === null || _e === void 0 ? void 0 : _e.reasoning_tokens) || 0,
                        }))];
                case 5:
                    _f.sent();
                    _f.label = 6;
                case 6:
                    if (!(message.tool_calls && message.tool_calls.length > 0)) return [3 /*break*/, 16];
                    assistantMsg = {
                        role: "assistant",
                        content: message.content || null,
                        tool_calls: message.tool_calls,
                    };
                    messages.push(assistantMsg);
                    _i = 0, _a = message.tool_calls;
                    _f.label = 7;
                case 7:
                    if (!(_i < _a.length)) return [3 /*break*/, 15];
                    toolCall = _a[_i];
                    if (!(signal === null || signal === void 0 ? void 0 : signal.aborted)) return [3 /*break*/, 9];
                    return [4 /*yield*/, (eventReceiver === null || eventReceiver === void 0 ? void 0 : eventReceiver.on({ type: "interrupted" }))];
                case 8:
                    _f.sent();
                    throw new Error("Interrupted");
                case 9:
                    _f.trys.push([9, 13, , 14]);
                    funcName = toolCall.type === "function" ? toolCall.function.name : toolCall.custom.name;
                    funcArgs = toolCall.type === "function" ? toolCall.function.arguments : toolCall.custom.input;
                    return [4 /*yield*/, (eventReceiver === null || eventReceiver === void 0 ? void 0 : eventReceiver.on({ type: "tool_call", toolCallId: toolCall.id, name: funcName, args: funcArgs }))];
                case 10:
                    _f.sent();
                    return [4 /*yield*/, (0, tools_js_1.executeTool)(funcName, funcArgs, signal)];
                case 11:
                    result = _f.sent();
                    return [4 /*yield*/, (eventReceiver === null || eventReceiver === void 0 ? void 0 : eventReceiver.on({ type: "tool_result", toolCallId: toolCall.id, result: result, isError: false }))];
                case 12:
                    _f.sent();
                    toolMsg = {
                        role: "tool",
                        tool_call_id: toolCall.id,
                        content: result,
                    };
                    messages.push(toolMsg);
                    return [3 /*break*/, 14];
                case 13:
                    e_2 = _f.sent();
                    eventReceiver === null || eventReceiver === void 0 ? void 0 : eventReceiver.on({ type: "tool_result", toolCallId: toolCall.id, result: e_2.message, isError: true });
                    errorMsg = {
                        role: "tool",
                        tool_call_id: toolCall.id,
                        content: e_2.message,
                    };
                    messages.push(errorMsg);
                    return [3 /*break*/, 14];
                case 14:
                    _i++;
                    return [3 /*break*/, 7];
                case 15: return [3 /*break*/, 22];
                case 16:
                    if (!message.content) return [3 /*break*/, 22];
                    _b = parseReasoningFromMessage(message, baseURL), cleanContent = _b.cleanContent, reasoningTexts = _b.reasoningTexts;
                    _c = 0, reasoningTexts_1 = reasoningTexts;
                    _f.label = 17;
                case 17:
                    if (!(_c < reasoningTexts_1.length)) return [3 /*break*/, 20];
                    reasoning = reasoningTexts_1[_c];
                    return [4 /*yield*/, (eventReceiver === null || eventReceiver === void 0 ? void 0 : eventReceiver.on({ type: "reasoning", text: reasoning }))];
                case 18:
                    _f.sent();
                    _f.label = 19;
                case 19:
                    _c++;
                    return [3 /*break*/, 17];
                case 20: 
                // Emit the cleaned assistant message
                return [4 /*yield*/, (eventReceiver === null || eventReceiver === void 0 ? void 0 : eventReceiver.on({ type: "assistant_message", text: cleanContent }))];
                case 21:
                    // Emit the cleaned assistant message
                    _f.sent();
                    finalMsg = { role: "assistant", content: cleanContent };
                    messages.push(finalMsg);
                    assistantResponded = true;
                    _f.label = 22;
                case 22: return [3 /*break*/, 1];
                case 23: return [2 /*return*/];
            }
        });
    });
}
var Agent = /** @class */ (function () {
    function Agent(config, renderer, sessionManager) {
        var _this = this;
        this.messages = [];
        this.abortController = null;
        this.supportsReasoning = null;
        this.config = config;
        this.client = new openai_1.default({
            apiKey: config.apiKey,
            baseURL: config.baseURL,
        });
        // Use provided renderer or default to console
        this.renderer = renderer;
        this.sessionManager = sessionManager;
        this.comboReceiver = {
            on: function (event) { return __awaiter(_this, void 0, void 0, function () {
                var _a, _b;
                return __generator(this, function (_c) {
                    switch (_c.label) {
                        case 0: return [4 /*yield*/, ((_a = this.renderer) === null || _a === void 0 ? void 0 : _a.on(event))];
                        case 1:
                            _c.sent();
                            return [4 /*yield*/, ((_b = this.sessionManager) === null || _b === void 0 ? void 0 : _b.on(event))];
                        case 2:
                            _c.sent();
                            return [2 /*return*/];
                    }
                });
            }); },
        };
        // Initialize with system prompt if provided
        if (config.systemPrompt) {
            this.messages.push({ role: "system", content: config.systemPrompt });
        }
        // Start session logging if we have a session manager
        if (sessionManager) {
            sessionManager.startSession(this.config);
            // Emit session_start event
            this.comboReceiver.on({
                type: "session_start",
                sessionId: sessionManager.getSessionId(),
                model: config.model,
                api: config.api,
                baseURL: config.baseURL,
                systemPrompt: config.systemPrompt,
            });
        }
    }
    Agent.prototype.ask = function (userMessage) {
        return __awaiter(this, void 0, void 0, function () {
            var userMsg, _a, e_3, errorMessage;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        // Render user message through the event system
                        this.comboReceiver.on({ type: "user_message", text: userMessage });
                        userMsg = { role: "user", content: userMessage };
                        this.messages.push(userMsg);
                        // Create a new AbortController for this chat session
                        this.abortController = new AbortController();
                        _b.label = 1;
                    case 1:
                        _b.trys.push([1, 9, 10, 11]);
                        return [4 /*yield*/, this.comboReceiver.on({ type: "assistant_start" })];
                    case 2:
                        _b.sent();
                        if (!(this.supportsReasoning === null)) return [3 /*break*/, 4];
                        _a = this;
                        return [4 /*yield*/, checkReasoningSupport(this.client, this.config.model, this.config.api, this.config.baseURL)];
                    case 3:
                        _a.supportsReasoning = _b.sent();
                        _b.label = 4;
                    case 4:
                        if (!(this.config.api === "responses")) return [3 /*break*/, 6];
                        return [4 /*yield*/, callModelResponsesApi(this.client, this.config.model, this.messages, this.abortController.signal, this.comboReceiver, this.supportsReasoning, this.config.baseURL)];
                    case 5:
                        _b.sent();
                        return [3 /*break*/, 8];
                    case 6: return [4 /*yield*/, callModelChatCompletionsApi(this.client, this.config.model, this.messages, this.abortController.signal, this.comboReceiver, this.supportsReasoning, this.config.baseURL)];
                    case 7:
                        _b.sent();
                        _b.label = 8;
                    case 8: return [3 /*break*/, 11];
                    case 9:
                        e_3 = _b.sent();
                        errorMessage = e_3 instanceof Error ? e_3.message : String(e_3);
                        if (errorMessage === "Interrupted" || this.abortController.signal.aborted) {
                            return [2 /*return*/];
                        }
                        throw e_3;
                    case 10:
                        this.abortController = null;
                        return [7 /*endfinally*/];
                    case 11: return [2 /*return*/];
                }
            });
        });
    };
    Agent.prototype.interrupt = function () {
        var _a;
        (_a = this.abortController) === null || _a === void 0 ? void 0 : _a.abort();
    };
    Agent.prototype.setEvents = function (events) {
        // Reconstruct messages from events based on API type
        this.messages = [];
        if (this.config.api === "responses") {
            // Responses API format
            if (this.config.systemPrompt) {
                this.messages.push({
                    type: "system",
                    content: [{ type: "system_text", text: this.config.systemPrompt }],
                });
            }
            for (var _i = 0, events_1 = events; _i < events_1.length; _i++) {
                var event_1 = events_1[_i];
                switch (event_1.type) {
                    case "user_message":
                        this.messages.push({
                            type: "user",
                            content: [{ type: "input_text", text: event_1.text }],
                        });
                        break;
                    case "reasoning":
                        // Add reasoning message
                        this.messages.push({
                            type: "reasoning",
                            content: [{ type: "reasoning_text", text: event_1.text }],
                        });
                        break;
                    case "tool_call":
                        // Add function call
                        this.messages.push({
                            type: "function_call",
                            id: event_1.toolCallId,
                            name: event_1.name,
                            arguments: event_1.args,
                        });
                        break;
                    case "tool_result":
                        // Add function result
                        this.messages.push({
                            type: "function_call_output",
                            call_id: event_1.toolCallId,
                            output: event_1.result,
                        });
                        break;
                    case "assistant_message":
                        // Add final message
                        this.messages.push({
                            type: "message",
                            content: [{ type: "output_text", text: event_1.text }],
                        });
                        break;
                }
            }
        }
        else {
            // Chat Completions API format
            if (this.config.systemPrompt) {
                this.messages.push({ role: "system", content: this.config.systemPrompt });
            }
            // Track tool calls in progress
            var pendingToolCalls = [];
            for (var _a = 0, events_2 = events; _a < events_2.length; _a++) {
                var event_2 = events_2[_a];
                switch (event_2.type) {
                    case "user_message":
                        this.messages.push({ role: "user", content: event_2.text });
                        break;
                    case "assistant_start":
                        // Reset pending tool calls for new assistant response
                        pendingToolCalls = [];
                        break;
                    case "tool_call":
                        // Accumulate tool calls
                        pendingToolCalls.push({
                            id: event_2.toolCallId,
                            type: "function",
                            function: {
                                name: event_2.name,
                                arguments: event_2.args,
                            },
                        });
                        break;
                    case "tool_result":
                        // When we see the first tool result, add the assistant message with all tool calls
                        if (pendingToolCalls.length > 0) {
                            this.messages.push({
                                role: "assistant",
                                content: null,
                                tool_calls: pendingToolCalls,
                            });
                            pendingToolCalls = [];
                        }
                        // Add the tool result
                        this.messages.push({
                            role: "tool",
                            tool_call_id: event_2.toolCallId,
                            content: event_2.result,
                        });
                        break;
                    case "assistant_message":
                        // Final assistant response (no tool calls)
                        this.messages.push({ role: "assistant", content: event_2.text });
                        break;
                    // Skip other event types (thinking, error, interrupted, token_usage)
                }
            }
        }
    };
    return Agent;
}());
exports.Agent = Agent;
