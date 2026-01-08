# Auto Theme Switching Implementation Plan

## Problem

Manually switching between light/dark themes via `/settings` is tedious when done twice daily (morning→light, evening→dark). Users want themes to follow system appearance automatically.

## Scope

- **macOS only** for initial implementation
- Linux/Windows: TODO (detection returns undefined, falls back to current behavior)
- No 3rd party dependencies
- Lightweight - use native Node.js `fs.watch` (FSEvents on macOS)

## Design Decisions

1. **Don't change existing users' settings** - Only new installs default to `"auto"`
2. **Simple defaults** - If `autoThemeLight`/`autoThemeDark` not set, use built-in `"light"`/`"dark"`
3. **Live updates** - Watch macOS preferences plist for changes
4. **No polling** - Use file system events via `fs.watch`

## Implementation

### Settings

```json
{
  "theme": "auto",                    // "auto" | "dark" | "light" | "<custom>"
  "autoThemeLight": "light",          // optional, defaults to "light"
  "autoThemeDark": "dark"             // optional, defaults to "dark"
}
```

- **Existing users:** Keep their `theme` setting untouched
- **New installs:** Default to `"auto"` (detected via missing settings file)

### macOS Detection

**Read current appearance:**
```typescript
import { execSync } from "child_process";

function detectMacOSAppearance(): "dark" | "light" {
  try {
    const result = execSync("defaults read -g AppleInterfaceStyle", {
      encoding: "utf-8",
      timeout: 1000,
    }).trim();
    return result === "Dark" ? "dark" : "light";
  } catch {
    return "light"; // No AppleInterfaceStyle = light mode
  }
}
```

**Watch for changes:**
```typescript
import { watch } from "fs";
const PREFS_PLIST = "~/Library/Preferences/.GlobalPreferences.plist";

// Watch plist for changes, re-detect appearance when it changes
fs.watch(PREFS_PLIST, { persistent: false }, (event) => {
  if (event === "change") {
    const appearance = detectMacOSAppearance();
    // Update theme if changed
  }
});
```

### Files Changed

**`theme.ts`:**
- `detectSystemAppearance()` - macOS only, returns `"dark" | "light" | undefined`
- `startSystemAppearanceWatcher(callback)` - watches plist, returns cleanup function
- `initTheme(options)` - now takes options object with auto theme settings
- `setTheme(name, options)` - now takes options object
- `getCurrentThemeSetting()` - returns raw setting (may be "auto")
- `getCurrentThemeName()` - returns resolved theme name

**`settings-manager.ts`:**
- Added `autoThemeLight?: string` and `autoThemeDark?: string` to Settings
- Added `getAutoThemeLight()`, `setAutoThemeLight()`
- Added `getAutoThemeDark()`, `setAutoThemeDark()`

**`theme-selector.ts`:**
- Shows "auto" option at top of theme list in /settings
- Shows "(follows system)" or "(follows system, currently: dark)" as description

**`interactive-mode.ts`:**
- Updated to pass auto theme settings to initTheme/setTheme
- Added "auto" to available themes list

### Platform Support

| Platform | Detection | Live Updates |
|----------|-----------|--------------|
| macOS    | ✅ `defaults read` | ✅ Watch plist |
| Linux    | TODO | TODO |
| Windows  | TODO | TODO |

When detection returns `undefined` (unsupported platform), falls back to `COLORFGBG` env var or default dark theme.

---

## TODO (Future)

### Linux Support
- GNOME: `gsettings get org.gnome.desktop.interface color-scheme`
- KDE: `kreadconfig5 --group General --key ColorScheme`  
- Watch: dconf or gsettings monitor

### Windows Support
- Registry: `HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize\AppsUseLightTheme`
- Watch: Registry change notifications (may need native addon)
