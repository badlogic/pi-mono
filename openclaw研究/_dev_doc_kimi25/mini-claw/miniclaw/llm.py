"""OpenAI LLM provider implementation."""

import json
from typing import Optional, Any
from pydantic import BaseModel


class Message(BaseModel):
    """A chat message."""
    role: str
    content: str


class ToolCall(BaseModel):
    """A tool call from the LLM."""
    name: str
    arguments: dict[str, Any]


class LLMResponse(BaseModel):
    """Response from an LLM."""
    content: Optional[str] = None
    tool_calls: list[ToolCall] = []
    usage: Optional[dict[str, int]] = None


class OpenAILLM:
    """OpenAI API implementation."""

    def __init__(self, api_key: str, model: str = "gpt-4o"):
        self.api_key = api_key
        self.model = model
        from openai import AsyncOpenAI
        self.client = AsyncOpenAI(api_key=api_key)

    async def chat(
        self,
        messages: list[Message],
        system_prompt: Optional[str] = None,
        tools: Optional[dict[str, Any]] = None,
    ) -> LLMResponse:
        """Send chat request to OpenAI."""
        from openai import NOT_GIVEN

        openai_messages = []
        if system_prompt:
            openai_messages.append({"role": "system", "content": system_prompt})

        for msg in messages:
            if msg.role == "system" and not system_prompt:
                openai_messages.append({"role": "system", "content": msg.content})
            elif msg.role in ("user", "assistant"):
                openai_messages.append({"role": msg.role, "content": msg.content})

        if tools:
            openai_tools = [
                {
                    "type": "function",
                    "function": {
                        "name": name,
                        "description": self._get_tool_description(name),
                        "parameters": self._get_tool_schema(name),
                    }
                }
                for name in tools.keys()
            ]
        else:
            openai_tools = NOT_GIVEN

        response = await self.client.chat.completions.create(
            model=self.model,
            messages=openai_messages,
            max_tokens=4096,
            tools=openai_tools,
        )

        choice = response.choices[0]
        message = choice.message

        content = message.content
        tool_calls = []

        if message.tool_calls:
            for tc in message.tool_calls:
                tool_calls.append(ToolCall(
                    name=tc.function.name,
                    arguments=json.loads(tc.function.arguments),
                ))

        usage = {
            "prompt_tokens": response.usage.prompt_tokens,
            "completion_tokens": response.usage.completion_tokens,
            "total_tokens": response.usage.total_tokens,
        } if response.usage else None

        return LLMResponse(
            content=content,
            tool_calls=tool_calls,
            usage=usage,
        )

    def _get_tool_description(self, tool_name: str) -> str:
        """Get description for a tool."""
        descriptions = {
            "bash": "Execute a shell command in the workspace directory",
            "read": "Read the contents of a file",
            "write": "Write content to a new file or overwrite an existing file",
            "edit": "Edit a file by replacing old text with new text",
            "glob": "Find files matching a glob pattern",
        }
        return descriptions.get(tool_name, "Execute a tool")

    def _get_tool_schema(self, tool_name: str) -> dict:
        """Get JSON schema for a tool."""
        schemas = {
            "bash": {
                "type": "object",
                "properties": {
                    "command": {"type": "string", "description": "The shell command to execute"}
                },
                "required": ["command"],
            },
            "read": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Path to the file to read"}
                },
                "required": ["path"],
            },
            "write": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Path to the file to write"},
                    "content": {"type": "string", "description": "Content to write to the file"}
                },
                "required": ["path", "content"],
            },
            "edit": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Path to the file to edit"},
                    "old_text": {"type": "string", "description": "Text to find and replace"},
                    "new_text": {"type": "string", "description": "Text to replace with"}
                },
                "required": ["path", "old_text", "new_text"],
            },
            "glob": {
                "type": "object",
                "properties": {
                    "pattern": {"type": "string", "description": "Glob pattern to match files"}
                },
                "required": ["pattern"],
            },
        }
        return schemas.get(tool_name, {
            "type": "object",
            "properties": {},
            "required": [],
        })
