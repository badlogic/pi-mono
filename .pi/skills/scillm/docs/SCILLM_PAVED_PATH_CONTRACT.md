# DevOps SciLLM Paved‑Path Contract (No Hacks / No Wrappers)

This document defines hard rules for how DevOps code in this repository must call SciLLM and Chutes. It exists to prevent regressions back to bespoke wrappers, manual headers, or raw HTTP calls that bypass the paved path.

Scope
- Applies to all code under `experiments/devops/**` (pipelines, workflows, scripts, CLIs, notebooks with executable code).
- Documentation may include `curl` examples for ops visibility, but executable code must follow this contract.

Canonical surfaces (to reduce confusion)
- Single model: `completion(...)` / `acompletion(...)`
- Batch: `batch_acompletions(...)` or `batch_acompletions_iter(...)` (aliases for `parallel_*`)
- Formal proofs: `certainly_prove(...)` / `completion(... custom_llm_provider="certainly" ...)`
- Multi‑model routing: **only** `Router(model_list=...)` (avoid custom fallback loops)

Hard Rules (Do / Don’t)
- DO use SciLLM directly:
  - `from scillm import acompletion, completion`
  - For large batch fan-out: `from scillm import batch_acompletions, batch_acompletions_iter` (aliases for the parallel_* APIs)
  - `from scillm.paved import sanity_preflight, list_models_openai_like, chutes_chat_json`
- DO pass credentials via `api_key=`; SciLLM canonicalizes headers for Chutes.
- DO request strict JSON when applicable: `response_format={"type":"json_object"}`.
- DO use paved preflight + discovery:
  - List models: `list_models_openai_like(api_base, api_key)` (Bearer → x‑api‑key fallback handled internally)
  - Preflight (sync helper): `sanity_preflight(api_base=..., api_key=..., model=..., parallel=3, wall_time_s=30)`
    - If you are already inside an event loop (async code), run it in a thread: `await asyncio.to_thread(sanity_preflight, api_base=..., api_key=..., model=...)`
- DO use Router only via SciLLM helpers (never reimplement):
  - `from scillm import Router` or `from scillm.paved import chutes_router_json`

- DON’T set auth headers manually in code (no exceptions):
  - Don’t pass `extra_headers={"Authorization": "Bearer …"}` or `extra_headers={"x-api-key": …}`
  - Don’t hand‑build `requests`/`httpx`/`aiohttp` calls to `/v1/chat/completions` or `/v1/models`
- DON’T implement client‑side alternates/fallbacks for Step 07; preflight must fail fast so operators can fix routing/quota. Use Router flows only where explicitly intended.
- DON’T swallow preflight errors. Surface structured details (`exc_type`, `message`, `status`) to the caller.

JSON validation (strict mode)
- Opt in with `SCILLM_JSON_STRICT=1` (or `strict_json=True` on the call). When enabled and `response_format={"type":"json_object"}` is set, SCILLM raises `JsonParseError` on empty/non‑JSON content and attaches `scillm_meta` with `reason=json_parse_failed`, `sample`, `raw_len`, `model`, and `provider`. This keeps errors actionable without bespoke wrappers.

Parallel batch (openai_like / Chutes)
- Signature (v1.77.4): `parallel_acompletions(requests, *, api_base, api_key, custom_llm_provider='openai_like', concurrency=6, timeout=20, wall_time_s=900, default_max_tokens=None, default_temperature=None, response_format=None, tenacious=True, …)`
- Each request dict may contain: `model`, `messages`, `max_tokens?`, `temperature?`, `response_format?`, `api_base?`, `api_key?`.
- Important: unlike `acompletion(...)`, `parallel_acompletions(...)` does **not** accept a top-level `model=` kwarg. Put `model` inside each request dict (or rely on `CHUTES_MODEL_ID`/`CHUTES_TEXT_MODEL` defaults).
- Also note: `messages_list=...` is **not** a Python API parameter; it is a CLI convenience used by `scillm-tool parallel` to build the per-item request dicts.
- Progress: if you need progress logging / as-completed checkpointing, use `parallel_acompletions_iter(...)` (or its alias `batch_acompletions_iter(...)`) instead of waiting on one big `await parallel_acompletions(...)`.
  - Iterator parity: `schema=`, `retry_invalid_json=`, and `repair_invalid_json=` are supported at the iterator level too.
- Return shape: list of dicts with `index, request, response, error, status, content`. When `response_format` is json_object, `content` may be a dict or string. Check `error`/`status` per item.
- Guards: if `api_base`/`api_key` or `model` are missing after env defaults, SCILLM raises `ValueError` early instead of hanging.
- Recommended defaults to avoid silent waits: `tenacious=False`, `timeout=20-30`, `wall_time_s=120-300`, `concurrency=4-8`, `response_format={"type":"json_object"}`. Keep `SCILLM_JSON_STRICT=1` in CI to surface bad JSON.
- Structured JSON helpers:
  - `schema=` (jsonschema dict or callable) validates each item’s parsed JSON; failures set `error="invalid_json: …"` and keep `raw` sample.
  - `retry_invalid_json=N` retries invalid JSON up to N times with backoff (same messages).
  - `summary` attached to the first item: counts of ok/invalid_json/provider_error/empty_content.
  - `repair_invalid_json=True` (opt-in; env `SCILLM_REPAIR_INVALID_JSON=1`) salvages malformed JSON (trim braces, then `clean_json_string` when available) before failing; repaired items are marked `repaired=true` in results/summary.
- Example (one model, multiple requests):
```python
import asyncio
import os

from scillm import parallel_acompletions

MODEL = os.environ["CHUTES_MODEL_ID"]

async def main():
    reqs = [
        {
            "model": MODEL,
            "messages": [{"role": "user", "content": 'Return only {"ok":true} as JSON.'}],
            "response_format": {"type": "json_object"},
            "max_tokens": 64,
            "temperature": 0,
        },
        {
            "model": MODEL,
            "messages": [{"role": "user", "content": 'Return only {"n":1} as JSON.'}],
            "response_format": {"type": "json_object"},
            "max_tokens": 64,
            "temperature": 0,
        },
    ]

    resps = await parallel_acompletions(
        reqs,
        api_base=os.environ["CHUTES_API_BASE"],
        api_key=os.environ["CHUTES_API_KEY"],
        custom_llm_provider="openai_like",
        concurrency=4,
        timeout=20,
        wall_time_s=120,
        response_format={"type":"json_object"},
        tenacious=False,
    )
    for r in resps:
        if r["error"]:
            print("error", r["status"], r["error"])
        else:
            print("content", r["content"])

asyncio.run(main())
```

- Example with progress (recommended for large batches):
```python
import asyncio
import os

from scillm import batch_acompletions_iter

MODEL = os.environ["CHUTES_MODEL_ID"]

async def main():
    reqs = [
        {"model": MODEL, "messages": [{"role": "user", "content": "hi"}], "response_format": {"type": "json_object"}},
        {"model": MODEL, "messages": [{"role": "user", "content": "hi"}], "response_format": {"type": "json_object"}},
    ]
    done = ok = err = 0
    async for ev in batch_acompletions_iter(
        reqs,
        api_base=os.environ["CHUTES_API_BASE"],
        api_key=os.environ["CHUTES_API_KEY"],
        custom_llm_provider="openai_like",
        # Optional JSON validation/repair (same as parallel_acompletions)
        # schema=MY_JSON_SCHEMA,
        # retry_invalid_json=1,
        # repair_invalid_json=True,
        concurrency=6,
        timeout=60,
        wall_time_s=900,
        tenacious=True,
    ):
        done += 1
        ok += int(bool(ev.get("ok")))
        err += int(not ev.get("ok"))
        if done % 25 == 0 or not ev.get("ok"):
            print(f"{done}/{len(reqs)} ok={ok} err={err} idx={ev.get('index')} status={ev.get('status')} elapsed_s={ev.get('elapsed_s')}")

asyncio.run(main())
```

- Common mistake (don’t do this):
```python
# ❌ wrong: parallel_acompletions has no model= or messages_list= kwargs
# await parallel_acompletions(model=..., messages_list=[[...], [...]], api_base=..., api_key=...)
```

- Minimal example (single request):
```python
resps = await parallel_acompletions(
    [
      {"messages":[{"role":"system","content":"Return JSON only."},
                   {"role":"user","content":"Return {\"ok\":true} as JSON."}],
       "response_format":{"type":"json_object"},
       "max_tokens":64,
       "temperature":0,
       "model": os.environ["CHUTES_MODEL_ID"]},
    ],
    api_base=os.environ["CHUTES_API_BASE"],
    api_key=os.environ["CHUTES_API_KEY"],
    custom_llm_provider="openai_like",
    concurrency=4,
    timeout=20,
    wall_time_s=120,
    response_format={"type":"json_object"},
    tenacious=False,
)
for r in resps:
    if r["error"]:
        print("error", r["status"], r["error"])
    else:
        print("content", r["content"])
```

Certainly / Lean4 (paved path)

**Architecture Decision: scillm as Main Caller**

scillm is the paved path for certainly in production code. This keeps:
- **Single API surface** — all providers (chutes, openai, certainly) use the same patterns
- **Consistent orchestration** — auth, retries, logging handled uniformly by scillm
- **Separation of concerns** — certainly focuses on proving, scillm handles integration

For debugging and standalone testing, use the lean4 repo's CLI directly:
```bash
# Quick proof test (requires lean_runner + OPENROUTER_API_KEY)
python -m lean4_prover.certainly_min "Prove that n + 0 = n" --tactics simp
```

Do NOT build separate certainly wrappers or CLIs in other projects — route through scillm.

**Two Modes:**
1. **Direct Mode (Preferred)**: When `certainly` is installed (`pip install scillm[certainly]`), the provider uses direct Python imports with no HTTP overhead.
2. **HTTP Mode (Fallback)**: When `certainly` is not installed, falls back to HTTP bridge at `CERTAINLY_BRIDGE_BASE`.

**Direct Mode API** (preferred for new code):
```python
from scillm.integrations.certainly import prove_requirement, is_available

if is_available():
    result = await prove_requirement(
        requirement="Prove that n + 0 = n",
        tactics=["simp"],
    )
    # result["ok"], result["best"]["lean4"], etc.
```

**Minimal Runnable Script** (copy-paste-run):
```python
#!/usr/bin/env python
"""Minimal certainly proof example.

Prerequisites:
  - lean_runner container running (docker ps | grep lean_runner)
  - OPENROUTER_API_KEY set
  - scillm[certainly] installed (pip install scillm[certainly])
"""
import asyncio
from scillm.integrations.certainly import prove_requirement, is_available

async def main():
    if not is_available():
        print("ERROR: certainly not available")
        return 1

    result = await prove_requirement(
        requirement="Prove that for any natural number n, n + 1 > n",
        tactics=["simp", "omega"],
    )

    if result.get("ok"):
        print("OK: Proof found")
        print("Lean4 code:", result["best"]["lean4"][:300])
        return 0
    else:
        print("FAIL:", result.get("error") or result.get("diagnosis", {}).get("diagnosis"))
        return 1

if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
```

**Environment Variables:**
- `SCILLM_CERTAINLY_HTTP_ONLY=1` — Force HTTP mode even if certainly installed
- `SCILLM_CERTAINLY_DIRECT_STRICT=1` — Fail fast if direct mode fails (no fallback)

**Provider API** (uses direct mode automatically when available):
- Explicit signature (most used):
```python
def certainly_prove(
    *,
    items: List[Dict[str, Any]],
    flags: Optional[List[str]] = None,
    strategies: Optional[List[str] | str] = None,
    tactics: Optional[List[str] | str] = None,
    response_format: Optional[Dict[str, Any]] = None,
    options: Optional[Dict[str, Any]] = None,
    request_timeout: float = 120.0,
    max_seconds: Optional[float] = None,
    session_id: Optional[str] = None,
    track_id: Optional[str] = None,
    api_base: Optional[str] = None,
    require_proved: bool = False,
) -> LiteLLMResponse: ...
```

- Canonical item shape: `{"requirement_text": "0 + n = n"}` (alias: `{"text": ...}`).
- **Primary results live in** `resp.additional_kwargs["certainly"]["results"]`.
- In simple mode, failed results may include `explanation` (LLM-generated reason).
- `resp.choices[0].message["content"]` is a short summary string by default. If `response_format={"type":"json_object"}` (or `json_schema`), the content is a JSON string of the proof payload.
- Strategies/tactics can be passed globally via `flags=` **or** per-item via `strategies`/`tactics` keys in each item.
- Best practice: keep items for requirements + metadata only; put solver config in `flags=`.

- Simplified path (recommended default for pipelines)
  - Single LLM generation + **single compile attempt** (no repair loops).
  - Optional LLM explanation on failure (no auto‑fix).
  - LLM enabled by default; set `options={"no_llm": True}` to force offline mode.
  - Use the dedicated helpers or pass `options={"simple": True, "max_refinements": 0, "explain_failures": True}`.
```python
from scillm.extras.providers import certainly_prove_simple

resp = certainly_prove_simple(
    items=[{"requirement_text": "Nat.add_assoc", "id": "sanity-1"}],
    # Optional: increase if Lean compile is slow
    max_seconds=300,
)
payload = (resp.get("additional_kwargs", {}) or {}).get("certainly", {})
results = payload.get("results", [])
print("status", results[0].get("status"))
print("lean_code", results[0].get("lean_code"))
print("explanation", results[0].get("explanation"))  # only on failure
```

- Minimal example (bridge provider):
```python
import os
from scillm import completion

resp = completion(
    model="certainly",
    custom_llm_provider="certainly",
    api_base=os.getenv("CERTAINLY_BRIDGE_BASE", "http://127.0.0.1:8787"),
    messages=[{"role": "system", "content": "Certainly/Lean4"}],
    items=[{"requirement_text": "Nat.add_comm"}],
    max_seconds=120,
    flags=["--strategies", "direct,structured"],
    session_id="stage-08",
    track_id="run-001",
)
summary = resp.choices[0].message["content"]  # string summary
payload = resp.additional_kwargs["certainly"]  # full bridge payload (summary/results/statistics)
```

- Helper (paved convenience):
```python
from scillm.extras.providers import certainly_prove

resp = certainly_prove(
    items=[{"requirement_text": "Nat.add_assoc"}],
    api_base=os.getenv("CERTAINLY_BRIDGE_BASE", "http://127.0.0.1:8787"),
    flags=["--strategies", "direct,structured"],
    max_seconds=120,
)
payload = resp.additional_kwargs["certainly"]
```

- As-completed iterator (LLM-like fan-out, each item compiled independently):
```python
from scillm.extras.providers import certainly_prove_iter

async for r in certainly_prove_iter(
    items=[{"requirement_text": "Nat.add_comm"}, {"requirement_text": "Nat.add_assoc"}],
    response_format={"type":"json_object"},
    concurrency=4,
):
    if r["ok"]:
        print("ok", r["content"])
    else:
        print("err", r["status"], r["error"])
```

- As-completed iterator (simplified, no repair loop):
```python
from scillm.extras.providers import certainly_prove_simple_iter

async for r in certainly_prove_simple_iter(
    items=[{"requirement_text": "Nat.add_comm"}, {"requirement_text": "Nat.add_assoc"}],
    response_format={"type":"json_object"},
    concurrency=4,
):
    payload = (r.get("response", {}).get("additional_kwargs", {}) or {}).get("certainly", {})
    results = payload.get("results", [])
    if r.get("ok"):
        print("ok", results[0].get("status"))
    else:
        print("err", r.get("status"), r.get("error"), results[0].get("explanation"))
```

Debugging quick-guide (Chutes)
- Text sanity (JSON echo):
```
curl -sS -H "Authorization: Bearer $CHUTES_API_KEY" -H 'Content-Type: application/json' \
  -d '{"model":"'"$CHUTES_MODEL_ID"'","messages":[{"role":"user","content":"Return only {\"ok\":true} as JSON."}],"response_format":{"type":"json_object"},"max_tokens":64,"temperature":0}' \
  "$CHUTES_API_BASE/chat/completions"
```
Expect HTTP 200 and body containing `"ok":true`.
- Multimodal sanity (remote image URL, still returns JSON):
```
curl -sS -H "Authorization: Bearer $CHUTES_API_KEY" -H 'Content-Type: application/json' \
  -d '{"model":"'"$CHUTES_VLM_MODEL"'","messages":[{"role":"user","content":[{"type":"text","text":"Describe the image in one JSON object with key desc"},{"type":"image_url","image_url":{"url":"https://picsum.photos/seed/scillm/256/256"}}]}],"response_format":{"type":"json_object"},"max_tokens":128,"temperature":0}' \
  "$CHUTES_API_BASE/chat/completions"
```
Expect HTTP 200 and a JSON object (e.g., `{"desc":"..."}`). If these fail (non‑200 or empty), the upstream is down; parallel_acompletions will also fail.

Packaging expectations
- `pip install scillm>=1.77.3` ships the paved helpers (`scillm.paved.*`) **and** the `chutes.middleware.*` modules they depend on. If an ImportError still occurs, upgrade or reinstall the wheel instead of patching a venv manually.
- The `openai_like` provider now accepts Bearer-only auth. Pass `api_key=` and SciLLM will project the token into the correct header (Bearer or `x-api-key`) for Chutes.

Step 07 (Knowledge) Requirements
- Preflight: `sanity_preflight(api_base=..., api_key=..., model=..., parallel=SCILLM_PREFLIGHT_PARALLEL|3, wall_time_s=SCILLM_PREFLIGHT_WALL_S|30)`
  - If Step 07 runs in an async worker, wrap it: `await asyncio.to_thread(sanity_preflight, api_base=..., api_key=..., model=..., parallel=..., wall_time_s=...)`
- On failure: return `preflight_details` (dict) to the pipeline summary.
- Runtime calls: `scillm.acompletion(..., api_key=CHUTES_API_KEY, custom_llm_provider="openai_like", response_format={"type":"json_object"})`

Simple Wrappers (scillm.paved)

For quick one-off completions without boilerplate, use the simple wrappers:

```python
from scillm.paved import chat, chat_json, analyze_image, analyze_image_json

# Text completion
answer = await chat("What is the capital of France?")

# JSON response (returns parsed dict)
data = await chat_json('Return {"name": "Alice", "age": 25}')

# Image analysis
desc = await analyze_image("https://example.com/photo.jpg", "Describe this")

# Image + JSON
data = await analyze_image_json("receipt.jpg", 'Extract {"total": number}')
```

These wrappers use OpenRouter by default (set `OPENROUTER_API_KEY`). Override with `model=`, `api_base=`, `api_key=` parameters.

For batch processing (many items), use `parallel_acompletions_iter` directly.

Skills for AI Agents

scillm bundles skills that can be installed into projects for use by Claude Code, Codex, Gemini, etc.

```bash
# List available skills
python -m scillm.skills list

# Install all skills to .skills/ (agent-agnostic location)
python -m scillm.skills install --all

# Install to specific location
python -m scillm.skills install --all --target .claude/skills
```

Skills are COPIED, not symlinked. Re-run install to update.

Current skills:
- `certainly-prover`: Lean4 theorem proving via scillm
- `scillm-completions`: LLM completions (text, JSON, vision, batch)

Allowed Surfaces (CHUTES / OpenAI‑compatible)
- `scillm.acompletion / scillm.completion`
- `scillm.paved.chat / chat_json / analyze_image / analyze_image_json` (simple wrappers)
- `scillm.paved.sanity_preflight / list_models_openai_like / chutes_chat_json / chutes_router_json`
- `scillm.Router` (lightweight passthrough; do not wrap)

Enforcement (Grep Guards)
- These patterns must not appear in DevOps code:
  - `extra_headers={.*Authorization.*}` or `extra_headers={.*x-api-key.*}`
  - `requests.(get|post)\(.*chat/completions` or `urllib.request.*chat/completions`
  - Raw `curl … /chat/completions` in executable code (allowed in docs)

Quick Self‑Check
- Allowed example:
  ```python
  from scillm import acompletion
  r = await acompletion(model=os.environ['CHUTES_TEXT_MODEL'],
                        api_base=os.environ['CHUTES_API_BASE'],
                        api_key=os.environ['CHUTES_API_KEY'],
                        custom_llm_provider='openai_like',
                        messages=[{"role":"user","content":"Return only {\\"ok\\":true} as JSON."}],
                        response_format={'type':'json_object'},
                        timeout=30)
  ```
- Disallowed example:
  ```python
  # ❌ manual headers and raw HTTP
  requests.post(f"{base}/chat/completions", headers={"Authorization": f"Bearer {key}"}, json=payload)
  ```

CI / PR Review Guidance
- If touching DevOps code, reviewers should run:
  - `rg -n "extra_headers=|Authorization|x-api-key|/chat/completions|requests\.(get|post)\(" experiments/devops -g '!**/.venv/**'`
- Reject any occurrence in code (docs are fine) and request migration to the paved helpers above.

Exceptions
- None for CHUTES/SciLLM. If a true exception is required, file a short design note and add a temporary allowlist entry to a local `EXCEPTIONS.md` with an expiration date.

Change History
- 2026‑01‑11: Added simple wrappers (chat, chat_json, analyze_image, analyze_image_json) and skills system. Skills are agent-agnostic (Claude, Codex, Gemini) and install to .skills/ by default.
- 2026‑01‑10: Added minimal runnable certainly script (copy-paste-run) with prerequisites. Documented architectural decision: scillm as main caller, certainly_min CLI for debugging only.
- 2026‑01‑03: Reinforced canonical surfaces, JSON strict guidance, iterator JSON repair parity, and Certainly/Lean4 paved‑path examples.
- 2025‑11‑09: Initial version. Codified paved helpers and strict “no manual headers / no raw HTTP” policy for DevOps.
- 2025‑11‑10: Documented bundled middleware + Bearer-only provider so DevOps doesn’t patch venvs manually.
- 2025‑12‑19: Clarified `parallel_acompletions` request shape and progress-friendly `batch_acompletions_iter` example.
- 2025‑12‑31: Added Certainly/Lean4 signature, primary results path, and clarified item/flags usage.
