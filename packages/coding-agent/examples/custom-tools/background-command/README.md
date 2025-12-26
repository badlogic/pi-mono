# Background Command

Run shell commands in the background. Emits `command:complete` event when done.

## Usage

```
Run tests in background: background_command({ command: "npm test" })
```

Returns immediately. When the command finishes, emits `command:complete` with `{ command, success, exitCode }`.

## Notification Hook

Use `examples/hooks/command-notify.ts` to get notified:

```bash
cp examples/hooks/command-notify.ts ~/.pi/agent/hooks/
```
