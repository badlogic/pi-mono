import asyncio
import time
from dataclasses import dataclass, field
from typing import Any

from agent import AgentService


@dataclass
class SessionInfo:
    id: str
    agent_service: AgentService
    created_at: float = field(default_factory=time.time)
    last_accessed_at: float = field(default_factory=time.time)
    request_count: int = 0


class SessionManager:
    def __init__(
        self,
        max_sessions: int = 5,
        idle_timeout_ms: int = 30 * 60 * 1000,
        max_lifetime_ms: int = 2 * 60 * 60 * 1000,
    ):
        self.sessions: dict[str, SessionInfo] = {}
        self.max_sessions = max_sessions
        self.idle_timeout_ms = idle_timeout_ms
        self.max_lifetime_ms = max_lifetime_ms
        self._cleanup_task: asyncio.Task | None = None

    async def start(self):
        self._cleanup_task = asyncio.create_task(self._cleanup_loop())

    async def stop(self):
        if self._cleanup_task:
            self._cleanup_task.cancel()
            try:
                await self._cleanup_task
            except asyncio.CancelledError:
                pass

    async def get_session(
        self,
        session_id: str,
        repo_path: str,
        api_key: str | None = None,
        model: str = "anthropic:claude-sonnet-4-20250514",
        base_url: str | None = None,
    ) -> AgentService:
        existing = self.sessions.get(session_id)

        if existing:
            existing.last_accessed_at = time.time()
            existing.request_count += 1
            return existing.agent_service

        if len(self.sessions) >= self.max_sessions:
            self._evict_lru()

        agent_service = AgentService(
            repo_path=repo_path,
            api_key=api_key,
            model=model,
            base_url=base_url,
        )

        session_info = SessionInfo(
            id=session_id,
            agent_service=agent_service,
        )
        self.sessions[session_id] = session_info
        print(f"[SessionManager] Created session {session_id}, total: {len(self.sessions)}")

        return agent_service

    def get_session_info(self, session_id: str) -> SessionInfo | None:
        return self.sessions.get(session_id)

    def list_sessions(self) -> list[dict[str, Any]]:
        now = time.time()
        return [
            {
                "id": s.id,
                "created_at": s.created_at,
                "last_accessed_at": s.last_accessed_at,
                "request_count": s.request_count,
                "age_ms": (now - s.created_at) * 1000,
                "idle_ms": (now - s.last_accessed_at) * 1000,
            }
            for s in self.sessions.values()
        ]

    async def destroy_session(self, session_id: str) -> bool:
        session = self.sessions.get(session_id)
        if not session:
            return False

        del self.sessions[session_id]
        print(f"[SessionManager] Destroyed session {session_id}, remaining: {len(self.sessions)}")
        return True

    async def destroy_all_sessions(self) -> None:
        self.sessions.clear()
        print("[SessionManager] All sessions destroyed")

    def get_stats(self) -> dict[str, Any]:
        now = time.time()
        oldest_age = 0
        longest_idle = 0

        for s in self.sessions.values():
            age = (now - s.created_at) * 1000
            idle = (now - s.last_accessed_at) * 1000
            oldest_age = max(oldest_age, age)
            longest_idle = max(longest_idle, idle)

        return {
            "total_sessions": len(self.sessions),
            "max_sessions": self.max_sessions,
            "oldest_session_age_ms": oldest_age,
            "longest_idle_ms": longest_idle,
        }

    async def _cleanup_loop(self) -> None:
        while True:
            await asyncio.sleep(60)
            self._cleanup()

    def _cleanup(self) -> None:
        now = time.time()
        to_delete = []

        for id, session in self.sessions.items():
            age = (now - session.created_at) * 1000
            idle = (now - session.last_accessed_at) * 1000

            if age > self.max_lifetime_ms or idle > self.idle_timeout_ms:
                to_delete.append(id)

        for id in to_delete:
            del self.sessions[id]

        if to_delete:
            print(f"[SessionManager] Cleaned up {len(to_delete)} expired sessions, remaining: {len(self.sessions)}")

    def _evict_lru(self) -> None:
        lru_id: str | None = None
        lru_time = float("inf")

        for id, session in self.sessions.items():
            if session.last_accessed_at < lru_time:
                lru_time = session.last_accessed_at
                lru_id = id

        if lru_id:
            del self.sessions[lru_id]
            print(f"[SessionManager] Evicted LRU session {lru_id}")
