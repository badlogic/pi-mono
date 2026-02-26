import os
import subprocess
from pathlib import Path
from typing import Literal

from pydantic import BaseModel
from pydantic_ai import Tool


class ReadResult(BaseModel):
    success: bool
    content: str | None = None
    error: str | None = None


class BashResult(BaseModel):
    success: bool
    stdout: str | None = None
    stderr: str | None = None
    error: str | None = None


class GrepResult(BaseModel):
    success: bool
    matches: list[dict] | None = None
    error: str | None = None


class FindResult(BaseModel):
    success: bool
    files: list[str] | None = None
    error: str | None = None


class LsResult(BaseModel):
    success: bool
    entries: list[dict] | None = None
    error: str | None = None


class FileTools:
    def __init__(self, repo_path: str):
        self.repo_path = Path(repo_path).resolve()

    def read(self, path: str, offset: int = 0, limit: int = 5000) -> ReadResult:
        try:
            full_path = (self.repo_path / path).resolve()
            if not full_path.exists():
                return ReadResult(success=False, error=f"File not found: {path}")
            if not full_path.is_file():
                return ReadResult(success=False, error=f"Not a file: {path}")
            
            content = full_path.read_text(encoding="utf-8")
            lines = content.split("\n")
            
            if offset > 0:
                lines = lines[offset:]
            if limit > 0:
                lines = lines[:limit]
            
            return ReadResult(success=True, content="\n".join(lines))
        except Exception as e:
            return ReadResult(success=False, error=str(e))

    def bash(self, command: str) -> BashResult:
        try:
            result = subprocess.run(
                command,
                shell=True,
                cwd=self.repo_path,
                capture_output=True,
                text=True,
                timeout=60,
            )
            return BashResult(
                success=result.returncode == 0,
                stdout=result.stdout,
                stderr=result.stderr,
            )
        except subprocess.TimeoutExpired:
            return BashResult(success=False, error="Command timed out")
        except Exception as e:
            return BashResult(success=False, error=str(e))

    def grep(
        self,
        pattern: str,
        path: str | None = None,
        regex: bool = True,
    ) -> GrepResult:
        try:
            search_path = self.repo_path if path is None else (self.repo_path / path)
            
            cmd = ["grep"]
            if regex:
                cmd.append("-E")
            else:
                cmd.append("-F")
            cmd.extend(["-n", "--", pattern])
            
            if path:
                cmd[-1] = str(search_path)
            else:
                cmd.append(str(search_path))
            
            result = subprocess.run(
                cmd,
                cwd=self.repo_path,
                capture_output=True,
                text=True,
                timeout=30,
            )
            
            matches = []
            for line in result.stdout.strip().split("\n"):
                if not line:
                    continue
                parts = line.split(":", 2)
                if len(parts) >= 2:
                    matches.append({
                        "file": parts[0],
                        "line": parts[1],
                        "content": parts[2] if len(parts) > 2 else "",
                    })
            
            return GrepResult(success=True, matches=matches)
        except Exception as e:
            return GrepResult(success=False, error=str(e))

    def find(self, pattern: str, type: Literal["f", "d"] = "f") -> FindResult:
        try:
            cmd = ["find", ".", "-type", type, "-name", pattern]
            result = subprocess.run(
                cmd,
                cwd=self.repo_path,
                capture_output=True,
                text=True,
                timeout=30,
            )
            
            files = [
                f.lstrip("./")
                for f in result.stdout.strip().split("\n")
                if f.strip()
            ]
            return FindResult(success=True, files=files)
        except Exception as e:
            return FindResult(success=False, error=str(e))

    def ls(self, path: str = ".") -> LsResult:
        try:
            full_path = (self.repo_path / path).resolve()
            if not full_path.exists():
                return LsResult(success=False, error=f"Path not found: {path}")
            
            entries = []
            for entry in sorted(full_path.iterdir()):
                stat = entry.stat()
                entries.append({
                    "name": entry.name,
                    "type": "dir" if entry.is_dir() else "file",
                    "size": stat.st_size,
                })
            
            return LsResult(success=True, entries=entries)
        except Exception as e:
            return LsResult(success=False, error=str(e))

    def get_tools(self):
        return [
            Tool(self.read, name="read", description="Read file contents from the repository"),
            Tool(self.bash, name="bash", description="Execute shell commands in the repository"),
            Tool(self.grep, name="grep", description="Search for patterns in files"),
            Tool(self.find, name="find", description="Find files by glob pattern"),
            Tool(self.ls, name="ls", description="List directory contents"),
        ]
