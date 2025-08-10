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
exports.SessionManager = void 0;
var crypto_1 = require("crypto");
var fs_1 = require("fs");
var os_1 = require("os");
var path_1 = require("path");
// Simple UUID v4 generator
function uuidv4() {
    var bytes = (0, crypto_1.randomBytes)(16);
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // Version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // Variant 10
    var hex = bytes.toString("hex");
    return "".concat(hex.slice(0, 8), "-").concat(hex.slice(8, 12), "-").concat(hex.slice(12, 16), "-").concat(hex.slice(16, 20), "-").concat(hex.slice(20, 32));
}
var SessionManager = /** @class */ (function () {
    function SessionManager(continueSession) {
        if (continueSession === void 0) { continueSession = false; }
        this.sessionDir = this.getSessionDirectory();
        if (continueSession) {
            var mostRecent = this.findMostRecentlyModifiedSession();
            if (mostRecent) {
                this.sessionFile = mostRecent;
                // Load session ID from file
                this.loadSessionId();
            }
            else {
                // No existing session, create new
                this.initNewSession();
            }
        }
        else {
            this.initNewSession();
        }
    }
    SessionManager.prototype.getSessionDirectory = function () {
        var cwd = process.cwd();
        var safePath = "--" + cwd.replace(/^\//, "").replace(/\//g, "-") + "--";
        var piConfigDir = (0, path_1.resolve)(process.env.PI_CONFIG_DIR || (0, path_1.join)((0, os_1.homedir)(), ".pi"));
        var sessionDir = (0, path_1.join)(piConfigDir, "sessions", safePath);
        if (!(0, fs_1.existsSync)(sessionDir)) {
            (0, fs_1.mkdirSync)(sessionDir, { recursive: true });
        }
        return sessionDir;
    };
    SessionManager.prototype.initNewSession = function () {
        this.sessionId = uuidv4();
        var timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        this.sessionFile = (0, path_1.join)(this.sessionDir, "".concat(timestamp, "_").concat(this.sessionId, ".jsonl"));
    };
    SessionManager.prototype.findMostRecentlyModifiedSession = function () {
        var _this = this;
        var _a;
        try {
            var files = (0, fs_1.readdirSync)(this.sessionDir)
                .filter(function (f) { return f.endsWith(".jsonl"); })
                .map(function (f) { return ({
                name: f,
                path: (0, path_1.join)(_this.sessionDir, f),
                mtime: (0, fs_1.statSync)((0, path_1.join)(_this.sessionDir, f)).mtime,
            }); })
                .sort(function (a, b) { return b.mtime.getTime() - a.mtime.getTime(); });
            return ((_a = files[0]) === null || _a === void 0 ? void 0 : _a.path) || null;
        }
        catch (_b) {
            return null;
        }
    };
    SessionManager.prototype.loadSessionId = function () {
        if (!(0, fs_1.existsSync)(this.sessionFile))
            return;
        var lines = (0, fs_1.readFileSync)(this.sessionFile, "utf8").trim().split("\n");
        for (var _i = 0, lines_1 = lines; _i < lines_1.length; _i++) {
            var line = lines_1[_i];
            try {
                var entry = JSON.parse(line);
                if (entry.type === "session") {
                    this.sessionId = entry.id;
                    return;
                }
            }
            catch (_a) {
                // Skip malformed lines
            }
        }
        // If no session entry found, create new ID
        this.sessionId = uuidv4();
    };
    SessionManager.prototype.startSession = function (config) {
        var entry = {
            type: "session",
            id: this.sessionId,
            timestamp: new Date().toISOString(),
            cwd: process.cwd(),
            config: config,
        };
        (0, fs_1.appendFileSync)(this.sessionFile, JSON.stringify(entry) + "\n");
    };
    SessionManager.prototype.on = function (event) {
        return __awaiter(this, void 0, void 0, function () {
            var entry;
            return __generator(this, function (_a) {
                entry = {
                    type: "event",
                    timestamp: new Date().toISOString(),
                    event: event,
                };
                (0, fs_1.appendFileSync)(this.sessionFile, JSON.stringify(entry) + "\n");
                return [2 /*return*/];
            });
        });
    };
    SessionManager.prototype.getSessionData = function () {
        if (!(0, fs_1.existsSync)(this.sessionFile))
            return null;
        var config = null;
        var events = [];
        var totalUsage = {
            type: "token_usage",
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            reasoningTokens: 0,
        };
        var lines = (0, fs_1.readFileSync)(this.sessionFile, "utf8").trim().split("\n");
        for (var _i = 0, lines_2 = lines; _i < lines_2.length; _i++) {
            var line = lines_2[_i];
            try {
                var entry = JSON.parse(line);
                if (entry.type === "session") {
                    config = entry.config;
                    this.sessionId = entry.id;
                }
                else if (entry.type === "event") {
                    var eventEntry = entry;
                    events.push(eventEntry);
                    if (eventEntry.event.type === "token_usage") {
                        totalUsage = entry.event;
                    }
                }
            }
            catch (_a) {
                // Skip malformed lines
            }
        }
        return config ? { config: config, events: events, totalUsage: totalUsage } : null;
    };
    SessionManager.prototype.getSessionId = function () {
        return this.sessionId;
    };
    SessionManager.prototype.getSessionFile = function () {
        return this.sessionFile;
    };
    return SessionManager;
}());
exports.SessionManager = SessionManager;
