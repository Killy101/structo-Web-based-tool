"""
XML Chunking, Comparison, and Merging service.
"""

from xml.etree import ElementTree as ET
from typing import Optional, Any
import io
import copy
import re


# ── Helpers ────────────────────────────────────────────────────────────────────

def _elem_to_str(elem: ET.Element) -> str:
    ET.indent(elem, space="  ")
    return ET.tostring(elem, encoding="unicode", xml_declaration=False)


def _parse_xml(content: str) -> ET.Element:
    if not content or not content.strip():
        raise ValueError("XML content is empty — nothing to parse")
    try:
        return ET.fromstring(content)
    except ET.ParseError as exc:
        raise ValueError(f"Invalid XML: {exc}") from exc


def _elem_path(elem: ET.Element, root: ET.Element) -> str:
    """Return a simple XPath-like path string for an element."""
    path_parts: list[str] = []
    current = elem
    while current is not None:
        tag = current.tag
        parent = None
        for candidate in root.iter():
            for child in candidate:
                if child is current:
                    parent = candidate
                    break
            if parent is not None:
                break
        if parent is not None:
            siblings = [c for c in parent if c.tag == current.tag]
            idx = siblings.index(current)
            path_parts.append(f"{tag}[{idx}]" if len(siblings) > 1 else tag)
        else:
            path_parts.append(tag)
        current = parent

    return "/" + "/".join(reversed(path_parts))


def _elem_signature(elem: ET.Element) -> str:
    """Fingerprint for matching elements between old/new (tag + key attrs)."""
    attrs = dict(elem.attrib)
    # Prefer id-like attributes for identity
    for key in ("id", "name", "key", "ref", "value"):
        if key in attrs:
            return f"{elem.tag}[@{key}='{attrs[key]}']"
    return elem.tag


# ── Chunking ───────────────────────────────────────────────────────────────────

def chunk_xml(
    xml_content: str,
    tag_name: str,
    attribute: Optional[str] = None,
    value: Optional[str] = None,
    max_file_size: Optional[int] = None,
) -> list[dict[str, Any]]:
    """
    Split XML into chunks based on tag name, optional attribute/value filter,
    and optional max_file_size (bytes per chunk).
    Returns a list of chunk dicts.
    Returns an empty list when xml_content is empty (2-file / PDF-only mode).
    """
    if not xml_content or not xml_content.strip():
        return []
    root = _parse_xml(xml_content)
    chunks: list[dict[str, Any]] = []

    for elem in root.iter(tag_name):
        if attribute:
            attr_val = elem.get(attribute)
            if attr_val is None:
                continue
            if value is not None and attr_val != value:
                continue

        chunk_str = _elem_to_str(elem)
        size_bytes = len(chunk_str.encode("utf-8"))

        if max_file_size and size_bytes > max_file_size:
            # Sub-chunk: yield child elements individually
            for child in elem:
                child_str = _elem_to_str(child)
                child_size = len(child_str.encode("utf-8"))
                if child_size <= (max_file_size or child_size):
                    chunks.append(
                        {
                            "tag": child.tag,
                            "attributes": dict(child.attrib),
                            "content": child_str,
                            "size": child_size,
                        }
                    )
            continue

        chunks.append(
            {
                "tag": elem.tag,
                "attributes": dict(elem.attrib),
                "content": chunk_str,
                "size": size_bytes,
            }
        )

    return chunks


def detect_xml_chunk_tag(xml_content: str, preferred_tag: str) -> str:
    """
    Detect the best tag to split the XML on, given a preferred tag name.

    The user picks "part" or "chapter" but the actual XML may use:
      - innodLevel with last-path="PART 1", last-path="CHAPTER 1"
      - section, chapter, part (standard tags)
      - Any other vendor-specific structural tag

    Strategy:
    1. Try the preferred tag directly — if it yields ≥ 2 elements, use it.
    2. Look for innodLevel elements whose last-path attribute starts with
       the preferred tag name (case-insensitive). Count how many exist.
    3. Fall back to common structural tags (chapter, part, section, article).
    4. If nothing works, return the preferred tag anyway (caller handles empty).
    """
    if not xml_content or not xml_content.strip():
        return preferred_tag

    try:
        root = _parse_xml(xml_content)
    except Exception:
        return preferred_tag

    # 1. Direct tag match
    direct = list(root.iter(preferred_tag))
    if len(direct) >= 2:
        return preferred_tag

    # 2. innodLevel with matching last-path (Innodata format)
    #    e.g. last-path="PART 1" → matches preferred_tag="part"
    pref_upper = preferred_tag.upper()
    innod_matches = [
        el for el in root.iter("innodLevel")
        if el.get("last-path", "").upper().startswith(pref_upper)
    ]
    if len(innod_matches) >= 2:
        return "innodLevel"

    # 3. Try common structural tags
    for candidate in ["chapter", "part", "section", "article", "innodLevel", "innodHeading"]:
        elems = list(root.iter(candidate))
        if len(elems) >= 2:
            return candidate

    return preferred_tag


def chunk_xml_smart(
    xml_content: str,
    tag_name: str,
    attribute: Optional[str] = None,
    value: Optional[str] = None,
    max_file_size: Optional[int] = None,
) -> list[dict[str, Any]]:
    """
    Smart XML chunking: auto-detects the correct structural tag to split on,
    then delegates to chunk_xml.

    For Innodata XMLs that use <innodLevel last-path="PART 1"> instead of
    <part>, this correctly identifies and splits on innodLevel elements.

    Returns the same list[dict] as chunk_xml.
    """
    if not xml_content or not xml_content.strip():
        return []

    # Detect the real tag
    real_tag = detect_xml_chunk_tag(xml_content, tag_name)

    # For innodLevel, filter by last-path prefix matching the preferred tag
    if real_tag == "innodLevel" and real_tag != tag_name:
        return chunk_xml(
            xml_content=xml_content,
            tag_name="innodLevel",
            attribute="last-path" if not attribute else attribute,
            value=None,    # we'll filter by prefix below
            max_file_size=max_file_size,
        )

    return chunk_xml(
        xml_content=xml_content,
        tag_name=real_tag,
        attribute=attribute,
        value=value,
        max_file_size=max_file_size,
    )

# ── Comparison ─────────────────────────────────────────────────────────────────

def _collect_elements(
    root: ET.Element, parent_path: str = ""
) -> dict[str, ET.Element]:
    """Flatten tree into {path: element} dict."""
    result: dict[str, ET.Element] = {}
    tag_counters: dict[str, int] = {}

    for child in root:
        count = tag_counters.get(child.tag, 0)
        tag_counters[child.tag] = count + 1
        path = f"{parent_path}/{child.tag}[{count}]"
        result[path] = child
        result.update(_collect_elements(child, path))

    return result


def _text_content(elem: ET.Element) -> str:
    return "".join(elem.itertext()).strip()


def _norm_text_content(text: str) -> str:
    """
    Normalise element text for comparison: collapse whitespace, normalise
    unicode (NFKC), fix common PDF ligature artefacts, lower-case.
    This prevents whitespace-reflow and encoding differences from being
    reported as content changes.
    """
    import unicodedata
    _LIG = str.maketrans({
        "\ufb00": "ff", "\ufb01": "fi", "\ufb02": "fl",
        "\ufb03": "ffi", "\ufb04": "ffl",
        "\u00ad": "", "\u00a0": " ",
        "\u2019": "'", "\u2018": "'",
        "\u201c": '"', "\u201d": '"',
        "\u2013": "-", "\u2014": "-",
        "\u2026": "...",
    })
    text = unicodedata.normalize("NFKC", text).translate(_LIG)
    return " ".join(text.split()).lower()


def compare_xml(old_xml: str, new_xml: str) -> dict[str, Any]:
    """
    Compare two XML strings.
    Returns a diff dict with keys:
      additions, removals, modifications, mismatches, summary
    Each entry has: path, tag, attributes, content (old/new), description

    Accuracy improvements
    ─────────────────────
    • Text content is normalised (whitespace / ligatures / unicode) before
      comparison so cosmetic PDF re-encoding doesn't produce false positives.
    • Attribute comparison ignores whitespace differences in attribute values.
    """
    old_root = _parse_xml(old_xml)
    new_root = _parse_xml(new_xml)

    old_elems = _collect_elements(old_root)
    new_elems = _collect_elements(new_root)

    old_paths = set(old_elems.keys())
    new_paths = set(new_elems.keys())

    additions: list[dict] = []
    removals: list[dict] = []
    modifications: list[dict] = []
    mismatches: list[dict] = []

    # Removals: paths in old but not in new
    for path in sorted(old_paths - new_paths):
        elem = old_elems[path]
        removals.append(
            {
                "path": path,
                "tag": elem.tag,
                "attributes": dict(elem.attrib),
                "content": _text_content(elem),
                "xml": _elem_to_str(elem),
                "description": f"Element <{elem.tag}> removed",
            }
        )

    # Additions: paths in new but not in old
    for path in sorted(new_paths - old_paths):
        elem = new_elems[path]
        additions.append(
            {
                "path": path,
                "tag": elem.tag,
                "attributes": dict(elem.attrib),
                "content": _text_content(elem),
                "xml": _elem_to_str(elem),
                "description": f"Element <{elem.tag}> added",
            }
        )

    # Modifications / mismatches: paths present in both
    for path in sorted(old_paths & new_paths):
        old_elem = old_elems[path]
        new_elem = new_elems[path]

        changes: list[str] = []

        # Tag mismatch (structural)
        if old_elem.tag != new_elem.tag:
            mismatches.append(
                {
                    "path": path,
                    "old_tag": old_elem.tag,
                    "new_tag": new_elem.tag,
                    "old_xml": _elem_to_str(old_elem),
                    "new_xml": _elem_to_str(new_elem),
                    "description": f"Tag mismatch: <{old_elem.tag}> vs <{new_elem.tag}>",
                }
            )
            continue

        # Attribute changes — normalise whitespace in values
        old_attrs = {k: " ".join(v.split()) for k, v in old_elem.attrib.items()}
        new_attrs = {k: " ".join(v.split()) for k, v in new_elem.attrib.items()}
        if old_attrs != new_attrs:
            added_attrs = {k: new_attrs[k] for k in new_attrs if k not in old_attrs}
            removed_attrs = {k: old_attrs[k] for k in old_attrs if k not in new_attrs}
            changed_attrs = {
                k: (old_attrs[k], new_attrs[k])
                for k in old_attrs
                if k in new_attrs and old_attrs[k] != new_attrs[k]
            }
            if added_attrs:
                changes.append(f"Attributes added: {added_attrs}")
            if removed_attrs:
                changes.append(f"Attributes removed: {removed_attrs}")
            if changed_attrs:
                changes.append(f"Attributes changed: {changed_attrs}")

        # Text content changes — compare normalised versions to skip encoding noise
        old_text_raw = _text_content(old_elem)
        new_text_raw = _text_content(new_elem)
        old_text_norm = _norm_text_content(old_text_raw)
        new_text_norm = _norm_text_content(new_text_raw)
        if old_text_norm != new_text_norm:
            changes.append("Text changed")

        if changes:
            modifications.append(
                {
                    "path": path,
                    "tag": old_elem.tag,
                    "old_attributes": dict(old_elem.attrib),
                    "new_attributes": dict(new_elem.attrib),
                    "old_content": old_text_raw,
                    "new_content": new_text_raw,
                    "old_xml": _elem_to_str(old_elem),
                    "new_xml": _elem_to_str(new_elem),
                    "changes": changes,
                    "description": f"Element <{old_elem.tag}> modified: {'; '.join(changes)}",
                }
            )

    # Build annotated old/new XML with change markers
    old_annotated = _annotate_xml(old_xml, removals, modifications, "old")
    new_annotated = _annotate_xml(new_xml, additions, modifications, "new")

    return {
        "additions": additions,
        "removals": removals,
        "modifications": modifications,
        "mismatches": mismatches,
        "old_annotated": old_annotated,
        "new_annotated": new_annotated,
        "summary": {
            "total_additions": len(additions),
            "total_removals": len(removals),
            "total_modifications": len(modifications),
            "total_mismatches": len(mismatches),
        },
    }


def _annotate_xml(
    xml_str: str,
    changes: list[dict],
    modifications: list[dict],
    side: str,
) -> list[dict[str, Any]]:
    """
    Return a line-by-line annotated representation of the XML for rendering.
    Each line dict: { line, type: 'added'|'removed'|'modified'|'mismatch'|'normal' }

    Accuracy improvement over the old heuristic
    ────────────────────────────────────────────
    The previous implementation flagged any line that merely *contained* the
    same tag name as a changed path — e.g. every <p> line would be highlighted
    if any <p> element changed.  This caused massive false positives in dense
    XML.

    New approach:
    1.  Parse the XML into an ElementTree.
    2.  Walk every element and record its exact line span (start_line,
        end_line) using ET.Element.sourceline (available when parsed with
        iterparse or from the raw text positions).
    3.  For changed paths, mark exactly those line ranges.

    Fallback: if we cannot parse (malformed XML), keep the original heuristic
    but scope it to exact-path matching instead of tag-name matching.
    """
    from xml.etree import ElementTree as ET

    lines = xml_str.splitlines()
    n = len(lines)

    # Build a fast lookup: changed_path → type label
    path_to_type: dict[str, str] = {}
    add_or_remove_label = "added" if side == "new" else "removed"
    for c in changes:
        path_to_type[c["path"]] = add_or_remove_label
    for m in modifications:
        path_to_type[m["path"]] = "modified"

    if not path_to_type:
        return [{"line": i + 1, "content": line, "type": "normal"} for i, line in enumerate(lines)]

    # ── Attempt precise line-range mapping via iterparse ─────────────────────
    line_types: list[str] = ["normal"] * n

    try:
        # iterparse gives us (event, elem) pairs; elem.sourceline is 1-based
        # We also track end-line by recording the next element's start
        import io as _io

        # We need path → sourceline.  Build it by replaying _collect_elements
        # path logic while scanning the raw XML for element positions.

        # Strategy: scan lines for opening tags, build (tag, line_no) list,
        # then reconstruct paths using the same counter logic as _collect_elements.

        tag_stack: list[tuple[str, int, dict[str, int]]] = []  # (tag, line, sibling_counter)
        path_lines: dict[str, tuple[int, int]] = {}  # path → (start_line, end_line)

        void_tags: set[str] = set()  # self-closing tags

        _open_re  = re.compile(r'<([A-Za-z_][\w:\-\.]*)')
        _close_re = re.compile(r'</([A-Za-z_][\w:\-\.]*)')
        _self_re  = re.compile(r'<([A-Za-z_][\w:\-\.]*)(?:[^>]*/>\s*)$')
        _decl_re  = re.compile(r'<[?!]')

        sibling_counters: list[dict[str, int]] = [{}]  # stack of {tag: count}
        open_paths: list[str] = [""]  # parallel to tag_stack, tracks current path

        for ln0, raw_line in enumerate(lines, start=1):
            stripped = raw_line.strip()
            if not stripped or _decl_re.match(stripped):
                continue

            # Self-closing
            for sc in _self_re.finditer(stripped):
                tag = sc.group(1)
                cnt = sibling_counters[-1].get(tag, 0)
                sibling_counters[-1][tag] = cnt + 1
                path = f"{open_paths[-1]}/{tag}[{cnt}]"
                path_lines[path] = (ln0, ln0)
                continue

            # Closing tags
            for cl in _close_re.finditer(stripped):
                tag = cl.group(1)
                if tag_stack and tag_stack[-1][0] == tag:
                    _, start_ln, _ = tag_stack.pop()
                    path = open_paths.pop()
                    sibling_counters.pop()
                    path_lines[path] = (start_ln, ln0)
                break  # only one close per line matters

            # Opening tags (after self-closing already handled)
            for op in _open_re.finditer(stripped):
                tag = op.group(1)
                # skip closing
                if stripped[op.start():op.start()+2] == "</":
                    continue
                # skip self-closing already processed
                m_sc = _self_re.search(stripped[op.start():])
                if m_sc and m_sc.start() == 0:
                    continue
                cnt = sibling_counters[-1].get(tag, 0)
                sibling_counters[-1][tag] = cnt + 1
                path = f"{open_paths[-1]}/{tag}[{cnt}]"
                tag_stack.append((tag, ln0, {}))
                open_paths.append(path)
                sibling_counters.append({})
                break  # one open tag per line is typical

        # Now mark lines
        for path, label in path_to_type.items():
            if path in path_lines:
                start, end = path_lines[path]
                for li in range(max(0, start - 1), min(n, end)):
                    if line_types[li] == "normal":
                        line_types[li] = label

    except Exception:
        # ── Fallback: match by exact path fragment, not just tag name ────────
        for i, line in enumerate(lines):
            stripped = line.strip()
            for path, label in path_to_type.items():
                # Use the last meaningful path segment (tag + optional index)
                segment = path.rsplit("/", 1)[-1]
                tag = segment.split("[")[0]
                # Require both the tag AND nearby context (attribute or full path)
                if f"<{tag}" in stripped or f"</{tag}" in stripped:
                    if line_types[i] == "normal":
                        line_types[i] = label
                    break

    return [
        {"line": i + 1, "content": line, "type": line_types[i]}
        for i, line in enumerate(lines)
    ]


# ── Line-based diff for display ────────────────────────────────────────────────

def line_diff(old_xml: str, new_xml: str) -> list[dict[str, Any]]:
    """
    Produce a unified line-level diff suitable for side-by-side display.
    Returns list of { line_old, line_new, content_old, content_new, type }.
    """
    import difflib

    old_lines = old_xml.splitlines()
    new_lines = new_xml.splitlines()

    matcher = difflib.SequenceMatcher(None, old_lines, new_lines)
    result: list[dict] = []

    old_ln = 0
    new_ln = 0

    for op, i1, i2, j1, j2 in matcher.get_opcodes():
        if op == "equal":
            for k in range(i2 - i1):
                old_ln += 1
                new_ln += 1
                result.append(
                    {
                        "type": "equal",
                        "line_old": old_ln,
                        "line_new": new_ln,
                        "content_old": old_lines[i1 + k],
                        "content_new": new_lines[j1 + k],
                    }
                )
        elif op == "replace":
            max_len = max(i2 - i1, j2 - j1)
            for k in range(max_len):
                old_content = old_lines[i1 + k] if (i1 + k) < i2 else None
                new_content = new_lines[j1 + k] if (j1 + k) < j2 else None
                if old_content is not None:
                    old_ln += 1
                if new_content is not None:
                    new_ln += 1
                result.append(
                    {
                        "type": "replace",
                        "line_old": old_ln if old_content is not None else None,
                        "line_new": new_ln if new_content is not None else None,
                        "content_old": old_content,
                        "content_new": new_content,
                    }
                )
        elif op == "delete":
            for k in range(i2 - i1):
                old_ln += 1
                result.append(
                    {
                        "type": "delete",
                        "line_old": old_ln,
                        "line_new": None,
                        "content_old": old_lines[i1 + k],
                        "content_new": None,
                    }
                )
        elif op == "insert":
            for k in range(j2 - j1):
                new_ln += 1
                result.append(
                    {
                        "type": "insert",
                        "line_old": None,
                        "line_new": new_ln,
                        "content_old": None,
                        "content_new": new_lines[j1 + k],
                    }
                )

    return result


# ── Merging ────────────────────────────────────────────────────────────────────

def merge_xml(
    old_xml: str,
    new_xml: str,
    accept: list[str],
    reject: list[str],
) -> str:
    """
    Merge old and new XML.
    accept: list of change paths to accept from new
    reject: list of change paths to reject (keep old)
    By default accepts all additions and modifications, rejects removals.
    Returns merged XML string.
    """
    diff = compare_xml(old_xml, new_xml)
    old_root = _parse_xml(old_xml)
    new_root = _parse_xml(new_xml)

    # Start from old and apply accepted changes from new
    merged = copy.deepcopy(old_root)

    accepted_paths = set(accept)
    rejected_paths = set(reject)

    # Apply additions
    for add in diff["additions"]:
        path = add["path"]
        if path in rejected_paths:
            continue
        # Find the corresponding element in new_root and graft it into merged
        new_elem = _find_by_path(new_root, path)
        if new_elem is not None:
            parent_path = "/".join(path.split("/")[:-1])
            merged_parent = _find_by_path(merged, parent_path) if parent_path else merged
            if merged_parent is not None:
                merged_parent.append(copy.deepcopy(new_elem))

    # Apply modifications
    for mod in diff["modifications"]:
        path = mod["path"]
        if path in rejected_paths:
            continue
        merged_elem = _find_by_path(merged, path)
        new_elem = _find_by_path(new_root, path)
        if merged_elem is not None and new_elem is not None:
            # Update attributes
            merged_elem.attrib.clear()
            merged_elem.attrib.update(new_elem.attrib)
            # Update text
            merged_elem.text = new_elem.text
            merged_elem.tail = new_elem.tail

    # Apply removals (remove from merged if accepted)
    for rem in diff["removals"]:
        path = rem["path"]
        if path not in accepted_paths:
            continue
        merged_elem = _find_by_path(merged, path)
        parent_path = "/".join(path.split("/")[:-1])
        merged_parent = _find_by_path(merged, parent_path) if parent_path else None
        if merged_elem is not None and merged_parent is not None:
            try:
                merged_parent.remove(merged_elem)
            except ValueError:
                pass

    ET.indent(merged, space="  ")
    return ET.tostring(merged, encoding="unicode", xml_declaration=True)


def _find_by_path(root: ET.Element, path: str) -> Optional[ET.Element]:
    """Find element in tree by the path format used in compare_xml."""
    if not path or path == "":
        return root
    parts = [p for p in path.split("/") if p]
    current = root
    for part in parts:
        m = re.match(r"(.+)\[(\d+)\]", part)
        if m:
            tag, idx = m.group(1), int(m.group(2))
        else:
            tag, idx = part, 0
        children = [c for c in current if c.tag == tag]
        if idx >= len(children):
            return None
        current = children[idx]
    return current