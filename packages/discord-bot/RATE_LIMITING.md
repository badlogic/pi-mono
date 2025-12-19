# Webhook Server Rate Limiting

## Overview

Implemented comprehensive rate limiting to prevent abuse and resource exhaustion in the webhook server.

## Implementation Details

### 1. General Rate Limiting
- **Limit:** 10 requests per minute per IP
- **Window:** 60 seconds (sliding)
- **Scope:** All endpoints except `/health`
- **Response:** 429 Too Many Requests with `retryAfter: 60`

### 2. Unauthorized Request Rate Limiting
- **Limit:** 3 unauthorized attempts per minute
- **Block Duration:** 5 minutes after reaching limit
- **Window:** 60 seconds (sliding)
- **Response:** 429 Too Many Requests with dynamic `retryAfter` (remaining block time)

## Rate Limiting Flow

```
Request → General Rate Limit Check (10/min)
          ↓
      Auth Check → Unauthorized Rate Limit Check (3/min, 5min block)
          ↓
      Process Request
```

## Data Structures

### RateLimitRecord Interface
```typescript
interface RateLimitRecord {
  count: number;           // Request count in current window
  firstRequest: number;    // Timestamp of first request in window
  blockedUntil?: number;   // Timestamp when block expires (auth only)
}
```

### In-Memory Storage
- `requestCounts: Map<string, RateLimitRecord>` - General rate limits
- `authFailures: Map<string, RateLimitRecord>` - Auth failure tracking

## Configuration

### General Rate Limit
```typescript
const GENERAL_RATE_LIMIT = 10;        // max requests
const GENERAL_RATE_WINDOW = 60000;    // 1 minute
```

### Auth Rate Limit
```typescript
const AUTH_RATE_LIMIT = 3;            // max failures before block
const AUTH_RATE_WINDOW = 60000;       // 1 minute
const AUTH_BLOCK_DURATION = 300000;   // 5 minutes
```

## Cleanup

Automatic cleanup runs every 10 minutes to remove expired rate limit records:
- Removes expired general rate limit records (older than 1 minute)
- Removes expired auth blocks (block time passed)
- Logs cleanup count when records are removed

## Example Responses

### General Rate Limit Exceeded
```json
{
  "error": "Too Many Requests",
  "message": "Rate limit exceeded. Maximum 10 requests per minute.",
  "retryAfter": 60
}
```

### Auth Rate Limit (Blocked)
```json
{
  "error": "Too Many Requests",
  "message": "Too many unauthorized attempts. Blocked for 287 seconds.",
  "retryAfter": 287
}
```

## Logging

### General Rate Limit Hit
```
[WEBHOOK] Rate limit exceeded from ::ffff:127.0.0.1 - max 10 requests per minute
```

### Auth Block Triggered
```
[WEBHOOK] IP ::ffff:127.0.0.1 blocked for 300s after 3 unauthorized attempts
```

### Auth Block Active
```
[WEBHOOK] Auth rate limit: ::ffff:127.0.0.1 blocked for 287s after 3 unauthorized attempts
```

### Cleanup
```
[WEBHOOK] Cleaned 5 expired rate limit records
```

## Testing

To test rate limiting:

```bash
# Test general rate limit (10 requests/min)
for i in {1..15}; do
  curl -X POST http://localhost:3001/webhook/alert \
    -H "Content-Type: application/json" \
    -d '{"message":"test"}' &
done

# Test auth rate limit (3 failures → 5min block)
for i in {1..5}; do
  curl -X POST http://localhost:3001/webhook/alert \
    -H "Content-Type: application/json" \
    -d '{"message":"test"}'
  sleep 1
done
```

## Security Benefits

1. **DoS Prevention:** Limits request volume from single IPs
2. **Brute Force Protection:** Blocks IPs after 3 auth failures for 5 minutes
3. **Resource Protection:** Prevents server overload and queue saturation
4. **Gradual Response:** General limit applies before stricter auth limits
5. **Memory Efficiency:** Automatic cleanup prevents unbounded growth

## Migration Notes

- No breaking changes to existing API
- Existing authenticated clients unaffected (unless exceeding 10 req/min)
- Health endpoint (`/health`) exempt from all rate limiting
- Rate limits apply per IP address (using `req.ip`)

## Future Enhancements

Potential improvements:
- Redis-backed rate limiting for multi-instance deployments
- Configurable limits via environment variables
- Rate limit headers (`X-RateLimit-Limit`, `X-RateLimit-Remaining`)
- Whitelist for trusted IPs (bypass rate limits)
- Per-endpoint rate limit configuration
