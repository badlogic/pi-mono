"""Command-line interface for Mini-Claw."""

import asyncio
import sys
from pathlib import Path
from typing import Optional

from prompt_toolkit import PromptSession
from prompt_toolkit.history import FileHistory
from prompt_toolkit.auto_suggest import AutoSuggestFromHistory
from rich.console import Console
from rich.markdown import Markdown
from rich.panel import Panel
from rich.spinner import Spinner
from rich.live import Live

from .config import Config, ConfigManager
from .llm import OpenAILLM
from .agent import Agent, AgentResult
from .tools import ToolExecution


console = Console()


def print_welcome() -> None:
    """Print welcome message."""
    console.print(Panel.fit(
        "[bold blue]Mini-Claw[/bold blue] - Minimal AI Coding Assistant (OpenAI)\n"
        f"[dim]Version 0.1.0 | Type /help for commands[/dim]",
        border_style="blue",
    ))
    console.print()


def print_tool_execution(execution: ToolExecution) -> None:
    """Print a tool execution result."""
    args_str = ", ".join(f"{k}={v!r}" for k, v in execution.arguments.items())

    if execution.result.success:
        console.print(f"[dim]→ {execution.name}({args_str})[/dim]")
        if execution.result.output and len(execution.result.output) < 500:
            for line in execution.result.output.split("\n"):
                console.print(f"  [dim]{line}[/dim]")
    else:
        console.print(f"[red]✗ {execution.name}({args_str})[/red]")
        if execution.result.error:
            console.print(f"  [red]Error: {execution.result.error}[/red]")


def print_result(result: AgentResult) -> None:
    """Print agent result."""
    if result.tool_executions:
        console.print(f"\n[dim]Executed {len(result.tool_executions)} tool(s):[/dim]")
        for execution in result.tool_executions:
            print_tool_execution(execution)

    console.print()
    console.print(Markdown(result.response))

    if result.usage:
        console.print()
        console.print(f"[dim]Tokens: {result.usage.get('prompt_tokens', 0)} prompt, {result.usage.get('completion_tokens', 0)} completion[/dim]")


async def run_agent_loop(config: Config, message: str, workspace: Optional[str] = None) -> AgentResult:
    """Run the agent with a message."""
    workspace = workspace or config.workspace or str(Path.cwd())

    llm = OpenAILLM(config.api_key, config.model)
    agent = Agent(llm=llm, workspace=workspace)

    with Live(Spinner("dots", text="Thinking...", style="blue"), console=console, transient=True):
        result = await agent.run(message)

    return result


async def interactive_mode(config: Config) -> None:
    """Run interactive REPL mode."""
    print_welcome()

    history_path = Path.home() / ".mini-claw" / "history"
    history_path.parent.mkdir(parents=True, exist_ok=True)

    session = PromptSession(
        history=FileHistory(str(history_path)),
        auto_suggest=AutoSuggestFromHistory(),
    )

    workspace = config.workspace or str(Path.cwd())
    llm = OpenAILLM(config.api_key, config.model)
    agent = Agent(llm=llm, workspace=workspace)

    while True:
        try:
            user_input = await session.prompt_async("❯ ")
            user_input = user_input.strip()

            if not user_input:
                continue

            if user_input.startswith("/"):
                command = user_input[1:].lower()

                if command in ("quit", "exit", "q"):
                    console.print("[yellow]Goodbye![/yellow]")
                    break
                elif command == "help":
                    print_help()
                elif command == "clear":
                    agent.reset()
                    console.print("[green]Conversation cleared[/green]")
                elif command == "status":
                    print_status(config, workspace, agent)
                else:
                    console.print(f"[red]Unknown command: /{command}[/red]")
                    console.print("Type [cyan]/help[/cyan] for available commands")
                continue

            with Live(Spinner("dots", text="Thinking...", style="blue"), console=console, transient=True):
                result = await agent.run(user_input)

            print_result(result)

        except KeyboardInterrupt:
            console.print()
            console.print("[yellow]Interrupted. Type /quit to exit.[/yellow]")
        except EOFError:
            console.print("\n[yellow]Goodbye![/yellow]")
            break


def print_help() -> None:
    """Print help message."""
    help_text = """
**Available Commands:**

- `/help` - Show this help message
- `/clear` - Clear conversation history
- `/status` - Show current configuration
- `/quit` or `/exit` or `/q` - Exit the program

**Usage:**

Just type your request and press Enter. The AI will:
1. Analyze your request
2. Use tools to read/edit files or run commands
3. Provide a response with the results

**Examples:**

- "List all Python files in the current directory"
- "Read the main.py file"
- "Create a new file called test.py with a simple hello world"
- "Run the tests"
"""
    console.print(Markdown(help_text))


def print_status(config: Config, workspace: str, agent: Agent) -> None:
    """Print current status."""
    console.print(Panel(
        f"[bold]Model:[/bold] {config.model}\n"
        f"[bold]Workspace:[/bold] {workspace}\n"
        f"[bold]Conversation turns:[/bold] {agent._turn_count}\n"
        f"[bold]History length:[/bold] {len(agent.history)} messages",
        title="Status",
        border_style="green",
    ))


async def run_command(config: Config, message: str, workspace: Optional[str] = None) -> None:
    """Run a single command."""
    workspace = workspace or config.workspace or str(Path.cwd())

    console.print(f"[bold blue]Mini-Claw[/bold blue] - Processing request...\n")

    result = await run_agent_loop(config, message, workspace)
    print_result(result)


def main() -> int:
    """Main entry point."""
    import argparse

    parser = argparse.ArgumentParser(
        description="Mini-Claw - Minimal AI Coding Assistant (OpenAI)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "message",
        nargs="?",
        help="Message to send to the AI (omit for interactive mode)",
    )
    parser.add_argument(
        "-c", "--config",
        help="Path to config file (default: ~/.mini-claw/config.json)",
    )
    parser.add_argument(
        "-w", "--workspace",
        help="Workspace directory (default: current directory)",
    )
    parser.add_argument(
        "-m", "--model",
        help="Model name (default: from config or gpt-4o)",
    )
    parser.add_argument(
        "--init-config",
        action="store_true",
        help="Initialize configuration interactively",
    )

    args = parser.parse_args()

    if args.init_config:
        return init_config_interactive(args.config)

    config_manager = ConfigManager(args.config)
    config = config_manager.load()

    if args.model:
        config.model = args.model

    if not config.api_key:
        console.print("[red]Error:[/red] No API key configured.")
        console.print("Run [cyan]mini-claw --init-config[/cyan] to set up, or set environment variable:")
        console.print("  [dim]OPENAI_API_KEY[/dim]")
        return 1

    if args.message:
        asyncio.run(run_command(config, args.message, args.workspace))
    else:
        asyncio.run(interactive_mode(config))

    return 0


def init_config_interactive(config_path: Optional[str]) -> int:
    """Initialize configuration interactively."""
    from prompt_toolkit import prompt

    console.print(Panel.fit(
        "[bold]Mini-Claw Configuration Setup[/bold]\n",
        border_style="green",
    ))

    config_manager = ConfigManager(config_path)

    if config_manager.exists():
        console.print("[yellow]Configuration already exists at:[/yellow]")
        console.print(f"  [dim]{config_manager.config_path}[/dim]\n")
        response = prompt("Overwrite? [y/N]: ").lower()
        if response not in ("y", "yes"):
            console.print("[dim]Cancelled[/dim]")
            return 0

    env_var = "OPENAI_API_KEY"
    default_model = "gpt-4o"

    console.print(f"Enter your API key (or set {env_var} environment variable):")
    api_key = prompt("API Key: ", is_password=True).strip()

    if not api_key:
        console.print("[red]Error:[/red] API key is required")
        return 1

    console.print(f"\nModel name [default: {default_model}]:")
    model = prompt("").strip() or default_model

    console.print("\nDefault workspace directory [default: current directory]:")
    workspace = prompt("").strip() or None

    config = Config(
        api_key=api_key,
        model=model,
        workspace=workspace,
    )
    config_manager.save(config)

    console.print(f"\n[green]✓ Configuration saved to:[/green]")
    console.print(f"  [dim]{config_manager.config_path}[/dim]\n")
    console.print("You can now run [cyan]mini-claw[/cyan] to start!")

    return 0
