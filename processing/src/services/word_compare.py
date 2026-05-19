from __future__ import annotations

import re
import unicodedata

try:
    from diff_match_patch import diff_match_patch as _DMP
    _dmp = _DMP()
    _dmp.Diff_Timeout = 0
    _dmp.Diff_EditCost = 6
    _HAS_DMP = True
except ImportError:
    _HAS_DMP = False

try:
    from rapidfuzz.distance import Levenshtein as _Lev
    def _char_ratio(a: str, b: str) -> float:
        m = max(len(a), len(b))
        return 1.0 if m == 0 else 1.0 - (_Lev.distance(a, b) / m)
except ImportError:
    import difflib
    def _char_ratio(a: str, b: str) -> float:
        return difflib.SequenceMatcher(None, a, b).ratio()

_LIGATURE = str.maketrans({
    "\ufb00": "ff", "\ufb01": "fi", "\ufb02": "fl",
    "\ufb03": "ffi", "\ufb04": "ffl",
    "\u00ad": "", "\u00a0": " ",
    "\u2019": "'", "\u2018": "'",
    "\u201c": '"', "\u201d": '"',
    "\u2013": "-", "\u2014": "-",
    "\u2026": "...",
})

_RE_HYPHEN_BREAK  = re.compile(r"-\s*\n\s*")
_RE_WHITESPACE    = re.compile(r"\s+")
_RE_SPLIT_WORDS   = re.compile(r"\s+")

_MAX_TOKENS = 40_000
_RE_STRIP_PUNCT   = re.compile(r"^[^\w]+|[^\w]+$")

# Legal-aware sentence splitter: handles .!?  and also ;/:  followed by a
# capital letter or opening parenthesis (common in regulatory provisions).
_SENT_SPLIT = re.compile(r'(?<=[.!?])\s+|(?<=[;:])\s+(?=[A-Z\(])')

# Sentence alignment thresholds
_SENT_MATCH_THRESHOLD    = 0.75
_SENT_LENGTH_RATIO_FLOOR = 0.30   # word-count ratio (not char ratio)


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
    raw  = _RE_SPLIT_WORDS.split(norm)

    tokens = []
    for tok in raw:
        if len(tokens) >= _MAX_TOKENS:
            break
        cleaned = _RE_STRIP_PUNCT.sub("", tok)
        if not cleaned:
            continue
        if not any(c.isalnum() for c in cleaned):
            continue
        tokens.append((cleaned, cleaned.lower()))

    return tokens


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
    reverse   = [""]

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


def _pair_tokens(del_list, ins_list, additions, removals, modifications):
    used = set()

    for ow in del_list:
        best_idx   = -1
        best_ratio = 0

        for i, nw in enumerate(ins_list):
            if i in used:
                continue
            r = _char_ratio(ow, nw)
            if r > best_ratio:
                best_ratio = r
                best_idx   = i

        if best_ratio >= 0.75:
            nw  = ins_list[best_idx]
            typ = "emphasis" if ow.lower() == nw.lower() and ow != nw else "modification"
            modifications.append({
                "old":   ow,
                "new":   nw,
                "ratio": round(best_ratio, 3),
                "type":  typ,
            })
            used.add(best_idx)
        else:
            removals.append(ow)

    for i, nw in enumerate(ins_list):
        if i not in used:
            additions.append(nw)


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

    total   = max(len(old_tokens), len(new_tokens), 1)
    changed = len(additions) + len(removals) + len(modifications)

    return {
        "has_changes":    changed > 0,
        "old_word_count": len(old_tokens),
        "new_word_count": len(new_tokens),
        "common_words":   equal,
        "additions":      additions,
        "removals":       removals,
        "modifications":  modifications,
        "summary": {
            "addition":     len(additions),
            "removal":      len(removals),
            "modification": len(modifications),
        },
        "change_ratio": round(changed / total, 4),
    }


def chunk_has_real_changes(
    old_text: str,
    new_text: str,
    change_ratio_threshold: float = 0.03,
    min_changed_words: int = 2,
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


def _split_sentences(text: str) -> list[str]:
    """
    Split normalised text into sentences using a legal-aware splitter.
    Handles .!? and also ;/: followed by a capital letter or parenthesis,
    which is common in regulatory provisions.
    """
    text = _normalise(text)
    return [s.strip() for s in _SENT_SPLIT.split(text) if s.strip()]


def _word_count(s: str) -> int:
    """Count words in a string."""
    return len(_RE_SPLIT_WORDS.split(s.strip()))


def align_sentences(old_text: str, new_text: str) -> list[tuple[str, str, float]]:
    """
    Align sentences between old and new text using global optimal matching
    (Hungarian algorithm via scipy, falling back to greedy if unavailable).

    Improvements over the original:
    - Uses scipy.optimize.linear_sum_assignment for global optimal pairing
      instead of greedy first-best, which prevented better matches later in
      the sequence from being found.
    - Length ratio guard uses WORD count (not character count) to be
      resilient to punctuation differences.
    - Legal-aware sentence splitter includes ;/: boundaries.
    """
    old_s = _split_sentences(old_text)
    new_s = _split_sentences(new_text)

    if not old_s and not new_s:
        return []
    if not old_s:
        return [("", n, 0.0) for n in new_s]
    if not new_s:
        return [(o, "", 0.0) for o in old_s]

    m, n = len(old_s), len(new_s)

    # Build similarity matrix
    sim_matrix: list[list[float]] = [[0.0] * n for _ in range(m)]
    for i, o in enumerate(old_s):
        wo = _word_count(o)
        for j, ns in enumerate(new_s):
            wn = _word_count(ns)
            # Word-count length ratio guard (not character ratio)
            wlen_ratio = min(wo, wn) / max(wo, wn, 1)
            if wlen_ratio < _SENT_LENGTH_RATIO_FLOOR:
                continue
            r = _char_ratio(o, ns)
            if r >= _SENT_MATCH_THRESHOLD:
                sim_matrix[i][j] = r

    # Try global optimal matching via scipy.
    # scipy.optimize.linear_sum_assignment accepts a plain Python list-of-lists;
    # numpy is NOT required, which keeps this module dependency-light.
    try:
        from scipy.optimize import linear_sum_assignment  # type: ignore[import-not-found]

        # Build square cost matrix (cost = 1 - similarity, padded with 1.0)
        size = max(m, n)
        cost: list[list[float]] = [[1.0] * size for _ in range(size)]
        for i in range(m):
            for j in range(n):
                if sim_matrix[i][j] > 0:
                    cost[i][j] = 1.0 - sim_matrix[i][j]

        row_ind, col_ind = linear_sum_assignment(cost)
        assignments: dict[int, int] = {}
        used_new: set[int] = set()
        for ri, ci in zip(row_ind, col_ind):
            if ri < m and ci < n and cost[ri][ci] < 1.0:
                assignments[ri] = ci
                used_new.add(ci)

    except Exception:
        # Fallback: greedy matching (original approach)
        assignments = {}
        used_new: set[int] = set()  # type: ignore[no-redef]
        for i in range(m):
            best_j, best_r = -1, 0.0
            for j in range(n):
                if j in used_new:
                    continue
                r = sim_matrix[i][j]
                if r > best_r:
                    best_r = r
                    best_j = j
            if best_j >= 0:
                assignments[i] = best_j
                used_new.add(best_j)

    # Build aligned output
    aligned = []
    for i, o in enumerate(old_s):
        if i in assignments:
            j = assignments[i]
            aligned.append((o, new_s[j], sim_matrix[i][j]))
        else:
            aligned.append((o, "", 0.0))

    for j, ns in enumerate(new_s):
        if j not in used_new:
            aligned.append(("", ns, 0.0))

    return aligned


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
                result.append({"type": "equal",  "value": t})
            elif op == -1:
                result.append({"type": "delete", "value": t})
            else:
                result.append({"type": "insert", "value": t})
    return result


def compare_document(old_text: str, new_text: str):
    aligned = align_sentences(old_text, new_text)

    output = []
    for old_s, new_s, score in aligned:
        word_diff = compare_words(old_s, new_s)
        inline    = build_git_inline_diff(old_s, new_s)

        output.append({
            "old":         old_s,
            "new":         new_s,
            "similarity":  round(score, 3),
            "word_diff":   word_diff,
            "inline_diff": inline,
        })

    return output