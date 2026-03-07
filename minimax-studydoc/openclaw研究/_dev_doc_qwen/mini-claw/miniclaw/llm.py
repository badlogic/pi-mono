"""LLM provider abstraction layer."""

from abc import ABC, abstractmethod
from typing import Optional, Any
from pydantic import BaseModel


class Message(BaseModel):
    """A chat message."""
    role: str  # "system", "user", "assistant"
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


class BaseLLM(ABC):
    """Abstract base class for LLM providers."""
    
    def __init__(self, api_key: str, model: str):
        self.api_key = api_key
        self.model = model
    
    @abstractmethod
    async def chat(
        self,
        messages: list[Message],
        system_prompt: Optional[str] = None,
        tools: Optional[dict[str, Any]] = None,
    ) -> LLMResponse:
        """Send a chat request to the LLM.
        
        Args:
            messages: Conversation history
            system_prompt: Optional system prompt
            tools: Optional tool definitions
        
        Returns:
            LLMResponse with content and/or tool calls
        """
        pass


class AnthropicLLM(BaseLLM):
    """Anthropic Claude API implementation."""
    
    def __init__(self, api_key: str, model: str = "claude-sonnet-4-5-20250929"):
        super().__init__(api_key, model)
        from anthropic import AsyncAnthropic
        self.client = AsyncAnthropic(api_key=api_key)
    
    async def chat(
        self,
        messages: list[Message],
        system_prompt: Optional[str] = None,
        tools: Optional[dict[str, Any]] = None,
    ) -> LLMResponse:
        """Send chat request to Anthropic."""
        from anthropic import NOT_GIVEN
        
        # Convert messages to Anthropic format
        anthropic_messages = []
        for msg in messages:
            if msg.role == "system":
                if not system_prompt:
                    system_prompt = msg.content
            elif msg.role == "user":
                anthropic_messages.append({"role": "user", "content": msg.content})
            elif msg.role == "assistant":
                anthropic_messages.append({"role": "assistant", "content": msg.content})
        
        # Build tool definitions for Anthropic
        if tools:
            anthropic_tools = [
                {
                    "name": name,
                    "description": self._get_tool_description(name),
                    "input_schema": self._get_tool_schema(name),
                }
                for name in tools.keys()
            ]
        else:
            anthropic_tools = NOT_GIVEN
        
        response = await self.client.messages.create(
            model=self.model,
            max_tokens=4096,
            system=system_prompt or NOT_GIVEN,
            messages=anthropic_messages,
            tools=anthropic_tools,
        )
        
        # Parse response
        content = None
        tool_calls = []
        
        for block in response.content:
            if block.type == "text":
                content = block.text
            elif block.type == "tool_use":
                tool_calls.append(ToolCall(
                    name=block.name,
                    arguments=block.input,
                ))
        
        usage = {
            "input_tokens": response.usage.input_tokens,
            "output_tokens": response.usage.output_tokens,
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


class OpenAILLM(BaseLLM):
    """OpenAI API implementation."""
    
    def __init__(self, api_key: str, model: str = "gpt-4o"):
        super().__init__(api_key, model)
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
        
        # Convert messages to OpenAI format
        openai_messages = []
        if system_prompt:
            openai_messages.append({"role": "system", "content": system_prompt})
        
        for msg in messages:
            if msg.role == "system" and not system_prompt:
                openai_messages.append({"role": "system", "content": msg.content})
            elif msg.role in ("user", "assistant"):
                openai_messages.append({"role": msg.role, "content": msg.content})
        
        # Build tool definitions for OpenAI
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
                import json
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


def create_llm(provider: str, api_key: str, model: Optional[str] = None) -> BaseLLM:
    """Factory function to create an LLM instance.
    
    Args:
        provider: Provider name ("anthropic" or "openai")
        api_key: API key for the provider
        model: Optional model name (uses default if not provided)
    
    Returns:
        BaseLLM instance
    
    Raises:
        ValueError: If provider is not supported
    """
    if provider == "anthropic":
        return AnthropicLLM(api_key, model or "claude-sonnet-4-5-20250929")
    elif provider == "openai":
        return OpenAILLM(api_key, model or "gpt-4o")
    else:
        raise ValueError(f"Unsupported provider: {provider}. Use 'anthropic' or 'openai'.")
