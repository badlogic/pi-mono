#!/usr/bin/env python3
"""Common utilities for Dogpile deep search aggregator.

Contains:
- run_command: Execute shell commands safely
- log_status: Status logging with task-monitor integration
- parse_rate_limit_headers: Parse HTTP rate limit headers
- with_semaphore: Decorator for provider-specific concurrency control
- create_retry_decorator: Create tenacity retry decorators
"""
import json
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Dict, Any, List, Optional, Callable, TypeVar

try:
    from typing import ParamSpec
except ImportError:  # Python < 3.10
    from typing_extensions import ParamSpec

# Add parent directory to path for package imports when running as script
_SCRIPT_DIR = Path(__file__).resolve().parent
if str(_SCRIPT_DIR.parent) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR.parent))

from dogpile.config import (
    PROVIDER_SEMAPHORES,
    RATE_LIMIT_STATE,
    TENACITY_AVAILABLE,
)

# Import error tracking (lazy to avoid circular imports)
_error_tracker = None

def _get_error_tracker():
    """Lazy import of error tracker to avoid circular imports."""
    global _error_tracker
    if _error_tracker is None:
        try:
            from dogpile.error_tracking import get_tracker
            _error_tracker = get_tracker()
        except ImportError:
            _error_tracker = False  # Mark as unavailable
    return _error_tracker if _error_tracker else None

from functools import wraps

P = ParamSpec("P")
R = TypeVar("R")

# Import tenacity components if available
if TENACITY_AVAILABLE:
    from tenacity import (
        retry,
        stop_after_attempt,
        stop_after_delay,
        wait_random_exponential,
        retry_if_exception_type,
    )


def run_command(cmd: List[str], cwd: Optional[Path] = None) -> str:
    """Run a command and return stdout.

    Args:
        cmd: Command and arguments as list
        cwd: Working directory for command execution

    Returns:
        Command stdout, or "Error: ..." on failure
    """
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            check=True,
            cwd=cwd
        )
        return result.stdout.strip()
    except subprocess.CalledProcessError as e:
        return f"Error: {e.stderr}"
    except Exception as e:
        return f"Error: {e}"


def log_status(
    msg: str,
    provider: Optional[str] = None,
    status: Optional[str] = None,
    error_type: Optional[str] = None,
    error_details: Optional[Dict[str, Any]] = None,
    http_status: Optional[int] = None,
    retry_after: Optional[float] = None,
):
    """Log status to stderr and update task-monitor state with atomic writes.

    Args:
        msg: Status message to log
        provider: Provider name (github, arxiv, etc.)
        status: Provider status (RUNNING, DONE, ERROR, RATE_LIMITED)
        error_type: Type of error (rate_limit, timeout, auth_failure, etc.)
        error_details: Additional error context for debugging
        http_status: HTTP status code if applicable
        retry_after: Seconds until retry (for rate limits)
    """
    # Emit parseable line for external monitors
    try:
        sys.stderr.write(f"[DOGPILE-STATUS] {msg}\n")
        sys.stderr.flush()
    except Exception:
        pass

    # Log to error tracker if it's an error or rate limit
    tracker = _get_error_tracker()
    if tracker and provider:
        if status == "RATE_LIMITED" or error_type == "rate_limit":
            from dogpile.error_tracking import ErrorType
            tracker.log_rate_limit(
                provider=provider,
                retry_after=retry_after,
                http_status=http_status or 429,
                details=error_details,
            )
        elif status == "ERROR" or error_type:
            from dogpile.error_tracking import ErrorType, ErrorSeverity
            # Map error_type string to enum
            error_type_enum = ErrorType.UNKNOWN
            if error_type:
                try:
                    error_type_enum = ErrorType(error_type)
                except ValueError:
                    error_type_enum = ErrorType.UNKNOWN
            elif "rate limit" in msg.lower():
                error_type_enum = ErrorType.RATE_LIMIT
            elif "timeout" in msg.lower():
                error_type_enum = ErrorType.TIMEOUT
            elif "auth" in msg.lower() or "unauthorized" in msg.lower():
                error_type_enum = ErrorType.AUTH_FAILURE

            tracker.log_error(
                provider=provider,
                error_type=error_type_enum,
                message=msg,
                details=error_details,
                http_status=http_status,
                retry_after=retry_after,
            )
        elif status == "DONE":
            tracker.log_success(provider, msg)

    # Update state for task-monitor atomically
    state_file = Path("dogpile_state.json")
    state: Dict[str, Any] = {}
    if state_file.exists():
        try:
            state = json.loads(state_file.read_text())
        except Exception:
            state = {}

    if provider:
        state.setdefault("providers", {})[provider] = status or "RUNNING"

        # Track errors in state for agent visibility
        if status in ("ERROR", "RATE_LIMITED") or error_type:
            state.setdefault("errors", []).append({
                "provider": provider,
                "status": status,
                "message": msg,
                "error_type": error_type,
                "http_status": http_status,
                "retry_after": retry_after,
                "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
            })
            # Keep only last 20 errors
            state["errors"] = state["errors"][-20:]

    state["last_msg"] = msg
    state["last_updated"] = time.strftime("%Y-%m-%d %H:%M:%S")

    try:
        tmp = state_file.with_suffix(".tmp")
        tmp.write_text(json.dumps(state, indent=2))
        os.replace(tmp, state_file)
    except Exception:
        pass


def parse_rate_limit_headers(headers: Dict[str, str], provider: str) -> Optional[float]:
    """Parse rate limit headers and return wait time if rate limited.

    Supports:
    - Retry-After (RFC 7231) - authoritative wait signal
    - x-ratelimit-remaining / x-ratelimit-reset (GitHub, others)
    - RateLimit-* (IETF draft, forward-compatible)

    Args:
        headers: HTTP response headers
        provider: Provider name for state tracking

    Returns:
        Seconds to wait, or None if not rate limited
    """
    # 1. Check Retry-After first (most authoritative)
    retry_after = headers.get("Retry-After") or headers.get("retry-after")
    if retry_after:
        try:
            # Can be seconds or HTTP-date
            wait_seconds = int(retry_after)
            log_status(
                f"Rate limited by {provider}: waiting {wait_seconds}s (Retry-After)",
                provider=provider,
                status="RATE_LIMITED",
                error_type="rate_limit",
                retry_after=float(wait_seconds),
                http_status=429,
                error_details={"source": "Retry-After header"},
            )
            return wait_seconds
        except ValueError:
            # Try HTTP-date format
            try:
                from email.utils import parsedate_to_datetime
                dt = parsedate_to_datetime(retry_after)
                from datetime import datetime
                now = datetime.now(dt.tzinfo) if getattr(dt, "tzinfo", None) else datetime.utcnow()
                wait_seconds = max(0.0, (dt - now).total_seconds())
                log_status(
                    f"Rate limited by {provider}: waiting {wait_seconds:.0f}s (Retry-After date)",
                    provider=provider,
                    status="RATE_LIMITED",
                    error_type="rate_limit",
                    retry_after=wait_seconds,
                    http_status=429,
                )
                return wait_seconds
            except Exception:
                pass

    # 2. Check x-ratelimit-* headers (GitHub pattern)
    remaining = headers.get("x-ratelimit-remaining") or headers.get("X-RateLimit-Remaining")
    reset = headers.get("x-ratelimit-reset") or headers.get("X-RateLimit-Reset")
    limit = headers.get("x-ratelimit-limit") or headers.get("X-RateLimit-Limit")

    if remaining is not None and reset is not None:
        try:
            remaining_int = int(remaining)
            reset_timestamp = int(reset)
            limit_int = int(limit) if limit else -1

            if remaining_int == 0:
                wait_seconds = max(0, reset_timestamp - time.time())
                log_status(
                    f"Rate limited by {provider}: waiting {wait_seconds:.0f}s (x-ratelimit-reset)",
                    provider=provider,
                    status="RATE_LIMITED",
                    error_type="rate_limit",
                    retry_after=wait_seconds,
                    http_status=429,
                    error_details={
                        "source": "x-ratelimit headers",
                        "remaining": remaining_int,
                        "limit": limit_int,
                        "reset_timestamp": reset_timestamp,
                    },
                )
                return wait_seconds

            # Track state for adaptive throttling
            RATE_LIMIT_STATE[provider] = {
                "remaining": remaining_int,
                "limit": limit_int,
                "reset": reset_timestamp,
                "updated": time.time()
            }
        except ValueError:
            pass

    # 3. Check IETF RateLimit-* draft headers (future-proofing)
    ratelimit = headers.get("RateLimit") or headers.get("ratelimit")
    if ratelimit:
        # Format: limit=100, remaining=50, reset=30
        try:
            parts = dict(p.strip().split("=") for p in ratelimit.split(","))
            if parts.get("remaining") == "0" and "reset" in parts:
                wait_seconds = float(parts["reset"])
                log_status(
                    f"Rate limited by {provider}: waiting {wait_seconds:.0f}s (IETF RateLimit)",
                    provider=provider,
                    status="RATE_LIMITED",
                    error_type="rate_limit",
                    retry_after=wait_seconds,
                    http_status=429,
                    error_details={"source": "IETF RateLimit header", "parts": parts},
                )
                return wait_seconds
        except Exception:
            pass

    return None


def with_semaphore(provider: str) -> Callable[[Callable[P, R]], Callable[P, R]]:
    """Decorator to wrap function with provider semaphore.

    Args:
        provider: Provider name (must exist in PROVIDER_SEMAPHORES)

    Returns:
        Decorated function with semaphore-guarded execution
    """
    import threading

    def decorator(func: Callable[P, R]) -> Callable[P, R]:
        @wraps(func)
        def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
            sem = PROVIDER_SEMAPHORES.get(provider, threading.Semaphore(5))
            with sem:
                return func(*args, **kwargs)
        return wrapper
    return decorator


def create_retry_decorator(provider: str, max_attempts: int = 3, max_delay: int = 120) -> Callable[[Callable[P, R]], Callable[P, R]]:
    """Create a tenacity retry decorator for a provider.

    Uses exponential backoff with jitter to prevent thundering herds.
    Respects rate limits via parse_rate_limit_headers when available.

    Args:
        provider: Provider name for logging
        max_attempts: Maximum retry attempts
        max_delay: Maximum delay between retries in seconds

    Returns:
        Tenacity retry decorator, or identity function if tenacity unavailable
    """
    if not TENACITY_AVAILABLE:
        # No-op decorator if tenacity not installed
        def identity(func: Callable[P, R]) -> Callable[P, R]:
            return func
        return identity

    return retry(
        stop=(stop_after_attempt(max_attempts) | stop_after_delay(300)),  # 5 min max
        wait=wait_random_exponential(multiplier=1, min=1, max=max_delay),
        retry=retry_if_exception_type((ConnectionError, TimeoutError, OSError)),
        reraise=True,
    )
