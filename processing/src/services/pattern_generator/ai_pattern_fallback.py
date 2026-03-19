"""
ai_pattern_fallback.py
----------------------
AI-powered level-pattern inference using Google Gemini Flash (free tier).

Called ONLY when rule-based inference in pattern_generator.py returns the
generic catch-all [^.*$] — meaning the rules gave up. This keeps AI usage
minimal so the free rate limit (500 req/day) lasts.

Setup
-----
1. Get a free API key at https://aistudio.google.com/app/apikey
2. Set env var:  GEMINI_API_KEY=your_key_here
   Or add to your .env file.

Usage (called automatically by generate_level_patterns):
    from .ai_pattern_fallback import ai_infer_patterns
    patterns = ai_infer_patterns(definition, examples, level, language)

Returns [] on any failure — caller falls back to existing defaults.
"""

from __future__ import annotations

import json
import logging
import os
import re
import time
from functools import lru_cache

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

_API_KEY = os.environ.get("GEMINI_API_KEY", "")
_MODEL   = "gemini-2.5-flash"   # current free-tier model (2026)
_URL     = f"https://generativelanguage.googleapis.com/v1beta/models/{_MODEL}:generateContent"
_TIMEOUT     = 15         # seconds per request
_MAX_RETRIES = 3          # retries on 429 rate limit
_RETRY_DELAY = 4          # seconds between retries (429 = slow down)
_CALL_DELAY  = 1          # seconds between every call (avoid burst 429s)
_CACHE_SIZE  = 512        # LRU cache entries

# ---------------------------------------------------------------------------
# Prompt
# ---------------------------------------------------------------------------

_SYSTEM = """\
You are a regex pattern generator for legal document identifiers.
Given a level's definition and example identifiers, output a JSON array of
Python-compatible regex strings that match those identifiers.

Rules:
- Output ONLY a valid JSON array, no prose, no markdown fences.
- Each pattern must be a valid Python regex string.
- Prefer anchored patterns (^ and $) when the identifier format is fixed.
- Use the minimum number of patterns needed (usually 1-3).
- Common formats: paren-number (\\([0-9]+\\)), paren-roman (\\([ivxlcdm]+\\)),
  bare number ([0-9]+$), bare letter ([a-z]+$), section-sign (^§\\s*[0-9]+\\.[0-9]+$).
- If unsure, return ["^.*$"] as a safe catch-all.

Example input:
  Level: 9, Language: English
  Definition: Parenthetical lowercase letter (a), (b), (c)
  Examples: ["(a)", "(b)", "(c)"]

Example output:
  ["^\\\\([a-z]+\\\\)$"]
"""

def _build_prompt(definition: str, examples: list[str], level: int, language: str) -> str:
    ex_str = json.dumps(examples[:6])  # cap examples to keep prompt short
    return (
        f"Level: {level}, Language: {language}\n"
        f"Definition: {definition or '(none)'}\n"
        f"Examples: {ex_str}\n\n"
        "Return a JSON array of regex patterns."
    )

# ---------------------------------------------------------------------------
# Cache key
# ---------------------------------------------------------------------------

def _cache_key(definition: str, examples: list[str], level: int, language: str) -> str:
    ex_norm = "|".join(sorted(set(str(e).strip() for e in examples[:6])))
    defn_norm = re.sub(r"\s+", " ", (definition or "").strip().lower())[:120]
    return f"{language}:{level}:{defn_norm}:{ex_norm}"

# ---------------------------------------------------------------------------
# Simple in-process LRU cache (avoids repeated API calls for same input)
# ---------------------------------------------------------------------------

_cache: dict[str, list[str]] = {}

def _cache_get(key: str) -> list[str] | None:
    return _cache.get(key)

def _cache_set(key: str, value: list[str]) -> None:
    if len(_cache) >= _CACHE_SIZE:
        # Evict oldest entry
        oldest = next(iter(_cache))
        del _cache[oldest]
    _cache[key] = value

# ---------------------------------------------------------------------------
# HTTP call
# ---------------------------------------------------------------------------

def _call_gemini(prompt: str) -> str | None:
    """Call Gemini API, return raw text or None on failure."""
    if not _API_KEY:
        logger.debug("ai_pattern_fallback: GEMINI_API_KEY not set, skipping AI inference")
        return None

    try:
        import urllib.request
        import urllib.error

        payload = json.dumps({
            "system_instruction": {"parts": [{"text": _SYSTEM}]},
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {
                "temperature": 0.1,     # near-deterministic
                "maxOutputTokens": 512,
            },
        }).encode()

        req = urllib.request.Request(
            f"{_URL}?key={_API_KEY}",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        # Small delay between every call to avoid burst rate limiting
        time.sleep(_CALL_DELAY)

        for attempt in range(_MAX_RETRIES + 1):
            try:
                with urllib.request.urlopen(req, timeout=_TIMEOUT) as resp:
                    body = json.loads(resp.read())
                    return (
                        body.get("candidates", [{}])[0]
                            .get("content", {})
                            .get("parts", [{}])[0]
                            .get("text", "")
                    )
            except urllib.error.HTTPError as e:
                if e.code == 429 and attempt < _MAX_RETRIES:
                    wait = _RETRY_DELAY * (attempt + 1)
                    logger.info(
                        "ai_pattern_fallback: rate limited (429), retrying in %ss (attempt %s/%s)",
                        wait, attempt + 1, _MAX_RETRIES
                    )
                    time.sleep(wait)
                    continue
                logger.warning("ai_pattern_fallback: HTTP %s from Gemini", e.code)
                return None
            except Exception as e:
                logger.warning("ai_pattern_fallback: request error: %s", e)
                return None

    except Exception as e:
        logger.warning("ai_pattern_fallback: unexpected error: %s", e)
        return None

# ---------------------------------------------------------------------------
# Parse + validate response
# ---------------------------------------------------------------------------

def _parse_patterns(raw: str) -> list[str]:
    """Extract and validate regex patterns from Gemini's response."""
    if not raw:
        return []

    text = raw.strip()

    # Strip markdown fences if model adds them despite instructions
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.MULTILINE)
    text = re.sub(r"\s*```$", "", text, flags=re.MULTILINE)
    text = text.strip()

    # Find JSON array anywhere in the response
    m = re.search(r"\[.*\]", text, re.DOTALL)
    if not m:
        # Check if response looks truncated (ends mid-string)
        if text.endswith(("'", '"', '\\')) or not text.endswith("]"):
            logger.warning("ai_pattern_fallback: response truncated (increase maxOutputTokens): %r", text[:120])
        else:
            logger.warning("ai_pattern_fallback: no JSON array in response: %r", text[:120])
        return []

    try:
        patterns = json.loads(m.group(0))
    except json.JSONDecodeError as e:
        logger.warning("ai_pattern_fallback: JSON parse failed (%s): %r", e, text[:120])
        return []

    if not isinstance(patterns, list):
        return []

    # Validate each pattern is a compilable regex
    valid: list[str] = []
    for p in patterns:
        if not isinstance(p, str) or not p.strip():
            continue
        try:
            re.compile(p)
            valid.append(p)
        except re.error:
            logger.warning("ai_pattern_fallback: invalid regex from AI: %r", p)

    return valid

# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def ai_infer_patterns(
    definition: str,
    examples: list[str],
    level: int,
    language: str,
) -> list[str]:
    """
    Use Gemini to infer level patterns when rule-based inference gives up.

    Returns a list of regex strings, or [] if AI is unavailable / fails.
    Never raises — all errors are caught and logged.
    """
    # Skip if no key configured
    if not _API_KEY:
        return []

    # Skip if there's genuinely nothing to work with
    has_definition = bool((definition or "").strip())
    has_examples   = bool(examples)
    if not has_definition and not has_examples:
        return []

    # Cache check
    key = _cache_key(definition, examples, level, language)
    cached = _cache_get(key)
    if cached is not None:
        logger.debug("ai_pattern_fallback: cache hit for L%s", level)
        return cached

    prompt = _build_prompt(definition, examples, level, language)
    raw = _call_gemini(prompt)
    patterns = _parse_patterns(raw) if raw else []

    # Safety: reject bare catch-all from AI (not useful)
    if patterns == [r"^.*$"]:
        patterns = []

    # Cache result (even empty, to avoid re-calling for known-hopeless inputs)
    _cache_set(key, patterns)

    if patterns:
        logger.info(
            "ai_pattern_fallback: L%s %s → %s",
            level, language, patterns
        )

    return patterns