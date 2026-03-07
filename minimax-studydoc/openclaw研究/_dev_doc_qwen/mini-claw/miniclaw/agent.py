"""Mini-Claw AI Agent - Core agent loop implementation."""

import asyncio
from pathlib import Path
from typing import Optional, Any

from .llm import BaseLLM, Message, ToolCall, LLMResponse, create_llm
from .tools import TOOLS, ToolResult, get_tool_descriptions


class Agent:
    """Mini-Claw AI Agent.
    
    This is a simplified agent implementation inspired by pi-mono's agent-core.
    It provides a basic agent loop with tool execution capabilities.
    """
    
    def __init__(
        self,
        llm: BaseLLM,
        workspace: Optional[str] = None,
        system_prompt: Optional[str] = None,
        max_turns: int = 10,
    ):
        """Initialize the agent.
        
        Args:
            llm: LLM instance to use
            workspace: Workspace directory for file operations
            system_prompt: Optional custom system prompt
            max_turns: Maximum conversation turns per run
        """
        self.llm = llm
        self.workspace = Path(workspace).resolve() if workspace else Path.cwd()
        self.max_turns = max_turns
        
        # Default system prompt
        self.system_prompt = system_prompt or self._build_system_prompt()
        
        # Conversation history
        self.history: list[Message] = []
        
        # Current turn counter
        self._turn_count = 0
    
    def _build_system_prompt(self) -> str:
        """Build the default system prompt."""
        return f"""You are Mini-Claw, a helpful AI coding assistant.
You work in the directory: {self.workspace}

{get_tool_descriptions()}

Guidelines:
- Always read files before editing them
- Test your changes by running commands
- Keep changes focused and minimal
- Explain what you're doing before doing it
- Use tools one at a time, waiting for results before proceeding

When you've completed the task, provide a summary of what was done."""
    
    async def run(self, user_message: str) -> AgentResult:
        """Run the agent with a user message.
        
        Args:
            user_message: The user's request
        
        Returns:
            AgentResult with final response and tool execution history
        """
        self._turn_count = 0
        tool_executions: list[ToolExecution] = []
        
        # Add user message to history
        self.history.append(Message(role="user", content=user_message))
        
        while self._turn_count < self.max_turns:
            self._turn_count += 1
            
            # Get LLM response
            response = await self.llm.chat(
                messages=self.history,
                system_prompt=self.system_prompt,
                tools=TOOLS,
            )
            
            # Process response
            if response.tool_calls:
                # Execute tools
                for tool_call in response.tool_calls:
                    execution = await self._execute_tool(tool_call)
                    tool_executions.append(execution)
                    
                    # Add tool result to history
                    self.history.append(Message(
                        role="user",
                        content=f"Tool '{tool_call.name}' result: {execution.result}",
                    ))
            elif response.content:
                # Assistant provided a text response
                self.history.append(Message(role="assistant", content=response.content))
                
                # Check if this looks like a final response
                if self._is_final_response(response.content):
                    return AgentResult(
                        response=response.content,
                        tool_executions=tool_executions,
                        usage=response.usage,
                        turns=self._turn_count,
                    )
            else:
                # Empty response, break the loop
                break
        
        # Return final response
        final_content = self.history[-1].content if self.history else "No response"
        return AgentResult(
            response=final_content,
            tool_executions=tool_executions,
            usage=None,
            turns=self._turn_count,
        )
    
    async def _execute_tool(self, tool_call: ToolCall) -> ToolExecution:
        """Execute a tool call.
        
        Args:
            tool_call: The tool call to execute
        
        Returns:
            ToolExecution with result
        """
        tool_name = tool_call.name
        tool_args = tool_call.arguments
        
        if tool_name not in TOOLS:
            return ToolExecution(
                name=tool_name,
                arguments=tool_args,
                result=ToolResult(success=False, output="", error=f"Unknown tool: {tool_name}"),
            )
        
        tool_func = TOOLS[tool_name]
        
        try:
            # Execute the tool
            if asyncio.iscoroutinefunction(tool_func):
                result = await tool_func(**tool_args, cwd=str(self.workspace))
            else:
                # Run sync function in executor to avoid blocking
                loop = asyncio.get_event_loop()
                result = await loop.run_in_executor(
                    None,
                    lambda: tool_func(**tool_args, cwd=str(self.workspace)),
                )
        except Exception as e:
            result = ToolResult(success=False, output="", error=str(e))
        
        return ToolExecution(
            name=tool_name,
            arguments=tool_args,
            result=result,
        )
    
    def _is_final_response(self, content: str) -> bool:
        """Check if the response looks final (not requesting more tool calls).
        
        This is a simple heuristic. A more sophisticated implementation
        would analyze the content more carefully.
        """
        # If it contains tool call patterns, it's not final
        if "I'll use" in content or "Let me " in content or "I need to" in content:
            return False
        
        # If it's a reasonable length and doesn't look like it's asking for more
        if len(content) > 50 and "?" not in content:
            return True
        
        return False
    
    def reset(self) -> None:
        """Reset the agent's conversation history."""
        self.history = []
        self._turn_count = 0


class ToolExecution:
    """Record of a tool execution."""
    
    def __init__(self, name: str, arguments: dict[str, Any], result: ToolResult):
        self.name = name
        self.arguments = arguments
        self.result = result
    
    def __str__(self) -> str:
        args_str = ", ".join(f"{k}={v!r}" for k, v in self.arguments.items())
        return f"{self.name}({args_str}) -> {self.result}"


class AgentResult:
    """Result from an agent run."""
    
    def __init__(
        self,
        response: str,
        tool_executions: list[ToolExecution],
        usage: Optional[dict[str, int]],
        turns: int,
    ):
        self.response = response
        self.tool_executions = tool_executions
        self.usage = usage
        self.turns = turns
    
    def __str__(self) -> str:
        return f"AgentResult(turns={self.turns}, tools={len(self.tool_executions)})"


async def run_agent(
    message: str,
    provider: str = "anthropic",
    api_key: Optional[str] = None,
    model: Optional[str] = None,
    workspace: Optional[str] = None,
    system_prompt: Optional[str] = None,
) -> AgentResult:
    """Convenience function to run the agent with minimal setup.
    
    Args:
        message: User message
        provider: LLM provider ("anthropic" or "openai")
        api_key: API key (or use environment variable)
        model: Model name (uses default if not provided)
        workspace: Workspace directory
        system_prompt: Optional custom system prompt
    
    Returns:
        AgentResult from the agent run
    """
    import os
    
    # Get API key from parameter or environment
    if not api_key:
        if provider == "anthropic":
            api_key = os.environ.get("ANTHROPIC_API_KEY")
        elif provider == "openai":
            api_key = os.environ.get("OPENAI_API_KEY")
    
    if not api_key:
        raise ValueError(f"API key required for {provider}. Set via parameter or environment variable.")
    
    # Create LLM and agent
    llm = create_llm(provider, api_key, model)
    agent = Agent(llm=llm, workspace=workspace, system_prompt=system_prompt)
    
    # Run the agent
    return await agent.run(message)
