# OpenClaw Session 锁机制研究文档

## 1. 概述

在 OpenClaw 中，Session（会话）历史数据通常以 `.jsonl` 格式存储在本地文件系统中。为了防止多个进程或线程同时写入同一个会话文件导致数据损坏或竞争状态，OpenClaw 实现了一套基于文件系统的 **Session 写锁机制 (Session Write Lock)**。

该机制的核心代码位于 `src/agents/session-write-lock.ts`。

## 2. 核心设计原理

### 2.1 基于文件的排他锁
OpenClaw 使用后缀为 `.jsonl.lock` 的文件来表示一个会话正在被占用。
- **原子性保障**：使用 Node.js 的 `fs.open(path, 'wx')`。`x` (exclusive) 标志位确保如果文件已存在，操作将失败，从而实现原子的“检查并创建”。
- **锁文件内容**：锁文件是一个 JSON 文件，记录了持有锁的进程 ID (`pid`) 和创建时间 (`createdAt`)。

### 2.2 锁的获取 (Acquire)
当调用 `acquireSessionWriteLock` 时：
1. **路径标准化**：使用 `fs.realpath` 确保路径一致，避免因软链接或相对路径导致的锁失效。
2. **重入支持 (Reentrancy)**：如果当前进程已经持有该锁，则增加内部计数器 `count` 并立即返回，无需重复创建文件。
3. **轮询重试**：如果锁已被占用，会在 `timeoutMs` 范围内进行指数退避式的轮询。

### 2.3 锁的释放 (Release)
- **计数管理**：每次调用 `release` 减少 `count`，仅当计数归零时才关闭文件句柄并删除 `.lock` 文件。
- **异步清理**：释放操作是异步的，确保文件句柄被正确关闭。

## 3. 健壮性与容错机制

这是 OpenClaw 锁机制最出色的部分，针对各种异常情况做了深度防御：

### 3.1 僵尸锁自动回收 (Stale Lock Detection)
如果进程意外崩溃，锁文件可能残留。OpenClaw 在尝试获取锁时会检查现有锁的状态：
- **PID 存活检查**：通过 `isPidAlive` 检查锁文件中的 PID 是否仍在运行。
- **超时检查**：如果锁的持有时间超过了 `staleMs`（默认 30 分钟），会被判定为“陈旧锁”。
- **自动清除**：一旦判定为陈旧，系统会自动删除残留的 `.lock` 文件并重新尝试获取。

### 3.2 看门狗监控 (Watchdog)
为了防止某个任务意外挂起（未崩溃但也不结束）导致永久死锁，OpenClaw 启动了一个后台定时器：
- **最大持有时间**：默认 `maxHoldMs` 为 5 分钟。
- **主动释放**：看门狗每分钟扫描一次，强制释放持有时间过长的锁，并发出警告日志。

### 3.3 进程退出保护 (Signal Handling)
OpenClaw 注册了多种信号处理器（`SIGINT`, `SIGTERM` 等）以及 `process.on('exit')`：
- **同步清理**：在进程关闭的最后时刻，强制通过 **同步方法** (`rmSync`) 清除所有当前进程持有的锁，确保不给下一次运行留麻烦。

## 4. 应用场景

该机制主要应用于以下高并发或高风险场景：
1. **会话持久化** (`src/config/sessions/store.ts`)：在保存会话状态到磁盘时。
2. **Agent 任务执行** (`src/agents/pi-embedded-runner/run/attempt.ts`)：确保一个 Agent 在处理消息时，其历史记录不会被其他并行任务篡改。
3. **历史记录压缩 (Compaction)** (`src/agents/pi-embedded-runner/compact.ts`)：在对大型 `.jsonl` 文件进行重写或清理时。

## 5. 总结

OpenClaw 的 Session 锁机制是一套典型的**悲观锁实现**。它不依赖复杂的分布式协调器（如 Redis 或 ZooKeeper），而是充分利用了文件系统的原子操作，并通过 PID 检查和看门狗机制解决了单机环境下的可靠性问题。

这种设计的优点是**零依赖**、**易于调试**且**极致健壮**，非常适合 OpenClaw 这种以本地文件为中心的数据架构。

---
*文档生成日期：2026-02-18*
*相关源码：src/agents/session-write-lock.ts*
