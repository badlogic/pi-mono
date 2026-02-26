# 使用 LangGraph/DeepAgents 实现 OpenClaw 功能：详细分析

> 不使用 pi-mono，如何使用 LangGraph 或 DeepAgents 构建类似 OpenClaw 的 AI Agent 系统

---

## 一、OpenClaw 核心架构拆解

### 1.1 核心组件分析

基于对 OpenClaw 源码的深入研究，其核心架构包含以下模块：

```
┌─────────────────────────────────────────────────────────────────────┐
│                         OpenClaw 架构                                │
├─────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │   Gateway    │  │    Agent     │  │   Session    │              │
│  │   Server     │  │    Core      │  │   Manager    │              │
│  └──────────────┘  └──────────────┘  └──────────────┘              │
│         │                 │                 │                       │
│         ▼                 ▼                 ▼                       │
│  ┌──────────────────────────────────────────────────────┐          │
│  │                    Tool System                        │          │
│  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐        │          │
│  │  │  Read  │ │ Write  │ │  Exec  │ │ Search │        │          │
│  │  └────────┘ └────────┘ └────────┘ └────────┘        │          │
│  └──────────────────────────────────────────────────────┘          │
│         │                 │                 │                       │
│         ▼                 ▼                 ▼                       │
│  ┌──────────────────────────────────────────────────────┐          │
│  │              Bootstrap Files (SOUL.md)                │          │
│  │  AGENTS.md │ SOUL.md │ TOOLS.md │ MEMORY.md          │          │
│  └──────────────────────────────────────────────────────┘          │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.2 关键功能模块

| 模块 | 功能 | 技术实现 | 替代难度 |
|------|------|----------|----------|
| **Gateway Server** | WebSocket/HTTP 服务，多客户端连接 | 自定义 WebSocket 服务器 | ⭐⭐⭐ |
| **Agent Core** | LLM 调用、工具执行循环 | pi-mono 的 Agent 运行时 | ⭐⭐⭐⭐ |
| **Session Manager** | 会话状态、历史记录、持久化 | 文件系统 + 内存 | ⭐⭐ |
| **Tool System** | 文件操作、Shell 执行、Web 搜索 | 自定义工具实现 | ⭐⭐⭐ |
| **Bootstrap Files** | SOUL.md 等上下文注入 | 文件读取 + Prompt 构建 | ⭐⭐ |
| **Memory System** | RAG、向量检索、记忆持久化 | SQLite + 向量扩展 | ⭐⭐⭐ |
| **Channel System** | Telegram/Discord/Slack 集成 | 各平台 SDK | ⭐⭐⭐⭐ |
| **Sandbox** | Docker 隔离执行环境 | Docker API | ⭐⭐⭐ |

---

## 二、LangGraph 方案

### 2.1 LangGraph 简介

LangGraph 是 LangChain 推出的用于构建复杂 Agent 工作流的框架，核心概念：

- **StateGraph**: 状态驱动的图结构
- **Nodes**: 处理节点（LLM 调用、工具执行）
- **Edges**: 条件边（路由逻辑）
- **State**: 可持久化的状态管理

### 2.2 架构映射

```
OpenClaw Component → LangGraph Equivalent
─────────────────────────────────────────
Agent Core         → StateGraph
Tool System        → ToolNode + 自定义 Tools
Session Manager    → Checkpointer (持久化)
Memory System      → 自定义 Node + VectorStore
Gateway Server     → FastAPI + WebSocket (外部)
Bootstrap Files    → State 初始化逻辑
```

### 2.3 完整实现方案

#### 2.3.1 核心 State 定义

```python
# state.py
from typing import Annotated, Sequence, TypedDict
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage, ToolMessage
from langgraph.graph.message import add_messages

class OpenClawState(TypedDict):
    """OpenClaw 风格的状态定义"""
    # 消息历史
    messages: Annotated[Sequence[BaseMessage], add_messages]
    
    # 会话标识
    session_id: str
    workspace_dir: str
    
    # Bootstrap 文件内容
    soul_md: str | None
    agents_md: str | None
    tools_md: str | None
    memory_md: str | None
    
    # 工具执行状态
    pending_tool_calls: list[dict]
    tool_results: list[dict]
    
    # 系统配置
    model_name: str
    temperature: float
    max_iterations: int
    
    # 执行控制
    iteration_count: int
    should_continue: bool
    error: str | None
```

#### 2.3.2 Bootstrap 文件加载

```python
# bootstrap.py
import os
from pathlib import Path

class BootstrapLoader:
    """加载 OpenClaw 风格的 Bootstrap 文件"""
    
    DEFAULT_FILES = {
        "soul": "SOUL.md",
        "agents": "AGENTS.md",
        "tools": "TOOLS.md",
        "identity": "IDENTITY.md",
        "user": "USER.md",
        "heartbeat": "HEARTBEAT.md",
        "bootstrap": "BOOTSTRAP.md",
        "memory": "MEMORY.md",
    }
    
    def __init__(self, workspace_dir: str):
        self.workspace_dir = Path(workspace_dir)
    
    def load_all(self) -> dict[str, str | None]:
        """加载所有 bootstrap 文件"""
        result = {}
        for key, filename in self.DEFAULT_FILES.items():
            filepath = self.workspace_dir / filename
            if filepath.exists():
                result[key] = filepath.read_text(encoding="utf-8")
            else:
                result[key] = None
        return result
    
    def build_system_prompt(self, bootstrap_files: dict) -> str:
        """构建 System Prompt"""
        sections = []
        
        # 基础身份
        sections.append("You are a personal assistant running inside OpenClaw-LangGraph.")
        
        # SOUL.md - 人格定义
        if bootstrap_files.get("soul"):
            sections.append(f"\n## Soul (Personality)\n{bootstrap_files['soul']}")
        
        # AGENTS.md - 项目上下文
        if bootstrap_files.get("agents"):
            sections.append(f"\n## Project Context\n{bootstrap_files['agents']}")
        
        # TOOLS.md - 工具指导
        if bootstrap_files.get("tools"):
            sections.append(f"\n## Tools Guidance\n{bootstrap_files['tools']}")
        
        # IDENTITY.md - 身份定义
        if bootstrap_files.get("identity"):
            sections.append(f"\n## Identity\n{bootstrap_files['identity']}")
        
        return "\n".join(sections)
```

#### 2.3.3 工具系统实现

```python
# tools.py
import subprocess
import os
from pathlib import Path
from typing import Type
from pydantic import BaseModel, Field
from langchain_core.tools import BaseTool

class ReadFileInput(BaseModel):
    """Read file tool input"""
    file_path: str = Field(description="Path to the file to read")
    offset: int = Field(default=1, description="Starting line number")
    limit: int = Field(default=100, description="Maximum lines to read")

class ReadFileTool(BaseTool):
    """OpenClaw-style read tool with pagination"""
    name: str = "read"
    description: str = "Read file contents with line numbers and pagination"
    args_schema: Type[BaseModel] = ReadFileInput
    
    workspace_dir: str = ""
    
    def _run(self, file_path: str, offset: int = 1, limit: int = 100) -> str:
        full_path = Path(self.workspace_dir) / file_path
        
        if not full_path.exists():
            return f"Error: File not found: {file_path}"
        
        try:
            with open(full_path, "r", encoding="utf-8") as f:
                lines = f.readlines()
            
            start = max(0, offset - 1)
            end = min(len(lines), start + limit)
            selected_lines = lines[start:end]
            
            # Format with line numbers
            result_lines = []
            for i, line in enumerate(selected_lines, start=start + 1):
                result_lines.append(f"{i:6d} | {line.rstrip()}")
            
            header = f"Reading: {file_path} (lines {start+1}-{end} of {len(lines)})\n"
            return header + "\n".join(result_lines)
            
        except Exception as e:
            return f"Error reading file: {str(e)}"

class WriteFileInput(BaseModel):
    """Write file tool input"""
    file_path: str = Field(description="Path to the file to write")
    content: str = Field(description="Content to write")

class WriteFileTool(BaseTool):
    """OpenClaw-style write tool"""
    name: str = "write"
    description: str = "Create or overwrite a file"
    args_schema: Type[BaseModel] = WriteFileInput
    
    workspace_dir: str = ""
    
    def _run(self, file_path: str, content: str) -> str:
        full_path = Path(self.workspace_dir) / file_path
        
        try:
            # Ensure directory exists
            full_path.parent.mkdir(parents=True, exist_ok=True)
            
            with open(full_path, "w", encoding="utf-8") as f:
                f.write(content)
            
            return f"Successfully wrote {len(content)} characters to {file_path}"
        except Exception as e:
            return f"Error writing file: {str(e)}"

class EditFileInput(BaseModel):
    """Edit file tool input"""
    file_path: str = Field(description="Path to the file to edit")
    old_string: str = Field(description="String to replace")
    new_string: str = Field(description="Replacement string")

class EditFileTool(BaseTool):
    """OpenClaw-style edit tool - precise replacement"""
    name: str = "edit"
    description: str = "Make precise edits by replacing text"
    args_schema: Type[BaseModel] = EditFileInput
    
    workspace_dir: str = ""
    
    def _run(self, file_path: str, old_string: str, new_string: str) -> str:
        full_path = Path(self.workspace_dir) / file_path
        
        try:
            with open(full_path, "r", encoding="utf-8") as f:
                content = f.read()
            
            if old_string not in content:
                return f"Error: Could not find the text to replace in {file_path}"
            
            new_content = content.replace(old_string, new_string, 1)
            
            with open(full_path, "w", encoding="utf-8") as f:
                f.write(new_content)
            
            return f"Successfully edited {file_path}"
        except Exception as e:
            return f"Error editing file: {str(e)}"

class ExecInput(BaseModel):
    """Execute command input"""
    command: str = Field(description="Command to execute")
    timeout: int = Field(default=60, description="Timeout in seconds")

class ExecTool(BaseTool):
    """OpenClaw-style exec tool with safety checks"""
    name: str = "exec"
    description: str = "Execute shell commands in the workspace"
    args_schema: Type[BaseModel] = ExecInput
    
    workspace_dir: str = ""
    allowed_commands: list[str] = None
    blocked_commands: list[str] = None
    
    def _run(self, command: str, timeout: int = 60) -> str:
        # Safety checks
        if self.blocked_commands:
            for blocked in self.blocked_commands:
                if blocked in command:
                    return f"Error: Command contains blocked pattern: {blocked}"
        
        try:
            result = subprocess.run(
                command,
                shell=True,
                cwd=self.workspace_dir,
                capture_output=True,
                text=True,
                timeout=timeout
            )
            
            output = []
            if result.stdout:
                output.append(f"STDOUT:\n{result.stdout}")
            if result.stderr:
                output.append(f"STDERR:\n{result.stderr}")
            output.append(f"Exit code: {result.returncode}")
            
            return "\n".join(output)
            
        except subprocess.TimeoutExpired:
            return f"Error: Command timed out after {timeout} seconds"
        except Exception as e:
            return f"Error executing command: {str(e)}"

class GrepInput(BaseModel):
    """Grep tool input"""
    pattern: str = Field(description="Regex pattern to search")
    path: str = Field(default=".", description="Path to search in")
    include: str = Field(default="*", description="File glob pattern")

class GrepTool(BaseTool):
    """OpenClaw-style grep tool"""
    name: str = "grep"
    description: str = "Search file contents using regex"
    args_schema: Type[BaseModel] = GrepInput
    
    workspace_dir: str = ""
    
    def _run(self, pattern: str, path: str = ".", include: str = "*") -> str:
        import re
        from fnmatch import fnmatch
        
        search_path = Path(self.workspace_dir) / path
        results = []
        
        try:
            for root, dirs, files in os.walk(search_path):
                # Skip common non-source directories
                dirs[:] = [d for d in dirs if d not in {
                    "node_modules", ".git", "__pycache__", ".venv", "dist", "build"
                }]
                
                for file in files:
                    if not fnmatch(file, include):
                        continue
                    
                    file_path = Path(root) / file
                    try:
                        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                            for line_num, line in enumerate(f, 1):
                                if re.search(pattern, line):
                                    rel_path = file_path.relative_to(self.workspace_dir)
                                    results.append(f"{rel_path}:{line_num}: {line.strip()}")
                                    
                                    if len(results) >= 50:  # Limit results
                                        results.append("... (truncated)")
                                        return "\n".join(results)
                    except Exception:
                        continue
            
            if not results:
                return f"No matches found for pattern: {pattern}"
            
            return f"Found {len(results)} matches:\n" + "\n".join(results)
            
        except Exception as e:
            return f"Error searching: {str(e)}"

def create_openclaw_tools(workspace_dir: str) -> list[BaseTool]:
    """Create all OpenClaw-style tools"""
    tools = [
        ReadFileTool(workspace_dir=workspace_dir),
        WriteFileTool(workspace_dir=workspace_dir),
        EditFileTool(workspace_dir=workspace_dir),
        ExecTool(workspace_dir=workspace_dir),
        GrepTool(workspace_dir=workspace_dir),
    ]
    return tools
```

#### 2.3.4 Memory 系统实现

```python
# memory.py
import sqlite3
import json
import numpy as np
from pathlib import Path
from typing import List, Optional
from langchain_openai import OpenAIEmbeddings

class MemoryManager:
    """OpenClaw-style memory system with RAG"""
    
    def __init__(self, workspace_dir: str, embedding_model: Optional[str] = None):
        self.workspace_dir = Path(workspace_dir)
        self.memory_dir = self.workspace_dir / "memory"
        self.memory_dir.mkdir(exist_ok=True)
        
        self.db_path = self.workspace_dir / ".openclaw" / "memory.db"
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        
        # Initialize embeddings
        self.embeddings = OpenAIEmbeddings(
            model=embedding_model or "text-embedding-3-small"
        )
        
        self._init_db()
    
    def _init_db(self):
        """Initialize SQLite database with vector extension"""
        conn = sqlite3.connect(str(self.db_path))
        cursor = conn.cursor()
        
        # Create tables
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS memory_chunks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_path TEXT NOT NULL,
                start_line INTEGER,
                end_line INTEGER,
                content TEXT NOT NULL,
                embedding BLOB,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_memory_file 
            ON memory_chunks(file_path)
        """)
        
        conn.commit()
        conn.close()
    
    def index_memory_files(self):
        """Index all memory files"""
        memory_files = [
            self.workspace_dir / "MEMORY.md",
            *self.memory_dir.glob("*.md")
        ]
        
        for file_path in memory_files:
            if file_path.exists():
                self._index_file(file_path)
    
    def _index_file(self, file_path: Path):
        """Index a single memory file"""
        content = file_path.read_text(encoding="utf-8")
        lines = content.split("\n")
        
        # Chunk by sections (simple approach)
        chunks = []
        current_chunk = []
        current_start = 1
        
        for i, line in enumerate(lines, 1):
            if line.startswith("#") and current_chunk:
                # Save previous chunk
                chunks.append({
                    "start": current_start,
                    "end": i - 1,
                    "content": "\n".join(current_chunk)
                })
                current_chunk = []
                current_start = i
            
            current_chunk.append(line)
        
        # Save last chunk
        if current_chunk:
            chunks.append({
                "start": current_start,
                "end": len(lines),
                "content": "\n".join(current_chunk)
            })
        
        # Generate embeddings and store
        conn = sqlite3.connect(str(self.db_path))
        cursor = conn.cursor()
        
        rel_path = file_path.relative_to(self.workspace_dir)
        
        for chunk in chunks:
            embedding = self.embeddings.embed_query(chunk["content"])
            embedding_blob = json.dumps(embedding).encode()
            
            cursor.execute("""
                INSERT INTO memory_chunks 
                (file_path, start_line, end_line, content, embedding)
                VALUES (?, ?, ?, ?, ?)
            """, (
                str(rel_path),
                chunk["start"],
                chunk["end"],
                chunk["content"],
                embedding_blob
            ))
        
        conn.commit()
        conn.close()
    
    def search(self, query: str, top_k: int = 5) -> List[dict]:
        """Search memory using vector similarity"""
        query_embedding = self.embeddings.embed_query(query)
        
        conn = sqlite3.connect(str(self.db_path))
        cursor = conn.cursor()
        
        cursor.execute("SELECT * FROM memory_chunks")
        rows = cursor.fetchall()
        conn.close()
        
        # Calculate cosine similarity
        results = []
        for row in rows:
            chunk_embedding = json.loads(row[5])
            similarity = self._cosine_similarity(query_embedding, chunk_embedding)
            
            results.append({
                "file_path": row[1],
                "start_line": row[2],
                "end_line": row[3],
                "content": row[4],
                "score": similarity
            })
        
        # Sort by similarity and return top_k
        results.sort(key=lambda x: x["score"], reverse=True)
        return results[:top_k]
    
    def _cosine_similarity(self, a: List[float], b: List[float]) -> float:
        """Calculate cosine similarity between two vectors"""
        a = np.array(a)
        b = np.array(b)
        return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))
```

#### 2.3.5 LangGraph 主流程

```python
# graph.py
from typing import Literal
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage, ToolMessage
from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph, END
from langgraph.prebuilt import ToolNode
from langgraph.checkpoint.sqlite import SqliteSaver

from state import OpenClawState
from bootstrap import BootstrapLoader
from tools import create_openclaw_tools
from memory import MemoryManager

class OpenClawGraph:
    """OpenClaw-style LangGraph implementation"""
    
    def __init__(self, workspace_dir: str, model_name: str = "gpt-4o"):
        self.workspace_dir = workspace_dir
        self.model_name = model_name
        
        # Initialize components
        self.bootstrap_loader = BootstrapLoader(workspace_dir)
        self.tools = create_openclaw_tools(workspace_dir)
        self.memory_manager = MemoryManager(workspace_dir)
        
        # Initialize LLM
        self.llm = ChatOpenAI(
            model=model_name,
            temperature=0.2,
        ).bind_tools(self.tools)
        
        # Build graph
        self.graph = self._build_graph()
    
    def _build_graph(self) -> StateGraph:
        """Build the LangGraph"""
        
        # Define nodes
        def initialize(state: OpenClawState) -> OpenClawState:
            """Initialize session with bootstrap files"""
            bootstrap_files = self.bootstrap_loader.load_all()
            system_prompt = self.bootstrap_loader.build_system_prompt(bootstrap_files)
            
            # Add system message
            messages = list(state.get("messages", []))
            if not messages or not isinstance(messages[0], SystemMessage):
                messages.insert(0, SystemMessage(content=system_prompt))
            
            # Index memory files
            self.memory_manager.index_memory_files()
            
            return {
                **state,
                "messages": messages,
                "soul_md": bootstrap_files.get("soul"),
                "agents_md": bootstrap_files.get("agents"),
                "tools_md": bootstrap_files.get("tools"),
                "memory_md": bootstrap_files.get("memory"),
                "iteration_count": 0,
                "should_continue": True,
            }
        
        def agent_node(state: OpenClawState) -> OpenClawState:
            """Main agent node - calls LLM"""
            messages = state["messages"]
            
            # Search memory if needed
            if state.get("iteration_count", 0) == 0:
                # For first iteration, search memory based on user query
                for msg in reversed(messages):
                    if isinstance(msg, HumanMessage):
                        memory_results = self.memory_manager.search(msg.content, top_k=3)
                        if memory_results:
                            memory_context = "\n\n## Relevant Memory\n"
                            for result in memory_results:
                                memory_context += f"\nFrom {result['file_path']}:\n{result['content']}\n"
                            
                            # Prepend to first human message
                            messages = list(messages)
                            for i, m in enumerate(messages):
                                if isinstance(m, HumanMessage):
                                    messages[i] = HumanMessage(
                                        content=memory_context + "\n\n" + m.content
                                    )
                                    break
                            break
            
            # Call LLM
            response = self.llm.invoke(messages)
            
            return {
                **state,
                "messages": list(messages) + [response],
                "iteration_count": state.get("iteration_count", 0) + 1,
            }
        
        def should_continue(state: OpenClawState) -> Literal["tools", "end"]:
            """Decide whether to continue or end"""
            messages = state["messages"]
            last_message = messages[-1] if messages else None
            
            # Check if last message has tool calls
            if isinstance(last_message, AIMessage) and last_message.tool_calls:
                return "tools"
            
            # Check iteration limit
            if state.get("iteration_count", 0) >= state.get("max_iterations", 10):
                return "end"
            
            return "end"
        
        # Create tool node
        tool_node = ToolNode(self.tools)
        
        # Build graph
        workflow = StateGraph(OpenClawState)
        
        # Add nodes
        workflow.add_node("initialize", initialize)
        workflow.add_node("agent", agent_node)
        workflow.add_node("tools", tool_node)
        
        # Add edges
        workflow.set_entry_point("initialize")
        workflow.add_edge("initialize", "agent")
        workflow.add_conditional_edges(
            "agent",
            should_continue,
            {
                "tools": "tools",
                "end": END,
            }
        )
        workflow.add_edge("tools", "agent")
        
        # Add persistence
        checkpointer = SqliteSaver.from_conn_string(
            f"{self.workspace_dir}/.openclaw/sessions.db"
        )
        
        return workflow.compile(checkpointer=checkpointer)
    
    def run(self, user_input: str, session_id: str = None) -> str:
        """Run the agent with user input"""
        import uuid
        
        if session_id is None:
            session_id = str(uuid.uuid4())
        
        # Initialize state
        initial_state: OpenClawState = {
            "messages": [HumanMessage(content=user_input)],
            "session_id": session_id,
            "workspace_dir": self.workspace_dir,
            "soul_md": None,
            "agents_md": None,
            "tools_md": None,
            "memory_md": None,
            "pending_tool_calls": [],
            "tool_results": [],
            "model_name": self.model_name,
            "temperature": 0.2,
            "max_iterations": 10,
            "iteration_count": 0,
            "should_continue": True,
            "error": None,
        }
        
        # Run graph
        config = {"configurable": {"thread_id": session_id}}
        result = self.graph.invoke(initial_state, config)
        
        # Extract final response
        messages = result["messages"]
        for msg in reversed(messages):
            if isinstance(msg, AIMessage) and not msg.tool_calls:
                return msg.content
        
        return "No response generated"
```

#### 2.3.6 Gateway Server (FastAPI + WebSocket)

```python
# server.py
import asyncio
import json
from typing import Dict, Set
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from graph import OpenClawGraph

class ConnectionManager:
    """WebSocket connection manager"""
    
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
        self.sessions: Dict[str, OpenClawGraph] = {}
    
    async def connect(self, websocket: WebSocket, client_id: str):
        await websocket.accept()
        self.active_connections[client_id] = websocket
    
    def disconnect(self, client_id: str):
        self.active_connections.pop(client_id, None)
        self.sessions.pop(client_id, None)
    
    async def send_message(self, client_id: str, message: dict):
        if client_id in self.active_connections:
            await self.active_connections[client_id].send_json(message)
    
    def get_or_create_session(self, client_id: str, workspace_dir: str) -> OpenClawGraph:
        if client_id not in self.sessions:
            self.sessions[client_id] = OpenClawGraph(workspace_dir)
        return self.sessions[client_id]

manager = ConnectionManager()

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan"""
    # Startup
    print("Starting OpenClaw-LangGraph server...")
    yield
    # Shutdown
    print("Shutting down...")

app = FastAPI(
    title="OpenClaw-LangGraph",
    description="OpenClaw implementation using LangGraph",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.websocket("/ws/{client_id}")
async def websocket_endpoint(websocket: WebSocket, client_id: str):
    """WebSocket endpoint for real-time communication"""
    await manager.connect(websocket, client_id)
    
    try:
        while True:
            # Receive message
            data = await websocket.receive_json()
            
            message_type = data.get("type", "message")
            
            if message_type == "message":
                user_input = data.get("content", "")
                workspace_dir = data.get("workspace_dir", "./workspace")
                session_id = data.get("session_id", client_id)
                
                # Get or create session
                graph = manager.get_or_create_session(client_id, workspace_dir)
                
                # Send acknowledgment
                await manager.send_message(client_id, {
                    "type": "status",
                    "status": "processing"
                })
                
                # Run agent
                try:
                    response = graph.run(user_input, session_id)
                    
                    await manager.send_message(client_id, {
                        "type": "response",
                        "content": response,
                        "session_id": session_id
                    })
                except Exception as e:
                    await manager.send_message(client_id, {
                        "type": "error",
                        "error": str(e)
                    })
            
            elif message_type == "reset":
                # Reset session
                if client_id in manager.sessions:
                    del manager.sessions[client_id]
                await manager.send_message(client_id, {
                    "type": "status",
                    "status": "reset"
                })
    
    except WebSocketDisconnect:
        manager.disconnect(client_id)

@app.post("/v1/chat/completions")
async def chat_completions(request: dict):
    """OpenAI-compatible chat completions endpoint"""
    messages = request.get("messages", [])
    workspace_dir = request.get("workspace_dir", "./workspace")
    session_id = request.get("session_id", "default")
    
    # Get user input from last message
    user_input = ""
    for msg in reversed(messages):
        if msg.get("role") == "user":
            user_input = msg.get("content", "")
            break
    
    # Create graph and run
    graph = OpenClawGraph(workspace_dir)
    response = graph.run(user_input, session_id)
    
    return {
        "id": f"chatcmpl-{session_id}",
        "object": "chat.completion",
        "choices": [{
            "index": 0,
            "message": {
                "role": "assistant",
                "content": response
            }
        }]
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=18789)
```

---

## 三、DeepAgents 方案

### 3.1 DeepAgents 简介

DeepAgents 是深度求索 (DeepSeek) 推出的 Agent 框架，特点：

- **原生支持 Function Calling**
- **多 Agent 协作**
- **内置工具生态**
- **与 DeepSeek 模型深度集成**

### 3.2 架构映射

```
OpenClaw Component → DeepAgents Equivalent
──────────────────────────────────────────
Agent Core         → Agent / MultiAgent
Tool System        → ToolRegistry + 自定义 Tools
Session Manager    → SessionStore
Memory System      → MemoryModule + VectorDB
Gateway Server     → FastAPI (外部)
Bootstrap Files    → Agent Config
```

### 3.3 实现方案

```python
# deepagents_impl.py
from deepagents import Agent, MultiAgent, Tool, ToolRegistry
from deepagents.memory import MemoryModule, SQLiteStore
from deepagents.session import SessionStore
import os
from pathlib import Path

class OpenClawDeepAgent:
    """OpenClaw implementation using DeepAgents"""
    
    def __init__(self, workspace_dir: str, model: str = "deepseek-chat"):
        self.workspace_dir = workspace_dir
        self.model = model
        
        # Initialize components
        self.tool_registry = self._create_tools()
        self.memory = self._create_memory()
        self.session_store = SessionStore(
            db_path=f"{workspace_dir}/.openclaw/sessions.db"
        )
        
        # Load bootstrap files
        self.bootstrap = self._load_bootstrap()
        
        # Create agent
        self.agent = self._create_agent()
    
    def _create_tools(self) -> ToolRegistry:
        """Create OpenClaw-style tools"""
        registry = ToolRegistry()
        
        @Tool(name="read", description="Read file contents")
        def read_file(file_path: str, offset: int = 1, limit: int = 100) -> str:
            full_path = Path(self.workspace_dir) / file_path
            if not full_path.exists():
                return f"Error: File not found: {file_path}"
            
            with open(full_path, "r", encoding="utf-8") as f:
                lines = f.readlines()
            
            start = max(0, offset - 1)
            end = min(len(lines), start + limit)
            selected = lines[start:end]
            
            result = [f"{i+1:6d} | {line.rstrip()}" for i, line in enumerate(selected, start)]
            return f"Reading: {file_path} (lines {start+1}-{end} of {len(lines)})\n" + "\n".join(result)
        
        @Tool(name="write", description="Write file contents")
        def write_file(file_path: str, content: str) -> str:
            full_path = Path(self.workspace_dir) / file_path
            full_path.parent.mkdir(parents=True, exist_ok=True)
            
            with open(full_path, "w", encoding="utf-8") as f:
                f.write(content)
            
            return f"Successfully wrote {len(content)} characters to {file_path}"
        
        @Tool(name="edit", description="Edit file contents")
        def edit_file(file_path: str, old_string: str, new_string: str) -> str:
            full_path = Path(self.workspace_dir) / file_path
            
            with open(full_path, "r", encoding="utf-8") as f:
                content = f.read()
            
            if old_string not in content:
                return f"Error: Could not find text to replace"
            
            new_content = content.replace(old_string, new_string, 1)
            
            with open(full_path, "w", encoding="utf-8") as f:
                f.write(new_content)
            
            return f"Successfully edited {file_path}"
        
        @Tool(name="exec", description="Execute shell command")
        def exec_command(command: str, timeout: int = 60) -> str:
            import subprocess
            
            result = subprocess.run(
                command,
                shell=True,
                cwd=self.workspace_dir,
                capture_output=True,
                text=True,
                timeout=timeout
            )
            
            output = []
            if result.stdout:
                output.append(f"STDOUT:\n{result.stdout}")
            if result.stderr:
                output.append(f"STDERR:\n{result.stderr}")
            output.append(f"Exit code: {result.returncode}")
            
            return "\n".join(output)
        
        @Tool(name="memory_search", description="Search memory files")
        def memory_search(query: str, top_k: int = 5) -> str:
            results = self.memory.search(query, top_k)
            if not results:
                return "No relevant memories found"
            
            output = ["Relevant memories:"]
            for r in results:
                output.append(f"\nFrom {r['file_path']} (score: {r['score']:.3f}):")
                output.append(r['content'])
            
            return "\n".join(output)
        
        registry.register(read_file)
        registry.register(write_file)
        registry.register(edit_file)
        registry.register(exec_command)
        registry.register(memory_search)
        
        return registry
    
    def _create_memory(self) -> MemoryModule:
        """Create memory system"""
        store = SQLiteStore(
            db_path=f"{self.workspace_dir}/.openclaw/memory.db"
        )
        
        memory = MemoryModule(
            store=store,
            embedding_model="deepseek-embedding"
        )
        
        # Index memory files
        memory_files = [
            Path(self.workspace_dir) / "MEMORY.md",
            *Path(self.workspace_dir / "memory").glob("*.md")
        ]
        
        for file_path in memory_files:
            if file_path.exists():
                memory.index_file(str(file_path))
        
        return memory
    
    def _load_bootstrap(self) -> dict:
        """Load bootstrap files"""
        files = {}
        for name in ["SOUL.md", "AGENTS.md", "TOOLS.md", "IDENTITY.md"]:
            path = Path(self.workspace_dir) / name
            if path.exists():
                files[name.lower().replace(".md", "")] = path.read_text()
        return files
    
    def _create_agent(self) -> Agent:
        """Create the main agent"""
        # Build system prompt from bootstrap
        system_prompt = self._build_system_prompt()
        
        agent = Agent(
            name="openclaw",
            model=self.model,
            system_prompt=system_prompt,
            tools=self.tool_registry,
            memory=self.memory,
            max_iterations=10
        )
        
        return agent
    
    def _build_system_prompt(self) -> str:
        """Build system prompt from bootstrap files"""
        sections = [
            "You are a personal assistant running inside OpenClaw-DeepAgents."
        ]
        
        if "soul" in self.bootstrap:
            sections.append(f"\n## Soul\n{self.bootstrap['soul']}")
        
        if "agents" in self.bootstrap:
            sections.append(f"\n## Project Context\n{self.bootstrap['agents']}")
        
        if "tools" in self.bootstrap:
            sections.append(f"\n## Tools Guidance\n{self.bootstrap['tools']}")
        
        sections.append("""
## Available Tools

You have access to the following tools:
- read: Read file contents with pagination
- write: Create or overwrite files
- edit: Make precise text replacements
- exec: Execute shell commands
- memory_search: Search memory files

Use these tools to help the user with their tasks.
""")
        
        return "\n".join(sections)
    
    def run(self, user_input: str, session_id: str = None) -> str:
        """Run the agent"""
        if session_id is None:
            import uuid
            session_id = str(uuid.uuid4())
        
        # Get or create session
        session = self.session_store.get_or_create(session_id)
        
        # Run agent
        response = self.agent.run(
            user_input,
            session=session,
            context={
                "workspace_dir": self.workspace_dir,
                "bootstrap": self.bootstrap
            }
        )
        
        return response
```

---

## 四、方案对比

### 4.1 LangGraph vs DeepAgents vs pi-mono

| 维度 | LangGraph | DeepAgents | pi-mono (OpenClaw) |
|------|-----------|------------|-------------------|
| **架构** | 图结构 (StateGraph) | Agent + ToolRegistry | 自定义 Agent 循环 |
| **状态管理** | 内置 Checkpointer | SessionStore | 自定义 Session 管理 |
| **工具系统** | ToolNode | ToolRegistry | 自定义 Tool 包装 |
| **记忆系统** | 需自定义 | MemoryModule | QMD / Builtin |
| **多 Agent** | 支持 (Subgraph) | MultiAgent | Subagents |
| **可视化** | LangGraph Studio | 有限 | 无 |
| **生态** | LangChain 生态 | DeepSeek 生态 | 独立 |
| **学习曲线** | 中等 | 低 | 高 |

### 4.2 实现复杂度对比

```
功能模块                LangGraph    DeepAgents    pi-mono
─────────────────────────────────────────────────────────
Bootstrap 加载          ⭐⭐          ⭐⭐           ⭐⭐
工具系统                ⭐⭐⭐         ⭐⭐            ⭐⭐⭐
记忆系统                ⭐⭐⭐         ⭐⭐            ⭐⭐
会话管理                ⭐⭐          ⭐⭐            ⭐⭐⭐
Gateway Server          ⭐⭐⭐         ⭐⭐⭐          ⭐⭐⭐
多 Agent 支持           ⭐⭐          ⭐⭐            ⭐⭐⭐
沙箱隔离                ⭐⭐⭐         ⭐⭐⭐          ⭐⭐
Channel 集成            ⭐⭐⭐         ⭐⭐⭐          ⭐⭐
```

---

## 五、推荐方案

### 5.1 选择建议

| 场景 | 推荐方案 | 理由 |
|------|----------|------|
| **快速原型** | DeepAgents | API 简洁，快速上手 |
| **生产环境** | LangGraph | 生态成熟，可控性强 |
| **复杂工作流** | LangGraph | 图结构适合复杂流程 |
| **DeepSeek 用户** | DeepAgents | 原生集成，性能优化 |
| **LangChain 用户** | LangGraph | 生态一致，工具丰富 |

### 5.2 混合方案

也可以结合两者优势：

```python
# 使用 LangGraph 作为主框架
# 使用 DeepAgents 的 ToolRegistry 管理工具
# 使用 DeepAgents 的 MemoryModule 管理记忆

from langgraph.graph import StateGraph
from deepagents import ToolRegistry
from deepagents.memory import MemoryModule

class HybridOpenClaw:
    def __init__(self):
        self.tool_registry = ToolRegistry()  # DeepAgents
        self.memory = MemoryModule()          # DeepAgents
        self.graph = self._build_langgraph()  # LangGraph
```

---

## 六、完整项目结构

```
openclaw-alternative/
├── langgraph_impl/           # LangGraph 实现
│   ├── __init__.py
│   ├── state.py             # State 定义
│   ├── bootstrap.py         # Bootstrap 文件加载
│   ├── tools.py             # 工具实现
│   ├── memory.py            # 记忆系统
│   ├── graph.py             # LangGraph 构建
│   └── server.py            # FastAPI Gateway
│
├── deepagents_impl/          # DeepAgents 实现
│   ├── __init__.py
│   └── agent.py             # DeepAgent 实现
│
├── shared/                   # 共享组件
│   ├── __init__.py
│   ├── templates/           # Bootstrap 模板
│   │   ├── SOUL.md
│   │   ├── AGENTS.md
│   │   └── TOOLS.md
│   └── utils.py
│
├── tests/
├── workspace/               # 默认工作区
│   ├── SOUL.md
│   ├── AGENTS.md
│   └── MEMORY.md
│
├── requirements.txt
├── README.md
└── main.py                  # 入口文件
```

---

## 七、关键挑战与解决方案

### 7.1 挑战 1: 工具策略系统

**OpenClaw 特性**: 复杂的工具权限策略（allowlist、blocklist、group policy）

**解决方案**:
```python
class ToolPolicyManager:
    def check_permission(self, tool_name: str, context: dict) -> bool:
        # 实现 OpenClaw 风格的策略检查
        pass

# 在 LangGraph 中包装工具
def wrap_tool_with_policy(tool, policy_manager):
    def wrapped_tool(*args, **kwargs):
        if not policy_manager.check_permission(tool.name, kwargs):
            return "Error: Tool not allowed by policy"
        return tool(*args, **kwargs)
    return wrapped_tool
```

### 7.2 挑战 2: 沙箱隔离

**OpenClaw 特性**: Docker 沙箱执行

**解决方案**:
```python
class SandboxExecutor:
    def __init__(self, container_name: str):
        self.container = container_name
    
    def exec(self, command: str) -> str:
        # 使用 Docker SDK
        import docker
        client = docker.from_env()
        container = client.containers.get(self.container)
        result = container.exec_run(command)
        return result.output.decode()
```

### 7.3 挑战 3: Channel 集成

**OpenClaw 特性**: Telegram、Discord、Slack 集成

**解决方案**:
```python
class ChannelManager:
    def __init__(self):
        self.channels = {}
    
    def register_telegram(self, bot_token: str):
        from telegram import Bot
        self.channels['telegram'] = Bot(token=bot_token)
    
    def send_message(self, channel: str, message: str):
        if channel in self.channels:
            self.channels[channel].send_message(message)
```

---

## 八、总结

### 8.1 核心结论

1. **LangGraph 更适合**: 需要复杂工作流、可视化调试、LangChain 生态集成的场景
2. **DeepAgents 更适合**: 快速开发、DeepSeek 模型用户、简单 Agent 场景
3. **两者都可以**: 实现 OpenClaw 的核心功能（Bootstrap 文件、工具系统、记忆系统）

### 8.2 实现要点

| 功能 | 关键实现 |
|------|----------|
| **Bootstrap 文件** | 文件加载器 + System Prompt 构建 |
| **工具系统** | 自定义 Tool 类 + 权限包装 |
| **记忆系统** | 向量数据库 + RAG |
| **会话管理** | Checkpointer / SessionStore |
| **Gateway** | FastAPI + WebSocket |

### 8.3 迁移路径

```
Phase 1: 基础工具 (read/write/edit/exec)
Phase 2: Bootstrap 文件支持
Phase 3: 记忆系统
Phase 4: Gateway Server
Phase 5: Channel 集成
Phase 6: 沙箱隔离
Phase 7: 高级功能 (subagents、cron 等)
```

---

## 参考文档

- [LangGraph Documentation](https://langchain-ai.github.io/langgraph/)
- [DeepAgents Documentation](https://github.com/deepseek-ai/deepagents)
- [OpenClaw Source Code](../src/agents/pi-tools.ts)
- [OpenClaw Gateway](../src/gateway/server.impl.ts)
