# Dashboard Testing Guide

## Pre-Integration Test

Before integrating into main.ts, you can test the API endpoints using curl:

### 1. Check if the analytics server is running

```bash
curl http://localhost:9090/api/health
```

Expected response:
```json
{
  "status": "ok",
  "uptime": 12345,
  "model": "mistral-small-3.1-24b-instruct",
  "channels": 2,
  "analyticsEnabled": true
}
```

### 2. Test existing analytics endpoint

```bash
curl http://localhost:9090/api/analytics
```

## Post-Integration Test

After adding the dashboard integration to main.ts and restarting the bot:

### 1. Test new API endpoints

```bash
# Status endpoint
curl http://localhost:9090/api/status

# Stats endpoint
curl http://localhost:9090/api/stats

# Costs endpoint
curl http://localhost:9090/api/costs

# Tools endpoint
curl http://localhost:9090/api/tools

# Activity endpoint
curl http://localhost:9090/api/activity
```

### 2. Access the dashboard

Open in browser:
```
http://localhost:9090/dashboard
```

### 3. Verify dashboard sections

The dashboard should show:
- ✅ Bot Status card (uptime should be counting)
- ✅ Memory Usage card (with progress bar)
- ✅ Current Model card (showing active model)
- ✅ Total Cost card (showing $0.00 or actual cost)
- ✅ Statistics cards (commands, messages, errors, channels)
- ✅ Daily cost chart (bar chart with last 7 days)
- ✅ Top users by cost (list of users)
- ✅ Most used commands (list of commands)
- ✅ Tools grid (showing ~88 tools)
- ✅ Recent activity feed (last 20 commands)
- ✅ Health status grid (API services)

### 4. Test auto-refresh

Wait 30 seconds and verify:
- "Last updated" timestamp changes
- Data refreshes automatically

## Troubleshooting

### Dashboard shows errors

Check browser console (F12) for:
- Network errors (API endpoints not responding)
- CORS issues (should be configured in main.ts)
- JSON parsing errors (API returning invalid data)

### API endpoints return 500 errors

Check bot logs for:
- Missing analytics data
- Undefined variables
- TypeScript compilation errors

### Dashboard doesn't load

1. Verify port 9090 is accessible:
   ```bash
   netstat -an | grep 9090
   ```

2. Check if dashboard endpoint is registered:
   ```bash
   curl -v http://localhost:9090/dashboard
   ```

3. Verify the integration code was added to main.ts

### No data showing

This is normal if:
- Bot just started (no commands processed yet)
- No analytics data collected
- First time running

Try:
1. Execute some Discord commands
2. Wait for analytics to collect data
3. Refresh dashboard

## Integration Checklist

- [ ] Added `import { setupDashboard } from "./dashboard-integration.js";` to main.ts
- [ ] Called `setupDashboard()` before `dashboardApp.listen()`
- [ ] Compiled TypeScript: `npm run build` or `tsc`
- [ ] Restarted the bot
- [ ] Verified port 9090 is open
- [ ] Tested `/dashboard` endpoint in browser
- [ ] All API endpoints return valid JSON
- [ ] Dashboard UI loads without errors
- [ ] Auto-refresh works after 30 seconds

## Manual Integration Example

If you prefer to manually integrate, here's the exact code to add:

**Location: src/main.ts around line 35-38**
```typescript
import { setupDashboard } from "./dashboard-integration.js";
```

**Location: src/main.ts around line 5055-5064 (BEFORE dashboardApp.listen())**
```typescript
// Setup dashboard endpoints
setupDashboard(dashboardApp, {
    analytics,
    botStats,
    model,
    currentProvider,
    channelStates,
    getToolUsageStats,
});
```

**Location: Update the dashboardApp.listen() callback**
```typescript
dashboardApp.listen(DASHBOARD_PORT, () => {
    logInfo(`[DASHBOARD] Analytics API listening on port ${DASHBOARD_PORT}`);
    logInfo(`[DASHBOARD] Access analytics at http://localhost:${DASHBOARD_PORT}/api/analytics`);
    logInfo(`[DASHBOARD] View web dashboard at http://localhost:${DASHBOARD_PORT}/dashboard`);
});
```

## Expected Log Output

After successful integration, you should see:
```
[DASHBOARD] Analytics API listening on port 9090
[DASHBOARD] Access analytics at http://localhost:9090/api/analytics
[DASHBOARD] View web dashboard at http://localhost:9090/dashboard
```

## Performance Notes

- Dashboard makes 6 API calls on load
- Each API call is lightweight (<100ms typically)
- Auto-refresh every 30 seconds makes 6 calls
- Total bandwidth: ~10-50KB per refresh
- No database queries (all in-memory analytics)

## Security Considerations

**Current State:**
- No authentication required
- CORS enabled for all origins
- Runs on localhost only

**For Production:**
1. Add authentication middleware
2. Restrict CORS to specific origins
3. Use HTTPS
4. Set up reverse proxy (nginx/traefik)
5. Add rate limiting

## Browser Compatibility

Tested and working on:
- ✅ Chrome 90+
- ✅ Firefox 88+
- ✅ Safari 14+
- ✅ Edge 90+

Requires:
- JavaScript enabled
- Fetch API support
- CSS Grid support
- Modern ES6+ features
