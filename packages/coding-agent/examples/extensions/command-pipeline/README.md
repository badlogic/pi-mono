# Command Pipeline Demos

Run all command pipeline demos (redaction, audit, copy, resume):

```
./pi-test.sh -e packages/coding-agent/examples/extensions/command-pipeline
```

Or with a released build:
```
pi -e packages/coding-agent/examples/extensions/command-pipeline
```

## Included demos

- Redaction + audit: `redaction-audit.ts`
- Copy format conversion: `copy-plain.ts`
- Resume access control: `resume-blocked.ts`

## Demo: /export redaction

1. Add a message that contains fake sensitive data:
   ```
   My email is alice@example.com.
   Token: api_key="sk_test_1234567890abcdef12345"
   Phone: 415-555-1212
   SSH:
   -----BEGIN OPENSSH PRIVATE KEY-----
   FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE
   -----END OPENSSH PRIVATE KEY-----
   ```
2. Run `/export`.
3. Open the generated HTML file and search for the strings above.

Expected: the export shows `[REDACTED:...]` for each matched pattern.

## Demo: /share audit logging

1. Run `/share`.
2. If redaction is detected, confirm the prompt to proceed.
3. Wait for completion.

Expected: a UI notification shows the audit log entry.

## Demo: /copy format conversion

1. Ask for a markdown response, e.g.:
   ```
   # Title
   Some *emphasis* and `inline code`.
   ```
2. Run `/copy`.

Expected: clipboard contains plain text (markers removed).

## Demo: /resume access control

1. If you have no session file yet, send any message first.
2. The demo automatically prepares a `*-blocked.jsonl` session named `this-is-demo-blocked`.
3. Run `/resume` and select the `*-blocked.jsonl` session.

Expected: resume is blocked with an error notification.
