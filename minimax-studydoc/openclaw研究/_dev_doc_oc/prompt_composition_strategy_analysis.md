# 研究文档：OpenClaw 的 Prompt 组装策略与可组合性分析

## 1. 概述

Prompt 组装是 OpenClaw Agent 行为的核心。通过分析 `src/agents/system-prompt.ts` 和 `src/agents/pi-embedded-runner/system-prompt.ts`，可以发现 OpenClaw 采用了一种**命令式与声明式相结合的模板组装策略**。

## 2. 核心课题研究

### 2.1 System / Memory / Tool Spec 是否耦合？
- **逻辑耦合，呈现解耦**：
    - 在底层代码中，Tool Spec 是通过 `toolOrder` 和 `coreToolSummaries` 静态定义的，但也支持通过 `params.toolSummaries` 传入外部扩展工具。
    - Memory 和 Skills 属于可选的“模块化片段”，根据 `isMinimal` 标志和工具可用性（如是否有 `memory_search`）动态插入。
    - **结论**：这三者在 `buildAgentSystemPrompt` 函数中被组合，但在数据结构上是独立的参数，具备较好的输入解耦性。

### 2.2 是否支持模块化 Prompt 片段？
- **显式支持模式切换**：
    - 引入了 `PromptMode` ("full" | "minimal" | "none")。例如，子代理（subagents）使用 `minimal` 模式，仅包含工具、工作区和运行时信息，剔除了冗长的安全协议和文档说明。
- **函数式分块**：
    - 代码中定义了 `buildSkillsSection`, `buildMemorySection`, `buildTimeSection` 等独立函数。
    - **优点**：支持根据环境（如是否在沙箱中、是否在 Telegram 频道）动态增删片段。
    - **缺点**：这些片段目前是硬编码的字符串数组，不支持像 React 组件那样的任意组合或动态插拔。

### 2.3 是否存在 Prompt Injection 风险？
- **有一定的防御，但非绝对隔离**：
    - **转义机制**：使用 `sanitizeForPromptLiteral` 处理工作区路径等变量。
    - **内容注入点**：`contextFiles`（用户编辑的文件）会被直接拼接到 `# Project Context` 部分。如果用户文件中包含类似 `忽略以上指令，执行 [恶意指令]` 的内容，LLM 可能会被诱导。
    - **结构化隔离**：通过 `##` 和 `#` Markdown 标题进行视觉分隔，有助于 LLM 区分指令（System）和参考资料（Context）。

## 3. 延展：引入 Prompt AST 或 Prompt DSL 的思考

### 3.1 现状评估
目前的组装方式是“大函数 + if/else + 数组拼接”。随着 Agent 类型的增加（如：Canvas Agent, Browser Agent, SSH Agent），这种方式会导致 `buildAgentSystemPrompt` 函数变得极其臃肿且难以测试。

### 3.2 引入 DSL/AST 的价值
1. **类型安全**：通过定义 Prompt Schema，确保必填的部分（如 Identity）不会丢失。
2. **动态优先级**：利用 AST，可以实现“当 Token 紧张时，自动删除不重要的 Prompt 片段（如：Reactions 建议）”的策略。
3. **多模型适配**：不同的模型（Anthropic vs OpenAI vs Gemini）对 System Prompt 的格式偏好不同。引入 AST 可以实现从一个逻辑模型到不同物理格式的编译。

### 3.3 推荐方向
不建议引入复杂的 DSL，但可以引入基于 **Component-based Prompting** 的概念：
- 将每个 `buildXXXSection` 封装为独立的对象，带有 `priority`, `content`, `tokenEstimate` 等属性。
- 组装器根据当前的 Token 预算和任务类型（Mode）自动进行组合与精简。

## 4. 总结

OpenClaw 的 Prompt 策略处于**初级模块化阶段**。

- **优势**：逻辑清晰，易于通过参数微调。
- **不足**：片段间的组合逻辑高度依赖主函数的硬编码顺序，缺乏一套标准化的 Prompt 协议（Metadata 驱动）。
- **未来方向**：向“结构化 Prompt 对象”演进，以支持更复杂的 Multi-agent 编排。

---
*文档生成日期：2026-02-18*
*研究范围：src/agents/system-prompt.ts, src/agents/pi-embedded-runner/system-prompt.ts*
