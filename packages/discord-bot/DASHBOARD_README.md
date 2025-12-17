# Discord Bot Web Dashboard

A modern, dark-themed web dashboard for monitoring and managing the Pi Discord Bot.

## Quick Start

### Integration (Manual Step Required)

The dashboard code is ready but requires two small additions to `src/main.ts`:

1. **Add import** (around line 35-38):
   ```typescript
   import { setupDashboard } from "./dashboard-integration.js";
   ```

2. **Setup endpoints** (around line 5055, BEFORE `dashboardApp.listen()`):
   ```typescript
   setupDashboard(dashboardApp, {
       analytics,
       botStats,
       model,
       currentProvider,
       channelStates,
       getToolUsageStats,
   });
   ```

See `src/DASHBOARD_INTEGRATION.md` for detailed instructions.

### Access Dashboard

After integration and restart:
- Dashboard URL: `http://localhost:9090/dashboard`
- Port configurable via `DASHBOARD_PORT` env variable
- Auto-refreshes every 30 seconds

## Features

### 📊 Status Overview
- Bot uptime and status
- Memory usage with visual progress bar
- Current AI model and provider (Ollama/OpenRouter)
- Total estimated costs

### 📈 Statistics
- Total commands processed
- Total messages handled
- Error count
- Active Discord channels

### 💰 Cost Tracking
- Total estimated USD cost
- Top users by cost (top 5)
- Most used commands (top 5)
- 7-day daily cost breakdown chart

### 🛠️ Tools Overview
- List of all 89 available tools
- Usage count per tool
- Average execution duration
- Error counts
- Last used timestamp

### 📝 Recent Activity
- Last 20 command executions
- Timestamps
- Response times
- User information

### 🏥 API Health Status
- OpenRouter API status and latency
- Fal.ai (Images) configuration status
- Suno (Music) configuration status
- LiveKit (Voice) configuration status
- ElevenLabs (TTS) configuration status

## API Endpoints

All endpoints served on port 9090 (configurable):

- `GET /dashboard` - Main dashboard HTML UI
- `GET /api/status` - Bot status, uptime, memory, model info
- `GET /api/stats` - Usage statistics (commands, messages, errors)
- `GET /api/costs` - Cost tracking data with daily breakdown
- `GET /api/tools` - List of all tools with usage stats
- `GET /api/activity` - Recent command activity feed
- `GET /api/health` - Health check endpoint (existing)
- `GET /api/analytics` - Detailed analytics (existing)

## Technology Stack

- **Pure HTML/CSS/JavaScript** - No build step required
- **Single file** - Complete dashboard in one HTML file
- **No dependencies** - No external libraries needed
- **Real-time** - Auto-refresh every 30 seconds
- **Responsive** - Works on mobile and desktop

## Design

- **Dark Theme**: Discord-like dark theme with gradients
- **Modern UI**: Cards, progress bars, charts
- **Pure CSS Charts**: Bar charts rendered with CSS (no libraries)
- **Smooth Animations**: Hover effects and transitions
- **Glassmorphism**: Backdrop blur effects

## Files Created

```
src/
├── dashboard.ts                   # Main dashboard HTML template
├── dashboard-integration.ts       # Setup function with all endpoints
├── dashboard-endpoints.ts         # Alternative endpoint implementation
└── DASHBOARD_INTEGRATION.md      # Integration instructions
```

## Screenshots (Sections)

### Status Cards (4 cards)
- Bot Status: Online/Offline with uptime
- Memory Usage: MB used with progress bar
- Current Model: AI model name and provider
- Total Cost: USD amount

### Statistics Cards (4 cards)
- Commands Processed: Total count
- Messages: Total processed
- Errors: Error count
- Active Channels: Connected channels

### Cost Tracking
- Top Users by Cost (top 5 with amounts)
- Most Used Commands (top 5 with counts)
- Daily Cost Chart (7-day bar chart)

### Tools Grid
- 89 tools displayed in a scrollable grid
- Each showing name, usage count

### Activity Feed
- Scrollable list of last 20 commands
- Timestamp, user, command name, response time

### Health Grid
- 5+ services with status indicators
- Green check ✅ / Yellow warning ⚠️ / Red error ❌
- Latency for API services

## Customization

### Colors
Edit CSS variables in `dashboard.ts`:
- Primary gradient: `#667eea` to `#764ba2`
- Background: `#1a1a2e` to `#16213e`
- Card background: `rgba(255, 255, 255, 0.05)`

### Refresh Rate
Change `REFRESH_INTERVAL` in JavaScript (default: 30000ms)

### Port
Set `DASHBOARD_PORT` environment variable (default: 9090)

## Security Notes

- Dashboard currently has no authentication
- Runs on localhost by default
- For production: Add authentication middleware
- For public access: Set up reverse proxy with auth

## Future Enhancements

Potential additions:
- [ ] User authentication
- [ ] Real-time WebSocket updates
- [ ] Command execution from UI
- [ ] Bot control (start/stop/restart)
- [ ] Configuration editor
- [ ] Log viewer
- [ ] More detailed analytics graphs
- [ ] Export data (CSV/JSON)
- [ ] Dark/Light theme toggle
- [ ] Custom date range selection
