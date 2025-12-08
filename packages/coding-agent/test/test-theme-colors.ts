import { initTheme, theme } from "../src/modes/interactive/theme/theme.js";

// Initialize with dark theme explicitly
process.env.COLORTERM = "truecolor";
initTheme("dark");

console.log("\n=== Foreground Colors ===\n");

// Core UI colors
console.log("accent:", theme.fg("accent", "Sample text"));
console.log("border:", theme.fg("border", "Sample text"));
console.log("borderAccent:", theme.fg("borderAccent", "Sample text"));
console.log("borderMuted:", theme.fg("borderMuted", "Sample text"));
console.log("success:", theme.fg("success", "Sample text"));
console.log("error:", theme.fg("error", "Sample text"));
console.log("warning:", theme.fg("warning", "Sample text"));
console.log("muted:", theme.fg("muted", "Sample text"));
console.log("dim:", theme.fg("dim", "Sample text"));
console.log("text:", theme.fg("text", "Sample text"));

console.log("\n=== Message Text Colors ===\n");
console.log("userMessageText:", theme.fg("userMessageText", "Sample text"));
console.log("toolTitle:", theme.fg("toolTitle", "Sample text"));
console.log("toolOutput:", theme.fg("toolOutput", "Sample text"));

console.log("\n=== Markdown Colors ===\n");
console.log("mdHeading:", theme.fg("mdHeading", "Sample text"));
console.log("mdLink:", theme.fg("mdLink", "Sample text"));
console.log("mdCode:", theme.fg("mdCode", "Sample text"));
console.log("mdCodeBlock:", theme.fg("mdCodeBlock", "Sample text"));
console.log("mdCodeBlockBorder:", theme.fg("mdCodeBlockBorder", "Sample text"));
console.log("mdQuote:", theme.fg("mdQuote", "Sample text"));
console.log("mdQuoteBorder:", theme.fg("mdQuoteBorder", "Sample text"));
console.log("mdHr:", theme.fg("mdHr", "Sample text"));
console.log("mdListBullet:", theme.fg("mdListBullet", "Sample text"));

console.log("\n=== Tool Diff Colors ===\n");
console.log("toolDiffAdded:", theme.fg("toolDiffAdded", "Sample text"));
console.log("toolDiffRemoved:", theme.fg("toolDiffRemoved", "Sample text"));
console.log("toolDiffContext:", theme.fg("toolDiffContext", "Sample text"));

console.log("\n=== Thinking Border Colors ===\n");
console.log("thinkingOff:", theme.fg("thinkingOff", "Sample text"));
console.log("thinkingMinimal:", theme.fg("thinkingMinimal", "Sample text"));
console.log("thinkingLow:", theme.fg("thinkingLow", "Sample text"));
console.log("thinkingMedium:", theme.fg("thinkingMedium", "Sample text"));
console.log("thinkingHigh:", theme.fg("thinkingHigh", "Sample text"));

console.log("\n=== Background Colors ===\n");
console.log("userMessageBg:", theme.bg("userMessageBg", " Sample background text "));
console.log("toolPendingBg:", theme.bg("toolPendingBg", " Sample background text "));
console.log("toolSuccessBg:", theme.bg("toolSuccessBg", " Sample background text "));
console.log("toolErrorBg:", theme.bg("toolErrorBg", " Sample background text "));

console.log("\n=== Raw ANSI Codes ===\n");
console.log("thinkingMedium ANSI:", JSON.stringify(theme.getFgAnsi("thinkingMedium")));
console.log("accent ANSI:", JSON.stringify(theme.getFgAnsi("accent")));
console.log("muted ANSI:", JSON.stringify(theme.getFgAnsi("muted")));
console.log("dim ANSI:", JSON.stringify(theme.getFgAnsi("dim")));

console.log("\n=== Direct RGB Test ===\n");
console.log("Gray #6c6c6c: \x1b[38;2;108;108;108mSample text\x1b[0m");
console.log("Gray #444444: \x1b[38;2;68;68;68mSample text\x1b[0m");
console.log("Gray #303030: \x1b[38;2;48;48;48mSample text\x1b[0m");

console.log("\n=== Hex Color Test ===\n");
console.log("Direct #00d7ff test: \x1b[38;2;0;215;255mBRIGHT CYAN\x1b[0m");
console.log("Theme cyan (should match above):", theme.fg("accent", "BRIGHT CYAN"));

console.log("\n=== Environment ===\n");
console.log("TERM:", process.env.TERM);
console.log("COLORTERM:", process.env.COLORTERM);
console.log("Color mode:", theme.getColorMode());

console.log("\n");
