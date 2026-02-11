#!/usr/bin/env python3
"""Error tracking and structured logging for Dogpile.

Provides:
- Structured error logging with timestamps and context
- Rate limit tracking per provider
- Error aggregation for debugging
- JSON log export for agent analysis

Log file: dogpile_errors.json (structured) and dogpile.log (human-readable)
"""
import json
import os
import sys
import time
import threading
from dataclasses import dataclass, field, asdict
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Dict, List, Optional, Any


class ErrorSeverity(str, Enum):
    """Error severity levels."""
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"
    CRITICAL = "critical"


class ErrorType(str, Enum):
    """Categorized error types for agent debugging."""
    RATE_LIMIT = "rate_limit"
    TIMEOUT = "timeout"
    AUTH_FAILURE = "auth_failure"
    NETWORK_ERROR = "network_error"
    PARSE_ERROR = "parse_error"
    API_ERROR = "api_error"
    CONFIG_ERROR = "config_error"
    DEPENDENCY_MISSING = "dependency_missing"
    UNKNOWN = "unknown"


@dataclass
class ErrorEvent:
    """Structured error event."""
    timestamp: str
    provider: str
    error_type: ErrorType
    severity: ErrorSeverity
    message: str
    details: Optional[Dict[str, Any]] = None
    retry_after_seconds: Optional[float] = None
    http_status: Optional[int] = None
    traceback: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["error_type"] = self.error_type.value
        d["severity"] = self.severity.value
        return d


@dataclass
class RateLimitState:
    """Track rate limit state per provider."""
    provider: str
    remaining: int = -1
    limit: int = -1
    reset_at: Optional[float] = None  # Unix timestamp
    last_hit: Optional[str] = None  # Timestamp of last rate limit hit
    total_hits: int = 0
    backoff_multiplier: float = 1.0


@dataclass
class SearchSession:
    """Track a single dogpile search session."""
    session_id: str
    query: str
    started_at: str
    ended_at: Optional[str] = None
    status: str = "running"  # running, completed, failed
    providers_succeeded: List[str] = field(default_factory=list)
    providers_failed: List[str] = field(default_factory=list)
    errors: List[ErrorEvent] = field(default_factory=list)
    rate_limits_hit: Dict[str, int] = field(default_factory=dict)


class ErrorTracker:
    """Singleton error tracker for dogpile sessions."""

    _instance = None
    _lock = threading.Lock()

    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return

        self._initialized = True
        self._lock = threading.Lock()

        # File paths
        self.log_dir = Path(__file__).parent
        self.error_log = self.log_dir / "dogpile_errors.json"
        self.human_log = self.log_dir / "dogpile.log"

        # State
        self.current_session: Optional[SearchSession] = None
        self.rate_limits: Dict[str, RateLimitState] = {}
        self.errors: List[ErrorEvent] = []

        # Load existing rate limit state
        self._load_rate_limit_state()

    def _load_rate_limit_state(self):
        """Load persisted rate limit state."""
        state_file = self.log_dir / "rate_limit_state.json"
        if state_file.exists():
            try:
                data = json.loads(state_file.read_text())
                for provider, state in data.items():
                    self.rate_limits[provider] = RateLimitState(**state)
            except Exception:
                pass

    def _save_rate_limit_state(self):
        """Persist rate limit state."""
        state_file = self.log_dir / "rate_limit_state.json"
        try:
            data = {p: asdict(s) for p, s in self.rate_limits.items()}
            tmp = state_file.with_suffix(".tmp")
            tmp.write_text(json.dumps(data, indent=2))
            os.replace(tmp, state_file)
        except Exception:
            pass

    def start_session(self, query: str) -> str:
        """Start a new search session."""
        session_id = f"dogpile_{int(time.time())}"
        self.current_session = SearchSession(
            session_id=session_id,
            query=query,
            started_at=datetime.now().isoformat(),
        )
        self._log_human(f"=== Session {session_id} started: {query[:60]}... ===")
        return session_id

    def end_session(self, status: str = "completed"):
        """End the current session."""
        if self.current_session:
            self.current_session.ended_at = datetime.now().isoformat()
            self.current_session.status = status
            self._save_session()
            self._log_human(f"=== Session {self.current_session.session_id} {status} ===")
            self.current_session = None

    def _save_session(self):
        """Save session to error log."""
        if not self.current_session:
            return

        try:
            # Load existing sessions
            sessions = []
            if self.error_log.exists():
                try:
                    data = json.loads(self.error_log.read_text())
                    sessions = data.get("sessions", [])
                except Exception:
                    pass

            # Add current session
            session_dict = asdict(self.current_session)
            session_dict["errors"] = [e.to_dict() for e in self.current_session.errors]
            sessions.append(session_dict)

            # Keep last 50 sessions
            sessions = sessions[-50:]

            # Write atomically
            output = {
                "last_updated": datetime.now().isoformat(),
                "sessions": sessions,
                "rate_limits": {p: asdict(s) for p, s in self.rate_limits.items()},
            }
            tmp = self.error_log.with_suffix(".tmp")
            tmp.write_text(json.dumps(output, indent=2))
            os.replace(tmp, self.error_log)
        except Exception as e:
            self._log_human(f"Failed to save session: {e}")

    def _log_human(self, msg: str):
        """Append to human-readable log."""
        try:
            timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            with open(self.human_log, "a") as f:
                f.write(f"[{timestamp}] {msg}\n")
        except Exception:
            pass

    def log_error(
        self,
        provider: str,
        error_type: ErrorType,
        message: str,
        severity: ErrorSeverity = ErrorSeverity.ERROR,
        details: Optional[Dict[str, Any]] = None,
        http_status: Optional[int] = None,
        retry_after: Optional[float] = None,
        traceback: Optional[str] = None,
    ) -> ErrorEvent:
        """Log a structured error."""
        event = ErrorEvent(
            timestamp=datetime.now().isoformat(),
            provider=provider,
            error_type=error_type,
            severity=severity,
            message=message,
            details=details,
            http_status=http_status,
            retry_after_seconds=retry_after,
            traceback=traceback,
        )

        with self._lock:
            self.errors.append(event)
            if self.current_session:
                self.current_session.errors.append(event)
                if provider not in self.current_session.providers_failed:
                    self.current_session.providers_failed.append(provider)

        # Log to human-readable
        severity_prefix = {
            ErrorSeverity.INFO: "INFO",
            ErrorSeverity.WARNING: "WARN",
            ErrorSeverity.ERROR: "ERROR",
            ErrorSeverity.CRITICAL: "CRIT",
        }.get(severity, "????")

        self._log_human(f"[{severity_prefix}] [{provider}] {error_type.value}: {message}")
        if details:
            self._log_human(f"  Details: {json.dumps(details)}")

        # Also emit to stderr for real-time monitoring
        try:
            sys.stderr.write(f"[DOGPILE-ERROR] [{provider}] {error_type.value}: {message}\n")
            sys.stderr.flush()
        except Exception:
            pass

        return event

    def log_rate_limit(
        self,
        provider: str,
        retry_after: Optional[float] = None,
        remaining: int = 0,
        limit: int = -1,
        reset_at: Optional[float] = None,
        http_status: int = 429,
        details: Optional[Dict[str, Any]] = None,
    ):
        """Log a rate limit event with tracking."""
        with self._lock:
            # Update rate limit state
            if provider not in self.rate_limits:
                self.rate_limits[provider] = RateLimitState(provider=provider)

            state = self.rate_limits[provider]
            state.remaining = remaining
            state.limit = limit
            state.reset_at = reset_at or (time.time() + (retry_after or 60))
            state.last_hit = datetime.now().isoformat()
            state.total_hits += 1
            state.backoff_multiplier = min(state.backoff_multiplier * 1.5, 10.0)

            # Track in session
            if self.current_session:
                self.current_session.rate_limits_hit[provider] = \
                    self.current_session.rate_limits_hit.get(provider, 0) + 1

        # Create error event
        wait_msg = f"waiting {retry_after:.0f}s" if retry_after else "backoff active"
        self.log_error(
            provider=provider,
            error_type=ErrorType.RATE_LIMIT,
            severity=ErrorSeverity.WARNING,
            message=f"Rate limited ({wait_msg})",
            details={
                **(details or {}),
                "remaining": remaining,
                "limit": limit,
                "reset_at": reset_at,
                "total_hits": self.rate_limits[provider].total_hits,
            },
            http_status=http_status,
            retry_after=retry_after,
        )

        # Persist state
        self._save_rate_limit_state()

    def log_success(self, provider: str, message: str = ""):
        """Log a successful provider completion."""
        with self._lock:
            if self.current_session:
                if provider not in self.current_session.providers_succeeded:
                    self.current_session.providers_succeeded.append(provider)
                # Remove from failed if it succeeded on retry
                if provider in self.current_session.providers_failed:
                    self.current_session.providers_failed.remove(provider)

            # Reset backoff on success
            if provider in self.rate_limits:
                self.rate_limits[provider].backoff_multiplier = 1.0

        self._log_human(f"[OK] [{provider}] {message or 'completed'}")

    def get_backoff_time(self, provider: str, base: float = 30.0) -> float:
        """Get recommended backoff time for a provider."""
        with self._lock:
            if provider not in self.rate_limits:
                return base

            state = self.rate_limits[provider]

            # If we have a reset time in the future, use it
            if state.reset_at and state.reset_at > time.time():
                return max(base, state.reset_at - time.time())

            # Otherwise use exponential backoff
            return base * state.backoff_multiplier

    def get_summary(self) -> Dict[str, Any]:
        """Get error summary for agent debugging."""
        with self._lock:
            session_summary = None
            if self.current_session:
                session_summary = {
                    "session_id": self.current_session.session_id,
                    "query": self.current_session.query[:50],
                    "status": self.current_session.status,
                    "succeeded": self.current_session.providers_succeeded,
                    "failed": self.current_session.providers_failed,
                    "error_count": len(self.current_session.errors),
                    "rate_limits_hit": self.current_session.rate_limits_hit,
                }

            # Recent errors (last 10)
            recent_errors = [e.to_dict() for e in self.errors[-10:]]

            # Rate limit summary
            rate_limit_summary = {}
            for provider, state in self.rate_limits.items():
                rate_limit_summary[provider] = {
                    "total_hits": state.total_hits,
                    "last_hit": state.last_hit,
                    "backoff_multiplier": state.backoff_multiplier,
                    "reset_at": state.reset_at,
                }

            return {
                "current_session": session_summary,
                "recent_errors": recent_errors,
                "rate_limits": rate_limit_summary,
                "total_errors": len(self.errors),
            }


# Global singleton
_tracker: Optional[ErrorTracker] = None


def get_tracker() -> ErrorTracker:
    """Get the global error tracker instance."""
    global _tracker
    if _tracker is None:
        _tracker = ErrorTracker()
    return _tracker


# Convenience functions
def log_error(provider: str, error_type: ErrorType, message: str, **kwargs):
    """Log an error event."""
    return get_tracker().log_error(provider, error_type, message, **kwargs)


def log_rate_limit(provider: str, retry_after: Optional[float] = None, **kwargs):
    """Log a rate limit event."""
    return get_tracker().log_rate_limit(provider, retry_after, **kwargs)


def log_success(provider: str, message: str = ""):
    """Log successful completion."""
    return get_tracker().log_success(provider, message)


def start_session(query: str) -> str:
    """Start a new search session."""
    return get_tracker().start_session(query)


def end_session(status: str = "completed"):
    """End the current session."""
    return get_tracker().end_session(status)


def get_error_summary() -> Dict[str, Any]:
    """Get error summary for debugging."""
    return get_tracker().get_summary()


def get_backoff_time(provider: str, base: float = 30.0) -> float:
    """Get recommended backoff time."""
    return get_tracker().get_backoff_time(provider, base)
