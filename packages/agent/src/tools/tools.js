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
exports.toolsForChat = exports.toolsForResponses = void 0;
exports.executeTool = executeTool;
var node_child_process_1 = require("node:child_process");
var node_fs_1 = require("node:fs");
var node_path_1 = require("node:path");
var glob_1 = require("glob");
// For GPT-OSS models via responses API
exports.toolsForResponses = [
    {
        type: "function",
        name: "read",
        description: "Read contents of a file",
        parameters: {
            type: "object",
            properties: {
                path: {
                    type: "string",
                    description: "Path to the file to read",
                },
            },
            required: ["path"],
        },
    },
    {
        type: "function",
        name: "list",
        description: "List contents of a directory",
        parameters: {
            type: "object",
            properties: {
                path: {
                    type: "string",
                    description: "Path to the directory (default: current directory)",
                },
            },
        },
    },
    {
        type: "function",
        name: "bash",
        description: "Execute a command in Bash",
        parameters: {
            type: "object",
            properties: {
                command: {
                    type: "string",
                    description: "Command to execute",
                },
            },
            required: ["command"],
        },
    },
    {
        type: "function",
        name: "glob",
        description: "Find files matching a glob pattern",
        parameters: {
            type: "object",
            properties: {
                pattern: {
                    type: "string",
                    description: "Glob pattern to match files (e.g., '**/*.ts', 'src/**/*.json')",
                },
                path: {
                    type: "string",
                    description: "Directory to search in (default: current directory)",
                },
            },
            required: ["pattern"],
        },
    },
    {
        type: "function",
        name: "rg",
        description: "Search using ripgrep.",
        parameters: {
            type: "object",
            properties: {
                args: {
                    type: "string",
                    description: 'Arguments to pass directly to ripgrep. Examples: "-l prompt" or "-i TODO" or "--type ts className" or "functionName src/". Never add quotes around the search pattern.',
                },
            },
            required: ["args"],
        },
    },
];
// For standard chat API (OpenAI format)
exports.toolsForChat = exports.toolsForResponses.map(function (tool) { return ({
    type: "function",
    function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
    },
}); });
// Helper to execute commands with abort support
function execWithAbort(command, signal) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, new Promise(function (resolve, reject) {
                    var _a, _b;
                    var child = (0, node_child_process_1.spawn)(command, {
                        shell: true,
                        signal: signal,
                    });
                    var stdout = "";
                    var stderr = "";
                    var MAX_OUTPUT_SIZE = 1024 * 1024; // 1MB limit
                    var outputTruncated = false;
                    (_a = child.stdout) === null || _a === void 0 ? void 0 : _a.on("data", function (data) {
                        var chunk = data.toString();
                        if (stdout.length + chunk.length > MAX_OUTPUT_SIZE) {
                            if (!outputTruncated) {
                                stdout += "\n... [Output truncated - exceeded 1MB limit] ...";
                                outputTruncated = true;
                            }
                        }
                        else {
                            stdout += chunk;
                        }
                    });
                    (_b = child.stderr) === null || _b === void 0 ? void 0 : _b.on("data", function (data) {
                        var chunk = data.toString();
                        if (stderr.length + chunk.length > MAX_OUTPUT_SIZE) {
                            if (!outputTruncated) {
                                stderr += "\n... [Output truncated - exceeded 1MB limit] ...";
                                outputTruncated = true;
                            }
                        }
                        else {
                            stderr += chunk;
                        }
                    });
                    child.on("error", function (error) {
                        reject(error);
                    });
                    child.on("close", function (code) {
                        if (signal === null || signal === void 0 ? void 0 : signal.aborted) {
                            reject(new Error("Interrupted"));
                        }
                        else if (code !== 0 && code !== null) {
                            // For some commands like ripgrep, exit code 1 is normal (no matches)
                            if (code === 1 && command.includes("rg")) {
                                resolve(""); // No matches for ripgrep
                            }
                            else if (stderr && !stdout) {
                                reject(new Error(stderr));
                            }
                            else {
                                resolve(stdout || "");
                            }
                        }
                        else {
                            resolve(stdout || stderr || "");
                        }
                    });
                    // Kill the process if signal is aborted
                    if (signal) {
                        signal.addEventListener("abort", function () {
                            child.kill("SIGTERM");
                        }, { once: true });
                    }
                })];
        });
    });
}
function executeTool(name, args, signal) {
    return __awaiter(this, void 0, void 0, function () {
        var parsed, _a, path, file, stats, MAX_FILE_SIZE, fd, buffer, data, path, dir, entries, command, output, e_1, pattern, searchPath, matches, e_2, args_1, cmd, output, e_3;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    parsed = JSON.parse(args);
                    _a = name;
                    switch (_a) {
                        case "read": return [3 /*break*/, 1];
                        case "list": return [3 /*break*/, 2];
                        case "bash": return [3 /*break*/, 3];
                        case "glob": return [3 /*break*/, 7];
                        case "rg": return [3 /*break*/, 11];
                    }
                    return [3 /*break*/, 15];
                case 1:
                    {
                        path = parsed.path;
                        if (!path)
                            return [2 /*return*/, "Error: path parameter is required"];
                        file = (0, node_path_1.resolve)(path);
                        if (!(0, node_fs_1.existsSync)(file))
                            return [2 /*return*/, "File not found: ".concat(file)];
                        stats = (0, node_fs_1.statSync)(file);
                        MAX_FILE_SIZE = 1024 * 1024;
                        if (stats.size > MAX_FILE_SIZE) {
                            fd = (0, node_fs_1.openSync)(file, "r");
                            buffer = Buffer.alloc(MAX_FILE_SIZE);
                            (0, node_fs_1.readSync)(fd, buffer, 0, MAX_FILE_SIZE, 0);
                            (0, node_fs_1.closeSync)(fd);
                            return [2 /*return*/, buffer.toString("utf8") + "\n\n... [File truncated - exceeded 1MB limit] ..."];
                        }
                        data = (0, node_fs_1.readFileSync)(file, "utf8");
                        return [2 /*return*/, data];
                    }
                    _b.label = 2;
                case 2:
                    {
                        path = parsed.path || ".";
                        dir = (0, node_path_1.resolve)(path);
                        if (!(0, node_fs_1.existsSync)(dir))
                            return [2 /*return*/, "Directory not found: ".concat(dir)];
                        entries = (0, node_fs_1.readdirSync)(dir, { withFileTypes: true });
                        return [2 /*return*/, entries.map(function (entry) { return (entry.isDirectory() ? entry.name + "/" : entry.name); }).join("\n")];
                    }
                    _b.label = 3;
                case 3:
                    command = parsed.command;
                    if (!command)
                        return [2 /*return*/, "Error: command parameter is required"];
                    _b.label = 4;
                case 4:
                    _b.trys.push([4, 6, , 7]);
                    return [4 /*yield*/, execWithAbort(command, signal)];
                case 5:
                    output = _b.sent();
                    return [2 /*return*/, output || "Command executed successfully"];
                case 6:
                    e_1 = _b.sent();
                    if (e_1.message === "Interrupted") {
                        throw e_1; // Re-throw interruption
                    }
                    throw new Error("Command failed: ".concat(e_1.message));
                case 7:
                    pattern = parsed.pattern;
                    if (!pattern)
                        return [2 /*return*/, "Error: pattern parameter is required"];
                    searchPath = parsed.path || process.cwd();
                    _b.label = 8;
                case 8:
                    _b.trys.push([8, 10, , 11]);
                    return [4 /*yield*/, (0, glob_1.glob)(pattern, {
                            cwd: searchPath,
                            dot: true,
                            nodir: false,
                            mark: true, // Add / to directories
                        })];
                case 9:
                    matches = _b.sent();
                    if (matches.length === 0) {
                        return [2 /*return*/, "No files found matching the pattern"];
                    }
                    // Sort by modification time (most recent first) if possible
                    return [2 /*return*/, matches.sort().join("\n")];
                case 10:
                    e_2 = _b.sent();
                    return [2 /*return*/, "Glob error: ".concat(e_2.message)];
                case 11:
                    args_1 = parsed.args;
                    if (!args_1)
                        return [2 /*return*/, "Error: args parameter is required"];
                    cmd = "rg ".concat(args_1, " < /dev/null");
                    _b.label = 12;
                case 12:
                    _b.trys.push([12, 14, , 15]);
                    return [4 /*yield*/, execWithAbort(cmd, signal)];
                case 13:
                    output = _b.sent();
                    return [2 /*return*/, output.trim() || "No matches found"];
                case 14:
                    e_3 = _b.sent();
                    if (e_3.message === "Interrupted") {
                        throw e_3; // Re-throw interruption
                    }
                    return [2 /*return*/, "ripgrep error: ".concat(e_3.message)];
                case 15: return [2 /*return*/, "Unknown tool: ".concat(name)];
            }
        });
    });
}
