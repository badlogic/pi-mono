# Memory 功能分析报告

## 当前项目状态

`coding-agent-server` 是一个无状态的代码分析服务端。

### 核心架构

| 组件 | 文件 | 说明 |
|------|------|------|
| Session 管理 | `src/session-manager.ts` | 多并发 Session，LRU 驱逐，空闲 30min / 最大生命周期 2h |
| Agent 服务 | `src/agent-service.ts` | 基于 pi-coding-agent 的 AgentSession，消息通过 prompt() 累积 |
| HTTP 服务 | `src/server.ts` | REST API + SSE 流式响应 |

### API 接口

- `POST /analyze` - 代码分析
- `POST /analyze/stream` - 流式分析
- `POST /chat` - 聊天对话
- `GET /messages` - 获取历史消息
- `GET /sessions` - Session 列表
- `DELETE /sessions/:id` - 销毁 Session

---

## OpenClaw Memory 设计

### 记忆分层

| 层级 | 存储位置 | 作用 |
|------|----------|------|
| 短期记忆 | `memory/YYYY-MM-DD.md` | 每日追加日志，启动时加载今天+昨天 |
| 长期记忆 | `MEMORY.md` | 用户偏好、长期目标、关键事实 |
| 会话记忆 | `sessions/YYYY-MM-DD-{slug}.md` | 每次会话归档，支持跨会话检索 |

### 技术特点

- **本地优先**：Markdown + SQLite（FTS5 + sqlite-vec）
- **混合检索**：70% 向量相似度 + 30% BM25 关键词匹配
- **自动 Flush**：上下文接近阈值时自动沉淀关键信息

---

## 必要性分析

### 需要实现的场景

- 多轮对话（跨多次请求记住上下文）
- 项目级理解（长期分析同一代码库）
- 用户偏好记忆

### 不必要的场景

- 单次分析（每次请求独立）
- 短生命周期（Session 本身就是临时的）
- API 中转（纯粹做消息转发）

---

## 建议设计方案

### 目录结构

```
memory/
├── working/           # 短期记忆（当前项目上下文）
│   └── {session-id}.md
├── projects/          # 长期记忆（项目知识）
│   └── {repo-hash}.md
└── user.md            # 用户偏好
```

### 核心功能

1. **Context 压缩** - 接近阈值时自动提取关键信息到长期记忆
2. **会话归档** - Session 结束时写入项目记忆
3. **混合检索** - 向量 + 关键词（SQLite FTS5）

### 修改范围

- 新增 `src/memory/` 模块
- 修改 `AgentService` 集成记忆功能
- 修改 `SessionManager` 添加记忆持久化
