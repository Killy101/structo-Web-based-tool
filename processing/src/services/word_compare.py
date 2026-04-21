"""
word_compare.py — Word-level document comparison service.

Pipeline
────────
1. Extract words from OLD text and NEW text (tokenise + normalise)
2. If word counts are identical and normalised word sets match → NO CHANGES
3. If word counts differ or sets differ → run word-level SequenceMatcher
4. Classify each differing word as addition / removal / modification
5. Return structured result with per-word changes and summary counts

This is used as the ground-truth comparison layer during /start-chunking.
It is fast (pure Python, no PDF I/O) and operates on pre-extracted text.
"""

from __future__ import annotations

import re
import difflib
import unicodedata
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# ── Optional diff-match-patch for more accurate word-level diffs ───────────────
try:
    from diff_match_patch import diff_match_patch as _DiffMatchPatch
    _dmp = _DiffMatchPatch()
    _USE_DMP = True
except ImportError:
    _USE_DMP = False

# Named thresholds (previously magic literals scattered through the code)
_WORD_MOD_THRESHOLD    = 0.70   # min char-similarity to call a replacement a "modification"
_COSMETIC_MOD_THRESHOLD = 0.95  # above this the modification is cosmetic (punct/spacing only)

# ── Normalisation ──────────────────────────────────────────────────────────────

_LIGATURE = str.maketrans({
    "\ufb00": "ff", "\ufb01": "fi", "\ufb02": "fl",
    "\ufb03": "ffi", "\ufb04": "ffl",
    "\u00ad": "",    # soft hyphen
    "\u00a0": " ",   # NBSP
    "\u2019": "'", "\u2018": "'",
    "\u201c": '"',  "\u201d": '"',
    "\u2013": "-",  "\u2014": "-",  "\u2012": "-",
    "\u2015": "-",  "\u2212": "-",
    "\u2026": "...",
    "\u2022": "",   # bullet → remove
    "\u00b7": "",
})

def _normalise(text: str) -> str:
    """NFKC + ligature fix + collapse whitespace + lowercase."""
    text = unicodedata.normalize("NFKC", text).translate(_LIGATURE)
    # Remove soft-hyphen line-break artifacts
    text = re.sub(r"-\s*\n\s*", "", text)
    return " ".join(text.split()).lower()


def _tokenise(text: str) -> list[str]:
    """
    Split normalised text into a list of word tokens.

    Rules:
    - Keep hyphenated words whole ("re-enact" → one token)
    - Drop pure punctuation-only tokens
    - Drop numeric-only tokens that look like page/footnote numbers (≤4 digits)
    - Keep section numbers like "2.1" or "12A"
    """
    norm = _normalise(text)
    raw = re.split(r"\s+", norm)
    tokens: list[str] = []
    for tok in raw:
        # Strip surrounding punctuation (but keep internal hyphens)
        cleaned = tok.strip(".,;:!?\"'()[]{}|\\/<>")
        if not cleaned:
            continue
        # Drop bare page/footnote numbers (1–4 digit standalone numbers)
        if re.fullmatch(r"\d{1,4}", cleaned):
            continue
        # Drop tokens that are purely non-alphanumeric
        if not re.search(r"[a-z0-9]", cleaned):
            continue
        tokens.append(cleaned)
    return tokens


# ── Main comparison ────────────────────────────────────────────────────────────

def compare_words(
    old_text: str,
    new_text: str,
    min_word_len: int = 2,
) -> dict:
    """
    Compare two text strings at the word level.

    Returns
    -------
    {
        "has_changes":   bool,
        "old_word_count": int,
        "new_word_count": int,
        "common_words":   int,    # words present in both (by value)
        "additions":      list[str],   # words only in new
        "removals":       list[str],   # words only in old
        "modifications":  list[dict],  # {"old": str, "new": str, "ratio": float}
        "summary": {
            "addition":     int,
            "removal":      int,
            "modification": int,
        },
        "change_ratio":  float,   # 0.0 = identical, 1.0 = completely different
    }
    """
    old_tokens = _tokenise(old_text)
    new_tokens = _tokenise(new_text)

    old_count = len(old_tokens)
    new_count = len(new_tokens)

    # ── Trivial case: both empty ───────────────────────────────────────────────
    if old_count == 0 and new_count == 0:
        return _no_changes(0, 0)

    # ── Sequence diff ─────────────────────────────────────────────────────────
    # NOTE: We deliberately do NOT use a bag-of-words fast path here.
    # "Same words, same counts" does NOT mean "no changes" — words can be
    # reordered, sentences restructured, or cross-references renumbered.
    # The sequence diff catches all of these correctly.
    matcher = difflib.SequenceMatcher(
        lambda w: len(w) < min_word_len,
        old_tokens,
        new_tokens,
        autojunk=False,
    )

    additions:     list[str]  = []
    removals:      list[str]  = []
    modifications: list[dict] = []
    equal_count = 0

    for op, i1, i2, j1, j2 in matcher.get_opcodes():
        if op == "equal":
            equal_count += (i2 - i1)

        elif op == "insert":
            additions.extend(new_tokens[j1:j2])

        elif op == "delete":
            removals.extend(old_tokens[i1:i2])

        elif op == "replace":
            old_block = old_tokens[i1:i2]
            new_block = new_tokens[j1:j2]
            paired = min(len(old_block), len(new_block))

            for k in range(paired):
                ow, nw = old_block[k], new_block[k]
                ratio = difflib.SequenceMatcher(None, ow, nw).ratio()
                if ratio >= _WORD_MOD_THRESHOLD:
                    modifications.append({"old": ow, "new": nw, "ratio": round(ratio, 3)})
                else:
                    # Too different → treat as separate add + remove
                    removals.append(ow)
                    additions.append(nw)

            # Leftover unpaired words
            removals.extend(old_block[paired:])
            additions.extend(new_block[paired:])

    total_words = max(old_count, new_count) or 1
    changed_words = len(additions) + len(removals) + len(modifications)
    change_ratio = round(changed_words / total_words, 4)

    has_changes = (len(additions) + len(removals) + len(modifications)) > 0

    return {
        "has_changes":    has_changes,
        "old_word_count": old_count,
        "new_word_count": new_count,
        "common_words":   equal_count,
        "additions":      additions,
        "removals":       removals,
        "modifications":  modifications,
        "summary": {
            "addition":     len(additions),
            "removal":      len(removals),
            "modification": len(modifications),
        },
        "change_ratio": change_ratio,
    }


def _bag(tokens: list[str]) -> dict[str, int]:
    """Count occurrences of each token."""
    bag: dict[str, int] = {}
    for t in tokens:
        bag[t] = bag.get(t, 0) + 1
    return bag


def _no_changes(old_count: int, new_count: int) -> dict:
    return {
        "has_changes":    False,
        "old_word_count": old_count,
        "new_word_count": new_count,
        "common_words":   old_count,
        "additions":      [],
        "removals":       [],
        "modifications":  [],
        "summary":        {"addition": 0, "removal": 0, "modification": 0},
        "change_ratio":   0.0,
    }


# ── Chunk-level helper ─────────────────────────────────────────────────────────

def chunk_has_real_changes(
    old_text: str,
    new_text: str,
    change_ratio_threshold: float = 0.006,
    min_changed_words: int = 1,
) -> tuple[bool, dict]:
    """
    Word-level noise filter — used AFTER span detection, not before.

    Returns (has_meaningful_word_changes, word_diff_result).

    Conservative noise suppression:
      • Suppress ONLY when change_ratio < 0.6% AND fewer than 1 word changed.
      • Suppress purely cosmetic modifications (ratio ≥ 0.95, e.g. hyphen vs
        en-dash, non-breaking space) with zero additions/removals.

    Lowered thresholds vs previous version so single real word substitutions
    (e.g. "offices" → "employers") are never silently dropped.  The authority
    for noise suppression at the line level belongs to the /detect-chunk diff
    which uses char-ratio guards.
    """
    result = compare_words(old_text, new_text)

    changed_word_count = (
        result["summary"]["addition"]
        + result["summary"]["removal"]
        + result["summary"]["modification"]
    )

    # Extra guard: ONLY cosmetic modifications (very high char-similarity) →
    # treat as noise (e.g. hyphen vs en-dash, NBSP vs space, smart quotes).
    # Raise ratio threshold from 0.92 → 0.95 so near-identical words like
    # "organisation" vs "organization" are still flagged as real changes.
    only_cosmetic_mods = (
        changed_word_count > 0
        and result["summary"]["addition"] == 0
        and result["summary"]["removal"] == 0
        and all(m["ratio"] >= _COSMETIC_MOD_THRESHOLD for m in result["modifications"])
    )
    if only_cosmetic_mods:
        return False, result

    meaningful = (
        result["has_changes"]
        and (changed_word_count >= min_changed_words
             or result["change_ratio"] >= change_ratio_threshold)
    )

    return meaningful, result

# ── Inline diff builder ────────────────────────────────────────────────────────

def build_inline_diff(old_text: str, new_text: str) -> list[dict]:
    """
    Build a token-level inline diff between old_text and new_text.

    Returns a list of { "op": "eq"|"del"|"ins", "text": str } dicts
    in display order, using the ORIGINAL (un-normalised) token text so
    the frontend can render them verbatim.

    Matching uses normalised tokens (ligature-fixed, lowercased, punct-
    stripped) so:
      - "offices,"  == "offices"  → rendered as equal (comma is noise)
      - "organisation" != "Organization" → del+ins  (genuinely different)
      - smart-quote vs straight-quote → equal (ligature normalisation)

    Whitespace gaps between tokens are emitted as op="eq" so spacing is
    preserved faithfully in the rendered output.
    """
    # ── tokenise preserving original surface form ────────────────────────
    def _split_with_gaps(text: str):
        """
        Split text into alternating (non-ws, ws) segments.
        Returns list of (original_str, is_whitespace).
        """
        parts = re.split(r'(\s+)', text)
        result = []
        for p in parts:
            if not p:
                continue
            result.append((p, bool(re.fullmatch(r'\s+', p))))
        return result

    old_parts = _split_with_gaps(old_text)
    new_parts = _split_with_gaps(new_text)

    # Extract only the word tokens (not whitespace) for diffing
    old_words = [(orig, _normalise_token(orig)) for orig, ws in old_parts if not ws]
    new_words = [(orig, _normalise_token(orig)) for orig, ws in new_parts if not ws]

    # LCS on normalised tokens — use DMP for more accurate word alignment when available
    old_norms = [n for _, n in old_words]
    new_norms = [n for _, n in new_words]

    word_ops: list[tuple[str, str | None, str | None]] = []

    if _USE_DMP and old_norms and new_norms:
        # Encode each unique normalised word as a private-use unicode char so DMP
        # can perform a word-level (not character-level) Myers diff.
        word_to_char: dict[str, str] = {}
        next_cp = [0xE000]

        def _encode(norm: str) -> str:
            if norm not in word_to_char:
                word_to_char[norm] = chr(next_cp[0])
                next_cp[0] += 1
            return word_to_char[norm]

        old_enc = "".join(_encode(n) for n in old_norms)
        new_enc = "".join(_encode(n) for n in new_norms)

        diffs = _dmp.diff_main(old_enc, new_enc, False)
        _dmp.diff_cleanupSemantic(diffs)

        old_idx = new_idx = 0
        for dop, chars in diffs:
            n = len(chars)
            if dop == 0:   # equal
                for k in range(n):
                    word_ops.append(("eq", old_words[old_idx + k][0], new_words[new_idx + k][0]))
                old_idx += n; new_idx += n
            elif dop == -1:  # delete
                for k in range(n):
                    word_ops.append(("del", old_words[old_idx + k][0], None))
                old_idx += n
            elif dop == 1:   # insert
                for k in range(n):
                    word_ops.append(("ins", None, new_words[new_idx + k][0]))
                new_idx += n
    else:
        matcher = difflib.SequenceMatcher(None, old_norms, new_norms, autojunk=False)
        for op, i1, i2, j1, j2 in matcher.get_opcodes():
            if op == "equal":
                for k in range(i2 - i1):
                    word_ops.append(("eq", old_words[i1 + k][0], new_words[j1 + k][0]))
            elif op == "insert":
                for k in range(j1, j2):
                    word_ops.append(("ins", None, new_words[k][0]))
            elif op == "delete":
                for k in range(i1, i2):
                    word_ops.append(("del", old_words[k][0], None))
            elif op == "replace":
                old_block = old_words[i1:i2]
                new_block = new_words[j1:j2]
                paired = min(len(old_block), len(new_block))
                for k in range(paired):
                    word_ops.append(("del", old_block[k][0], None))
                    word_ops.append(("ins", None, new_block[k][0]))
                for k in range(paired, len(old_block)):
                    word_ops.append(("del", old_block[k][0], None))
                for k in range(paired, len(new_block)):
                    word_ops.append(("ins", None, new_block[k][0]))

    # ── Rebuild with whitespace ──────────────────────────────────────────
    # Strategy: walk new_parts in order for ins/eq, old_parts for del,
    # inserting whitespace tokens between words as they appear in source.
    # Simpler approach: just emit tokens in order with a space between each,
    # which matches how PDF text is typically displayed.
    result: list[dict] = []
    for i, (op, old_orig, new_orig) in enumerate(word_ops):
        # Add space before this token (except at start)
        if i > 0:
            result.append({"op": "eq", "text": " "})
        if op == "eq":
            result.append({"op": "eq",  "text": new_orig})   # use new surface form
        elif op == "del":
            result.append({"op": "del", "text": old_orig})
        else:  # ins
            result.append({"op": "ins", "text": new_orig})

    return result


def _normalise_token(tok: str) -> str:
    """
    Normalise a single surface token for matching:
      - NFKC + ligature table
      - lowercase
      - strip surrounding punctuation (but keep internal hyphens/apostrophes)
    Does NOT strip spelling — "organisation" and "organization" remain distinct.
    """
    t = unicodedata.normalize("NFKC", tok).translate(_LIGATURE).lower()
    # Strip surrounding punctuation chars (not internal)
    t = t.strip(".,;:!?\"'()[]{}|\\/<>\u2018\u2019\u201c\u201d")
    return t