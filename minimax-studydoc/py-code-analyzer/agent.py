import os
from dataclasses import dataclass, field
from typing import Any

from pydantic import BaseModel
from pydantic_ai import Agent, RunContext

from tools import FileTools


class ToolCallRecord(BaseModel):
    name: str
    args: dict[str, Any]
    result: str
    is_error: bool


class AnalysisResult(BaseModel):
    success: bool
    response: str
    tool_calls: list[ToolCallRecord] = []
    tokens: dict[str, int] = {}


DEFAULT_SYSTEM_PROMPT = """You are a code analysis assistant. Analyze code in the repository.

Available tools:
- read: Read file contents (supports offset/limit for large files)
- grep: Search file contents for patterns (supports regex)
- find: Find files by glob pattern
- ls: List directory contents
- bash: Execute shell commands

Guidelines:
1. Start by exploring the directory structure with ls or find
2. Use grep to find relevant code patterns
3. Read specific files to understand implementation details
4. Be concise and focus on the user's specific questions
5. Provide actionable insights and code examples when helpful"""


class AgentDeps:
    def __init__(self, repo_path: str):
        self.file_tools = FileTools(repo_path)
        self.tool_calls: list[ToolCallRecord] = []


@dataclass
class AgentService:
    repo_path: str
    api_key: str | None = None
    model: str = "anthropic:claude-sonnet-4-20250514"
    base_url: str | None = None
    system_prompt: str = DEFAULT_SYSTEM_PROMPT
    
    _agent: Agent[AgentDeps] | None = field(default=None, init=False)
    _deps: AgentDeps = field(init=False)

    def __post_init__(self):
        self._deps = AgentDeps(self.repo_path)
        self._init_agent()

    def _init_agent(self):
        @Agent.tool_plain
        def read(path: str, offset: int = 0, limit: int = 5000) -> str:
            result = self._deps.file_tools.read(path, offset, limit)
            if result.success:
                return result.content or ""
            return f"Error: {result.error}"

        @Agent.tool_plain
        def bash(command: str) -> str:
            result = self._deps.file_tools.bash(command)
            if result.success:
                return result.stdout or ""
            return f"Error: {result.stderr or result.error}"

        @Agent.tool_plain
        def grep(pattern: str, path: str | None = None) -> str:
            result = self._deps.file_tools.grep(pattern, path)
            if result.success and result.matches:
                lines = [f"{m['file']}:{m['line']}: {m['content']}" for m in result.matches[:50]]
                return "\n".join(lines)
            return "No matches found"

        @Agent.tool_plain
        def find(pattern: str) -> str:
            result = self._deps.file_tools.find(pattern)
            if result.success and result.files:
                return "\n".join(result.files[:50])
            return "No files found"

        @Agent.tool_plain
        def ls(path: str = ".") -> str:
            result = self._deps.file_tools.ls(path)
            if result.success and result.entries:
                lines = [f"{'d' if e['type'] == 'dir' else 'f'} {e['name']}" for e in result.entries]
                return "\n".join(lines)
            return f"Error: {result.error}"

        self._agent = Agent(
            model=self.model,
            system_prompt=self.system_prompt,
            tools=[read, bash, grep, find, ls],
        )

    async def analyze(self, prompt: str) -> AnalysisResult:
        if self._agent is None:
            self._init_agent()

        self._deps.tool_calls = []
        
        result = await self._agent.run(prompt, deps=self._deps)
        
        tool_calls = []
        for msg in result.all_messages():
            if hasattr(msg, 'parts'):
                for part in msg.parts:
                    if hasattr(part, 'tool_call_id'):
                        tool_calls.append(ToolCallRecord(
                            name=part.tool_name,
                            args=part.args,
                            result=str(part.content)[:500],
                            is_error=part.content and 'Error' in str(part.content)
                        ))

        return AnalysisResult(
            success=True,
            response=str(result.data),
            tool_calls=tool_calls,
        )

    async def chat(self, prompt: str) -> str:
        result = await self.analyze(prompt)
        return result.response

    def get_messages(self) -> list[dict[str, Any]]:
        if self._agent is None:
            return []
        return []


class SummarizeService:
    def __init__(self, api_key: str | None = None, model: str = "anthropic:claude-sonnet-4-20250514"):
        self.api_key = api_key or os.getenv("ANTHROPIC_API_KEY")
        self.model = model

    async def summarize(self, conversation_text: str) -> str:
        summary_prompt = f"""Summarize this conversation so I can resume it later.
Include goals, key decisions, progress, open questions, and next steps.
Keep it concise and structured with headings.

<conversation>
{conversation_text}
</conversation>"""

        agent = Agent(model=self.model)
        
        result = await agent.run(summary_prompt)
        return str(result.data)
