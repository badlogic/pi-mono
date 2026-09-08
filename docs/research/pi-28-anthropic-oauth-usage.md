# PI-28 Anthropic OAuth usage API research

Date: 2026-09-08

## Confirmed

Anthropic's Claude Code setup documentation supports Claude Pro, Max, Team, Enterprise, and Console accounts, plus `ANTHROPIC_API_KEY` and third-party providers. It does not document a subscription-usage API.

Source: [Set up Claude Code](https://docs.anthropic.com/en/docs/claude-code/getting-started)

## Implementation-adjacent evidence

Users of Anthropic's public `claude-code` issue tracker consistently report this request shape:

```http
GET https://api.anthropic.com/api/oauth/usage
Authorization: Bearer <OAuth access token>
anthropic-beta: oauth-2025-04-20
```

Reported responses include:

```json
{
  "five_hour": {
    "utilization": 74.0,
    "resets_at": "2026-04-11T07:00:00.528743+00:00"
  },
  "seven_day": {
    "utilization": 10.0,
    "resets_at": "2026-04-17T00:59:59.951713+00:00"
  }
}
```

`utilization` is reported as percentage used, so the normalized proportion is `utilization / 100`. `resets_at` is reported as an ISO-8601 timestamp. Model-specific seven-day windows and `extra_usage` have also been observed, but are not needed for PI-28.

The issue reports persistent HTTP 429 responses, including a `retry-after: 0` case. Comments claim a `User-Agent: claude-code/<version>` header changes rate-limit behavior. These are user reports, not Anthropic commitments. PI-28 should not impersonate Claude Code without explicit approval.

Sources:

- [Anthropic claude-code issue #30930](https://github.com/anthropics/claude-code/issues/30930)
- [Shunt's parser and fixture](https://github.com/pleaseai/shunt/blob/main/src/auth/claude/usage.rs)

## Recommended fixture

```json
{
  "five_hour": {
    "utilization": 42.5,
    "resets_at": "2026-09-08T18:00:00Z"
  }
}
```

Treat a window as available only when `utilization` is a finite number in `[0, 100]` and `resets_at` parses to a finite future absolute time. Invalid, missing, API-key, bearer-token, enterprise, unlimited, 401, 429, timeout, abort, and server-error cases return no report.

## Recorded decision

The maintainer approved use of this undocumented endpoint and authorized Pi to identify these requests as Claude Code. Pi sends the same `claude-cli/2.1.251` user agent already used for Anthropic OAuth model requests. It still degrades silently on 429 and every other optional failure.
