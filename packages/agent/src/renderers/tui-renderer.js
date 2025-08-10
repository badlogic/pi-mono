"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        if (typeof b !== "function" && b !== null)
            throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
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
exports.TuiRenderer = void 0;
var pi_tui_1 = require("@mariozechner/pi-tui");
var chalk_1 = require("chalk");
var LoadingAnimation = /** @class */ (function (_super) {
    __extends(LoadingAnimation, _super);
    function LoadingAnimation(ui) {
        var _this = _super.call(this, "", { bottom: 1 }) || this;
        _this.frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
        _this.currentFrame = 0;
        _this.intervalId = null;
        _this.ui = null;
        _this.ui = ui;
        _this.start();
        return _this;
    }
    LoadingAnimation.prototype.start = function () {
        var _this = this;
        this.updateDisplay();
        this.intervalId = setInterval(function () {
            _this.currentFrame = (_this.currentFrame + 1) % _this.frames.length;
            _this.updateDisplay();
        }, 80);
    };
    LoadingAnimation.prototype.stop = function () {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    };
    LoadingAnimation.prototype.updateDisplay = function () {
        var frame = this.frames[this.currentFrame];
        this.setText("".concat(chalk_1.default.cyan(frame), " ").concat(chalk_1.default.dim("Thinking...")));
        if (this.ui) {
            this.ui.requestRender();
        }
    };
    return LoadingAnimation;
}(pi_tui_1.TextComponent));
var TuiRenderer = /** @class */ (function () {
    function TuiRenderer() {
        this.isInitialized = false;
        this.currentLoadingAnimation = null;
        this.lastSigintTime = 0;
        this.lastInputTokens = 0;
        this.lastOutputTokens = 0;
        this.lastCacheReadTokens = 0;
        this.lastCacheWriteTokens = 0;
        this.lastReasoningTokens = 0;
        this.toolCallCount = 0;
        this.tokenStatusComponent = null;
        this.ui = new pi_tui_1.TUI();
        this.chatContainer = new pi_tui_1.Container();
        this.statusContainer = new pi_tui_1.Container();
        this.editor = new pi_tui_1.TextEditor();
        this.tokenContainer = new pi_tui_1.Container();
        // Setup autocomplete for file paths and slash commands
        var autocompleteProvider = new pi_tui_1.CombinedAutocompleteProvider([], process.cwd());
        this.editor.setAutocompleteProvider(autocompleteProvider);
    }
    TuiRenderer.prototype.init = function () {
        return __awaiter(this, void 0, void 0, function () {
            var header;
            var _this = this;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (this.isInitialized)
                            return [2 /*return*/];
                        header = new pi_tui_1.TextComponent(chalk_1.default.gray(chalk_1.default.blueBright(">> pi interactive chat <<<")) +
                            "\n" +
                            chalk_1.default.dim("Press Escape to interrupt while processing") +
                            "\n" +
                            chalk_1.default.dim("Press CTRL+C to clear the text editor") +
                            "\n" +
                            chalk_1.default.dim("Press CTRL+C twice quickly to exit"), { bottom: 1 });
                        // Setup UI layout
                        this.ui.addChild(header);
                        this.ui.addChild(this.chatContainer);
                        this.ui.addChild(this.statusContainer);
                        this.ui.addChild(new pi_tui_1.WhitespaceComponent(1));
                        this.ui.addChild(this.editor);
                        this.ui.addChild(this.tokenContainer);
                        this.ui.setFocus(this.editor);
                        // Set up global key handler for Escape and Ctrl+C
                        this.ui.onGlobalKeyPress = function (data) {
                            // Intercept Escape key when processing
                            if (data === "\x1b" && _this.currentLoadingAnimation) {
                                // Call interrupt callback if set
                                if (_this.onInterruptCallback) {
                                    _this.onInterruptCallback();
                                }
                                // Stop the loading animation immediately
                                if (_this.currentLoadingAnimation) {
                                    _this.currentLoadingAnimation.stop();
                                    _this.statusContainer.clear();
                                    _this.currentLoadingAnimation = null;
                                }
                                // Don't show message here - the interrupted event will handle it
                                // Re-enable editor submission
                                _this.editor.disableSubmit = false;
                                _this.ui.requestRender();
                                // Don't forward to editor
                                return false;
                            }
                            // Handle Ctrl+C (raw mode sends \x03)
                            if (data === "\x03") {
                                var now = Date.now();
                                var timeSinceLastCtrlC = now - _this.lastSigintTime;
                                if (timeSinceLastCtrlC < 500) {
                                    // Second Ctrl+C within 500ms - exit
                                    _this.stop();
                                    process.exit(0);
                                }
                                else {
                                    // First Ctrl+C - clear the editor
                                    _this.clearEditor();
                                    _this.lastSigintTime = now;
                                }
                                // Don't forward to editor
                                return false;
                            }
                            // Forward all other keys
                            return true;
                        };
                        // Handle editor submission
                        this.editor.onSubmit = function (text) {
                            text = text.trim();
                            if (!text)
                                return;
                            if (_this.onInputCallback) {
                                _this.onInputCallback(text);
                            }
                        };
                        // Start the UI
                        return [4 /*yield*/, this.ui.start()];
                    case 1:
                        // Start the UI
                        _a.sent();
                        this.isInitialized = true;
                        return [2 /*return*/];
                }
            });
        });
    };
    TuiRenderer.prototype.on = function (event) {
        return __awaiter(this, void 0, void 0, function () {
            var thinkingContainer, thinkingLines, _i, thinkingLines_1, line, lines, maxLines, truncated, toShow, resultContainer, _a, toShow_1, line;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        if (!!this.isInitialized) return [3 /*break*/, 2];
                        return [4 /*yield*/, this.init()];
                    case 1:
                        _b.sent();
                        _b.label = 2;
                    case 2:
                        switch (event.type) {
                            case "assistant_start":
                                this.chatContainer.addChild(new pi_tui_1.TextComponent(chalk_1.default.hex("#FFA500")("[assistant]")));
                                // Disable editor submission while processing
                                this.editor.disableSubmit = true;
                                // Start loading animation in the status container
                                this.statusContainer.clear();
                                this.currentLoadingAnimation = new LoadingAnimation(this.ui);
                                this.statusContainer.addChild(this.currentLoadingAnimation);
                                break;
                            case "reasoning": {
                                thinkingContainer = new pi_tui_1.Container();
                                thinkingContainer.addChild(new pi_tui_1.TextComponent(chalk_1.default.dim("[thinking]")));
                                thinkingLines = event.text.split("\n");
                                for (_i = 0, thinkingLines_1 = thinkingLines; _i < thinkingLines_1.length; _i++) {
                                    line = thinkingLines_1[_i];
                                    thinkingContainer.addChild(new pi_tui_1.TextComponent(chalk_1.default.dim(line)));
                                }
                                thinkingContainer.addChild(new pi_tui_1.WhitespaceComponent(1));
                                this.chatContainer.addChild(thinkingContainer);
                                break;
                            }
                            case "tool_call":
                                this.toolCallCount++;
                                this.updateTokenDisplay();
                                this.chatContainer.addChild(new pi_tui_1.TextComponent(chalk_1.default.yellow("[tool] ".concat(event.name, "(").concat(event.args, ")"))));
                                break;
                            case "tool_result": {
                                lines = event.result.split("\n");
                                maxLines = 10;
                                truncated = lines.length > maxLines;
                                toShow = truncated ? lines.slice(0, maxLines) : lines;
                                resultContainer = new pi_tui_1.Container();
                                for (_a = 0, toShow_1 = toShow; _a < toShow_1.length; _a++) {
                                    line = toShow_1[_a];
                                    resultContainer.addChild(new pi_tui_1.TextComponent(event.isError ? chalk_1.default.red(line) : chalk_1.default.gray(line)));
                                }
                                if (truncated) {
                                    resultContainer.addChild(new pi_tui_1.TextComponent(chalk_1.default.dim("... (".concat(lines.length - maxLines, " more lines)"))));
                                }
                                resultContainer.addChild(new pi_tui_1.WhitespaceComponent(1));
                                this.chatContainer.addChild(resultContainer);
                                break;
                            }
                            case "assistant_message":
                                // Stop loading animation when assistant responds
                                if (this.currentLoadingAnimation) {
                                    this.currentLoadingAnimation.stop();
                                    this.currentLoadingAnimation = null;
                                    this.statusContainer.clear();
                                }
                                // Re-enable editor submission
                                this.editor.disableSubmit = false;
                                // Use MarkdownComponent for rich formatting
                                this.chatContainer.addChild(new pi_tui_1.MarkdownComponent(event.text));
                                this.chatContainer.addChild(new pi_tui_1.WhitespaceComponent(1));
                                break;
                            case "error":
                                // Stop loading animation on error
                                if (this.currentLoadingAnimation) {
                                    this.currentLoadingAnimation.stop();
                                    this.currentLoadingAnimation = null;
                                    this.statusContainer.clear();
                                }
                                // Re-enable editor submission
                                this.editor.disableSubmit = false;
                                this.chatContainer.addChild(new pi_tui_1.TextComponent(chalk_1.default.red("[error] ".concat(event.message)), { bottom: 1 }));
                                break;
                            case "user_message":
                                // Render user message
                                this.chatContainer.addChild(new pi_tui_1.TextComponent(chalk_1.default.green("[user]")));
                                this.chatContainer.addChild(new pi_tui_1.TextComponent(event.text, { bottom: 1 }));
                                break;
                            case "token_usage":
                                // Store the latest token counts (not cumulative since prompt includes full context)
                                this.lastInputTokens = event.inputTokens;
                                this.lastOutputTokens = event.outputTokens;
                                this.lastCacheReadTokens = event.cacheReadTokens;
                                this.lastCacheWriteTokens = event.cacheWriteTokens;
                                this.lastReasoningTokens = event.reasoningTokens;
                                this.updateTokenDisplay();
                                break;
                            case "interrupted":
                                // Stop the loading animation
                                if (this.currentLoadingAnimation) {
                                    this.currentLoadingAnimation.stop();
                                    this.currentLoadingAnimation = null;
                                    this.statusContainer.clear();
                                }
                                // Show interrupted message
                                this.chatContainer.addChild(new pi_tui_1.TextComponent(chalk_1.default.red("[Interrupted by user]"), { bottom: 1 }));
                                // Re-enable editor submission
                                this.editor.disableSubmit = false;
                                break;
                        }
                        this.ui.requestRender();
                        return [2 /*return*/];
                }
            });
        });
    };
    TuiRenderer.prototype.updateTokenDisplay = function () {
        // Clear and update token display
        this.tokenContainer.clear();
        // Build token display text
        var tokenText = chalk_1.default.dim("\u2191".concat(this.lastInputTokens.toLocaleString(), " \u2193").concat(this.lastOutputTokens.toLocaleString()));
        // Add reasoning tokens if present
        if (this.lastReasoningTokens > 0) {
            tokenText += chalk_1.default.dim(" \u26A1".concat(this.lastReasoningTokens.toLocaleString()));
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
            tokenText += chalk_1.default.dim(" (".concat(cacheText.join(" "), ")"));
        }
        // Add tool call count
        if (this.toolCallCount > 0) {
            tokenText += chalk_1.default.dim(" \u2692 ".concat(this.toolCallCount));
        }
        this.tokenStatusComponent = new pi_tui_1.TextComponent(tokenText);
        this.tokenContainer.addChild(this.tokenStatusComponent);
    };
    TuiRenderer.prototype.getUserInput = function () {
        return __awaiter(this, void 0, void 0, function () {
            var _this = this;
            return __generator(this, function (_a) {
                return [2 /*return*/, new Promise(function (resolve) {
                        _this.onInputCallback = function (text) {
                            _this.onInputCallback = undefined; // Clear callback
                            resolve(text);
                        };
                    })];
            });
        });
    };
    TuiRenderer.prototype.setInterruptCallback = function (callback) {
        this.onInterruptCallback = callback;
    };
    TuiRenderer.prototype.clearEditor = function () {
        var _this = this;
        this.editor.setText("");
        // Show hint in status container
        this.statusContainer.clear();
        var hint = new pi_tui_1.TextComponent(chalk_1.default.dim("Press Ctrl+C again to exit"));
        this.statusContainer.addChild(hint);
        this.ui.requestRender();
        // Clear the hint after 500ms
        setTimeout(function () {
            _this.statusContainer.clear();
            _this.ui.requestRender();
        }, 500);
    };
    TuiRenderer.prototype.renderAssistantLabel = function () {
        // Just render the assistant label without starting animations
        // Used for restored session history
        this.chatContainer.addChild(new pi_tui_1.TextComponent(chalk_1.default.hex("#FFA500")("[assistant]")));
        this.ui.requestRender();
    };
    TuiRenderer.prototype.stop = function () {
        if (this.currentLoadingAnimation) {
            this.currentLoadingAnimation.stop();
            this.currentLoadingAnimation = null;
        }
        if (this.isInitialized) {
            this.ui.stop();
            this.isInitialized = false;
        }
    };
    return TuiRenderer;
}());
exports.TuiRenderer = TuiRenderer;
