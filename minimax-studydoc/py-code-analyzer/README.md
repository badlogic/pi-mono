# Py Code Analyzer

基于 PydanticAI 的代码分析服务，参考 coding-agent 的设计。

## 快速开始

### 1. 安装依赖

```bash
cd py-code-analyzer
pip install -e .
```

### 2. 配置环境

```bash
cp .env.example .env
# 编辑 .env 添加你的 API Key
```

### 3. 创建代码目录

```bash
mkdir -p repo
# 将要分析的代码复制到 repo/ 目录
```

### 4. 启动服务

```bash
python server.py
```

## API 接口

### POST /analyze

分析代码并返回完整结果：

```bash
curl -X POST http://localhost:3000/analyze \
  -H "Content-Type: application/json" \
  -H "X-Session-Id: my-session" \
  -d '{"prompt": "Analyze the project structure"}'
```

### POST /chat

对话模式：

```bash
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"prompt": "What does this project do?"}'
```

### GET /messages

获取会话历史：

```bash
curl http://localhost:3000/messages \
  -H "X-Session-Id: my-session"
```

### POST /summarize

生成会话摘要：

```bash
curl -X POST http://localhost:3000/summarize \
  -H "X-Session-Id: my-session"
```

### GET /health

健康检查：

```bash
curl http://localhost:3000/health
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `ANTHROPIC_API_KEY` | - | Anthropic API Key |
| `REPO_PATH` | `./repo` | 代码仓库路径 |
| `MODEL` | `anthropic:claude-sonnet-4-20250514` | 模型名称 |
| `PORT` | `3000` | 服务端口 |
| `MAX_SESSIONS` | `5` | 最大并发会话数 |
