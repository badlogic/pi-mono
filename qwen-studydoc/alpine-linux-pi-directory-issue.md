# Alpine Linux 环境下找不到 .pi 目录的研究报告

## 问题描述

在使用 SDK 集成 pi-coding-agent 的 server app 中（运行在 Alpine Linux 容器环境），发现无法找到 `.pi` 配置目录。

## 根本原因分析

### 1. .pi 目录的创建逻辑

#### 1.1 目录路径计算

根据 [`config.ts`](file://d:\temp\pi-mono-agent\packages\coding-agent\src\config.ts#L186-L195) 的代码：

```typescript
export function getAgentDir(): string {
  const envDir = process.env[ENV_AGENT_DIR];
  if (envDir) {
    // Expand tilde to home directory
    if (envDir === "~") return homedir();
    if (envDir.startsWith("~/")) return homedir() + envDir.slice(1);
    return envDir;
  }
  return join(homedir(), CONFIG_DIR_NAME, "agent");
}
```

**关键发现**：
- 默认路径：`~/.pi/agent`（即 `${homedir()}/.pi/agent`）
- 可通过环境变量 `PI_CODING_AGENT_DIR` 覆盖
- **目录不会自动创建**，只有在需要时才会创建

#### 1.2 目录创建时机

查看代码发现，`.pi` 目录**不是**在调用 `createAgentSession()` 时立即创建的，而是在以下情况才会创建：

**情况 1：写入 auth.json 时** ([`auth-storage.ts`](file://d:\temp\pi-mono-agent\packages\coding-agent\src\core\auth-storage.ts#L47-L55))

```typescript
export class FileAuthStorageBackend implements AuthStorageBackend {
  constructor(private authPath: string = join(getAgentDir(), "auth.json")) {}

  private ensureParentDir(): void {
    const dir = dirname(this.authPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
  }
}
```

**情况 2：创建会话目录时** ([`session-manager.ts`](file://d:\temp\pi-mono-agent\packages\coding-agent\src\core\session-manager.ts#L415-L427))

```typescript
function getDefaultSessionDir(cwd: string): string {
  const safePath = `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
  const sessionDir = join(getDefaultAgentDir(), "sessions", safePath);
  if (!existsSync(sessionDir)) {
    mkdirSync(sessionDir, { recursive: true });
  }
  return sessionDir;
}
```

**情况 3：写入 models.json、settings.json 等配置文件时**

### 2. Alpine Linux 环境的特殊性

#### 2.1 Home 目录问题

在 Alpine Linux 容器中，`homedir()` 的返回值可能不符合预期：

```typescript
import { homedir } from "os";
console.log(homedir()); // 可能返回 "/" 或 "/root" 或其他
```

**常见问题**：

| 场景 | HOME 环境变量 | homedir() 返回 | 结果路径 |
|------|--------------|----------------|----------|
| root 用户运行 | `/root` | `/root` | `/root/.pi/agent` |
| 无 HOME 环境变量 | 未设置 | `/` | `/.pi/agent` ⚠️ |
| 非 root 用户 | `/home/user` | `/home/user` | `/home/user/.pi/agent` |
| 容器特殊配置 | 自定义路径 | 自定义路径 | 取决于配置 |

#### 2.2 权限问题

Alpine Linux 容器通常有以下限制：

1. **只读文件系统**：某些目录可能是只读的
2. **用户权限**：非 root 用户可能无法创建目录
3. **临时文件系统**：`/tmp` 可能是唯一的可写位置

### 3. SDK 集成时的关键点

查看 [`sdk.ts`](file://d:\temp\pi-mono-agent\packages\coding-agent\src\core\sdk.ts#L167-L200)：

```typescript
export async function createAgentSession(options: CreateAgentSessionOptions = {}): Promise<CreateAgentSessionResult> {
  const cwd = options.cwd ?? process.cwd();
  const agentDir = options.agentDir ?? getDefaultAgentDir();
  
  // 如果提供了 agentDir，才会创建相关文件
  const authPath = options.agentDir ? join(agentDir, "auth.json") : undefined;
  const modelsPath = options.agentDir ? join(agentDir, "models.json") : undefined;
  const authStorage = options.authStorage ?? AuthStorage.create(authPath);
  
  // ...
}
```

**关键发现**：
- 如果**不显式提供** `agentDir`，会使用默认的 `getAgentDir()`
- **不会立即创建目录**，只有在实际写入时才会创建
- 如果使用 `SessionManager.inMemory()`，则完全不需要磁盘目录

## 解决方案

### 方案 1：显式指定 agentDir（推荐）

在你的 server app 中，显式指定配置目录：

```typescript
import { createAgentSession } from "@mariozechner/pi-coding-agent";
import { join } from "path";

// 方案 A：使用环境变量指定的目录
const agentDir = process.env.PI_CODING_AGENT_DIR || join(process.cwd(), ".pi-agent-data");

// 确保目录存在
import { mkdirSync } from "fs";
mkdirSync(agentDir, { recursive: true });

const result = await createAgentSession({
  cwd: yourCwd,
  agentDir: agentDir, // 显式指定
});
```

**优点**：
- 完全控制目录位置
- 不依赖 HOME 环境变量
- 便于容器化部署（可挂载 volume）

### 方案 2：使用内存模式（无持久化）

如果不需要持久化会话：

```typescript
import { createAgentSession, SessionManager } from "@mariozechner/pi-coding-agent";

const result = await createAgentSession({
  cwd: yourCwd,
  sessionManager: SessionManager.inMemory(yourCwd), // 内存模式
  // 不提供 agentDir，不会创建任何目录
});
```

**优点**：
- 完全不需要磁盘目录
- 适合无状态服务
- 启动速度快

**缺点**：
- 重启后会话丢失
- 无法跨实例共享

### 方案 3：设置环境变量

在 Dockerfile 或容器启动时设置：

```dockerfile
# Dockerfile
ENV PI_CODING_AGENT_DIR=/app/pi-agent-data
RUN mkdir -p /app/pi-agent-data && chmod 700 /app/pi-agent-data
```

或者在 Kubernetes 中：

```yaml
env:
  - name: PI_CODING_AGENT_DIR
    value: /data/pi-agent
volumeMounts:
  - name: pi-data
    mountPath: /data/pi-agent
```

### 方案 4：使用临时目录

适合测试环境：

```typescript
import { tmpdir } from "os";
import { join } from "path";

const agentDir = join(tmpdir(), `pi-agent-${process.pid}`);

const result = await createAgentSession({
  cwd: yourCwd,
  agentDir: agentDir,
});
```

## 诊断步骤

### 步骤 1：检查 HOME 环境变量

```typescript
import { homedir } from "os";

console.log("HOME env:", process.env.HOME);
console.log("USERPROFILE env:", process.env.USERPROFILE);
console.log("homedir():", homedir());
console.log("Expected .pi path:", join(homedir(), ".pi", "agent"));
```

### 步骤 2：检查目录是否存在

```typescript
import { existsSync } from "fs";
import { getAgentDir } from "@mariozechner/pi-coding-agent";

const agentDir = getAgentDir();
console.log("Agent dir:", agentDir);
console.log("Exists:", existsSync(agentDir));

// 尝试列出父目录
import { readdirSync } from "fs";
const parentDir = dirname(agentDir);
try {
  const files = readdirSync(parentDir);
  console.log("Parent dir contents:", files);
} catch (error) {
  console.error("Cannot read parent dir:", error);
}
```

### 步骤 3：检查权限

```typescript
import { accessSync, constants } from "fs";

try {
  accessSync(dirname(agentDir), constants.W_OK);
  console.log("Parent directory is writable");
} catch {
  console.error("Parent directory is NOT writable");
}
```

### 步骤 4：启用调试日志

```typescript
import { createAgentSession } from "@mariozechner/pi-coding-agent";

const result = await createAgentSession({
  cwd: yourCwd,
  agentDir: yourAgentDir,
  // 添加调试
});

console.log("Session created with agentDir:", yourAgentDir);
```

## Alpine Linux 特定配置

### Dockerfile 示例

```dockerfile
FROM alpine:3.18

# 安装 Node.js 运行时
RUN apk add --no-cache nodejs npm

# 创建应用目录
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .

# 创建 pi-agent 数据目录
RUN mkdir -p /app/pi-agent-data && chmod 700 /app/pi-agent-data

# 设置环境变量
ENV PI_CODING_AGENT_DIR=/app/pi-agent-data
ENV NODE_ENV=production

# 运行应用
CMD ["node", "dist/server.js"]
```

### Docker Compose 示例

```yaml
version: '3.8'
services:
  pi-server:
    build: .
    environment:
      - PI_CODING_AGENT_DIR=/data/pi-agent
      # 如果使用 API keys，也可以通过环境变量传递
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
    volumes:
      - pi-data:/data/pi-agent
      # 如果需要持久化会话
      - ./sessions:/app/pi-agent-data/sessions
    ports:
      - "3000:3000"

volumes:
  pi-data:
```

### Kubernetes 配置示例

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: pi-agent-data
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 1Gi
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: pi-server
spec:
  replicas: 1
  selector:
    matchLabels:
      app: pi-server
  template:
    metadata:
      labels:
        app: pi-server
    spec:
      containers:
        - name: pi-server
          image: your-registry/pi-server:latest
          env:
            - name: PI_CODING_AGENT_DIR
              value: /data/pi-agent
            - name: ANTHROPIC_API_KEY
              valueFrom:
                secretKeyRef:
                  name: pi-secrets
                  key: anthropic-api-key
          volumeMounts:
            - name: pi-data
              mountPath: /data/pi-agent
      volumes:
        - name: pi-data
          persistentVolumeClaim:
            claimName: pi-agent-data
```

## 常见问题排查

### 问题 1：目录创建失败

**症状**：调用 `createAgentSession()` 后仍然找不到目录

**可能原因**：
1. 父目录不存在且无法创建
2. 权限不足
3. 文件系统只读

**解决方法**：
```typescript
import { mkdirSync, existsSync } from "fs";

const agentDir = "/your/path/.pi/agent";
try {
  mkdirSync(agentDir, { recursive: true, mode: 0o700 });
  console.log("Directory created successfully");
} catch (error) {
  console.error("Failed to create directory:", error);
  // 回退到临时目录
  const fallbackDir = join(tmpdir(), `pi-agent-${Date.now()}`);
  mkdirSync(fallbackDir, { recursive: true });
  // 使用 fallbackDir
}
```

### 问题 2：会话文件找不到

**症状**：会话创建成功，但重启后找不到之前的会话

**可能原因**：
1. 使用了不同的 `cwd`
2. 使用了不同的 `agentDir`
3. 会话文件被清理（临时目录）

**解决方法**：
```typescript
// 始终使用相同的 cwd 和 agentDir
const cwd = process.env.WORKDIR || "/app/workspace";
const agentDir = process.env.PI_CODING_AGENT_DIR || "/app/pi-agent-data";

// 列出所有会话检查
import { SessionManager } from "@mariozechner/pi-coding-agent";
const sessions = await SessionManager.list(cwd, agentDir);
console.log("Found sessions:", sessions.length);
```

### 问题 3：权限错误

**症状**：`EACCES: permission denied`

**解决方法**：
```dockerfile
# Dockerfile 中设置正确的权限
RUN mkdir -p /app/pi-agent-data && \
    chown -R node:node /app/pi-agent-data && \
    chmod -R 700 /app/pi-agent-data

USER node
```

## 最佳实践总结

### 1. 容器环境

✅ **推荐**：
```typescript
const agentDir = process.env.PI_CODING_AGENT_DIR || 
                 join(process.cwd(), ".pi-agent-data");
mkdirSync(agentDir, { recursive: true });

await createAgentSession({ agentDir });
```

❌ **不推荐**：
```typescript
// 依赖默认的 ~/.pi/agent
await createAgentSession();
```

### 2. 无状态服务

✅ **推荐**：
```typescript
await createAgentSession({
  sessionManager: SessionManager.inMemory(cwd),
});
```

### 3. 生产环境

✅ **推荐**：
- 使用环境变量配置目录
- 挂载持久化 volume
- 设置合适的权限（700）
- 定期备份会话数据

### 4. 开发/测试环境

✅ **推荐**：
```typescript
const agentDir = join(tmpdir(), `pi-agent-${process.pid}`);
await createAgentSession({ agentDir });
// 测试结束后自动清理
```

## 代码示例：完整的 Server App 集成

```typescript
import express from "express";
import { createAgentSession, SessionManager } from "@mariozechner/pi-coding-agent";
import { mkdirSync, existsSync } from "fs";
import { join } from "path";

const app = express();

// 配置
const DATA_DIR = process.env.PI_AGENT_DATA_DIR || join(process.cwd(), "data");
const AGENT_DIR = join(DATA_DIR, "pi-agent");

// 确保目录存在
if (!existsSync(AGENT_DIR)) {
  mkdirSync(AGENT_DIR, { recursive: true, mode: 0o700 });
}

app.post("/api/session/create", async (req, res) => {
  try {
    const { cwd } = req.body;
    
    const result = await createAgentSession({
      cwd: cwd || process.cwd(),
      agentDir: AGENT_DIR, // 显式指定
    });
    
    res.json({
      success: true,
      sessionId: result.session.sessionId,
      agentDir: AGENT_DIR,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    agentDir: AGENT_DIR,
    agentDirExists: existsSync(AGENT_DIR),
    homeDir: process.env.HOME,
  });
});

app.listen(3000, () => {
  console.log(`Server running on port 3000`);
  console.log(`Agent directory: ${AGENT_DIR}`);
  console.log(`Agent directory exists: ${existsSync(AGENT_DIR)}`);
});
```

## 结论

在 Alpine Linux 等容器环境中找不到 `.pi` 目录的根本原因是：

1. **目录不会自动创建** - 只有在实际写入时才会创建
2. **HOME 环境变量不确定** - 容器中可能未设置或指向特殊位置
3. **权限限制** - 容器文件系统可能是只读的

**最佳解决方案**：
- ✅ 显式指定 `agentDir` 参数
- ✅ 使用环境变量 `PI_CODING_AGENT_DIR` 配置
- ✅ 在 Dockerfile 中预创建目录并设置权限
- ✅ 使用 Volume 挂载持久化数据

这样可以确保在任何环境下都能正确找到和创建 `.pi` 目录。
