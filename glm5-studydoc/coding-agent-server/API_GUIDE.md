# Coding Agent Server API 使用指南

## 概述

本文档提供 Coding Agent Server 的完整 API 使用示例，包括多会话管理、代码分析和流式响应。

## 基础配置

### 环境变量

```bash
# 必需
ANTHROPIC_API_KEY=sk-ant-your-key-here

# 可选（使用默认值）
PROVIDER=anthropic
MODEL_ID=claude-sonnet-4-20250514
THINKING_LEVEL=medium
PORT=3000
REPO_PATH=/app/repo

# 多会话配置
MAX_SESSIONS=10
SESSION_IDLE_TIMEOUT_MS=1800000      # 30分钟
SESSION_MAX_LIFETIME_MS=7200000      # 2小时

# GitHub ZIP 下载（可选）
GITHUB_PAT=ghp_your_fine_grained_pat
```

### 启动服务

```bash
# 本地开发
npm install
npm run build
npm start

# Docker
docker-compose up -d
```

---

## 会话管理

### 会话标识

使用 `X-Session-Id` HTTP Header 区分不同会话：

```bash
# 不指定时默认使用 "default"
curl http://localhost:3000/health

# 指定会话 ID
curl -H "X-Session-Id: user-123" http://localhost:3000/health
```

### 多用户场景示例

```bash
# 用户 A 分析项目
curl -X POST http://localhost:3000/analyze \
  -H "Content-Type: application/json" \
  -H "X-Session-Id: user-alice" \
  -d '{"prompt": "分析这个项目的架构"}'

# 用户 B 同时分析（完全隔离）
curl -X POST http://localhost:3000/analyze \
  -H "Content-Type: application/json" \
  -H "X-Session-Id: user-bob" \
  -d '{"prompt": "找出所有安全漏洞"}'

# 用户 A 继续对话（保持上下文）
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -H "X-Session-Id: user-alice" \
  -d '{"prompt": "详细解释刚才提到的模块"}'
```

---

## API 端点

### 1. 健康检查

```bash
curl http://localhost:3000/health
```

**响应：**
```json
{
  "status": "ok",
  "sessions": {
    "totalSessions": 2,
    "maxSessions": 10,
    "oldestSessionAgeMs": 300000,
    "longestIdleMs": 60000
  },
  "config": {
    "repoPath": "/app/repo",
    "provider": "anthropic",
    "modelId": "claude-sonnet-4-20250514",
    "thinkingLevel": "medium",
    "hasApiKey": true,
    "maxSessions": 10,
    "sessionIdleTimeoutMs": 1800000,
    "sessionMaxLifetimeMs": 7200000
  }
}
```

---

### 2. 代码分析

```bash
curl -X POST http://localhost:3000/analyze \
  -H "Content-Type: application/json" \
  -H "X-Session-Id: my-session" \
  -d '{
    "prompt": "分析这个代码库的架构，列出主要模块和入口点"
  }'
```

**响应：**
```json
{
  "success": true,
  "response": "这个项目采用分层架构...",
  "toolCalls": [
    {
      "name": "ls",
      "args": {"path": "."},
      "result": "src/\npackage.json\nREADME.md",
      "isError": false
    },
    {
      "name": "read",
      "args": {"path": "package.json"},
      "result": "{...}",
      "isError": false
    }
  ],
  "tokens": {
    "input": 1500,
    "output": 800,
    "total": 2300
  },
  "sessionId": "my-session",
  "duration": 5200
}
```

---

### 3. 流式分析

```bash
curl -X POST http://localhost:3000/analyze/stream \
  -H "Content-Type: application/json" \
  -H "X-Session-Id: stream-session" \
  -d '{
    "prompt": "解释这个项目的主要功能"
  }'
```

**SSE 事件：**

```
data: {"type":"tool_start","toolName":"ls","args":{"path":"."}}

data: {"type":"tool_end","toolName":"ls","isError":false}

data: {"type":"delta","text":"这个项目是一个"}

data: {"type":"delta","text":"代码分析工具，"}

data: {"type":"delta","text":"主要功能包括..."}

data: {"type":"done","sessionId":"stream-session","result":{"success":true,"response":"...","duration":3200}}
```

**JavaScript 客户端示例：**

```javascript
const eventSource = new EventSource('http://localhost:3000/analyze/stream', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    prompt: '分析代码结构',
    sessionId: 'my-session'
  })
});

eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  
  switch (data.type) {
    case 'delta':
      console.log('文本:', data.text);
      break;
    case 'tool_start':
      console.log('开始工具:', data.toolName);
      break;
    case 'tool_end':
      console.log('工具完成:', data.toolName);
      break;
    case 'done':
      console.log('分析完成:', data.result);
      eventSource.close();
      break;
    case 'error':
      console.error('错误:', data.message);
      eventSource.close();
      break;
  }
};
```

---

### 4. 简单对话

```bash
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -H "X-Session-Id: chat-session" \
  -d '{
    "prompt": "当前目录有哪些文件？"
  }'
```

**响应：**
```json
{
  "success": true,
  "response": "当前目录包含以下文件：src/、package.json、README.md...",
  "sessionId": "chat-session",
  "duration": 1200
}
```

---

### 5. 获取消息历史

```bash
curl -H "X-Session-Id: my-session" \
  http://localhost:3000/messages
```

**响应：**
```json
{
  "success": true,
  "sessionId": "my-session",
  "count": 4,
  "messages": [
    { "role": "user", "content": "分析架构" },
    { "role": "assistant", "content": "..." },
    { "role": "user", "content": "详细解释" },
    { "role": "assistant", "content": "..." }
  ]
}
```

---

### 6. 会话管理

#### 列出所有会话

```bash
curl http://localhost:3000/sessions
```

**响应：**
```json
{
  "success": true,
  "sessions": [
    {
      "id": "user-alice",
      "createdAt": "2024-01-15T10:00:00Z",
      "lastAccessedAt": "2024-01-15T10:05:00Z",
      "requestCount": 3,
      "ageMs": 300000,
      "idleMs": 60000
    },
    {
      "id": "user-bob",
      "createdAt": "2024-01-15T10:02:00Z",
      "lastAccessedAt": "2024-01-15T10:06:00Z",
      "requestCount": 2,
      "ageMs": 240000,
      "idleMs": 120000
    }
  ],
  "stats": {
    "totalSessions": 2,
    "maxSessions": 10,
    "oldestSessionAgeMs": 300000,
    "longestIdleMs": 120000
  }
}
```

#### 销毁指定会话

```bash
curl -X DELETE http://localhost:3000/sessions/user-alice
```

**响应：**
```json
{
  "success": true,
  "message": "Session user-alice destroyed"
}
```

#### 重置当前会话

```bash
curl -X POST http://localhost:3000/reset \
  -H "X-Session-Id: my-session"
```

**响应：**
```json
{
  "success": true,
  "message": "Session my-session reset successfully"
}
```

---

## 高级用例

### 用例 1：克隆并分析 GitHub 仓库

```bash
# 步骤 1：克隆仓库（使用 git_clone 工具）
curl -X POST http://localhost:3000/analyze \
  -H "Content-Type: application/json" \
  -H "X-Session-Id: github-analysis" \
  -d '{
    "prompt": "使用 git_clone 工具克隆 https://github.com/example/project.git，然后分析其代码结构"
  }'

# 或使用 github_zip（更快，需要 GITHUB_PAT）
curl -X POST http://localhost:3000/analyze \
  -H "Content-Type: application/json" \
  -H "X-Session-Id: github-analysis" \
  -d '{
    "prompt": "使用 github_zip 工具下载 owner=facebook repo=react ref=main，然后分析核心模块"
  }'
```

### 用例 2：批量代码审查

```bash
#!/bin/bash

PROJECTS=("project-a" "project-b" "project-c")

for project in "${PROJECTS[@]}"; do
  echo "审查 $project..."
  
  curl -X POST http://localhost:3000/analyze \
    -H "Content-Type: application/json" \
    -H "X-Session-Id: review-$project" \
    -d "{
      \"prompt\": \"对 /repos/$project 进行安全审查，检查：1) 硬编码密钥 2) SQL注入 3) XSS漏洞\"
    }" > "review-$project.json"
  
  # 销毁会话释放资源
  curl -X DELETE "http://localhost:3000/sessions/review-$project"
done
```

### 用例 3：交互式分析会话

```bash
#!/bin/bash

SESSION_ID="interactive-$(date +%s)"
REPO_PATH="/repos/my-project"

echo "开始交互式分析会话: $SESSION_ID"

# 第一轮：了解项目结构
response=$(curl -s -X POST http://localhost:3000/analyze \
  -H "Content-Type: application/json" \
  -H "X-Session-Id: $SESSION_ID" \
  -d "{
    \"prompt\": \"分析 $REPO_PATH 的项目结构和主要入口点\"
  }")

echo "项目结构分析完成"

# 第二轮：深入核心模块
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -H "X-Session-Id: $SESSION_ID" \
  -d '{
    "prompt": "详细解释刚才提到的核心模块的依赖关系"
  }'

# 第三轮：检查测试覆盖
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -H "X-Session-Id: $SESSION_ID" \
  -d '{
    "prompt": "找出没有被测试覆盖的关键功能"
  }'

# 清理会话
curl -X DELETE "http://localhost:3000/sessions/$SESSION_ID"
```

### 用例 4：实时监控会话

```bash
#!/bin/bash

# 在后台启动监控
while true; do
  clear
  echo "=== 活跃会话监控 ==="
  echo "时间: $(date)"
  echo ""
  
  curl -s http://localhost:3000/sessions | jq -r '
    .sessions[] | 
    "会话: \(.id)\n" +
    "  请求数: \(.requestCount)\n" +
    "  年龄: \(.ageMs / 1000 / 60) 分钟\n" +
    "  空闲: \(.idleMs / 1000) 秒\n"
  '
  
  echo ""
  echo "按 Ctrl+C 停止监控"
  sleep 5
done
```

---

## 错误处理

### 常见错误码

| 状态码 | 场景 | 处理建议 |
|--------|------|---------|
| 400 | 缺少参数 | 检查请求体是否包含必需字段 |
| 404 | 会话不存在 | 使用正确的 sessionId 或创建新会话 |
| 429 | 会话数超限 | 等待其他会话过期或手动销毁 |
| 500 | 内部错误 | 检查服务日志 |

### 错误响应示例

```json
{
  "success": false,
  "error": "Session limit exceeded (max: 10)",
  "duration": 0
}
```

---

## 最佳实践

### 1. 会话生命周期管理

```bash
# 为每个用户/任务创建独立会话
SESSION_ID="user-$(whoami)-$(date +%s)"

# 使用完成后主动销毁
curl -X DELETE "http://localhost:3000/sessions/$SESSION_ID"
```

### 2. 超时控制

```bash
# 客户端设置超时
curl -X POST http://localhost:3000/analyze \
  --max-time 120 \
  -H "X-Session-Id: my-session" \
  -d '{"prompt": "复杂分析任务"}'
```

### 3. 流式响应处理

```javascript
// 推荐：使用流式接口处理长文本
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 120000);

fetch('/analyze/stream', {
  method: 'POST',
  signal: controller.signal,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt: '长文本分析' })
});
```

---

## 完整测试脚本

见 `test-api.sh` 文件，包含所有 API 的自动化测试。
