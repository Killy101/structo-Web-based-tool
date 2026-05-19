"""Utilities for rebuilding a consolidated XML from chunked XML files."""

from __future__ import annotations

import copy
import hashlib
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from typing import Any, Iterable

_COMMENT_RE = re.compile(r"<!--([\s\S]*?)-->", re.I)
_CHUNK_NUM_RE = re.compile(r"(?:^|[^a-z0-9])chunk\s*0*(\d+)", re.I)
_INNOD_NUM_RE = re.compile(r"_innod\.(\d+)\.xml$", re.I)
_PART_RE = re.compile(r"\bpart\s+([0-9ivxlcdm]+[a-z]?)\b", re.I)


@dataclass
class ParsedChunk:
    filename: str
    relative_path: str
    content: str
    root: ET.Element
    sequence: int | None
    part_order: int
    section_level: int
    has_changes: bool
    duplicate_key: str
    source_path: str | None


class ChunkedMergeError(ValueError):
    """Raised when chunk inputs cannot be merged safely."""


def _safe_text(value: str | None) -> str:
    return (value or "").strip()


def _normalise_space(value: str) -> str:
    return " ".join(value.split())


def _strip_xml_decl(raw: str) -> str:
    text = raw.lstrip("\ufeff").strip()
    if text.startswith("<?xml"):
        end = text.find("?>")
        if end != -1:
            text = text[end + 2 :].lstrip()
    return text


def _extract_comments(raw: str) -> list[str]:
    return [m.group(1).strip() for m in _COMMENT_RE.finditer(raw)]


def _extract_sequence(filename: str, comments: Iterable[str]) -> int | None:
    m_innod = _INNOD_NUM_RE.search(filename)
    if m_innod:
        return int(m_innod.group(1))

    m_chunk = _CHUNK_NUM_RE.search(filename)
    if m_chunk:
        return int(m_chunk.group(1))

    for c in comments:
        mc = _CHUNK_NUM_RE.search(c)
        if mc:
            return int(mc.group(1))

    return None


def _parse_part_order(value: str) -> int:
    token = value.strip().lower()
    if not token:
        return 10**9

    if token.isdigit():
        return int(token)

    roman_map = {"i": 1, "v": 5, "x": 10, "l": 50, "c": 100, "d": 500, "m": 1000}
    if all(ch in roman_map for ch in token):
        total = 0
        prev = 0
        for ch in reversed(token):
            cur = roman_map[ch]
            if cur < prev:
                total -= cur
            else:
                total += cur
            prev = cur
        return total

    tail = token[-1]
    if len(token) > 1 and token[:-1].isdigit() and tail.isalpha():
        return int(token[:-1]) * 100 + (ord(tail) - 96)

    return 10**9


def _heading_text(elem: ET.Element) -> str:
    title = elem.find(".//innodHeading/title")
    if title is None:
        title = elem.find(".//title")
    if title is not None:
        text = _normalise_space("".join(title.itertext()))
        if text:
            return text
    attr = _safe_text(elem.get("last-path"))
    return _normalise_space(attr)


def _identifier_text(elem: ET.Element) -> str:
    node = elem.find(".//innodIdentifier")
    if node is None:
        return ""
    return _normalise_space("".join(node.itertext()))


def _iter_units(root: ET.Element) -> list[ET.Element]:
    if root.tag == "innodLevel":
        return [root]

    parent_map: dict[ET.Element, ET.Element] = {}
    for p in root.iter():
        for ch in list(p):
            parent_map[ch] = p

    levels = [n for n in root.iter("innodLevel")]
    top_levels: list[ET.Element] = []
    for n in levels:
        parent = parent_map.get(n)
        is_nested = False
        while parent is not None:
            if parent.tag == "innodLevel":
                is_nested = True
                break
            parent = parent_map.get(parent)
        if not is_nested:
            top_levels.append(n)

    if top_levels:
        return top_levels

    return [root]


def _canonical_xml(elem: ET.Element) -> str:
    return ET.tostring(elem, encoding="unicode")


def _normalised_xml_hash(elem: ET.Element) -> str:
    # Duplicate detection must be content-based, not heading-based. Different
    # chapters can share labels like "CAPITULO I" across different titles.
    raw = _canonical_xml(elem)
    normalised = re.sub(r">\s+<", "><", raw).strip()
    return hashlib.sha1(normalised.encode("utf-8")).hexdigest()


def _build_duplicate_key(elem: ET.Element, source_path: str | None) -> str:
    return _normalised_xml_hash(elem)


def _source_path_from_comments(comments: Iterable[str]) -> str | None:
    for c in comments:
        if "source_path" in c.lower():
            parts = c.split(":", 1)
            if len(parts) == 2:
                v = _safe_text(parts[1])
                if v:
                    return v
    return None


def _parse_chunk_file(filename: str, content: str, relative_path: str = "") -> ParsedChunk:
    comments = _extract_comments(content)
    xml_body = _strip_xml_decl(content)
    if not xml_body:
        raise ChunkedMergeError(f"{filename}: empty XML content")

    try:
        wrapped = f"<mergeRoot>{xml_body}</mergeRoot>"
        holder = ET.fromstring(wrapped)
    except ET.ParseError as exc:
        raise ChunkedMergeError(f"{filename}: invalid XML ({exc})") from exc

    candidates = [n for n in list(holder) if isinstance(n.tag, str)]
    if not candidates:
        raise ChunkedMergeError(f"{filename}: XML has no mergeable elements")

    root = candidates[0]
    sequence = _extract_sequence(filename, comments)

    part_match = _PART_RE.search(_heading_text(root))
    part_order = _parse_part_order(part_match.group(1)) if part_match else 10**9

    level_raw = _safe_text(root.get("level"))
    section_level = int(level_raw) if level_raw.isdigit() else 10**9

    rel_lc = relative_path.lower().replace("\\", "/")
    has_changes = "/haschanges/" in rel_lc or "/has_changes/" in rel_lc
    source_path = _source_path_from_comments(comments)
    duplicate_key = _build_duplicate_key(root, source_path)

    return ParsedChunk(
        filename=filename,
        relative_path=relative_path,
        content=content,
        root=root,
        sequence=sequence,
        part_order=part_order,
        section_level=section_level,
        has_changes=has_changes,
        duplicate_key=duplicate_key,
        source_path=source_path,
    )


def _sort_key(chunk: ParsedChunk) -> tuple[int, int, int, str]:
    seq = chunk.sequence if chunk.sequence is not None else 10**9
    return (seq, chunk.part_order, chunk.section_level, chunk.filename.lower())


def inspect_chunk_files(
    files: list[dict[str, str]],
    selected_filenames: list[str] | None = None,
) -> dict[str, Any]:
    if not files:
        raise ChunkedMergeError("No chunk XML files provided")

    selected = set(selected_filenames or [])
    parsed: list[ParsedChunk] = []
    invalid: list[dict[str, str]] = []

    for f in files:
        name = _safe_text(f.get("filename"))
        content = f.get("content") or ""
        rel = f.get("relative_path") or ""
        if not name:
            continue
        if not name.lower().endswith(".xml"):
            invalid.append({"filename": name, "reason": "Not an XML file"})
            continue
        try:
            parsed.append(_parse_chunk_file(name, content, rel))
        except ChunkedMergeError as exc:
            invalid.append({"filename": name, "reason": str(exc)})

    if not parsed:
        raise ChunkedMergeError("No valid XML chunks found")

    parsed.sort(key=_sort_key)

    missing_sequences: list[int] = []
    seqs = sorted([p.sequence for p in parsed if p.sequence is not None])
    if seqs:
        for n in range(seqs[0], seqs[-1] + 1):
            if n not in seqs:
                missing_sequences.append(n)

    seen_dup: set[str] = set()
    rows: list[dict[str, Any]] = []
    selected_count = 0
    changed_selected = 0
    duplicate_selected = 0

    for idx, p in enumerate(parsed, start=1):
        is_dup = p.duplicate_key in seen_dup
        if not is_dup:
            seen_dup.add(p.duplicate_key)

        is_selected = True if not selected else p.filename in selected
        if is_selected:
            selected_count += 1
            if p.has_changes:
                changed_selected += 1
            if is_dup:
                duplicate_selected += 1

        rows.append(
            {
                "index": idx,
                "filename": p.filename,
                "relative_path": p.relative_path,
                "sequence": p.sequence,
                "part_order": p.part_order,
                "section_level": p.section_level,
                "has_changes": p.has_changes,
                "duplicate": is_dup,
                "selected": is_selected,
                "heading": _heading_text(p.root),
                "source_path": p.source_path,
            }
        )

    warnings: list[str] = []
    if invalid:
        warnings.append(f"Skipped {len(invalid)} invalid/non-XML files")
    if missing_sequences:
        warnings.append("Missing sequence numbers: " + ", ".join(str(x) for x in missing_sequences[:30]))
    if any(r["duplicate"] for r in rows):
        warnings.append("Duplicate chunks detected; duplicates will be excluded from merge")
    if selected_count == 0:
        warnings.append("No chunks selected for merge")

    return {
        "success": True,
        "chunk_rows": rows,
        "invalid_files": invalid,
        "warnings": warnings,
        "missing_sequences": missing_sequences,
        "summary": {
            "total_detected": len(rows),
            "selected": selected_count,
            "changed_selected": changed_selected,
            "duplicates_selected": duplicate_selected,
        },
    }


def _merge_selected(parsed: list[ParsedChunk], selected: set[str]) -> ET.Element:
    chosen = [p for p in parsed if (not selected or p.filename in selected)]
    if not chosen:
        raise ChunkedMergeError("No chunks selected to merge")

    base_root: ET.Element | None = None
    for p in chosen:
        if p.root.tag != "innodLevel":
            base_root = ET.Element(p.root.tag, dict(p.root.attrib))
            break

    if base_root is None:
        base_root = ET.Element("document")

    seen_keys: set[str] = set()

    for p in chosen:
        units = _iter_units(p.root)
        for unit in units:
            key = _build_duplicate_key(unit, p.source_path)
            if key in seen_keys:
                continue
            seen_keys.add(key)

            copied = copy.deepcopy(unit)
            if copied.tag == base_root.tag:
                for ch in list(copied):
                    base_root.append(copy.deepcopy(ch))
            else:
                base_root.append(copied)

    return base_root


def build_merged_xml(
    files: list[dict[str, str]],
    selected_filenames: list[str] | None = None,
) -> dict[str, Any]:
    selected = set(selected_filenames or [])

    parsed: list[ParsedChunk] = []
    invalid: list[dict[str, str]] = []
    for f in files:
        name = _safe_text(f.get("filename"))
        if not name:
            continue
        content = f.get("content") or ""
        rel = f.get("relative_path") or ""
        try:
            parsed.append(_parse_chunk_file(name, content, rel))
        except ChunkedMergeError as exc:
            invalid.append({"filename": name, "reason": str(exc)})

    if not parsed:
        raise ChunkedMergeError("No valid chunk XML files to merge")

    parsed.sort(key=_sort_key)
    merged_root = _merge_selected(parsed, selected)

    ET.indent(merged_root, space="  ")
    merged_xml = ET.tostring(merged_root, encoding="unicode", xml_declaration=True)

    # Validate final XML is parseable.
    try:
        ET.fromstring(merged_xml)
    except ET.ParseError as exc:
        raise ChunkedMergeError(f"Merged XML failed validation: {exc}") from exc

    inspected = inspect_chunk_files(files, selected_filenames)
    inspected["merged_xml"] = merged_xml
    return inspected
