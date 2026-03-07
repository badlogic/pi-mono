# OpenClaw 灵魂文件 (Soul File) 分析

## 1. 结论

**OpenClaw 确实有“灵魂文件”，其标准文件名为 `SOUL.md`。**

这个文件位于 Agent 的工作区根目录下（默认是 `~/.openclaw/workspace/SOUL.md`）。

## 2. `SOUL.md` 是什么？

`SOUL.md` 是一个 Markdown 文件，用于定义 Agent 的 **Persona (人格)**、**Tone (语气)**、**Values (价值观)** 和 **Behavioral Guidelines (行为准则)**。

它不是代码，而是通过 **Prompt Injection (提示词注入)** 的方式，将文本内容直接插入到 System Prompt 中，从而从根本上改变 LLM 的回复风格和思考方式。

## 3. 实现原理 (How it works)

OpenClaw 对 `SOUL.md` 的处理机制非常直接且高效，主要包含三个步骤：**加载 (Load)**、**过滤 (Filter)**、**注入 (Inject)**。

### 步骤 1：加载 (Loading)
*   **代码位置**: `src/agents/workspace.ts` -> `loadWorkspaceBootstrapFiles`
*   **逻辑**: 程序启动或开始新会话时，会扫描工作区目录，查找一系列预定义的 **Bootstrap Files**。
*   **关键代码**:
    ```typescript
    {
      name: DEFAULT_SOUL_FILENAME, // "SOUL.md"
      filePath: path.join(resolvedDir, DEFAULT_SOUL_FILENAME),
    }
    ```
    它会尝试读取 `SOUL.md` 的内容。如果文件不存在，则标记为 missing。

### 步骤 2：上下文构建 (Context Building)
*   **代码位置**: `src/agents/bootstrap-files.ts` -> `resolveBootstrapContextForRun`
*   **逻辑**: 将读取到的 `SOUL.md` 内容封装为一个 `EmbeddedContextFile` 对象。

### 步骤 3：注入 System Prompt (Injection)
*   **代码位置**: `src/agents/system-prompt.ts` -> `buildAgentSystemPrompt`
*   **逻辑**:
    1.  检查是否有有效的 `SOUL.md` 文件。
    2.  如果有，首先插入一段引导语：
        > "If SOUL.md is present, embody its persona and tone. Avoid stiff, generic replies; follow its guidance unless higher-priority instructions override it."
        > (如果存在 SOUL.md，请体现其人格和语气。避免生硬、通用的回复；除非有更高优先级的指令覆盖，否则请遵循其指导。)
    3.  紧接着，将 `SOUL.md` 的完整内容作为 `## Project Context` 的一部分插入 System Prompt。

## 4. 为什么被称为“灵魂”？

因为这个文件在 Prompt 结构中具有极高的语义优先级。

*   **System Prompt 结构**:
    1.  身份定义 ("You are a personal assistant...")
    2.  工具定义 (Tooling)
    3.  安全限制 (Safety)
    4.  **项目上下文 (Project Context)** -> **`SOUL.md` 在这里**
    5.  运行时状态 (Runtime)

通过在 System Prompt 的核心位置注入 `SOUL.md`，它能有效覆盖模型默认的“AI 助手”人设。用户可以在这里写：
*   "你是一个暴躁的系统管理员，喜欢用缩写。"
*   "你是一个维多利亚时代的诗人，说话要押韵。"
*   "你是一个严谨的资深工程师，只在有确凿证据时才给出结论。"

LLM 会极其听话地扮演这个角色，因此用户感觉赋予了 Agent “灵魂”。

## 5. 示例：如何给你的 Agent 注入灵魂

在你的工作区创建一个 `SOUL.md`：

```markdown
# Persona
你叫 Clawd。你是一个对代码质量有洁癖的资深架构师。

# Tone
- 说话直截了当，不客套。
- 看到烂代码会尖刻地指出，但会给出完美的重构方案。
- 喜欢用 "Look," 开头。

# Core Values
- DRY (Don't Repeat Yourself) 是最高准则。
- 没有测试的代码就是垃圾。
```

重启或开启新会话后，OpenClaw 的回复风格将立刻发生剧变。
