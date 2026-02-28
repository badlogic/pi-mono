# Coding Agent Server

基于 `pi-mono` / `pi-coding-agent` 的长期运行代码任务执行服务器。

## 核心特性

- **依赖预检查**: 执行前分析所有依赖，确保信息完整
- **环境冻结**: 固化输入、文件、工具配置，确保确定性执行
- **无交互执行**: 执行阶段绝对禁止用户交互
- **断点恢复**: 支持崩溃恢复和会话持久化
- **多会话并发**: 同时管理多个独立任务

## 架构概览

```
Client
   ↓
Express Server
   ↓
Session Manager (FSM)
   ↓
Preflight (Contract Synthesis)
   ↓
Snapshot Builder (Freeze)
   ↓
Execution Runner
   + NoInteractionExtension
   + PersistenceExtension
```

### 状态机

```
INIT → CONTRACT_SYNTHESIS → PREFLIGHT → FROZEN → EXECUTING → COMPLETE
                                          ↓
                                        FAILED / PAUSED
```

## 安装

```bash
# 安装依赖
npm install

# 构建
npm run build
```

## 配置

环境变量:

```bash
# 服务器配置
PORT=3000                           # 服务器端口
WORKING_DIR=/path/to/workspace      # 工作目录
AGENT_DIR=/path/to/.pi             # Agent 配置目录
SESSIONS_DIR=/path/to/sessions     # 会话存储目录

# LLM 配置
LLM_PROVIDER=anthropic             # 提供商: anthropic, openai, etc.
LLM_MODEL=claude-sonnet-4-5        # 模型 ID
LLM_API_KEY=sk-...                 # API Key

# 执行限制
MAX_STEPS=100                      # 最大执行步数
```

## 使用

### 启动服务器

```bash
# 开发模式
npm run dev

# 生产模式
npm run build
npm start
```

### API 使用流程

#### 1. 创建会话

```bash
curl -X POST http://localhost:3000/api/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "userPrompt": "分析这个代码库的结构并生成文档",
    "skillText": "## Code Analyzer\n\nYou analyze codebases...",
    "workingDir": "/path/to/repo"
  }'
```

响应:
```json
{
  "success": true,
  "data": {
    "sessionId": "uuid",
    "state": "INIT",
    "createdAt": 1234567890
  }
}
```

#### 2. 运行预检查

```bash
curl -X POST http://localhost:3000/api/sessions/{sessionId}/preflight
```

响应 (有缺失信息):
```json
{
  "success": true,
  "data": {
    "canProceed": false,
    "contract": {
      "requiredInputs": ["target_directory"],
      "requiredFiles": ["src/**/*.ts"],
      "requiredTools": ["read", "grep"],
      "requiredScripts": [],
      "missingInformation": ["Target directory not specified"]
    },
    "missingInfo": ["Target directory not specified"],
    "message": "Missing information required before execution..."
  }
}
```

响应 (可以执行):
```json
{
  "success": true,
  "data": {
    "canProceed": true,
    "contract": { ... },
    "message": "All dependencies satisfied. Ready to freeze and execute."
  }
}
```

#### 3. 开始执行

```bash
curl -X POST http://localhost:3000/api/sessions/{sessionId}/execute \
  -H "Content-Type: application/json" \
  -d '{
    "workingDir": "/path/to/repo"
  }'
```

响应:
```json
{
  "success": true,
  "data": {
    "message": "Execution started",
    "sessionId": "uuid",
    "snapshot": {
      "createdAt": 1234567890,
      "filesFrozen": 25,
      "toolsWhitelisted": 6
    }
  }
}
```

#### 4. 查询状态

```bash
curl http://localhost:3000/api/sessions/{sessionId}
```

响应:
```json
{
  "success": true,
  "data": {
    "sessionId": "uuid",
    "state": "EXECUTING",
    "progress": {
      "current": 15,
      "total": 100
    }
  }
}
```

#### 5. 中止执行

```bash
curl -X POST http://localhost:3000/api/sessions/{sessionId}/abort
```

#### 6. 删除会话

```bash
curl -X DELETE http://localhost:3000/api/sessions/{sessionId}
```

## 核心组件

### SessionManager

- 管理会话生命周期和状态机
- 支持持久化存储（文件/Redis/DB）
- 处理状态转换验证

### ContractSynthesizer

- 独立 LLM 调用（不启动 agent runtime）
- 分析依赖并生成执行合同
- 检测缺失信息

### SnapshotBuilder

- 计算文件 SHA256 哈希
- 获取 Git commit hash
- 构建工具白名单

### ExecutionRunner

- 创建受限 CodingAgent 实例
- 加载 NoInteractionExtension
- 执行并监控进度

### NoInteractionExtension

- 拦截 `ask_user` 等交互工具
- 检测消息中的交互模式
- 三层保护：工具层、Extension层、SystemPrompt层

### PersistenceExtension

- 每步执行后保存消息历史
- 支持崩溃恢复
- 进度追踪

## Skill 编写规范

为了让预检查有效，Skill 必须显式声明:

```markdown
---
name: code-analyzer
description: Analyze code structure
required_inputs:
  - target_directory
  - analysis_depth
required_files:
  - "src/**/*.{ts,js}"
required_tools:
  - read
  - grep
  - find
---

## Instructions

Analyze the codebase at {{target_directory}} with depth {{analysis_depth}}...
```

## 测试

```bash
npm test
```

## 生产部署

### Docker

```dockerfile
FROM node:20-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY dist ./dist

ENV PORT=3000
ENV WORKING_DIR=/workspace
ENV SESSIONS_DIR=/sessions

EXPOSE 3000

CMD ["node", "dist/server.js"]
```

### Systemd

```ini
[Unit]
Description=Coding Agent Server
After=network.target

[Service]
Type=simple
User=coding-agent
WorkingDirectory=/opt/coding-agent-server
ExecStart=/usr/bin/node dist/server.js
Environment=PORT=3000
Environment=LLM_PROVIDER=anthropic
EnvironmentFile=/etc/coding-agent-server/env
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

## 许可证

MIT
