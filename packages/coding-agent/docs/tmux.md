# tmux Setup

Pi works inside tmux, but tmux strips modifier information from certain keys by default. Without configuration, `Shift+Enter` and `Ctrl+Enter` are indistinguishable from plain `Enter`.

## Required Configuration

Add to `~/.tmux.conf`:

```tmux
set -g extended-keys on
set -g extended-keys-format csi-u
```

Then restart tmux (not just reload):

```bash
tmux kill-server
tmux
```

This tells tmux to forward modified key sequences in CSI-u format when an application requests extended key reporting. Pi requests this automatically when Kitty keyboard protocol is not available.

## What This Fixes

Without this config, tmux collapses modified enter keys to plain `\r`:

| Key | Without config | With config |
|-----|---------------|-------------|
| Enter | `\r` | `\r` |
| Shift+Enter | `\r` | `\x1b[13;2u` |
| Ctrl+Enter | `\r` | `\x1b[13;5u` |
| Alt/Option+Enter | `\x1b\r` | `\x1b[13;3u` |

This affects the default keybindings (`Enter` to submit, `Shift+Enter` for newline) and any custom keybindings using modified enter keys.

## Requirements

- tmux 3.2 or later (run `tmux -V` to check)
- A terminal emulator that supports extended keys (Ghostty, Kitty, iTerm2, WezTerm, Windows Terminal)
