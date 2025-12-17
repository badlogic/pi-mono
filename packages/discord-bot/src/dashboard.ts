/**
 * Dashboard HTML Template for Pi Discord Bot
 * A modern, dark-themed web dashboard with real-time stats
 */

export const dashboardHTML = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Pi Discord Bot - Dashboard</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            color: #e0e0e0;
            min-height: 100vh;
            padding: 20px;
        }

        .container {
            max-width: 1400px;
            margin: 0 auto;
        }

        header {
            text-align: center;
            margin-bottom: 40px;
            padding: 20px;
            background: rgba(255, 255, 255, 0.05);
            border-radius: 12px;
            backdrop-filter: blur(10px);
        }

        h1 {
            font-size: 2.5em;
            background: linear-gradient(45deg, #667eea 0%, #764ba2 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            margin-bottom: 10px;
        }

        .subtitle {
            color: #a0a0a0;
            font-size: 1.1em;
        }

        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
            margin-bottom: 20px;
        }

        .card {
            background: rgba(255, 255, 255, 0.05);
            border-radius: 12px;
            padding: 20px;
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            transition: transform 0.2s, box-shadow 0.2s;
        }

        .card:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 24px rgba(102, 126, 234, 0.2);
        }

        .card-title {
            font-size: 1.2em;
            margin-bottom: 15px;
            color: #667eea;
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .card-icon {
            font-size: 1.5em;
        }

        .stat-value {
            font-size: 2.5em;
            font-weight: bold;
            margin: 10px 0;
            background: linear-gradient(45deg, #667eea 0%, #764ba2 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }

        .stat-label {
            color: #a0a0a0;
            font-size: 0.9em;
            text-transform: uppercase;
            letter-spacing: 1px;
        }

        .wide-card {
            grid-column: 1 / -1;
        }

        .half-card {
            grid-column: span 1;
        }

        @media (min-width: 768px) {
            .half-card {
                grid-column: span 1;
            }
            .two-thirds-card {
                grid-column: span 2;
            }
        }

        .list-item {
            display: flex;
            justify-content: space-between;
            padding: 12px;
            margin: 8px 0;
            background: rgba(255, 255, 255, 0.03);
            border-radius: 8px;
            border-left: 3px solid #667eea;
        }

        .list-item:hover {
            background: rgba(255, 255, 255, 0.08);
        }

        .badge {
            display: inline-block;
            padding: 4px 12px;
            border-radius: 12px;
            font-size: 0.85em;
            font-weight: 600;
        }

        .badge-success {
            background: rgba(46, 213, 115, 0.2);
            color: #2ed573;
        }

        .badge-warning {
            background: rgba(255, 159, 64, 0.2);
            color: #ffa502;
        }

        .badge-error {
            background: rgba(255, 71, 87, 0.2);
            color: #ff4757;
        }

        .badge-info {
            background: rgba(102, 126, 234, 0.2);
            color: #667eea;
        }

        .progress-bar {
            width: 100%;
            height: 8px;
            background: rgba(255, 255, 255, 0.1);
            border-radius: 4px;
            overflow: hidden;
            margin: 10px 0;
        }

        .progress-fill {
            height: 100%;
            background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
            border-radius: 4px;
            transition: width 0.3s ease;
        }

        .chart-container {
            margin-top: 20px;
        }

        .bar-chart {
            display: flex;
            align-items: flex-end;
            justify-content: space-between;
            height: 200px;
            gap: 8px;
            margin-top: 20px;
        }

        .bar {
            flex: 1;
            background: linear-gradient(180deg, #667eea 0%, #764ba2 100%);
            border-radius: 4px 4px 0 0;
            position: relative;
            min-height: 2px;
            transition: all 0.3s ease;
        }

        .bar:hover {
            opacity: 0.8;
        }

        .bar-label {
            position: absolute;
            bottom: -25px;
            left: 50%;
            transform: translateX(-50%);
            font-size: 0.75em;
            color: #a0a0a0;
            white-space: nowrap;
        }

        .bar-value {
            position: absolute;
            top: -25px;
            left: 50%;
            transform: translateX(-50%);
            font-size: 0.8em;
            color: #667eea;
            font-weight: 600;
        }

        .tool-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
            gap: 10px;
            max-height: 400px;
            overflow-y: auto;
            padding: 10px;
        }

        .tool-item {
            background: rgba(255, 255, 255, 0.03);
            padding: 10px;
            border-radius: 6px;
            font-size: 0.9em;
            border-left: 2px solid #667eea;
        }

        .tool-name {
            font-weight: 600;
            color: #e0e0e0;
            margin-bottom: 4px;
        }

        .tool-count {
            color: #a0a0a0;
            font-size: 0.85em;
        }

        .activity-feed {
            max-height: 500px;
            overflow-y: auto;
        }

        .activity-item {
            padding: 15px;
            margin: 10px 0;
            background: rgba(255, 255, 255, 0.03);
            border-radius: 8px;
            border-left: 3px solid #667eea;
        }

        .activity-time {
            color: #a0a0a0;
            font-size: 0.85em;
            margin-bottom: 5px;
        }

        .activity-user {
            color: #667eea;
            font-weight: 600;
        }

        .activity-command {
            color: #e0e0e0;
            margin-top: 5px;
            font-family: monospace;
            background: rgba(0, 0, 0, 0.3);
            padding: 8px;
            border-radius: 4px;
            font-size: 0.9em;
        }

        .health-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
            gap: 15px;
        }

        .health-item {
            text-align: center;
            padding: 15px;
            background: rgba(255, 255, 255, 0.03);
            border-radius: 8px;
        }

        .health-status {
            font-size: 2em;
            margin-bottom: 8px;
        }

        .health-name {
            font-size: 0.9em;
            color: #a0a0a0;
        }

        .health-latency {
            font-size: 0.85em;
            color: #667eea;
            margin-top: 4px;
        }

        .refresh-info {
            text-align: center;
            color: #a0a0a0;
            margin-top: 20px;
            font-size: 0.9em;
        }

        .loading {
            text-align: center;
            padding: 20px;
            color: #a0a0a0;
        }

        .error {
            text-align: center;
            padding: 20px;
            color: #ff4757;
            background: rgba(255, 71, 87, 0.1);
            border-radius: 8px;
            margin: 20px 0;
        }

        /* Scrollbar styling */
        ::-webkit-scrollbar {
            width: 8px;
            height: 8px;
        }

        ::-webkit-scrollbar-track {
            background: rgba(255, 255, 255, 0.05);
            border-radius: 4px;
        }

        ::-webkit-scrollbar-thumb {
            background: rgba(102, 126, 234, 0.5);
            border-radius: 4px;
        }

        ::-webkit-scrollbar-thumb:hover {
            background: rgba(102, 126, 234, 0.7);
        }

        /* Responsive design */
        @media (max-width: 768px) {
            .grid {
                grid-template-columns: 1fr;
            }

            h1 {
                font-size: 2em;
            }

            .stat-value {
                font-size: 2em;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>Pi Discord Bot Dashboard</h1>
            <p class="subtitle">Real-time monitoring and analytics</p>
        </header>

        <div id="error-container"></div>

        <!-- Status Overview -->
        <div class="grid">
            <div class="card">
                <div class="card-title">
                    <span class="card-icon">🤖</span>
                    Bot Status
                </div>
                <div class="stat-value" id="bot-status">Online</div>
                <div class="stat-label">UPTIME: <span id="uptime">--</span></div>
            </div>

            <div class="card">
                <div class="card-title">
                    <span class="card-icon">💾</span>
                    Memory Usage
                </div>
                <div class="stat-value" id="memory-usage">--</div>
                <div class="stat-label">Heap Used / Total</div>
                <div class="progress-bar">
                    <div class="progress-fill" id="memory-bar" style="width: 0%"></div>
                </div>
            </div>

            <div class="card">
                <div class="card-title">
                    <span class="card-icon">🧠</span>
                    Current Model
                </div>
                <div class="stat-value" id="current-model" style="font-size: 1.3em;">--</div>
                <div class="stat-label" id="model-provider">--</div>
            </div>

            <div class="card">
                <div class="card-title">
                    <span class="card-icon">💰</span>
                    Total Cost
                </div>
                <div class="stat-value" id="total-cost">$0.00</div>
                <div class="stat-label">ESTIMATED USD</div>
            </div>
        </div>

        <!-- Statistics -->
        <div class="grid">
            <div class="card">
                <div class="card-title">
                    <span class="card-icon">📊</span>
                    Commands Processed
                </div>
                <div class="stat-value" id="total-commands">0</div>
                <div class="stat-label">All Time</div>
            </div>

            <div class="card">
                <div class="card-title">
                    <span class="card-icon">💬</span>
                    Messages
                </div>
                <div class="stat-value" id="total-messages">0</div>
                <div class="stat-label">Total Processed</div>
            </div>

            <div class="card">
                <div class="card-title">
                    <span class="card-icon">❌</span>
                    Errors
                </div>
                <div class="stat-value" id="total-errors">0</div>
                <div class="stat-label">Total Count</div>
            </div>

            <div class="card">
                <div class="card-title">
                    <span class="card-icon">🔗</span>
                    Active Channels
                </div>
                <div class="stat-value" id="active-channels">0</div>
                <div class="stat-label">Connected</div>
            </div>
        </div>

        <!-- Daily Stats Chart -->
        <div class="card wide-card">
            <div class="card-title">
                <span class="card-icon">📈</span>
                Daily Cost Breakdown (Last 7 Days)
            </div>
            <div class="chart-container">
                <div class="bar-chart" id="daily-chart">
                    <div class="loading">Loading chart data...</div>
                </div>
            </div>
        </div>

        <!-- Two Column Layout -->
        <div class="grid">
            <!-- Top Users by Cost -->
            <div class="card">
                <div class="card-title">
                    <span class="card-icon">👥</span>
                    Top Users by Cost
                </div>
                <div id="top-users">
                    <div class="loading">Loading...</div>
                </div>
            </div>

            <!-- Top Commands -->
            <div class="card">
                <div class="card-title">
                    <span class="card-icon">⚡</span>
                    Most Used Commands
                </div>
                <div id="top-commands">
                    <div class="loading">Loading...</div>
                </div>
            </div>
        </div>

        <!-- Tools Overview -->
        <div class="card wide-card">
            <div class="card-title">
                <span class="card-icon">🛠️</span>
                Tools (89 Available)
            </div>
            <div class="tool-grid" id="tools-grid">
                <div class="loading">Loading tools...</div>
            </div>
        </div>

        <!-- Recent Activity -->
        <div class="card wide-card">
            <div class="card-title">
                <span class="card-icon">📝</span>
                Recent Activity (Last 20 Commands)
            </div>
            <div class="activity-feed" id="activity-feed">
                <div class="loading">Loading activity...</div>
            </div>
        </div>

        <!-- Health Status -->
        <div class="card wide-card">
            <div class="card-title">
                <span class="card-icon">🏥</span>
                API Health Status
            </div>
            <div class="health-grid" id="health-grid">
                <div class="loading">Loading health status...</div>
            </div>
        </div>

        <div class="refresh-info">
            Auto-refreshing every 30 seconds • Last updated: <span id="last-update">--</span>
        </div>
    </div>

    <script>
        // Configuration
        const API_BASE = '';
        const REFRESH_INTERVAL = 30000; // 30 seconds

        // Utility functions
        function formatUptime(seconds) {
            const days = Math.floor(seconds / 86400);
            const hours = Math.floor((seconds % 86400) / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            const secs = seconds % 60;

            if (days > 0) return \`\${days}d \${hours}h \${minutes}m\`;
            if (hours > 0) return \`\${hours}h \${minutes}m \${secs}s\`;
            if (minutes > 0) return \`\${minutes}m \${secs}s\`;
            return \`\${secs}s\`;
        }

        function formatMemory(bytes) {
            if (bytes === 0) return '0 MB';
            const mb = bytes / (1024 * 1024);
            return \`\${mb.toFixed(1)} MB\`;
        }

        function formatCurrency(amount) {
            return new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: 'USD',
                minimumFractionDigits: 4,
                maximumFractionDigits: 4
            }).format(amount);
        }

        function formatTime(timestamp) {
            const date = new Date(timestamp);
            return date.toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        }

        function showError(message) {
            const container = document.getElementById('error-container');
            container.innerHTML = \`<div class="error">Error: \${message}</div>\`;
        }

        function clearError() {
            document.getElementById('error-container').innerHTML = '';
        }

        // Fetch bot status
        async function fetchStatus() {
            try {
                const response = await fetch(\`\${API_BASE}/api/status\`);
                if (!response.ok) throw new Error('Failed to fetch status');
                const data = await response.json();

                document.getElementById('uptime').textContent = formatUptime(data.uptime);
                document.getElementById('current-model').textContent = data.model || 'N/A';
                document.getElementById('model-provider').textContent = (data.provider || 'Unknown').toUpperCase();

                // Memory
                if (data.memory) {
                    const memUsed = data.memory.heapUsed;
                    const memTotal = data.memory.heapTotal;
                    const percentage = (memUsed / memTotal) * 100;
                    document.getElementById('memory-usage').textContent = \`\${formatMemory(memUsed)}\`;
                    document.getElementById('memory-bar').style.width = \`\${percentage}%\`;
                }

                clearError();
            } catch (error) {
                console.error('Status fetch error:', error);
                showError('Failed to fetch bot status');
            }
        }

        // Fetch statistics
        async function fetchStats() {
            try {
                const response = await fetch(\`\${API_BASE}/api/stats\`);
                if (!response.ok) throw new Error('Failed to fetch stats');
                const data = await response.json();

                document.getElementById('total-commands').textContent = data.totalCommands || 0;
                document.getElementById('total-messages').textContent = data.totalMessages || 0;
                document.getElementById('total-errors').textContent = data.totalErrors || 0;
                document.getElementById('active-channels').textContent = data.activeChannels || 0;

                // Top commands
                if (data.topCommands && data.topCommands.length > 0) {
                    const html = data.topCommands.slice(0, 5).map(cmd => \`
                        <div class="list-item">
                            <span>\${cmd.command}</span>
                            <span class="badge badge-info">\${cmd.count} uses</span>
                        </div>
                    \`).join('');
                    document.getElementById('top-commands').innerHTML = html;
                } else {
                    document.getElementById('top-commands').innerHTML = '<div class="loading">No commands yet</div>';
                }

                clearError();
            } catch (error) {
                console.error('Stats fetch error:', error);
                showError('Failed to fetch statistics');
            }
        }

        // Fetch cost data
        async function fetchCosts() {
            try {
                const response = await fetch(\`\${API_BASE}/api/costs\`);
                if (!response.ok) throw new Error('Failed to fetch costs');
                const data = await response.json();

                document.getElementById('total-cost').textContent = formatCurrency(data.totalCost || 0);

                // Top users by cost
                if (data.topUsers && data.topUsers.length > 0) {
                    const html = data.topUsers.slice(0, 5).map(user => \`
                        <div class="list-item">
                            <span>\${user.username}</span>
                            <span class="badge badge-warning">\${formatCurrency(user.cost)}</span>
                        </div>
                    \`).join('');
                    document.getElementById('top-users').innerHTML = html;
                } else {
                    document.getElementById('top-users').innerHTML = '<div class="loading">No cost data yet</div>';
                }

                // Daily breakdown chart
                if (data.dailyCosts && data.dailyCosts.length > 0) {
                    const maxCost = Math.max(...data.dailyCosts.map(d => d.cost), 0.01);
                    const html = data.dailyCosts.map(day => {
                        const height = (day.cost / maxCost) * 100;
                        const date = new Date(day.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                        return \`
                            <div class="bar" style="height: \${height}%">
                                <div class="bar-value">\${formatCurrency(day.cost)}</div>
                                <div class="bar-label">\${date}</div>
                            </div>
                        \`;
                    }).join('');
                    document.getElementById('daily-chart').innerHTML = html;
                } else {
                    document.getElementById('daily-chart').innerHTML = '<div class="loading">No daily cost data yet</div>';
                }

                clearError();
            } catch (error) {
                console.error('Costs fetch error:', error);
                showError('Failed to fetch cost data');
            }
        }

        // Fetch tools
        async function fetchTools() {
            try {
                const response = await fetch(\`\${API_BASE}/api/tools\`);
                if (!response.ok) throw new Error('Failed to fetch tools');
                const data = await response.json();

                if (data.tools && data.tools.length > 0) {
                    const html = data.tools.map(tool => \`
                        <div class="tool-item">
                            <div class="tool-name">\${tool.name}</div>
                            <div class="tool-count">\${tool.count || 0} uses</div>
                        </div>
                    \`).join('');
                    document.getElementById('tools-grid').innerHTML = html;
                } else {
                    document.getElementById('tools-grid').innerHTML = '<div class="loading">No tools data</div>';
                }

                clearError();
            } catch (error) {
                console.error('Tools fetch error:', error);
                showError('Failed to fetch tools');
            }
        }

        // Fetch recent activity
        async function fetchActivity() {
            try {
                const response = await fetch(\`\${API_BASE}/api/activity\`);
                if (!response.ok) throw new Error('Failed to fetch activity');
                const data = await response.json();

                if (data.activity && data.activity.length > 0) {
                    const html = data.activity.slice(0, 20).map(item => \`
                        <div class="activity-item">
                            <div class="activity-time">\${formatTime(item.timestamp)}</div>
                            <div>
                                <span class="activity-user">\${item.username}</span>
                                used command: <strong>\${item.command}</strong>
                            </div>
                            \${item.responseTime ? \`<div class="activity-command">Response time: \${item.responseTime}ms</div>\` : ''}
                        </div>
                    \`).join('');
                    document.getElementById('activity-feed').innerHTML = html;
                } else {
                    document.getElementById('activity-feed').innerHTML = '<div class="loading">No recent activity</div>';
                }

                clearError();
            } catch (error) {
                console.error('Activity fetch error:', error);
                showError('Failed to fetch activity');
            }
        }

        // Fetch health status
        async function fetchHealth() {
            try {
                const response = await fetch(\`\${API_BASE}/api/health\`);
                if (!response.ok) throw new Error('Failed to fetch health');
                const data = await response.json();

                if (data.services && data.services.length > 0) {
                    const html = data.services.map(service => {
                        const statusIcon = service.status === 'ok' ? '✅' :
                                         service.status === 'degraded' ? '⚠️' : '❌';
                        return \`
                            <div class="health-item">
                                <div class="health-status">\${statusIcon}</div>
                                <div class="health-name">\${service.name}</div>
                                \${service.latency ? \`<div class="health-latency">\${service.latency}ms</div>\` : ''}
                            </div>
                        \`;
                    }).join('');
                    document.getElementById('health-grid').innerHTML = html;
                } else {
                    document.getElementById('health-grid').innerHTML = '<div class="loading">No health data</div>';
                }

                clearError();
            } catch (error) {
                console.error('Health fetch error:', error);
                document.getElementById('health-grid').innerHTML = '<div class="loading">Health check unavailable</div>';
            }
        }

        // Update all data
        async function updateDashboard() {
            const now = new Date().toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
            document.getElementById('last-update').textContent = now;

            await Promise.all([
                fetchStatus(),
                fetchStats(),
                fetchCosts(),
                fetchTools(),
                fetchActivity(),
                fetchHealth()
            ]);
        }

        // Initialize dashboard
        document.addEventListener('DOMContentLoaded', () => {
            updateDashboard();
            setInterval(updateDashboard, REFRESH_INTERVAL);
        });
    </script>
</body>
</html>
`;
