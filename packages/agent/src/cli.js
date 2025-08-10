#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var main_js_1 = require("./main.js");
// Run as CLI - this file should always be executed, not imported
(0, main_js_1.main)(process.argv.slice(2)).catch(function (err) {
    console.error(err);
    process.exit(1);
});
