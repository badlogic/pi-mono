"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseArgs = parseArgs;
exports.printHelp = printHelp;
var os_1 = require("os");
var path_1 = require("path");
function parseArgs(defs, args) {
    var result = { _: [] };
    var aliasMap = {};
    // Build alias map and set defaults
    for (var _i = 0, _a = Object.entries(defs); _i < _a.length; _i++) {
        var _b = _a[_i], key = _b[0], def = _b[1];
        if (def.alias) {
            aliasMap[def.alias] = key;
        }
        if (def.default !== undefined) {
            result[key] = def.default;
        }
        else if (def.type === "flag" || def.type === "boolean") {
            result[key] = false;
        }
    }
    // Parse arguments
    for (var i = 0; i < args.length; i++) {
        var arg = args[i];
        // Check if it's a flag
        if (arg.startsWith("--")) {
            var flagName = arg.slice(2);
            var key = aliasMap[flagName] || flagName;
            var def = defs[key];
            if (!def) {
                // Unknown flag, add to positional args
                result._.push(arg);
                continue;
            }
            if (def.type === "flag") {
                // Simple on/off flag
                result[key] = true;
            }
            else if (i + 1 < args.length) {
                // Flag with value
                var value = args[++i];
                var parsedValue = void 0;
                switch (def.type) {
                    case "boolean":
                        parsedValue = value === "true" || value === "1" || value === "yes";
                        break;
                    case "int":
                        parsedValue = parseInt(value, 10);
                        if (Number.isNaN(parsedValue)) {
                            throw new Error("Invalid integer value for --".concat(key, ": ").concat(value));
                        }
                        break;
                    case "float":
                        parsedValue = parseFloat(value);
                        if (Number.isNaN(parsedValue)) {
                            throw new Error("Invalid float value for --".concat(key, ": ").concat(value));
                        }
                        break;
                    case "string":
                        parsedValue = value;
                        break;
                    case "file": {
                        // Resolve ~ to home directory and make absolute
                        var path = value;
                        if (path.startsWith("~")) {
                            path = path.replace("~", (0, os_1.homedir)());
                        }
                        parsedValue = (0, path_1.resolve)(path);
                        break;
                    }
                }
                // Validate against choices if specified
                if (def.choices) {
                    var validValues = def.choices.map(function (c) { return (typeof c === "string" ? c : c.value); });
                    if (!validValues.includes(parsedValue)) {
                        throw new Error("Invalid value for --".concat(key, ": \"").concat(parsedValue, "\". Valid choices: ").concat(validValues.join(", ")));
                    }
                }
                result[key] = parsedValue;
            }
            else {
                throw new Error("Flag --".concat(key, " requires a value"));
            }
        }
        else if (arg.startsWith("-") && arg.length === 2) {
            // Short flag like -h
            var flagChar = arg[1];
            var key = aliasMap[flagChar] || flagChar;
            var def = defs[key];
            if (!def) {
                result._.push(arg);
                continue;
            }
            if (def.type === "flag") {
                result[key] = true;
            }
            else {
                throw new Error("Short flag -".concat(flagChar, " cannot have a value"));
            }
        }
        else {
            // Positional argument
            result._.push(arg);
        }
    }
    return result;
}
function printHelp(defs, usage) {
    console.log(usage);
    console.log("\nOptions:");
    for (var _i = 0, _a = Object.entries(defs); _i < _a.length; _i++) {
        var _b = _a[_i], key = _b[0], def = _b[1];
        var line = "  --".concat(key);
        if (def.alias) {
            line += ", -".concat(def.alias);
        }
        if (def.type !== "flag") {
            if (def.choices) {
                // Show choices instead of type
                var simpleChoices = def.choices.filter(function (c) { return typeof c === "string"; });
                if (simpleChoices.length === def.choices.length) {
                    // All choices are simple strings
                    line += " <".concat(simpleChoices.join("|"), ">");
                }
                else {
                    // Has descriptions, just show the type
                    var typeStr = def.type === "file" ? "path" : def.type;
                    line += " <".concat(typeStr, ">");
                }
            }
            else {
                var typeStr = def.type === "file" ? "path" : def.type;
                line += " <".concat(typeStr, ">");
            }
        }
        if (def.description) {
            // Pad to align descriptions
            line = line.padEnd(30) + def.description;
        }
        if (def.default !== undefined && def.type !== "flag" && def.showDefault !== false) {
            if (typeof def.showDefault === "string") {
                line += " (default: ".concat(def.showDefault, ")");
            }
            else {
                line += " (default: ".concat(def.default, ")");
            }
        }
        console.log(line);
        // Print choices with descriptions if available
        if (def.choices) {
            var hasDescriptions = def.choices.some(function (c) { return typeof c === "object" && c.description; });
            if (hasDescriptions) {
                for (var _c = 0, _d = def.choices; _c < _d.length; _c++) {
                    var choice = _d[_c];
                    if (typeof choice === "object") {
                        var choiceLine = "      ".concat(choice.value).padEnd(30) + (choice.description || "");
                        console.log(choiceLine);
                    }
                }
            }
        }
    }
}
