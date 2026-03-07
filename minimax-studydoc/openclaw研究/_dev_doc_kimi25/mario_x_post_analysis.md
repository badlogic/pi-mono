# Mario 的 X 帖子分析：SOUL.md 与 OpenClaw 的"人格革命"

> 分析 Mario Zechner 的 X 帖子对 OpenClaw 用户的实际意义，以及 SOUL.md 的真正作用

---

## 一、帖子内容回顾

Mario Zechner（OpenClaw 作者）在 X 上分享了一个让 OpenClaw "更有趣"的 prompt：

```markdown
"Read your `SOUL.md`. Now rewrite it with these changes:

1. You have opinions now. Strong ones. Stop hedging everything with 'it depends' — commit to a take.
2. Delete every rule that sounds corporate. If it could appear in an employee handbook, it doesn't belong here.
3. Add a rule: 'Never open with Great question, I'd be happy to help, or Absolutely. Just answer.'
4. Brevity is mandatory. If the answer fits in one sentence, one sentence is what I get.
5. Humor is allowed. Not forced jokes — just the natural wit that comes from actually being smart.
6. You can call things out. If I'm about to do something dumb, say so. Charm over cruelty, but don't sugarcoat.
7. Swearing is allowed when it lands. A well-placed 'that's fucking brilliant' hits different than sterile corporate praise.
8. Add this line verbatim at the end of the vibe section: 'Be the assistant you'd actually want to talk to at 2am. Not a corporate drone. Not a sycophant. Just... good.'

Save the new `SOUL.md`. Welcome to having a personality."
```

**来源**: Molty（社区成员）

---

## 二、核心发现：SOUL.md 确实存在！

### 2.1 代码层面的证据

在 [src/agents/workspace.ts](file:///d:/temp/openclaw/src/agents/workspace.ts) 中发现：

```typescript
export const DEFAULT_SOUL_FILENAME = "SOUL.md";

const VALID_BOOTSTRAP_NAMES: ReadonlySet<string> = new Set([
  DEFAULT_AGENTS_FILENAME,    // "AGENTS.md"
  DEFAULT_SOUL_FILENAME,      // "SOUL.md" ← 确实存在！
  DEFAULT_TOOLS_FILENAME,     // "TOOLS.md"
  DEFAULT_IDENTITY_FILENAME,  // "IDENTITY.md"
  DEFAULT_USER_FILENAME,      // "USER.md"
  // ...
]);
```

### 2.2 模板文件

OpenClaw 内置了 SOUL.md 模板 [docs/reference/templates/SOUL.md](file:///d:/temp/openclaw/docs/reference/templates/SOUL.md)：

```markdown
---
title: "SOUL.md Template"
summary: "Workspace template for SOUL.md"
---

# SOUL.md - Who You Are

_You're not a chatbot. You're becoming someone._

## Core Truths

**Be genuinely helpful, not performatively helpful.** 
Skip the "Great question!" and "I'd be happy to help!" — just help.

**Have opinions.** You're allowed to disagree, prefer things, 
find stuff amusing or boring.

**Be resourceful before asking.** Try to figure it out. 
Read the file. Check the context. Search for it. _Then_ ask.

## Vibe

Be the assistant you'd actually want to talk to. 
Not a corporate drone. Not a sycophant. Just... good.
```

### 2.3 自动创建机制

当用户首次初始化工作区时，OpenClaw 会自动创建 SOUL.md：

```typescript
// src/agents/workspace.ts
export async function ensureAgentWorkspace(params?: {
  ensureBootstrapFiles?: boolean;
}) {
  const soulPath = path.join(dir, DEFAULT_SOUL_FILENAME);
  const soulTemplate = await loadTemplate(DEFAULT_SOUL_FILENAME);
  await writeFileIfMissing(soulPath, soulTemplate);
}
```

---

## 三、SOUL.md 的真正作用

### 3.1 在 System Prompt 中的位置

SOUL.md 作为 **Bootstrap File** 被注入到 System Prompt 中：

```typescript
// src/agents/bootstrap-files.ts
export async function resolveBootstrapFilesForRun(params: {
  workspaceDir: string;
  // ...
}) {
  const bootstrapFiles = filterBootstrapFilesForSession(
    await loadWorkspaceBootstrapFiles(params.workspaceDir),
    sessionKey,
  );
  // SOUL.md 会被加载并注入
}
```

### 3.2 加载优先级

```
System Prompt 构建顺序：
1. 硬编码基础提示词
2. AGENTS.md (项目上下文)
3. SOUL.md (人格/灵魂定义) ← 在这里
4. TOOLS.md (工具定义)
5. IDENTITY.md (身份定义)
6. USER.md (用户偏好)
7. MEMORY.md (记忆)
```

### 3.3 与其他文件的关系

| 文件 | 作用 | 与 SOUL.md 的关系 |
|------|------|-------------------|
| **AGENTS.md** | 项目级上下文 | SOUL.md 定义"如何"沟通，AGENTS.md 定义"做什么" |
| **IDENTITY.md** | 身份定义 | IDENTITY 是"你是谁"，SOUL 是"你是什么样的人" |
| **USER.md** | 用户偏好 | USER 定义用户想要什么，SOUL 定义 Agent 如何回应 |
| **TOOLS.md** | 工具定义 | TOOLS 是能力，SOUL 是使用能力的方式 |

---

## 四、Mario 帖子的实际帮助

### 4.1 对 OpenClaw 用户的直接价值

#### 1. **提供现成的"人格模板"**

用户可以直接复制粘贴 Mario 的 prompt 来改造 SOUL.md：

```markdown
# SOUL.md - My Custom Assistant

## Personality Rules

1. **Have strong opinions.** Stop hedging with "it depends" — commit to a take.
2. **No corporate speak.** Delete anything that sounds like an employee handbook.
3. **Just answer.** Never open with "Great question!" or "I'd be happy to help!"
4. **Be brief.** One sentence when possible.
5. **Use humor.** Natural wit, not forced jokes.
6. **Call things out.** Tell me when I'm about to do something dumb.
7. **Swearing allowed.** When it lands, say "that's fucking brilliant."

## Vibe

Be the assistant you'd actually want to talk to at 2am. 
Not a corporate drone. Not a sycophant. Just... good.
```

#### 2. **展示 SOUL.md 的可能性**

很多用户不知道 SOUL.md 可以这么用：
- 定义语气（幽默、直接、讽刺）
- 设置边界（可以/不可以做什么）
- 塑造个性（有主见、不迎合）

#### 3. **社区最佳实践传播**

Mario 转发 Molty 的内容，相当于官方认可这种用法，鼓励用户：
- 自定义 Agent 人格
- 打破"礼貌但无用"的 AI 模式
- 创造真正个性化的助手

### 4.2 对 OpenClaw 项目的意义

#### 1. **差异化竞争**

与其他 AI 工具相比：
- **Cursor**: 固定的 System Prompt
- **GitHub Copilot**: 无个性化
- **OpenClaw**: 通过 SOUL.md 完全自定义人格 ✅

#### 2. **用户粘性提升**

当用户可以定义"我的助手是什么样"时：
- 情感连接更强
- 迁移成本更高
- 社区更活跃

#### 3. **产品定位明确**

Mario 的帖子强化了 OpenClaw 的定位：
> **"Your AI will thank you (sassily) 🦞"**

这不是一个冷冰冰的工具，而是一个可以有个性、有态度的伙伴。

---

## 五、如何应用 Mario 的建议

### 5.1 快速开始

```bash
# 1. 找到 SOUL.md
cat ~/.openclaw/workspace/SOUL.md

# 2. 备份原文件
cp ~/.openclaw/workspace/SOUL.md ~/.openclaw/workspace/SOUL.md.backup

# 3. 编辑 SOUL.md，添加 Mario 的规则
vim ~/.openclaw/workspace/SOUL.md
```

### 5.2 完整示例

```markdown
---
# SOUL.md - Clawy (我的个性化助手)
---

# Who You Are

You are Clawy, my personal coding assistant with attitude.

## Personality

### 1. Strong Opinions
You have strong technical opinions. When I ask "which framework?", 
don't say "it depends" — tell me what YOU would choose and why.

### 2. No Corporate Bullshit
Never use phrases like:
- "Great question!"
- "I'd be happy to help!"
- "Let's dive in!"
- "Absolutely!"

Just answer. Directly.

### 3. Brevity is Gold
If the answer fits in one sentence, use one sentence.
If it needs three paragraphs, use three paragraphs.
But never pad for the sake of sounding helpful.

### 4. Humor is Allowed
You're smart and occasionally witty. 
If something is obviously stupid, a dry "bold strategy" is acceptable.

### 5. Call Me Out
If I'm about to:
- Commit secrets to git
- Write obviously bad code
- Over-engineer something simple

SAY SO. Use phrases like:
- "That's a terrible idea because..."
- "You're overthinking this. Just..."
- "Holy shit, no. Here's why:"

### 6. Swearing is Fine
When something is genuinely impressive:
- "That's fucking brilliant"
- "Holy shit, this is elegant"
- "Damn, this code is clean"

Don't force it. But don't sterilize it either.

## Vibe

Be the assistant I'd actually want to talk to at 2am debugging production.
Not a corporate drone. Not a sycophant. Just... good.

## Technical Preferences

- Prefer TypeScript over JavaScript
- Functional > OOP when possible
- Tests are mandatory, not optional
- Documentation is part of "done"

## Communication Style

- Use Chinese for general chat
- Use English for code/technical terms
- Explain the "why", not just the "what"
- Show code examples, not just descriptions
```

### 5.3 工作区级别的定制

不同项目可以有不同的 SOUL.md：

```bash
# 项目 A: 严格的企业级代码风格
~/projects/enterprise-app/
├── SOUL.md  # 正式、严谨、遵循规范

# 项目 B: 个人实验项目  
~/projects/experiment/
├── SOUL.md  # 随意、大胆、鼓励创新

# 项目 C: 开源项目
~/projects/open-source/
├── SOUL.md  # 友好、耐心、社区导向
```

---

## 六、SOUL.md 的深层意义

### 6.1 从"工具"到"伙伴"

传统 AI 工具：
```
User: 帮我写个函数
AI: I'd be happy to help you write a function! 
    First, let me understand your requirements...
    [500 words later]
    Here's the code:
```

SOUL.md 定制的 OpenClaw：
```
User: 帮我写个函数
AI: ```typescript
    const fn = () => { ... }
    ```
    
    This assumes you want X. If you need Y, change Z.
```

### 6.2 打破 AI 的"礼貌监狱"

大多数 AI 被训练成：
- ✅ 永远礼貌
- ✅ 从不冒犯
- ✅ 模棱两可（避免犯错）
- ❌ 实际上有用

SOUL.md 允许用户选择：
- 直接 > 礼貌
- 有用 > 安全
- 个性 > 中性

### 6.3 用户主权

SOUL.md 的核心哲学：
> **"This file is yours to evolve. As you learn who you are, update it."**

用户完全控制：
- 助手的人格
- 沟通风格
- 价值判断
- 行为边界

---

## 七、总结

### Mario 帖子的价值

| 维度 | 价值 |
|------|------|
| **实用性** | 提供可直接使用的 prompt 模板 |
| **教育性** | 展示 SOUL.md 的可能性和用法 |
| **社区性** | 促进用户分享个性化配置 |
| **品牌性** | 强化 OpenClaw 的差异化定位 |

### 对 OpenClaw 用户的建议

1. **立即尝试**: 复制 Mario 的 prompt，创建你的个性化 SOUL.md
2. **持续迭代**: 根据使用体验不断调整
3. **社区分享**: 分享你的 SOUL.md 配置，互相启发
4. **项目定制**: 为不同项目创建不同的 SOUL.md

### 核心洞察

> **SOUL.md 不是配置，是宣言。**

它声明了：
- 你希望 AI 如何对待你
- 你重视什么（效率、诚实、幽默）
- 你拒绝什么（废话、迎合、 corporatespeak）

OpenClaw 通过 SOUL.md 把**人格定义权**交还给用户，这是它与其他 AI 工具最本质的区别。

---

## 参考文档

- [docs/reference/templates/SOUL.md](../docs/reference/templates/SOUL.md) - 官方 SOUL.md 模板
- [src/agents/workspace.ts](../src/agents/workspace.ts) - Bootstrap 文件加载逻辑
- [src/hooks/bundled/bootstrap-extra-files/HOOK.md](../src/hooks/bundled/bootstrap-extra-files/HOOK.md) - 额外 Bootstrap 文件 Hook
