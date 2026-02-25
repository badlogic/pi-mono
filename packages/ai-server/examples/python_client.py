"""
pi-ai-server Python client example
===================================
Requires: pip install requests   (or use the urllib fallback below)

Start the server first:
  cd packages/ai-server && node dist/server.js

Then run this script:
  python3 examples/python_client.py
"""

import json
import urllib.request
import urllib.error

SERVER = "http://127.0.0.1:3456"


# ─── Low-level helpers (no pip required) ──────────────────────────────────────

def post(path: str, data: dict) -> dict:
    """POST JSON to the server and return parsed response."""
    body = json.dumps(data).encode()
    req = urllib.request.Request(
        f"{SERVER}{path}",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode())


def get(path: str) -> dict:
    """GET JSON from the server."""
    with urllib.request.urlopen(f"{SERVER}{path}") as resp:
        return json.loads(resp.read().decode())


def stream(path: str, data: dict):
    """POST and yield Server-Sent Events as parsed dicts."""
    body = json.dumps(data).encode()
    req = urllib.request.Request(
        f"{SERVER}{path}",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req) as resp:
        buf = ""
        event_type = "message"
        for raw_line in resp:
            line = raw_line.decode("utf-8").rstrip("\n\r")
            if line.startswith("event:"):
                event_type = line[len("event:"):].strip()
            elif line.startswith("data:"):
                buf = line[len("data:"):].strip()
            elif line == "" and buf:
                yield event_type, json.loads(buf)
                buf = ""
                event_type = "message"


# ─── Example 1: List providers ────────────────────────────────────────────────

def example_list_providers():
    print("=== Providers ===")
    providers = get("/providers")
    for p in providers:
        auth_status = (
            "✓ authenticated" if p["authenticated"]
            else "✗ not logged in" if p["authType"] == "oauth"
            else "(api key required)"
        )
        print(f"  {p['id']:<25} [{p['authType']}]  {auth_status}")
    print()


# ─── Example 2: OAuth token (Gemini CLI / OpenAI Codex) ───────────────────────

def example_get_oauth_token(provider_id: str) -> str:
    """Get a valid API key for an OAuth provider (auto-refreshes if expired)."""
    print(f"=== Get OAuth token for {provider_id} ===")
    result = post("/auth/token", {"providerId": provider_id})
    api_key = result["apiKey"]
    print(f"  Got apiKey: {api_key[:40]}...")
    print()
    return api_key


# ─── Example 3: Complete (non-streaming) ──────────────────────────────────────

def example_complete_openai(api_key: str):
    """Use OpenAI with a plain API key."""
    print("=== Complete (OpenAI GPT-4o-mini) ===")
    result = post("/complete", {
        "model": {
            "id": "gpt-4o-mini",
            "name": "GPT-4o Mini",
            "api": "openai-completions",
            "provider": "openai",
            "baseUrl": "https://api.openai.com/v1",
            "reasoning": False,
            "input": ["text"],
            "cost": {"input": 0.15, "output": 0.6, "cacheRead": 0, "cacheWrite": 0},
            "contextWindow": 128000,
            "maxTokens": 16384,
        },
        "context": {
            "messages": [
                {
                    "role": "user",
                    "content": "Say hello in one sentence.",
                    "timestamp": 0,
                }
            ]
        },
        "options": {
            "apiKey": api_key,
        },
    })
    text_blocks = [b["text"] for b in result["content"] if b["type"] == "text"]
    print(f"  Response: {''.join(text_blocks)}")
    print(f"  Tokens: {result['usage']['totalTokens']}")
    print()


def example_complete_gemini_cli(api_key: str):
    """Use Gemini CLI with the OAuth API key obtained from /auth/token."""
    print("=== Complete (Gemini CLI) ===")
    result = post("/complete", {
        "model": {
            "id": "gemini-2.0-flash",
            "name": "Gemini 2.0 Flash",
            "api": "google-gemini-cli",
            "provider": "google-gemini-cli",
            "baseUrl": "",
            "reasoning": False,
            "input": ["text", "image"],
            "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0},
            "contextWindow": 1000000,
            "maxTokens": 8192,
        },
        "context": {
            "messages": [
                {
                    "role": "user",
                    "content": "Say hello in one sentence.",
                    "timestamp": 0,
                }
            ]
        },
        "options": {
            "apiKey": api_key,  # The JSON string returned by /auth/token
        },
    })
    text_blocks = [b["text"] for b in result["content"] if b["type"] == "text"]
    print(f"  Response: {''.join(text_blocks)}")
    print(f"  Tokens: {result['usage']['totalTokens']}")
    print()


# ─── Example 4: Streaming ─────────────────────────────────────────────────────

def example_stream_gemini_cli(api_key: str):
    """Stream a Gemini CLI response via SSE."""
    print("=== Stream (Gemini CLI) ===")
    print("  Response: ", end="", flush=True)
    for event_type, event in stream("/stream", {
        "model": {
            "id": "gemini-2.0-flash",
            "name": "Gemini 2.0 Flash",
            "api": "google-gemini-cli",
            "provider": "google-gemini-cli",
            "baseUrl": "",
            "reasoning": False,
            "input": ["text", "image"],
            "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0},
            "contextWindow": 1000000,
            "maxTokens": 8192,
        },
        "context": {
            "messages": [
                {
                    "role": "user",
                    "content": "Count from 1 to 5, one number per line.",
                    "timestamp": 0,
                }
            ]
        },
        "options": {"apiKey": api_key},
    }):
        if event.get("type") == "text_delta":
            print(event.get("delta", ""), end="", flush=True)
        elif event_type == "done":
            break
        elif event_type == "error":
            print(f"\n  Error: {event}")
            break
    print("\n")


# ─── Main ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    # 1. List providers
    example_list_providers()

    # 2. Demo with OpenAI (set your API key here or via env)
    import os
    openai_key = os.environ.get("OPENAI_API_KEY", "")
    if openai_key:
        example_complete_openai(openai_key)
    else:
        print("⚠  Skipping OpenAI example (set OPENAI_API_KEY env var to enable)\n")

    # 3. Demo with Gemini CLI OAuth (requires prior `pi-ai login google-gemini-cli`)
    try:
        gemini_key = example_get_oauth_token("google-gemini-cli")
        example_complete_gemini_cli(gemini_key)
        example_stream_gemini_cli(gemini_key)
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        print(f"⚠  Gemini CLI skipped: {body}\n")
    except Exception as e:
        print(f"⚠  Gemini CLI skipped: {e}\n")
