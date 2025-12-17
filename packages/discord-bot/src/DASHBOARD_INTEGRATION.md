# Dashboard Integration Instructions

## Overview
The web dashboard UI has been created and is ready to integrate into the Discord bot.

## Files Created

1. **src/dashboard.ts** - Contains the complete HTML/CSS/JS for the dashboard UI
2. **src/dashboard-integration.ts** - Exports the `setupDashboard()` function that adds all API endpoints

## Integration Steps

To integrate the dashboard into main.ts, add the following code:

### Step 1: Add Import (around line 35-38)

Add this import after the other imports:

```typescript
import { setupDashboard } from "./dashboard-integration.js";
```

### Step 2: Setup Dashboard Endpoints (around line 5055-5064)

Find this section in main.ts:

```typescript
	// Health check for dashboard
	dashboardApp.get("/api/health", (req, res) => {
		res.json({
			status: "ok",
			uptime: process.uptime(),
			model: model.id,
			channels: channelStates.size,
			analyticsEnabled: true,
		});
	});

	dashboardApp.listen(DASHBOARD_PORT, () => {
		logInfo(`[DASHBOARD] Analytics API listening on port ${DASHBOARD_PORT}`);
		logInfo(`[DASHBOARD] Access analytics at http://localhost:${DASHBOARD_PORT}/api/analytics`);
	});
```

**Add this code BEFORE `dashboardApp.listen()`:**

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

**And update the listen callback:**

```typescript
	dashboardApp.listen(DASHBOARD_PORT, () => {
		logInfo(`[DASHBOARD] Analytics API listening on port ${DASHBOARD_PORT}`);
		logInfo(`[DASHBOARD] Access analytics at http://localhost:${DASHBOARD_PORT}/api/analytics`);
		logInfo(`[DASHBOARD] View web dashboard at http://localhost:${DASHBOARD_PORT}/dashboard`);
	});
```

## API Endpoints Added

The dashboard integration adds these endpoints:

- `GET /api/status` - Bot status, uptime, memory, model, service health
- `GET /api/stats` - Command statistics, messages, errors, channels
- `GET /api/costs` - Cost tracking, top users, daily breakdown
- `GET /api/tools` - List of 89 tools with usage counts
- `GET /api/activity` - Last 20 command executions
- `GET /dashboard` - Serves the HTML dashboard UI

## Access the Dashboard

After integration and bot restart:

1. The dashboard will be available at: `http://localhost:9090/dashboard`
2. The port can be configured via `DASHBOARD_PORT` environment variable
3. Auto-refreshes every 30 seconds
4. No build step needed - it's a single self-contained HTML file

## Features

- **Status Section**: Bot uptime, memory usage, current model
- **Stats Section**: Commands processed, messages, errors, active channels
- **Cost Tracking**: Total cost, top users by cost, 7-day chart
- **Tools Overview**: All 89 tools with usage counts
- **Recent Activity**: Last 20 commands with timestamps
- **Health Status**: API status for OpenRouter, Fal.ai, Suno, LiveKit, ElevenLabs
- **Dark Theme**: Modern Discord-like dark theme
- **Responsive**: Works on mobile and desktop
