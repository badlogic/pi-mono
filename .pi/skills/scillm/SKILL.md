---
name: scillm
description: >
  LLM completions (text and VLM) via scillm/Chutes.ai. Two main patterns:
  (1) VLM for image/figure/table description,
  (2) Text for batch extraction, summarization, JSON extraction.
  Also supports Lean4 theorem proving.
allowed-tools: Bash, Read
triggers:
  - batch LLM calls
  - parallel completions
  - describe image
  - describe figure
  - describe table
  - VLM call
  - multimodal
  - prove mathematically
  - formal verification
  - Lean4 proof
  - extract JSON from
  - verify this claim
metadata:
  short-description: scillm (VLM, text batch, Lean4 proofs)
---

# scillm Tools

LLM completions via scillm/Chutes.ai (per SCILLM_PAVED_PATH_CONTRACT.md).

## Two Main Patterns

| Pattern | Tool | Model | Use Case |
|---------|------|-------|----------|
| **VLM** | `vlm.py` | `$CHUTES_VLM_MODEL` | Image/figure/table description |
| **Text** | `batch.py` | `$CHUTES_TEXT_MODEL` | Requirements extraction, summarization |

## Tools

| Tool | Purpose |
|------|---------|
| `vlm.py` | VLM (multimodal) image description |
| `batch.py` | Text LLM completions (single and batch) |
| `prove.py` | Lean4 theorem proving via certainly |

---

## vlm.py - VLM (Multimodal) Completions

### Quick Start
```bash
# Describe an image
python .agents/skills/scillm/vlm.py describe /path/to/image.png

# With custom prompt
python .agents/skills/scillm/vlm.py describe /path/to/image.png --prompt "What table headers do you see?"

# JSON output
python .agents/skills/scillm/vlm.py describe /path/to/image.png --json

# Batch describe images
python .agents/skills/scillm/vlm.py batch --input images.jsonl
```

### Commands

**Describe single image:**
```bash
python .agents/skills/scillm/vlm.py describe <image> [--prompt PROMPT] [--json] [--model MODEL]
```

**Batch describe:**
```bash
python .agents/skills/scillm/vlm.py batch \
  --input images.jsonl \
  --output results.jsonl \
  --concurrency 6
```

### Input Format (Batch)

JSONL with image paths:
```json
{"path": "/path/to/image1.png", "prompt": "Describe this table"}
{"path": "/path/to/image2.png"}
```

### Environment Variables

| Variable | Default |
|----------|---------|
| `CHUTES_VLM_MODEL` | `Qwen/Qwen3-VL-235B-A22B-Instruct` |
| `CHUTES_API_BASE` | required |
| `CHUTES_API_KEY` | required |

---

## batch.py - LLM Completions

### Quick Start
```bash
# Single completion
python .agents/skills/scillm/batch.py single "What is 2+2?"

# Single with JSON response
python .agents/skills/scillm/batch.py single "Return {answer: number}" --json

# Batch from file
python .agents/skills/scillm/batch.py batch --input prompts.jsonl --json
```

### Commands

**Single completion:**
```bash
python .agents/skills/scillm/batch.py single "Your prompt" [--json] [--model MODEL]
```

**Batch completions:**
```bash
python .agents/skills/scillm/batch.py batch \
  --input prompts.jsonl \
  --output results.jsonl \
  --json \
  --concurrency 6
```

### Input/Output Format

Input JSONL (one per line):
```json
{"prompt": "Summarize..."}
{"prompt": "Translate..."}
```

Output JSONL:
```json
{"index": 0, "content": "...", "ok": true}
{"index": 1, "error": "timeout", "status": 408}
```

### Environment Variables

| Variable | Required |
|----------|----------|
| `CHUTES_API_BASE` | Yes |
| `CHUTES_API_KEY` | Yes |
| `CHUTES_MODEL_ID` | Yes |

---

## prove.py - Lean4 Theorem Proving

### Quick Start
```bash
# Prove a claim
python .agents/skills/scillm/prove.py "Prove that n + 0 = n"

# With tactic hints
python .agents/skills/scillm/prove.py "Prove n < n + 1" --tactics omega

# Check availability
python .agents/skills/scillm/prove.py --check
```

### Commands

**Prove a claim:**
```bash
python .agents/skills/scillm/prove.py "Your claim" [--tactics simp,omega] [--timeout 120]
```

**Check if ready:**
```bash
python .agents/skills/scillm/prove.py --check
```

### Output Format

**Success:**
```json
{
  "ok": true,
  "lean4_code": "theorem add_zero (n : ℕ) : n + 0 = n := by simp",
  "compile_ms": 7406
}
```

**Failure:**
```json
{
  "ok": false,
  "diagnosis": "mathematically false",
  "suggestion": "Change to 'Prove that 2 + 2 = 4'"
}
```

### Tactic Hints

| Tactic | Use for |
|--------|---------|
| `simp` | Identities, simplification |
| `omega` | Integer arithmetic |
| `ring` | Polynomial algebra |
| `linarith` | Linear inequalities |

### Prerequisites

1. **lean_runner container** running
2. **OPENROUTER_API_KEY** set
3. **scillm[certainly]** installed

---

## Importable API (For Other Skills)

The `quick_completion` function can be imported by sibling skills:

```python
# Add scillm to path (for sibling skills)
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent / "scillm"))

from batch import quick_completion

# Simple completion
result = quick_completion("What is 2+2?")

# With JSON mode
result = quick_completion("Extract {name, age}", json_mode=True)

# With system prompt
result = quick_completion(
    prompt="Translate to French: Hello",
    system="You are a translator",
    temperature=0.3,
)
```

**Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `prompt` | str | required | User prompt |
| `model` | str | env var | Model ID |
| `json_mode` | bool | False | Request JSON response |
| `max_tokens` | int | 1024 | Max tokens |
| `temperature` | float | 0.2 | Sampling temperature |
| `timeout` | int | 30 | Request timeout (s) |
| `system` | str | None | System prompt |

---

## Python API (Direct scillm)

For more control, use scillm directly:

```python
# Single completion (for one-off calls)
from scillm import acompletion

resp = await acompletion(model=..., messages=[...], api_base=..., api_key=...)

# Batch completions (for parallel processing)
from scillm import parallel_acompletions

reqs = [{"model": MODEL, "messages": [...]}]
results = await parallel_acompletions(reqs, api_base=..., api_key=...)

# Lean4 proofs
from scillm.integrations.certainly import prove_requirement

result = await prove_requirement("Prove n + 0 = n", tactics=["simp"])
```

See SCILLM_PAVED_PATH_CONTRACT.md for full reference.
