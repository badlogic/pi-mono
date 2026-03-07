# MEMORY.md 优化建议分析：推文解读

> 分析 Chrys Bader 的推文建议，评估其合理性及潜在误解

---

## 一、推文原文

```
tell your @openclaw NOW:

"Review http://MEMORY.md for anything that belongs in skills or http://TOOLS.md instead"

then ask it to do this nightly. it'll save you tokens and headaches.

---

https://x.com/chrysb/status/2023610392614990086

Chrys Bader
@chrysb
```

---

## 二、核心建议解读

### 2.1 建议内容

推文建议用户：
1. **让 OpenClaw 审查 MEMORY.md 文件**
2. **找出应该放入 Skills 或 TOOLS.md 的内容**
3. **每晚自动执行此操作**
4. **声称可以节省 token 和减少麻烦**

---

## 三、技术原理分析

### 3.1 OpenClaw 的 Context 构建机制

根据 [token-use.md](file:///d:/temp/openclaw/docs/reference/token-use.md) 文档，OpenClaw 的系统 prompt 构建包括：

```
系统 prompt 组成（按优先级排序）：
├── Tool list + 描述
├── Skills list（仅元数据，指令按需加载）
├── Bootstrap 文件（AGENTS.md, SOUL.md, TOOLS.md, IDENTITY.md, USER.md, HEARTBEAT.md, BOOTSTRAP.md, MEMORY.md）
│   ├── 大文件会被 truncate（默认 20000 字符）
│   └── 总注入量有上限（默认 150000 字符）
├── 时间信息
├── Reply tags + heartbeat 行为
└── Runtime metadata
```

**关键点**：
- `MEMORY.md` **默认会被注入到系统 prompt 中**
- 大文件会被截断，但总注入量有上限
- `memory/*.md` 文件**不会自动注入**，需要通过 memory tools 按需获取

### 3.2 MEMORY.md vs Skills 的区别

| 维度 | MEMORY.md | Skills |
|------|-----------|--------|
| **加载时机** | 每次会话启动时自动注入 | 按需触发（metadata 始终在，body 按需） |
| **内容类型** | 长期记忆、偏好、决策 | 工作流、领域知识、脚本 |
| **token 成本** | 固定开销（每次都在） | 渐进式（仅触发时加载） |
| **更新频率** | 频繁追加 | 相对稳定 |
| **搜索能力** | 支持向量搜索 | 不支持搜索 |

### 3.3 Skills 的 Progressive Disclosure 机制

根据 [SKILL.md](file:///d:/temp/openclaw/skills/skill-creator/SKILL.md) 文档，Skills 使用三级加载系统：

```
Level 1: Metadata (name + description) - 始终在 context 中 (~100 words)
    ↓ 触发条件匹配
Level 2: SKILL.md body - 触发时加载 (<5k words)
    ↓ Codex 决定需要时
Level 3: Bundled resources - 按需加载（scripts/references/assets）
```

**核心优势**：Skills 的 body 和 references **不会自动加载**，只有 metadata 在 context 中。

---

## 四、建议合理性评估

### 4.1 正确的部分 ✅

#### 1. MEMORY.md 确实会占用固定 token

```
来自 token-use.md:
"Workspace + bootstrap files (AGENTS.md, SOUL.md, TOOLS.md, IDENTITY.md, 
USER.md, HEARTBEAT.md, BOOTSTRAP.md when new, plus MEMORY.md and/or memory.md 
when present)."
```

**结论**：MEMORY.md 每次都会被注入，确实占用 token。

#### 2. Skills 的 token 效率更高

- Skills 的 body 不会自动加载
- 只有 metadata（~100 words）固定占用
- 触发后才加载完整内容

**结论**：将稳定的工作流知识迁移到 Skills 确实可以节省 token。

#### 3. 定期审查有价值

MEMORY.md 会随时间增长，定期整理确实有助于：
- 移除过期的临时笔记
- 将成熟的工作流固化为 Skills
- 保持 MEMORY.md 精简

### 4.2 误解/夸大的部分 ⚠️

#### 1. "save you tokens" - 部分正确但有限

**分析**：
- MEMORY.md 有 **truncate 机制**（默认 20000 字符）
- 总 bootstrap 有 **上限**（默认 150000 字符）
- 如果 MEMORY.md 不大，优化收益有限

**实际情况**：
```
假设 MEMORY.md 有 5000 tokens：
- 每次会话都加载：5000 tokens
- 迁移到 Skills：metadata 100 words ≈ 150 tokens
- 节省：4850 tokens/会话

但如果 MEMORY.md 只有 1000 tokens：
- 节省：850 tokens/会话（收益较小）
```

#### 2. "do this nightly" - 可能过度

**问题**：
- MEMORY.md 的内容变化频率因人而异
-  nightly 执行可能造成不必要的 API 调用
- 更好的触发条件是：当 MEMORY.md 达到一定大小时

#### 3. "anything that belongs in skills" - 判断标准模糊

**什么应该放入 Skills？**

根据 SKILL.md 的指导：
- ✅ **多步骤工作流** - 适合 Skills
- ✅ **领域专业知识** - 适合 Skills
- ✅ **重复使用的脚本** - 适合 Skills
- ❌ **个人偏好、临时笔记** - 留在 MEMORY.md
- ❌ **每日日志** - 留在 memory/YYYY-MM-DD.md

**风险**：如果错误地将应该留在 MEMORY.md 的内容迁移到 Skills，会导致：
- Skills 臃肿，metadata 过多
- 触发频率增加，反而增加 token 消耗

### 4.3 未提及的重要 nuance

#### 1. MEMORY.md 有向量搜索能力

```
来自 memory.md:
"OpenClaw can build a small vector index over MEMORY.md and memory/*.md 
so semantic queries can find related notes even when wording differs."
```

**意义**：MEMORY.md 的内容可以通过 `memory_search` 工具语义检索，这是 Skills 不具备的能力。

#### 2. Skills 无法替代所有 MEMORY.md 内容

- **个人偏好**："我喜欢用 2 空格缩进" → 留在 MEMORY.md
- **项目决策**："我们决定用 React 而非 Vue" → 可以放入 AGENTS.md 或 Skills
- **临时上下文**："今天的会议要点" → 留在 memory/YYYY-MM-DD.md

#### 3. TOOLS.md 的角色

根据文档，TOOLS.md 是 bootstrap 文件之一，用于：
- 指导工具使用方式
- 定义工具偏好和约束

它**不是**Skills 的替代品，而是**补充**。

---

## 五、正确的优化策略

### 5.1 分层存储策略

```
内容类型                    推荐位置                    理由
─────────────────────────────────────────────────────────────────
个人偏好/习惯               MEMORY.md                   每次都需要
项目上下文/决策             AGENTS.md                   项目级别
多步骤工作流                Skills                      按需触发
领域知识/参考资料           Skills/references/          渐进式加载
临时笔记/日志               memory/YYYY-MM-DD.md        不占用系统 prompt
工具使用指导                TOOLS.md                    工具调用时参考
```

### 5.2 推荐的审查流程

**不是 nightly，而是按需**：

```
触发条件：
1. MEMORY.md 超过 10000 字符
2. 发现重复的工作流模式（3次以上）
3. 用户主动要求整理

审查步骤：
1. 读取 MEMORY.md 全文
2. 识别可固化的工作流
3. 创建对应的 Skill
4. 从 MEMORY.md 中移除已迁移内容
5. 更新 AGENTS.md 引用新 Skill
```

### 5.3 自动化的合理方式

如果确实要自动化，建议：

```json5
// config 示例
{
  agents: {
    defaults: {
      compaction: {
        memoryFlush: {
          enabled: true,
          // 在接近 compaction 时提醒整理 memory
          systemPrompt: "Session nearing compaction. Review MEMORY.md for content that should be migrated to skills.",
        },
      },
    },
  },
}
```

利用 OpenClaw 已有的 **pre-compaction ping** 机制，而不是 nightly cron。

---

## 六、结论

### 6.1 推文的帮助性

| 方面 | 评分 | 说明 |
|------|------|------|
| **方向正确** | ⭐⭐⭐⭐⭐ | 确实应该关注 MEMORY.md 的膨胀问题 |
| **技术准确** | ⭐⭐⭐ | 忽略了 truncate 机制和渐进式加载的细节 |
| **操作建议** | ⭐⭐ | nightly 执行可能过度，缺乏判断标准 |
| **整体价值** | ⭐⭐⭐⭐ | 提醒了重要的优化方向，但需补充 nuance |

### 6.2 正确理解

**推文的本质**：这是一个**经验分享**，而非**最佳实践指南**。

**正确的解读**：
1. ✅ 关注 MEMORY.md 的大小和 content drift
2. ✅ 将稳定的工作流迁移到 Skills
3. ✅ 利用 Skills 的渐进式加载节省 token
4. ⚠️ 不要盲目 nightly 执行
5. ⚠️ 不是所有内容都适合迁移到 Skills
6. ⚠️ 保留 MEMORY.md 的语义搜索能力

### 6.3 最终建议

**对用户**：
- 定期（如每月）审查 MEMORY.md
- 将重复出现的工作流固化为 Skills
- 保持 MEMORY.md 精简（<5000 tokens）
- 利用 `memory_search` 工具而非依赖全文注入

**对 OpenClaw 开发者**：
- 考虑添加 MEMORY.md 大小警告
- 提供自动检测重复工作流的工具
- 优化 Skills 创建流程，降低迁移成本

---

## 参考文档

- [Token Use and Costs](file:///d:/temp/openclaw/docs/reference/token-use.md)
- [Memory System](file:///d:/temp/openclaw/docs/concepts/memory.md)
- [Skill Creator Guide](file:///d:/temp/openclaw/skills/skill-creator/SKILL.md)
- [System Prompt](file:///d:/temp/openclaw/docs/concepts/system-prompt.md)
