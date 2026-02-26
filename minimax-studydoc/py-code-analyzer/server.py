import os
import time
from contextlib import asynccontextmanager
from typing import Annotated

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

from agent import AgentService
from session import SessionManager

load_dotenv()

REPO_PATH = os.getenv("REPO_PATH", "./repo")
API_KEY = os.getenv("ANTHROPIC_API_KEY", os.getenv("OPENAI_API_KEY", ""))
MODEL = os.getenv("MODEL", "anthropic:claude-sonnet-4-20250514")
BASE_URL = os.getenv("BASE_URL", "")
PORT = int(os.getenv("PORT", "3000"))

MAX_SESSIONS = int(os.getenv("MAX_SESSIONS", "5"))
SESSION_IDLE_TIMEOUT_MS = int(os.getenv("SESSION_IDLE_TIMEOUT_MS", "1800000"))
SESSION_MAX_LIFETIME_MS = int(os.getenv("SESSION_MAX_LIFETIME_MS", "7200000"))

session_manager = SessionManager(
    max_sessions=MAX_SESSIONS,
    idle_timeout_ms=SESSION_IDLE_TIMEOUT_MS,
    max_lifetime_ms=SESSION_MAX_LIFETIME_MS,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await session_manager.start()
    yield
    await session_manager.stop()


app = FastAPI(lifespan=lifespan)


class AnalyzeRequest(BaseModel):
    prompt: str


class ChatRequest(BaseModel):
    prompt: str


async def get_session_from_request(x_session_id: Annotated[str | None, Header()] = None):
    session_id = x_session_id or "default"
    
    agent = await session_manager.get_session(
        session_id=session_id,
        repo_path=REPO_PATH,
        api_key=API_KEY or None,
        model=MODEL,
        base_url=BASE_URL or None,
    )
    
    return session_id, agent


@app.post("/analyze")
async def analyze(req: AnalyzeRequest, x_session_id: Annotated[str | None, Header()] = None):
    start_time = int(time.time() * 1000)
    
    if not req.prompt:
        raise HTTPException(status_code=400, detail="prompt is required")
    
    session_id, agent = await get_session_from_request(x_session_id)
    print(f"[Analyze] Session: {session_id}, Prompt: {req.prompt[:100]}...")
    
    result = await agent.analyze(req.prompt)
    
    duration = int(time.time() * 1000) - start_time
    print(f"[Analyze] Session: {session_id}, Completed in {duration}ms, {len(result.tool_calls)} tool calls")
    
    return {
        **result.model_dump(),
        "session_id": session_id,
        "duration": duration,
    }


@app.post("/chat")
async def chat(req: ChatRequest, x_session_id: Annotated[str | None, Header()] = None):
    start_time = int(time.time() * 1000)
    
    if not req.prompt:
        raise HTTPException(status_code=400, detail="prompt is required")
    
    session_id, agent = await get_session_from_request(x_session_id)
    print(f"[Chat] Session: {session_id}, Prompt: {req.prompt[:100]}...")
    
    response = await agent.chat(req.prompt)
    
    duration = int(time.time() * 1000) - start_time
    print(f"[Chat] Session: {session_id}, Completed in {duration}ms")
    
    return {
        "success": True,
        "response": response,
        "session_id": session_id,
        "duration": duration,
    }


@app.get("/messages")
async def get_messages(x_session_id: Annotated[str | None, Header()] = None):
    session_id, agent = await get_session_from_request(x_session_id)
    messages = agent.get_messages()
    
    return {
        "success": True,
        "session_id": session_id,
        "count": len(messages),
        "messages": messages,
    }


@app.post("/summarize")
async def summarize(x_session_id: Annotated[str | None, Header()] = None):
    from agent import SummarizeService
    
    start_time = int(time.time() * 1000)
    
    session_id, agent = await get_session_from_request(x_session_id)
    print(f"[Summarize] Session: {session_id}")
    
    messages = agent.get_messages()
    conversation_text = "\n".join([f"User: {m.get('user', '')}\nAssistant: {m.get('assistant', '')}" for m in messages])
    
    summarize_service = SummarizeService(api_key=API_KEY or None, model=MODEL)
    summary = await summarize_service.summarize(conversation_text)
    
    duration = int(time.time() * 1000) - start_time
    print(f"[Summarize] Session: {session_id}, Completed in {duration}ms")
    
    return {
        "success": True,
        "summary": summary,
        "session_id": session_id,
        "duration": duration,
    }


@app.get("/health")
async def health():
    stats = session_manager.get_stats()
    
    return {
        "status": "ok",
        "sessions": stats,
        "config": {
            "repo_path": REPO_PATH,
            "model": MODEL,
            "has_api_key": bool(API_KEY),
            "max_sessions": MAX_SESSIONS,
            "session_idle_timeout_ms": SESSION_IDLE_TIMEOUT_MS,
            "session_max_lifetime_ms": SESSION_MAX_LIFETIME_MS,
        },
    }


@app.get("/sessions")
async def list_sessions():
    sessions = session_manager.list_sessions()
    stats = session_manager.get_stats()
    
    return {
        "success": True,
        "sessions": sessions,
        "stats": stats,
    }


@app.delete("/sessions/{session_id}")
async def destroy_session(session_id: str):
    destroyed = await session_manager.destroy_session(session_id)
    
    if destroyed:
        return {"success": True, "message": f"Session {session_id} destroyed"}
    else:
        raise HTTPException(status_code=404, detail="Session not found")


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=PORT)
