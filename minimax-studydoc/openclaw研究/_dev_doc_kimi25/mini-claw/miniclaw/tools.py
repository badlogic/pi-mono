"""Core tools for Mini-Claw agent."""

import subprocess
from pathlib import Path
from typing import Optional


class ToolResult:
    """Result from a tool execution."""

    def __init__(self, success: bool, output: str, error: Optional[str] = None):
        self.success = success
        self.output = output
        self.error = error

    def __str__(self) -> str:
        if self.success:
            return self.output if self.output else "(no output)"
        return f"Error: {self.error or 'Unknown error'}"


def bash(command: str, cwd: Optional[str] = None) -> ToolResult:
    """Execute a bash/shell command.

    Args:
        command: The command to execute
        cwd: Working directory (defaults to current dir)

    Returns:
        ToolResult with output or error
    """
    try:
        result = subprocess.run(
            command,
            shell=True,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=300,
        )
        output = result.stdout
        if result.stderr:
            output += result.stderr if not output else "\n" + result.stderr
        return ToolResult(
            success=result.returncode == 0,
            output=output.strip() if output else "",
            error=f"Command failed with exit code {result.returncode}" if result.returncode != 0 else None,
        )
    except subprocess.TimeoutExpired:
        return ToolResult(success=False, output="", error="Command timed out (5 minutes)")
    except Exception as e:
        return ToolResult(success=False, output="", error=str(e))


def read_file(path: str, cwd: Optional[str] = None) -> ToolResult:
    """Read a file's contents.

    Args:
        path: Path to the file (relative or absolute)
        cwd: Base directory for relative paths

    Returns:
        ToolResult with file contents or error
    """
    try:
        file_path = Path(cwd) / path if cwd else Path(path)
        file_path = file_path.resolve()

        if cwd:
            cwd_resolved = Path(cwd).resolve()
            if not str(file_path).startswith(str(cwd_resolved)):
                return ToolResult(success=False, output="", error="Access denied: file outside workspace")

        if not file_path.exists():
            return ToolResult(success=False, output="", error=f"File not found: {path}")
        if not file_path.is_file():
            return ToolResult(success=False, output="", error=f"Not a file: {path}")

        content = file_path.read_text(encoding="utf-8")
        return ToolResult(success=True, output=content)
    except Exception as e:
        return ToolResult(success=False, output="", error=str(e))


def write_file(path: str, content: str, cwd: Optional[str] = None) -> ToolResult:
    """Write content to a file.

    Args:
        path: Path to the file (relative or absolute)
        content: Content to write
        cwd: Base directory for relative paths

    Returns:
        ToolResult with status or error
    """
    try:
        file_path = Path(cwd) / path if cwd else Path(path)
        file_path = file_path.resolve()

        if cwd:
            cwd_resolved = Path(cwd).resolve()
            if not str(file_path).startswith(str(cwd_resolved)):
                return ToolResult(success=False, output="", error="Access denied: file outside workspace")

        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_text(content, encoding="utf-8")
        return ToolResult(success=True, output=f"Successfully wrote {len(content)} characters to {path}")
    except Exception as e:
        return ToolResult(success=False, output="", error=str(e))


def edit_file(path: str, old_text: str, new_text: str, cwd: Optional[str] = None) -> ToolResult:
    """Edit a file by replacing old_text with new_text.

    Args:
        path: Path to the file
        old_text: Text to find and replace
        new_text: Text to replace with
        cwd: Base directory for relative paths

    Returns:
        ToolResult with status or error
    """
    try:
        file_path = Path(cwd) / path if cwd else Path(path)
        file_path = file_path.resolve()

        if cwd:
            cwd_resolved = Path(cwd).resolve()
            if not str(file_path).startswith(str(cwd_resolved)):
                return ToolResult(success=False, output="", error="Access denied: file outside workspace")

        if not file_path.exists():
            return ToolResult(success=False, output="", error=f"File not found: {path}")

        content = file_path.read_text(encoding="utf-8")

        if old_text not in content:
            return ToolResult(success=False, output="", error="Text to replace not found in file")

        new_content = content.replace(old_text, new_text, 1)
        file_path.write_text(new_content, encoding="utf-8")

        return ToolResult(success=True, output=f"Successfully replaced text in {path}")
    except Exception as e:
        return ToolResult(success=False, output="", error=str(e))


def glob_files(pattern: str, cwd: Optional[str] = None) -> ToolResult:
    """Find files matching a glob pattern.

    Args:
        pattern: Glob pattern (e.g., "*.py", "**/*.txt")
        cwd: Base directory for search

    Returns:
        ToolResult with matching file paths or error
    """
    try:
        search_dir = Path(cwd) if cwd else Path(".")
        search_dir = search_dir.resolve()

        files = []
        for match in search_dir.glob(pattern):
            if str(match).startswith(str(search_dir)):
                files.append(str(match.relative_to(search_dir)))

        if not files:
            return ToolResult(success=True, output="No files found matching pattern")

        return ToolResult(success=True, output="\n".join(sorted(files)))
    except Exception as e:
        return ToolResult(success=False, output="", error=str(e))


TOOLS = {
    "bash": bash,
    "read": read_file,
    "write": write_file,
    "edit": edit_file,
    "glob": glob_files,
}


def get_tool_descriptions() -> str:
    """Get descriptions of all available tools."""
    return """Available tools:
- bash(command): Execute shell commands
- read(path): Read file contents
- write(path, content): Write content to a file
- edit(path, old_text, new_text): Edit a file by replacing text
- glob(pattern): Find files matching a pattern"""
