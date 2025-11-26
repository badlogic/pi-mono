# Fix Step 06 progress logging and sanitize HTML before Readability to prevent hangs

## Repository and branch

- **Repo:** `grahama1970/devops`
- **Branch:** `fix/restore-pipeline-steps-20251031-073204`
- **Paths of interest:**
  - `sparta/pipeline/06_fetch_urls.py`
  - `fetcher/workflows/prefilters.py`
  - `fetcher/workflows/paywall_detector.py`

## Summary

Step 06 intermittently "hangs" near completion because:

1. Progress logs in `06_fetch_urls.py` are printed with literal format tokens (`%d`/`%s`), so operators can't see actual progress.
2. Readability is fed raw HTML that can contain NULL bytes (`\x00`), leading to `ValueError: All strings must be XML compatible` and preventing the JSON summary/audit from being emitted.

## Objectives

### 1. Progress logging

In `sparta/pipeline/06_fetch_urls.py`, function `_progress`:

- Replace `%d`-style or f-string interpolation with Loguru brace-format placeholders and keyword arguments so actual numbers/URLs print.
- Keep existing `EXECUTE` gating and current progress bucketing/dedup behavior.

### 2. HTML sanitization before Readability

In `fetcher/workflows/prefilters.py`:

- In `_analyze_html`, sanitize HTML once up-front (strip NULL bytes) and pass the sanitized string consistently to BeautifulSoup and `readability.Document`.

In `fetcher/workflows/paywall_detector.py`:

- In the function that computes readability text length (likely `_readability_len`), ensure `readability_text_len_robust` receives sanitized HTML (strip NULL bytes) rather than raw bodies.
- **Goal:** Eliminate crashes like `ValueError: All strings must be XML compatible` caused by `\x00`.

### 3. Step 06 completion

- Ensure the fetch run completes and prints its JSON summary/audit when executed with `EXECUTE=1 ENABLE_RESOLVER=1`.

## Constraints for the patch

- **Output format:** Unified diff only, inline inside a single fenced code block.
- Include a one-line commit subject on the first line of the patch.
- Hunk headers must be numeric only (`@@ -old,+new @@`); no symbolic headers.
- Patch must apply cleanly on branch `fix/restore-pipeline-steps-20251031-073204`.
- No destructive defaults; retain existing `EXECUTE` gating and current behavior unless explicitly required by this change.
- No extra commentary, hosted links, or PR creation in the output.

## Acceptance criteria

- Running: `EXECUTE=1 ENABLE_RESOLVER=1 uv run python sparta/pipeline/06_fetch_urls.py` completes.
- No `ValueError: All strings must be XML compatible` appears during the run (Readability always receives sanitized HTML).
- Downstream artifacts update successfully:
  - `sparta/data/processed/url_sources.jsonl`
  - Then `sparta/data/processed/url_sources_clean.jsonl` after: `make -s sources-clean`

## Test plan

**Before change** (optional): Reproduce issue by observing literal `%d`/`%s` in progress logs and occasional `ValueError` near 100%.

**After change:**

1. Run with `EXECUTE=1 ENABLE_RESOLVER=1`.
2. Verify progress logs display actual processed/total/percent and URLs.
3. Confirm the run completes and prints JSON summary.
4. Confirm artifacts exist and are updated.
5. Run `make -s sources-clean` and confirm `url_sources_clean.jsonl` is updated.

## Implementation notes

- **Logging:** Use `logger.info("msg with {placeholders}", key=value, …)` rather than f-strings; pass values as keyword args for Loguru structured logging.
- **HTML sanitization:** Minimal sanitization required is to remove NULL bytes with `s.replace("\x00", "")` before passing to BeautifulSoup and `readability.Document`/`readability_text_len_robust`. Keep everything else unchanged.
- Do not change concurrency, retries, resolver behavior, or `EXECUTE` gating.

## Known touch points

- `sparta/pipeline/06_fetch_urls.py`: `_progress`
- `fetcher/workflows/prefilters.py`: `_analyze_html`
- `fetcher/workflows/paywall_detector.py`: function that calls `readability_text_len_robust` (likely `_readability_len`)

## Clarifying questions

*Answer inline here or authorize assumptions:*

1. **Paywall detector entry point:** Please confirm the exact function name and location that wraps `readability_text_len_robust` (e.g., `_readability_len` in `fetcher/workflows/paywall_detector.py`). If not specified, I will locate `_readability_len` and sanitize its HTML input before calling `readability_text_len_robust`.

2. **HTML helper location:** Do you prefer an inline sanitizer in each file or a shared helper (e.g., `sparta/workflows/html_utils.py`)? If unspecified, I will add a tiny local sanitizer in each touched file to minimize blast radius.

3. **Additional sanitization:** Is removing only NULL bytes sufficient, or should we also strip other control chars? If unspecified, I will only remove `\x00` as requested.

4. **Progress log cadence:** Keep existing `SPARTA_STEP06_PROGRESS_STEP` behavior and progress bucketing? If unspecified, I will keep current logic and only fix formatting.

5. **Structured logging fields:** OK to include `url` and `via` (if available) as structured fields? If unspecified, I will include them as shown in the current code path.

## Deliverable

Reply with 
- a single fenced code block containing  a unified diff that meets the constraints above.
- answers to clarifying questions
