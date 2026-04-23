from __future__ import annotations

import re
import unicodedata
import logging

logger = logging.getLogger(__name__)

# ── Myers diff ────────────────────────────────────────────────────────────────
try:
    from diff_match_patch import diff_match_patch as _DMP
    _dmp = _DMP()
    _dmp.Diff_Timeout = 0
    _dmp.Diff_EditCost = 6
    _HAS_DMP = True
except ImportError:
    _HAS_DMP = False

# ── Rapidfuzz ─────────────────────────────────────────────────────────────────
try:
    from rapidfuzz.distance import Levenshtein as _Lev
    def _char_ratio(a: str, b: str) -> float:
        m = max(len(a), len(b))
        return 1.0 if m == 0 else 1.0 - (_Lev.distance(a, b) / m)
except ImportError:
    import difflib
    def _char_ratio(a: str, b: str) -> float:
        return difflib.SequenceMatcher(None, a, b).ratio()

# ── Regex ─────────────────────────────────────────────────────────────────────
_LIGATURE = str.maketrans({
    "\ufb00": "ff", "\ufb01": "fi", "\ufb02": "fl",
    "\ufb03": "ffi", "\ufb04": "ffl",
    "\u00ad": "", "\u00a0": " ",
    "\u2019": "'", "\u2018": "'",
    "\u201c": '"', "\u201d": '"',
    "\u2013": "-", "\u2014": "-",
    "\u2026": "...",
})

_RE_HYPHEN_BREAK = re.compile(r"-\s*\n\s*")
_RE_WHITESPACE = re.compile(r"\s+")
_RE_SPLIT_WORDS = re.compile(r"\s+")
_RE_STRIP_PUNCT = re.compile(r"^[^\w]+|[^\w]+$")
_SENT_SPLIT = re.compile(r'(?<=[.!?])\s+')

# ── Normalisation ─────────────────────────────────────────────────────────────
def _pre_normalise_layout(text: str) -> str:
    text = re.sub(r'(?<!\.)\n(?!\n)', ' ', text)
    text = re.sub(r'\n+', '\n', text)
    return text

def _normalise(text: str) -> str:
    text = _pre_normalise_layout(text)
    text = unicodedata.normalize("NFKC", text).translate(_LIGATURE)
    text = _RE_HYPHEN_BREAK.sub("", text)
    text = _RE_WHITESPACE.sub(" ", text).strip()
    return text

def _tokenise(text: str):
    norm = _normalise(text)
    raw = _RE_SPLIT_WORDS.split(norm)

    tokens = []
    for tok in raw:
        cleaned = _RE_STRIP_PUNCT.sub("", tok)
        if not cleaned:
            continue
        if not any(c.isalnum() for c in cleaned):
            continue

        tokens.append((cleaned, cleaned.lower()))

    return tokens

# ── Myers diff ────────────────────────────────────────────────────────────────
def _myers_word_diff(old_tokens, new_tokens):
    if not _HAS_DMP:
        import difflib
        matcher = difflib.SequenceMatcher(None, old_tokens, new_tokens)
        result = []
        for op, i1, i2, j1, j2 in matcher.get_opcodes():
            if op == "equal":
                result.append((0, old_tokens[i1:i2]))
            elif op == "delete":
                result.append((-1, old_tokens[i1:i2]))
            elif op == "insert":
                result.append((1, new_tokens[j1:j2]))
            else:
                result.append((-1, old_tokens[i1:i2]))
                result.append((1, new_tokens[j1:j2]))
        return result

    token_map = {}
    reverse = [""]

    def encode(tokens):
        out = []
        for t in tokens:
            key = t[1]
            if key not in token_map:
                c = chr(0xE000 + len(reverse))
                token_map[key] = c
                reverse.append(key)
            out.append(token_map[key])
        return "".join(out)

    old_enc = encode(old_tokens)
    new_enc = encode(new_tokens)

    diffs = _dmp.diff_main(old_enc, new_enc, False)
    _dmp.diff_cleanupSemantic(diffs)

    result = []
    for op, chars in diffs:
        toks = [reverse[ord(c) - 0xE000] for c in chars if ord(c) >= 0xE000]
        result.append((op, toks))
    return result

# ── Smart pairing ─────────────────────────────────────────────────────────────
def _pair_tokens(del_list, ins_list, additions, removals, modifications):
    used = set()

    for ow in del_list:
        best_idx = -1
        best_ratio = 0

        for i, nw in enumerate(ins_list):
            if i in used:
                continue
            r = _char_ratio(ow, nw)
            if r > best_ratio:
                best_ratio = r
                best_idx = i

        if best_ratio >= 0.75:
            nw = ins_list[best_idx]

            typ = "emphasis" if ow.lower() == nw.lower() and ow != nw else "modification"

            modifications.append({
                "old": ow,
                "new": nw,
                "ratio": round(best_ratio, 3),
                "type": typ
            })
            used.add(best_idx)
        else:
            removals.append(ow)

    for i, nw in enumerate(ins_list):
        if i not in used:
            additions.append(nw)

# ── Word compare ──────────────────────────────────────────────────────────────
def compare_words(old_text: str, new_text: str):
    old_tokens = _tokenise(old_text)
    new_tokens = _tokenise(new_text)

    diffs = _myers_word_diff(old_tokens, new_tokens)

    additions, removals, modifications = [], [], []
    equal = 0

    pending_del, pending_ins = [], []

    def flush():
        if pending_del or pending_ins:
            _pair_tokens(pending_del, pending_ins, additions, removals, modifications)
            pending_del.clear()
            pending_ins.clear()

    for op, toks in diffs:
        if op == 0:
            flush()
            equal += len(toks)
        elif op == -1:
            pending_del.extend(toks)
        else:
            pending_ins.extend(toks)

    flush()

    total = max(len(old_tokens), len(new_tokens), 1)
    changed = len(additions) + len(removals) + len(modifications)

    return {
        "has_changes": changed > 0,
        "old_word_count": len(old_tokens),
        "new_word_count": len(new_tokens),
        "common_words": equal,
        "additions": additions,
        "removals": removals,
        "modifications": modifications,
        "summary": {
            "addition": len(additions),
            "removal": len(removals),
            "modification": len(modifications),
        },
        "change_ratio": round(changed / total, 4),
    }

# ─────────────────────────────────────────────────────────────
# ✅ ADD THIS FUNCTION HERE (IMPORTANT FIX)
# ─────────────────────────────────────────────────────────────

def chunk_has_real_changes(
    old_text: str,
    new_text: str,
    change_ratio_threshold: float = 0.01,
    min_changed_words: int = 1,
):
    """
    Returns:
        (bool, dict)
    """
    result = compare_words(old_text, new_text)

    changed_words = (
        result["summary"]["addition"]
        + result["summary"]["removal"]
        + result["summary"]["modification"]
    )

    meaningful = (
        result.get("change_ratio", 0) > change_ratio_threshold
        or changed_words >= min_changed_words
    )

    return meaningful, result

# ── Sentence alignment ────────────────────────────────────────────────────────
def _split_sentences(text: str):
    text = _normalise(text)
    return [s.strip() for s in _SENT_SPLIT.split(text) if s.strip()]

def align_sentences(old_text: str, new_text: str):
    old_s = _split_sentences(old_text)
    new_s = _split_sentences(new_text)

    aligned = []
    used = set()

    for o in old_s:
        best_i, best_r = -1, 0
        for i, n in enumerate(new_s):
            if i in used:
                continue
            r = _char_ratio(o, n)
            if r > best_r:
                best_i, best_r = i, r

        if best_r >= 0.6:
            aligned.append((o, new_s[best_i], best_r))
            used.add(best_i)
        else:
            aligned.append((o, "", 0))

    for i, n in enumerate(new_s):
        if i not in used:
            aligned.append(("", n, 0))

    return aligned

# ── Git-style inline diff ─────────────────────────────────────────────────────
def build_git_inline_diff(old_text: str, new_text: str):
    old_tokens = [t[0] for t in _tokenise(old_text)]
    new_tokens = [t[0] for t in _tokenise(new_text)]

    diffs = _myers_word_diff(
        [(w, w.lower()) for w in old_tokens],
        [(w, w.lower()) for w in new_tokens]
    )

    result = []
    for op, toks in diffs:
        for t in toks:
            if op == 0:
                result.append({"type": "equal", "value": t})
            elif op == -1:
                result.append({"type": "delete", "value": t})
            else:
                result.append({"type": "insert", "value": t})
    return result

# ── Full document compare ─────────────────────────────────────────────────────
def compare_document(old_text: str, new_text: str):
    aligned = align_sentences(old_text, new_text)

    output = []
    for old_s, new_s, score in aligned:
        word_diff = compare_words(old_s, new_s)
        inline = build_git_inline_diff(old_s, new_s)

        output.append({
            "old": old_s,
            "new": new_s,
            "similarity": round(score, 3),
            "word_diff": word_diff,
            "inline_diff": inline
        })

    return output