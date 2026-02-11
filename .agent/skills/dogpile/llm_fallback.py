#!/usr/bin/env python3
"""LLM Fallback Chain for Dogpile.

Provides sequential fallback across multiple LLM providers:
1. Codex (gpt-5.2-codex) - High reasoning, requires auth
2. OpenAI API (gpt-4o) - Standard API fallback
3. Claude headless (claude -p) - OAuth-based CLI fallback

Each provider is tried in sequence until one succeeds.
"""
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

# Add parent directory to path for package imports
_SCRIPT_DIR = Path(__file__).resolve().parent
if str(_SCRIPT_DIR.parent) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR.parent))

from dogpile.utils import log_status
from dogpile.error_tracking import log_rate_limit

# Skills directory for finding CLI tools
SKILLS_DIR = Path(__file__).resolve().parent.parent


class LLMProvider:
    """Base class for LLM providers."""

    name: str = "base"

    def is_available(self) -> bool:
        """Check if this provider is available."""
        raise NotImplementedError

    def call(self, prompt: str, schema: Optional[Path] = None) -> Tuple[bool, str]:
        """Call the LLM with a prompt.

        Args:
            prompt: The prompt to send
            schema: Optional JSON schema for structured output

        Returns:
            Tuple of (success, response_or_error)
        """
        raise NotImplementedError


class CodexProvider(LLMProvider):
    """OpenAI Codex CLI provider (gpt-5.2-codex)."""

    name = "codex"

    def __init__(self):
        self.script = SKILLS_DIR / "codex" / "run.sh"

    def is_available(self) -> bool:
        """Check if Codex CLI is available."""
        if not self.script.exists():
            return False
        # Also check if codex binary exists
        return shutil.which("codex") is not None

    def call(self, prompt: str, schema: Optional[Path] = None) -> Tuple[bool, str]:
        """Call Codex for high-reasoning analysis."""
        log_status(f"Trying {self.name}...", provider=self.name, status="RUNNING")

        if schema:
            cmd = ["bash", str(self.script), "extract", prompt, "--schema", str(schema)]
        else:
            cmd = ["bash", str(self.script), "reason", prompt]

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=120,
                cwd=str(self.script.parent),
            )

            output = result.stdout + result.stderr

            # Check for auth failures
            if "401" in output or "Unauthorized" in output or "authentication" in output.lower():
                log_status(f"{self.name} auth failed", provider=self.name, status="AUTH_FAILED")
                return False, f"Auth failed: {output[:200]}"

            # Check for rate limits
            if "rate limit" in output.lower() or "429" in output:
                log_rate_limit(self.name, retry_after=60)
                log_status(f"{self.name} rate limited", provider=self.name, status="RATE_LIMITED")
                return False, "Rate limited"

            if result.returncode == 0 and result.stdout.strip():
                log_status(f"{self.name} succeeded", provider=self.name, status="DONE")
                return True, result.stdout

            return False, output or "Empty response"

        except subprocess.TimeoutExpired:
            log_status(f"{self.name} timed out", provider=self.name, status="TIMEOUT")
            return False, "Timeout"
        except Exception as e:
            log_status(f"{self.name} error: {e}", provider=self.name, status="ERROR")
            return False, str(e)


class OpenAIProvider(LLMProvider):
    """Direct OpenAI API provider (gpt-4o or gpt-5)."""

    name = "openai"

    def __init__(self, model: str = "gpt-4o"):
        self.model = model
        self.api_key = os.environ.get("OPENAI_API_KEY")

    def is_available(self) -> bool:
        """Check if OpenAI API key is available."""
        return bool(self.api_key)

    def call(self, prompt: str, schema: Optional[Path] = None) -> Tuple[bool, str]:
        """Call OpenAI API directly."""
        log_status(f"Trying {self.name} ({self.model})...", provider=self.name, status="RUNNING")

        try:
            import httpx
        except ImportError:
            # Fallback to requests if httpx not available
            try:
                import requests as httpx
            except ImportError:
                return False, "No HTTP client available (install httpx or requests)"

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        messages = [{"role": "user", "content": prompt}]

        payload: Dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "max_tokens": 4096,
        }

        # Add JSON schema if provided
        if schema and schema.exists():
            try:
                schema_data = json.loads(schema.read_text())
                payload["response_format"] = {
                    "type": "json_schema",
                    "json_schema": {"name": "response", "schema": schema_data}
                }
            except Exception:
                pass  # Skip schema if invalid

        try:
            if hasattr(httpx, 'Client'):
                # httpx
                with httpx.Client(timeout=120) as client:
                    response = client.post(
                        "https://api.openai.com/v1/chat/completions",
                        headers=headers,
                        json=payload,
                    )
            else:
                # requests
                response = httpx.post(
                    "https://api.openai.com/v1/chat/completions",
                    headers=headers,
                    json=payload,
                    timeout=120,
                )

            if response.status_code == 401:
                log_status(f"{self.name} auth failed", provider=self.name, status="AUTH_FAILED")
                return False, "Auth failed"

            if response.status_code == 429:
                log_rate_limit(self.name, retry_after=60)
                log_status(f"{self.name} rate limited", provider=self.name, status="RATE_LIMITED")
                return False, "Rate limited"

            if response.status_code == 200:
                data = response.json()
                content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
                if content:
                    log_status(f"{self.name} succeeded", provider=self.name, status="DONE")
                    return True, content
                return False, "Empty response"

            return False, f"HTTP {response.status_code}: {response.text[:200]}"

        except Exception as e:
            log_status(f"{self.name} error: {e}", provider=self.name, status="ERROR")
            return False, str(e)


class ClaudeProvider(LLMProvider):
    """Claude CLI provider (headless with OAuth)."""

    name = "claude"

    def __init__(self, model: str = "sonnet"):
        self.model = model

    def is_available(self) -> bool:
        """Check if Claude CLI is available."""
        return shutil.which("claude") is not None

    def call(self, prompt: str, schema: Optional[Path] = None) -> Tuple[bool, str]:
        """Call Claude CLI in headless mode."""
        log_status(f"Trying {self.name} ({self.model})...", provider=self.name, status="RUNNING")

        cmd = ["claude", "--model", self.model, "-p", prompt]

        # Add JSON output format if schema provided
        if schema:
            cmd.extend(["--output-format", "json"])

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=180,  # Claude can be slower
            )

            output = result.stdout + result.stderr

            # Check for auth failures
            if "unauthorized" in output.lower() or "authentication" in output.lower():
                log_status(f"{self.name} auth failed", provider=self.name, status="AUTH_FAILED")
                return False, f"Auth failed: {output[:200]}"

            # Check for rate limits
            if "rate limit" in output.lower():
                log_rate_limit(self.name, retry_after=60)
                log_status(f"{self.name} rate limited", provider=self.name, status="RATE_LIMITED")
                return False, "Rate limited"

            if result.returncode == 0 and result.stdout.strip():
                log_status(f"{self.name} succeeded", provider=self.name, status="DONE")
                # If JSON output format was used, extract the 'result' field from the wrapper
                if schema:
                    try:
                        data = json.loads(result.stdout)
                        if isinstance(data, dict) and "result" in data:
                            return True, data["result"]
                    except json.JSONDecodeError:
                        pass  # Fall through to return raw output
                return True, result.stdout

            return False, output or "Empty response"

        except subprocess.TimeoutExpired:
            log_status(f"{self.name} timed out", provider=self.name, status="TIMEOUT")
            return False, "Timeout"
        except FileNotFoundError:
            log_status(f"{self.name} CLI not found", provider=self.name, status="NOT_FOUND")
            return False, "CLI not found"
        except Exception as e:
            log_status(f"{self.name} error: {e}", provider=self.name, status="ERROR")
            return False, str(e)


class PiProvider(LLMProvider):
    """Pi CLI provider (headless with OAuth)."""

    name = "pi"

    def __init__(self, model: str = "sonnet"):
        self.model = model

    def is_available(self) -> bool:
        """Check if Pi CLI is available."""
        return shutil.which("pi") is not None

    def call(self, prompt: str, schema: Optional[Path] = None) -> Tuple[bool, str]:
        """Call Pi CLI in headless mode."""
        log_status(f"Trying {self.name}...", provider=self.name, status="RUNNING")

        cmd = ["pi", "--no-session", "-p", prompt]

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=180,
            )

            if result.returncode == 0 and result.stdout.strip():
                log_status(f"{self.name} succeeded", provider=self.name, status="DONE")
                return True, result.stdout

            return False, result.stderr or "Empty response"

        except subprocess.TimeoutExpired:
            log_status(f"{self.name} timed out", provider=self.name, status="TIMEOUT")
            return False, "Timeout"
        except FileNotFoundError:
            log_status(f"{self.name} CLI not found", provider=self.name, status="NOT_FOUND")
            return False, "CLI not found"
        except Exception as e:
            log_status(f"{self.name} error: {e}", provider=self.name, status="ERROR")
            return False, str(e)


class GeminiProvider(LLMProvider):
    """Google Gemini API provider."""

    name = "gemini"

    def __init__(self, model: str = "gemini-2.0-flash"):
        self.model = model
        self.api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")

    def is_available(self) -> bool:
        """Check if Gemini API key is available."""
        return bool(self.api_key)

    def call(self, prompt: str, schema: Optional[Path] = None) -> Tuple[bool, str]:
        """Call Gemini API."""
        log_status(f"Trying {self.name} ({self.model})...", provider=self.name, status="RUNNING")

        try:
            import httpx
        except ImportError:
            try:
                import requests as httpx
            except ImportError:
                return False, "No HTTP client available"

        # Gemini API endpoint
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent"

        headers = {
            "Content-Type": "application/json",
        }

        payload = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {
                "maxOutputTokens": 4096,
            }
        }

        # Add JSON schema if provided
        if schema and schema.exists():
            try:
                schema_data = json.loads(schema.read_text())
                payload["generationConfig"]["responseMimeType"] = "application/json"
                payload["generationConfig"]["responseSchema"] = schema_data
            except Exception:
                pass

        try:
            if hasattr(httpx, 'Client'):
                with httpx.Client(timeout=120) as client:
                    response = client.post(
                        f"{url}?key={self.api_key}",
                        headers=headers,
                        json=payload,
                    )
            else:
                response = httpx.post(
                    f"{url}?key={self.api_key}",
                    headers=headers,
                    json=payload,
                    timeout=120,
                )

            if response.status_code == 401 or response.status_code == 403:
                log_status(f"{self.name} auth failed", provider=self.name, status="AUTH_FAILED")
                return False, "Auth failed"

            if response.status_code == 429:
                log_rate_limit(self.name, retry_after=60)
                log_status(f"{self.name} rate limited", provider=self.name, status="RATE_LIMITED")
                return False, "Rate limited"

            if response.status_code == 200:
                data = response.json()
                # Extract text from Gemini response structure
                candidates = data.get("candidates", [])
                if candidates:
                    content = candidates[0].get("content", {})
                    parts = content.get("parts", [])
                    if parts:
                        text = parts[0].get("text", "")
                        if text:
                            log_status(f"{self.name} succeeded", provider=self.name, status="DONE")
                            return True, text
                return False, "Empty response"

            return False, f"HTTP {response.status_code}: {response.text[:200]}"

        except Exception as e:
            log_status(f"{self.name} error: {e}", provider=self.name, status="ERROR")
            return False, str(e)


class AnthropicProvider(LLMProvider):
    """Direct Anthropic API provider (claude-3.5-sonnet)."""

    name = "anthropic"

    def __init__(self, model: str = "claude-sonnet-4-20250514"):
        self.model = model
        self.api_key = os.environ.get("ANTHROPIC_API_KEY")

    def is_available(self) -> bool:
        """Check if Anthropic API key is available."""
        return bool(self.api_key)

    def call(self, prompt: str, schema: Optional[Path] = None) -> Tuple[bool, str]:
        """Call Anthropic API directly."""
        log_status(f"Trying {self.name} ({self.model})...", provider=self.name, status="RUNNING")

        try:
            import httpx
        except ImportError:
            try:
                import requests as httpx
            except ImportError:
                return False, "No HTTP client available"

        headers = {
            "x-api-key": self.api_key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        }

        payload: Dict[str, Any] = {
            "model": self.model,
            "max_tokens": 4096,
            "messages": [{"role": "user", "content": prompt}],
        }

        try:
            if hasattr(httpx, 'Client'):
                with httpx.Client(timeout=120) as client:
                    response = client.post(
                        "https://api.anthropic.com/v1/messages",
                        headers=headers,
                        json=payload,
                    )
            else:
                response = httpx.post(
                    "https://api.anthropic.com/v1/messages",
                    headers=headers,
                    json=payload,
                    timeout=120,
                )

            if response.status_code == 401:
                log_status(f"{self.name} auth failed", provider=self.name, status="AUTH_FAILED")
                return False, "Auth failed"

            if response.status_code == 429:
                log_rate_limit(self.name, retry_after=60)
                log_status(f"{self.name} rate limited", provider=self.name, status="RATE_LIMITED")
                return False, "Rate limited"

            if response.status_code == 200:
                data = response.json()
                content = data.get("content", [])
                if content and content[0].get("type") == "text":
                    text = content[0].get("text", "")
                    if text:
                        log_status(f"{self.name} succeeded", provider=self.name, status="DONE")
                        return True, text
                return False, "Empty response"

            return False, f"HTTP {response.status_code}: {response.text[:200]}"

        except Exception as e:
            log_status(f"{self.name} error: {e}", provider=self.name, status="ERROR")
            return False, str(e)


# Rate limit tracking (persistent across calls within same process)
_RATE_LIMITED_PROVIDERS: Dict[str, float] = {}  # provider -> backoff_until timestamp


def is_rate_limited(provider_name: str) -> bool:
    """Check if a provider is currently rate limited."""
    if provider_name not in _RATE_LIMITED_PROVIDERS:
        return False
    backoff_until = _RATE_LIMITED_PROVIDERS[provider_name]
    if time.time() > backoff_until:
        del _RATE_LIMITED_PROVIDERS[provider_name]
        return False
    return True


def mark_rate_limited(provider_name: str, seconds: float = 60):
    """Mark a provider as rate limited."""
    _RATE_LIMITED_PROVIDERS[provider_name] = time.time() + seconds


# Default fallback chain - ordered by preference
# Fast/cheap providers first, expensive/slow providers last
DEFAULT_PROVIDERS: List[LLMProvider] = [
    CodexProvider(),                        # 1. Codex (gpt-5.2) - high reasoning
    OpenAIProvider(model="gpt-4o"),         # 2. OpenAI API (gpt-4o) - fast, reliable
    GeminiProvider(model="gemini-2.0-flash"),  # 3. Gemini Flash - fast, cheap
    AnthropicProvider(),                    # 4. Anthropic API - reliable
    ClaudeProvider(model="sonnet"),         # 5. Claude CLI (OAuth) - headless
    ClaudeProvider(model="haiku"),          # 6. Claude Haiku - faster/cheaper
    PiProvider(),                           # 7. Pi CLI - fallback
]

# High-reasoning chain (for synthesis tasks)
HIGH_REASONING_PROVIDERS: List[LLMProvider] = [
    CodexProvider(),                        # Codex with high reasoning
    OpenAIProvider(model="gpt-4o"),         # GPT-4o
    AnthropicProvider(model="claude-sonnet-4-20250514"),  # Claude Sonnet
    GeminiProvider(model="gemini-2.0-pro"), # Gemini Pro
    ClaudeProvider(model="opus"),           # Claude Opus (most capable)
]

# Fast chain (for simple tasks like query tailoring)
FAST_PROVIDERS: List[LLMProvider] = [
    GeminiProvider(model="gemini-2.0-flash"),  # Fastest
    OpenAIProvider(model="gpt-4o-mini"),       # Fast OpenAI
    ClaudeProvider(model="haiku"),             # Fast Claude
    AnthropicProvider(model="claude-3-haiku-20240307"),  # Fast Anthropic
]


def call_with_fallback(
    prompt: str,
    schema: Optional[Path] = None,
    providers: Optional[List[LLMProvider]] = None,
    skip_rate_limited: bool = True,
) -> Tuple[str, str]:
    """Call LLM with sequential fallback through providers.

    Args:
        prompt: The prompt to send
        schema: Optional JSON schema for structured output
        providers: List of providers to try (uses DEFAULT_PROVIDERS if None)
        skip_rate_limited: Skip providers that are currently rate limited

    Returns:
        Tuple of (provider_name, response)
        If all fail, returns ("none", error_summary)
    """
    if providers is None:
        providers = DEFAULT_PROVIDERS

    errors = []
    skipped_rate_limited = []

    for provider in providers:
        # Check if rate limited
        if skip_rate_limited and is_rate_limited(provider.name):
            skipped_rate_limited.append(provider.name)
            log_status(f"Skipping {provider.name} (rate limited)", provider=provider.name, status="SKIP_RATELIMIT")
            continue

        if not provider.is_available():
            log_status(f"Skipping {provider.name} (not available)", provider=provider.name, status="SKIP")
            continue

        success, result = provider.call(prompt, schema)

        if success:
            return provider.name, result

        # Track rate limits
        if "rate limit" in result.lower() or "429" in result:
            mark_rate_limited(provider.name, seconds=120)  # 2 min backoff

        errors.append(f"{provider.name}: {result[:100]}")

    # All providers failed
    error_lines = [f"  - {e}" for e in errors]
    if skipped_rate_limited:
        error_lines.append(f"  - Skipped (rate limited): {', '.join(skipped_rate_limited)}")

    error_summary = "All LLM providers failed:\n" + "\n".join(error_lines)
    log_status("All providers failed", status="ALL_FAILED")
    return "none", error_summary


def call_fast(prompt: str, schema: Optional[Path] = None) -> Tuple[str, str]:
    """Call LLM using fast provider chain (for simple tasks)."""
    return call_with_fallback(prompt, schema, providers=FAST_PROVIDERS)


def call_high_reasoning(prompt: str, schema: Optional[Path] = None) -> Tuple[str, str]:
    """Call LLM using high-reasoning provider chain (for synthesis)."""
    return call_with_fallback(prompt, schema, providers=HIGH_REASONING_PROVIDERS)


def get_available_providers() -> List[str]:
    """Get list of available provider names."""
    return [p.name for p in DEFAULT_PROVIDERS if p.is_available()]


# CLI for testing
if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Test LLM fallback chain")
    parser.add_argument("prompt", nargs="?", default="What is 2+2? Reply with just the number.",
                       help="Test prompt")
    parser.add_argument("--list", action="store_true", help="List available providers")

    args = parser.parse_args()

    if args.list:
        print("Available providers:")
        for provider in DEFAULT_PROVIDERS:
            status = "available" if provider.is_available() else "not available"
            print(f"  {provider.name}: {status}")
        sys.exit(0)

    print(f"Testing fallback chain with prompt: {args.prompt[:50]}...")
    print()

    provider_name, result = call_with_fallback(args.prompt)

    print(f"\n{'='*50}")
    print(f"Provider used: {provider_name}")
    print(f"Result:\n{result[:500]}")
