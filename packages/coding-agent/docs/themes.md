> pi can create themes. Ask it to build one for your setup.

# Themes

Themes are JSON files that define colors for the TUI. You can select themes in `/settings` or via `settings.json`.

## Locations

Pi loads themes from:

- Built-in: `dark`, `light`
- Global: `~/.pi/agent/themes/*.json`
- Project: `.pi/themes/*.json`
- Packages: `themes/` directories or `pi.themes` entries in `package.json`
- Settings: `themes` array with files or directories
- CLI: `--theme <path>` (repeatable)

Disable discovery with `--no-themes`.

## Format

Themes use this structure:

```json
{
  "$schema": "https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/theme-schema.json",
  "name": "my-theme",
  "vars": {
    "accent": "#00aaff",
    "muted": 242
  },
  "colors": {
    "accent": "accent",
    "muted": "muted",
    "text": "",
    "userMessageBg": "#2d2d30",
    "toolSuccessBg": "#1e2e1e"
  }
}
```

- `name` is required and must be unique.
- `vars` is optional. It lets you reuse colors.
- `colors` must define all required tokens.

See [theme.md](theme.md) for the full token list, color formats, and validation details.
