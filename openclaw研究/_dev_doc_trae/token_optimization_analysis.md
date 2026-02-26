# OpenClaw Token 优化分析报告

本文档深入分析 OpenClaw 已实现的 token 优化机制，并探讨可以继续改进的方向。

---

## 一、已实现的优化机制

### 1.1 自动压缩 (Auto-Compaction) ✅

**核心文件**: [compact.ts](file:///d:/temp/openclaw/src/agents/pi-embedded-runner/compact.ts)

这是 OpenClaw 最核心的 token 优化手段，采用"分层防御"策略。

**触发条件**:
| 场景 | 触发逻辑 |
|-----|---------|
| 溢出恢复 | 模型返回 context overflow 错误 → 压缩 → 重试 |
| 阈值维护 | `contextTokens > contextWindow - reserveTokens` 时触发 |

**工作原理**:
```
原始对话历史 (长)
     ↓
[LLM 生成摘要]
     ↓
压缩摘要条目 (短) + 近期消息保留
     ↓
持久化到 JSONL
```

**关键配置**:
```json5
{
  compaction: {
    enabled: true,
    reserveTokens: 16384,      // 为下次输出预留空间
    keepRecentTokens: 20000,   // 保留最近消息的 token 数
  }
}
```

**代码参考**:
```typescript
// compact.ts 核心函数
export async function compactEmbeddedPiSessionDirect(
  params: CompactEmbeddedPiSessionParams
): Promise<EmbeddedPiCompactResult>
```

---

### 1.2 工具结果截断 (Tool Result Truncation) ✅

**核心文件**: [tool-result-truncation.ts](file:///d:/temp/openclaw/src/agents/pi-embedded-runner/tool-result-truncation.ts)

防止单个工具输出（如 `cat` 大文件）撑爆上下文。

**截断策略**:
| 参数 | 值 | 说明 |
|-----|---|------|
| `MAX_TOOL_RESULT_CONTEXT_SHARE` | 0.3 | 单个工具结果不超过上下文的 30% |
| `HARD_MAX_TOOL_RESULT_CHARS` | 400,000 | 硬性字符上限 (~100K tokens) |
| `MIN_KEEP_CHARS` | 2,000 | 截断时至少保留的字符数 |

**截断算法**:
```typescript
// 保留头部 + 尾部，中间省略
function truncateToolResultText(text: string, maxChars: number): string {
  const keepChars = Math.max(MIN_KEEP_CHARS, maxChars - TRUNCATION_SUFFIX.length);
  // 尝试在换行处截断，避免切断行
  const lastNewline = text.lastIndexOf("\n", keepChars);
  if (lastNewline > keepChars * 0.8) {
    cutPoint = lastNewline;
  }
  return text.slice(0, cutPoint) + TRUNCATION_SUFFIX;
}
```

**截断后缀**:
```
⚠️ [Content truncated — original was too large for the model's context window. 
The content above is a partial view. If you need more, request specific sections 
or use offset/limit parameters to read smaller chunks.]
```

---

### 1.3 Bootstrap 文件截断 ✅

**核心文件**: [bootstrap.ts](file:///d:/temp/openclaw/src/agents/pi-embedded-helpers/bootstrap.ts)

限制注入到 System Prompt 的引导文件大小。

**默认限制**:
| 配置项 | 默认值 | 说明 |
|-------|-------|------|
| `bootstrapMaxChars` | 20,000 | 单个文件最大字符数 |
| `bootstrapTotalMaxChars` | 150,000 | 所有文件总字符数上限 |

**截断策略**:
```typescript
// 头尾保留策略
const BOOTSTRAP_HEAD_RATIO = 0.7;  // 保留头部 70%
const BOOTSTRAP_TAIL_RATIO = 0.2;  // 保留尾部 20%
// 中间 10% 用于截断标记
```

**截断标记示例**:
```
[...truncated, read AGENTS.md for full content...]
…(truncated AGENTS.md: kept 14000+4000 chars of 50000)…
```

---

### 1.4 历史轮次限制 ✅

**核心文件**: [history.ts](file:///d:/temp/openclaw/src/agents/pi-embedded-runner/history.ts)

针对长对话 DM 会话的历史裁剪。

**实现逻辑**:
```typescript
export function limitHistoryTurns(
  messages: AgentMessage[],
  limit: number | undefined
): AgentMessage[] {
  // 从后向前计数，保留最近 N 轮用户对话
  let userCount = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      userCount++;
      if (userCount > limit) {
        return messages.slice(lastUserIndex);
      }
    }
  }
}
```

**配置方式**:
```yaml
channels:
  telegram:
    dmHistoryLimit: 50      # DM 会话保留 50 轮
    historyLimit: 100       # 群组保留 100 轮
    dms:
      "+1234567890":
        historyLimit: 30    # 特定用户的限制
```

---

### 1.5 图片尺寸优化 ✅

**核心文件**: [image-sanitization.ts](file:///d:/temp/openclaw/src/agents/image-sanitization.ts)

降低视觉 token 消耗。

**默认配置**:
| 参数 | 默认值 | 说明 |
|-----|-------|------|
| `imageMaxDimensionPx` | 1200 | 图片最大边长像素 |
| `maxBytes` | 5MB | 图片最大字节 |

**配置方式**:
```yaml
agents:
  defaults:
    imageMaxDimensionPx: 800  # 更小 = 更省 token
```

---

### 1.6 上下文窗口守卫 ✅

**核心文件**: [context-window-guard.ts](file:///d:/temp/openclaw/src/agents/context-window-guard.ts)

防止上下文窗口过小导致的问题。

**阈值设置**:
```typescript
export const CONTEXT_WINDOW_HARD_MIN_TOKENS = 16_000;   // 硬性最小值
export const CONTEXT_WINDOW_WARN_BELOW_TOKENS = 32_000; // 警告阈值
```

**来源优先级**:
1. `models.providers.*.models[].contextWindow` (配置覆盖)
2. 模型定义的 `contextWindow`
3. `agents.defaults.contextTokens` (上限)
4. 默认值

---

### 1.7 Prompt Caching 支持 ✅

**核心文件**: [cache-ttl.ts](file:///d:/temp/openclaw/src/agents/pi-embedded-runner/cache-ttl.ts)

利用 Anthropic Prompt Caching 降低成本。

**支持的 Provider**:
- Anthropic (原生)
- OpenRouter (Anthropic 模型)

**Cache TTL 机制**:
```
时间线:
|----缓存有效期 (TTL)----|
                         ↓ TTL 过期
                    [Session Pruning]
                         ↓
                    [重置缓存窗口]
                         ↓
|----新缓存有效期----|
```

**心跳保持缓存热度**:
```yaml
agents:
  defaults:
    heartbeat:
      every: "55m"  # 略小于 1h TTL，保持缓存热
    models:
      "anthropic/claude-opus-4-5":
        params:
          cacheRetention: "long"
```

---

### 1.8 Session Pruning ✅

**核心文件**: [session-pruning.md](file:///d:/temp/openclaw/docs/concepts/session-pruning.md)

在发送给 LLM 前临时修剪工具结果（不修改磁盘历史）。

**两种修剪模式**:

| 模式 | 行为 | 用途 |
|-----|------|------|
| **Soft-trim** | 保留头尾，中间省略 | 超大工具结果 |
| **Hard-clear** | 替换为占位符 | 过旧的完整清除 |

**默认配置**:
```json5
{
  contextPruning: {
    mode: "cache-ttl",
    ttl: "5m",
    keepLastAssistants: 3,
    softTrimRatio: 0.3,
    hardClearRatio: 0.5,
    softTrim: { maxChars: 4000, headChars: 1500, tailChars: 1500 },
    hardClear: { placeholder: "[Old tool result content cleared]" }
  }
}
```

---

### 1.9 System Prompt 模式 ✅

**核心文件**: [system-prompt.ts](file:///d:/temp/openclaw/src/agents/system-prompt.ts)

根据场景动态调整 System Prompt 大小。

**三种模式**:
| 模式 | 包含内容 | 使用场景 |
|-----|---------|---------|
| `full` | 所有章节 | 主 Agent |
| `minimal` | 仅工具、工作区、运行时 | 子 Agent、Cron |
| `none` | 仅身份行 | 特殊场景 |

**可省略的章节** (minimal 模式):
- Skills 指令
- Memory Recall
- User Identity
- Reply Tags
- Messaging
- Voice (TTS)
- Documentation

---

### 1.10 System Prompt 缓存稳定性 ✅

**设计决策**: System Prompt 不包含日期/时间，以保持缓存稳定。

```typescript
// system-prompt.e2e.test.ts
it("does NOT include a date or time in the system prompt (cache stability)", () => {
  // This is intentional for prompt cache stability
});
```

时间信息仅在用户请求时动态注入，不影响 System Prompt 的缓存。

---

## 二、优化机制总览

### 2.1 优化层级图

```
┌─────────────────────────────────────────────────────────────────┐
│                    Token 优化层级 (从外到内)                      │
├─────────────────────────────────────────────────────────────────┤
│  Layer 1: 预防层 (减少输入)                                       │
│  ├── Bootstrap 文件截断 (单文件 20K, 总计 150K)                   │
│  ├── 图片尺寸压缩 (1200px)                                        │
│  ├── System Prompt 模式选择 (full/minimal/none)                  │
│  └── 历史轮次限制 (DM/Channel)                                    │
├─────────────────────────────────────────────────────────────────┤
│  Layer 2: 运行时保护层                                            │
│  ├── 工具结果截断 (30% 上下文上限)                                 │
│  ├── Session Pruning (cache-ttl 模式)                            │
│  └── 上下文窗口守卫 (16K 最小值)                                   │
├─────────────────────────────────────────────────────────────────┤
│  Layer 3: 恢复层 (溢出后)                                         │
│  ├── 自动压缩 (Compaction)                                       │
│  └── 溢出重试机制                                                 │
├─────────────────────────────────────────────────────────────────┤
│  Layer 4: 缓存优化层                                              │
│  ├── Prompt Caching 支持                                         │
│  ├── Cache TTL 修剪                                              │
│  ├── 心跳保持缓存热度                                              │
│  └── System Prompt 缓存稳定性                                     │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 各优化效果估算

| 优化机制 | 潜在节省 | 适用场景 |
|---------|---------|---------|
| 自动压缩 | 50-80% | 长对话溢出时 |
| 工具结果截断 | 30-70% | 大文件/命令输出 |
| Bootstrap 截断 | 10-30% | 大型 AGENTS.md |
| 历史轮次限制 | 20-50% | 长期 DM 会话 |
| 图片压缩 | 50-75% | 截图密集会话 |
| Prompt Caching | 90% (cache read) | 重复上下文 |
| Session Pruning | 20-40% | TTL 过期后首次请求 |

---

## 三、可继续优化的方向

### 3.1 语义化修剪 (Semantic Pruning) 🔮

**现状**: 按时间顺序截断或整体摘要，可能误删重要早期信息。

**建议方案**:
```
当前: [消息1] [消息2] ... [消息N] → 按时间截断
改进: [消息1] [消息2] ... [消息N] → Embedding → 语义检索
                                        ↓
                              只保留与当前 Query 相关的历史片段
```

**实现思路**:
1. 将早期消息存入向量数据库 (LanceDB / SQLite-vec)
2. 用户提问时，检索语义相关的历史片段
3. 动态注入相关上下文，而非全量历史

**预期收益**: 保留关键决策，删除无关闲聊，节省 30-50% token。

---

### 3.2 结构化数据压缩 🔮

**现状**: JSON/API 响应以纯文本形式进入上下文，包含大量冗余键名和空格。

**示例问题**:
```json
// 原始 API 响应 (约 500 tokens)
{
  "status": "success",
  "data": {
    "users": [
      {"id": 1, "name": "Alice", "email": "alice@example.com", "role": "admin"},
      {"id": 2, "name": "Bob", "email": "bob@example.com", "role": "user"}
    ]
  },
  "metadata": {
    "page": 1,
    "total": 2,
    "timestamp": "2024-01-15T10:30:00Z"
  }
}
```

**建议方案**:
```typescript
// 压缩后 (约 150 tokens)
// API Response: users (2 records)
// | id | name  | role  |
// |----|-------|-------|
// | 1  | Alice | admin |
// | 2  | Bob   | user  |
// meta: page=1, total=2
```

**实现思路**:
1. 检测 JSON 结构，识别表格/列表数据
2. 自动转换为 Markdown Table
3. 限制行数，超出时添加 `... (N more rows)`

**预期收益**: JSON 数据节省 50-70% token。

---

### 3.3 动态工具注入 🔮

**现状**: System Prompt 包含所有可用工具的定义，即使某些工具在当前对话中不会被使用。

**问题**: 20+ 工具的定义可能占用 2000-5000 tokens。

**建议方案**:
```typescript
// 当前: 所有工具定义都注入
tools: [read, write, exec, grep, glob, web_search, web_fetch, memory, ...]

// 改进: 根据意图预测动态注入
userMessage: "帮我分析这个日志文件"
→ 预测需要: read, grep, exec
→ 仅注入这 3 个工具的完整定义
→ 其他工具仅保留名称列表
```

**实现思路**:
1. 维护工具-意图映射表
2. 分析用户消息，预测可能需要的工具
3. Top-K 工具完整定义，其余仅保留名称

**预期收益**: System Prompt 节省 30-50% token。

---

### 3.4 思维链清理 (Chain-of-Thought Cleanup) 🔮

**现状**: Agent 的 `thinking` 块通常保留在历史中，占用大量 token。

**问题**: 多轮对话后，历史思考过程往往不再重要，重要的是最终结果。

**建议方案**:
```
原始历史:
[User] 分析这个 bug
[Assistant] <thinking>让我分析...首先检查...然后...</thinking>问题是...
[User] 继续修复
[Assistant] <thinking>根据之前的分析...我需要...</thinking>已修复

清理后:
[User] 分析这个 bug
[Assistant] 问题是...
[User] 继续修复
[Assistant] 已修复
```

**实现思路**:
1. 每轮对话结束后，检测并剥离 `thinking` 内容
2. 仅保留最终回复
3. 可配置保留策略 (always / on-success / never)

**预期收益**: 每轮节省 500-2000 tokens。

---

### 3.5 代码文件智能摘要 🔮

**现状**: 用户让 Agent 读取文件时，文件内容全量进入上下文。

**问题**: 大文件 (如 5000 行代码) 会消耗 15000+ tokens。

**建议方案**:
```
第一次读取:
[Agent] 读取 utils.ts (5000 行)
→ 生成"文件地图":
  - function foo(a, b): string
  - function bar(x): number
  - class Baz { method1(), method2() }
→ 地图存入会话元数据

后续引用:
[Agent] 需要修改 foo 函数
→ 使用地图定位，只读取相关行 (L100-L150)
→ 而非全量重新读取
```

**实现思路**:
1. 首次读取大文件时，生成签名/地图
2. 缓存地图到会话元数据
3. 后续操作优先使用地图定位

**预期收益**: 大文件场景节省 60-80% token。

---

### 3.6 差异化 System Prompt (Tiered Prompts) 🔮

**现状**: `full` 和 `minimal` 两种模式，粒度较粗。

**建议方案**:
| 层级 | Token 预算 | 包含内容 | 使用场景 |
|-----|-----------|---------|---------|
| `micro` | ~500 | 工具定义 + 极简指令 | 简单任务 (计算、查询) |
| `minimal` | ~2000 | + 工作区 + 运行时 | 子 Agent |
| `standard` | ~5000 | + Skills + Memory | 常规对话 |
| `full` | ~10000 | + 文档 + 消息指南 | 复杂任务 |

**实现思路**:
1. 分析用户消息复杂度
2. 动态选择 System Prompt 层级
3. 简单任务用 micro，复杂任务用 full

**预期收益**: 简单任务节省 80% System Prompt token。

---

### 3.7 历史消息重要性评分 🔮

**现状**: 按时间顺序保留/删除消息。

**建议方案**:
```typescript
interface MessageScore {
  messageId: string;
  importance: number;  // 0-1
  factors: {
    hasDecision: boolean;      // 包含决策
    hasCodeChange: boolean;    // 包含代码修改
    hasError: boolean;         // 包含错误
    userReferenced: boolean;   // 用户后续引用
  };
}

// 评分后保留高重要性消息
function pruneByImportance(messages: Message[], budget: number): Message[] {
  const scored = messages.map(scoreImportance);
  scored.sort((a, b) => b.importance - a.importance);
  return scored.slice(0, budget);
}
```

**预期收益**: 保留关键决策，删除无关闲聊。

---

## 四、优化优先级建议

### 4.1 ROI 分析

| 优化方向 | 实现难度 | 预期收益 | 优先级 |
|---------|---------|---------|-------|
| 思维链清理 | 低 | 高 | P0 |
| 结构化数据压缩 | 中 | 高 | P0 |
| 动态工具注入 | 中 | 高 | P1 |
| 代码文件智能摘要 | 中 | 高 | P1 |
| 语义化修剪 | 高 | 中 | P2 |
| 差异化 System Prompt | 低 | 中 | P2 |
| 历史消息重要性评分 | 高 | 中 | P3 |

### 4.2 推荐实施路径

**第一阶段** (快速收益):
1. 思维链清理 - 实现简单，每轮节省 500-2000 tokens
2. 结构化数据压缩 - JSON → Markdown Table

**第二阶段** (中等投入):
3. 动态工具注入 - 需要意图预测
4. 代码文件智能摘要 - 需要签名生成

**第三阶段** (长期投资):
5. 语义化修剪 - 需要向量数据库
6. 历史消息重要性评分 - 需要评分模型

---

## 五、总结

### 已实现的优化 (工程化兜底)

OpenClaw 在 **工程化兜底** 方面做得非常完善：

- ✅ 自动压缩 - 溢出时的安全网
- ✅ 工具结果截断 - 防止单点爆炸
- ✅ Bootstrap 截断 - 控制注入量
- ✅ Prompt Caching - 利用缓存降本
- ✅ Session Pruning - TTL 过期后修剪

### 可改进的方向 (语义化智能)

未来的优化应更多转向 **语义层面的智能筛选**：

- 🔮 从"硬截断"进化为"软感知"
- 🔮 从"时间顺序"进化为"重要性排序"
- 🔮 从"全量注入"进化为"按需注入"

**核心理念**: 让每一分 Token 都花在刀刃上。
