"""Example usage of Mini-Claw agent."""

import asyncio
from miniclaw.agent import run_agent


async def main():
    """Run a simple example."""
    # Run a single request
    result = await run_agent(
        message="List all Python files in the current directory",
        provider="anthropic",
        # api_key="sk-ant-...",  # Or set ANTHROPIC_API_KEY env var
        workspace=".",
    )
    
    print(f"Response: {result.response}")
    print(f"Tools used: {len(result.tool_executions)}")
    for execution in result.tool_executions:
        print(f"  - {execution.name}: {execution.result.success}")


if __name__ == "__main__":
    asyncio.run(main())
