"use strict";
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
exports.ConsoleRenderer = void 0;
var chalk_1 = require("chalk");
var ConsoleRenderer = /** @class */ (function () {
    function ConsoleRenderer() {
        this.frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
        this.currentFrame = 0;
        this.animationInterval = null;
        this.isAnimating = false;
        this.animationLine = "";
        this.isTTY = process.stdout.isTTY;
        this.toolCallCount = 0;
        this.lastInputTokens = 0;
        this.lastOutputTokens = 0;
        this.lastCacheReadTokens = 0;
        this.lastCacheWriteTokens = 0;
        this.lastReasoningTokens = 0;
    }
    ConsoleRenderer.prototype.startAnimation = function (text) {
        var _this = this;
        if (text === void 0) { text = "Thinking"; }
        if (this.isAnimating || !this.isTTY)
            return;
        this.isAnimating = true;
        this.currentFrame = 0;
        // Write initial frame
        this.animationLine = "".concat(chalk_1.default.cyan(this.frames[this.currentFrame]), " ").concat(chalk_1.default.dim(text));
        process.stdout.write(this.animationLine);
        this.animationInterval = setInterval(function () {
            // Clear current line
            process.stdout.write("\r".concat(" ".repeat(_this.animationLine.length), "\r"));
            // Update frame
            _this.currentFrame = (_this.currentFrame + 1) % _this.frames.length;
            _this.animationLine = "".concat(chalk_1.default.cyan(_this.frames[_this.currentFrame]), " ").concat(chalk_1.default.dim(text));
            process.stdout.write(_this.animationLine);
        }, 80);
    };
    ConsoleRenderer.prototype.stopAnimation = function () {
        if (!this.isAnimating)
            return;
        if (this.animationInterval) {
            clearInterval(this.animationInterval);
            this.animationInterval = null;
        }
        // Clear the animation line
        process.stdout.write("\r".concat(" ".repeat(this.animationLine.length), "\r"));
        this.isAnimating = false;
        this.animationLine = "";
    };
    ConsoleRenderer.prototype.displayMetrics = function () {
        // Build metrics display
        var metricsText = chalk_1.default.dim("\u2191".concat(this.lastInputTokens.toLocaleString(), " \u2193").concat(this.lastOutputTokens.toLocaleString()));
        // Add reasoning tokens if present
        if (this.lastReasoningTokens > 0) {
            metricsText += chalk_1.default.dim(" \u26A1".concat(this.lastReasoningTokens.toLocaleString()));
        }
        // Add cache info if available
        if (this.lastCacheReadTokens > 0 || this.lastCacheWriteTokens > 0) {
            var cacheText = [];
            if (this.lastCacheReadTokens > 0) {
                cacheText.push("\u27F2".concat(this.lastCacheReadTokens.toLocaleString()));
            }
            if (this.lastCacheWriteTokens > 0) {
                cacheText.push("\u27F3".concat(this.lastCacheWriteTokens.toLocaleString()));
            }
            metricsText += chalk_1.default.dim(" (".concat(cacheText.join(" "), ")"));
        }
        // Add tool call count
        if (this.toolCallCount > 0) {
            metricsText += chalk_1.default.dim(" \u2692 ".concat(this.toolCallCount));
        }
        console.log(metricsText);
        console.log();
    };
    ConsoleRenderer.prototype.on = function (event) {
        return __awaiter(this, void 0, void 0, function () {
            var lines, maxLines, truncated, toShow, text;
            return __generator(this, function (_a) {
                // Stop animation for any new event except token_usage
                if (event.type !== "token_usage" && this.isAnimating) {
                    this.stopAnimation();
                }
                switch (event.type) {
                    case "session_start":
                        console.log(chalk_1.default.blue("[Session started] ID: ".concat(event.sessionId, ", Model: ").concat(event.model, ", API: ").concat(event.api, ", Base URL: ").concat(event.baseURL)));
                        console.log(chalk_1.default.dim("System Prompt: ".concat(event.systemPrompt, "\n")));
                        break;
                    case "assistant_start":
                        console.log(chalk_1.default.hex("#FFA500")("[assistant]"));
                        this.startAnimation();
                        break;
                    case "reasoning":
                        this.stopAnimation();
                        console.log(chalk_1.default.dim("[thinking]"));
                        console.log(chalk_1.default.dim(event.text));
                        console.log();
                        // Resume animation after showing thinking
                        this.startAnimation("Processing");
                        break;
                    case "tool_call":
                        this.stopAnimation();
                        this.toolCallCount++;
                        console.log(chalk_1.default.yellow("[tool] ".concat(event.name, "(").concat(event.args, ")")));
                        // Resume animation while tool executes
                        this.startAnimation("Running ".concat(event.name));
                        break;
                    case "tool_result": {
                        this.stopAnimation();
                        lines = event.result.split("\n");
                        maxLines = 10;
                        truncated = lines.length > maxLines;
                        toShow = truncated ? lines.slice(0, maxLines) : lines;
                        text = toShow.join("\n");
                        console.log(event.isError ? chalk_1.default.red(text) : chalk_1.default.gray(text));
                        if (truncated) {
                            console.log(chalk_1.default.dim("... (".concat(lines.length - maxLines, " more lines)")));
                        }
                        console.log();
                        // Resume animation after tool result
                        this.startAnimation("Thinking");
                        break;
                    }
                    case "assistant_message":
                        this.stopAnimation();
                        console.log(event.text);
                        console.log();
                        // Display metrics after assistant message
                        this.displayMetrics();
                        break;
                    case "error":
                        this.stopAnimation();
                        console.error(chalk_1.default.red("[error] ".concat(event.message, "\n")));
                        break;
                    case "user_message":
                        console.log(chalk_1.default.green("[user]"));
                        console.log(event.text);
                        console.log();
                        break;
                    case "interrupted":
                        this.stopAnimation();
                        console.log(chalk_1.default.red("[Interrupted by user]\n"));
                        break;
                    case "token_usage":
                        // Store token usage for display after assistant message
                        this.lastInputTokens = event.inputTokens;
                        this.lastOutputTokens = event.outputTokens;
                        this.lastCacheReadTokens = event.cacheReadTokens;
                        this.lastCacheWriteTokens = event.cacheWriteTokens;
                        this.lastReasoningTokens = event.reasoningTokens;
                        // Don't stop animation for this event
                        break;
                }
                return [2 /*return*/];
            });
        });
    };
    return ConsoleRenderer;
}());
exports.ConsoleRenderer = ConsoleRenderer;
