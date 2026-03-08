# Windows Setup

Pi requires a bash shell on Windows. Checked locations (in order):

1. Custom path from `~/.pi/agent/settings.json`
2. Git Bash (`C:\Program Files\Git\bin\bash.exe`)
3. `bash.exe` on PATH (Cygwin, MSYS2, WSL)

For most users, [Git for Windows](https://git-scm.com/download/win) is sufficient.

## Custom Shell Path

```json
{
  "shellPath": "C:\\cygwin64\\bin\\bash.exe"
}
```

## Session Paths in Git Bash / MSYS

When using `--session` with a Windows path in Git Bash/MSYS, quote backslash paths or use forward slashes.

```bash
# Good
pi --session 'C:\Users\Admin\.pi\agent\sessions\...jsonl'
pi --session C:/Users/Admin/.pi/agent/sessions/...jsonl

# Bad (unquoted backslashes get eaten by bash)
pi --session C:\Users\Admin\.pi\agent\sessions\...jsonl
```
