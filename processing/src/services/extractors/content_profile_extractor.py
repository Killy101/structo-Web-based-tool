"""
src/services/extractors/content_profile_extractor.py

Builds a content profile by aggregating results from the scope, metadata,
and toc extractors — no direct document analysis is performed here.

Output shape matches the Content Profile spreadsheet (DE sources):
  - RC Filename        ← metadata
  - Hardcoded Path     ← Level 0 description + Level 1 description (e.g. /DE + /DEBaFinOrdinance)
  - Level Numbers      ← extracted TOC sections only
  - Heading Annotation ← always "Level 2"
  - Whitespace Rules       ← extracted payload only
  - RC Naming Convention   ← File Naming Conventions section
  - RC Naming Example      ← example filename from File Naming section
  - File Separation        ← how files are split (by Title, Chapter, etc.)
  - Zip Naming Convention  ← Zip File Naming section (newer BRDs)
  - Zip Naming Example     ← example zip filename

REDJAy XML Tag generation rules (from spreadsheet):
  - Level 0 and Level 1  → "Hardcoded"
  - All other levels     → <section level="N"><title>{example}</title></section>
                           Multiple examples (split on ";" or "/") produce one
                           tag per example value, joined by newline.
"""

from .scope_extractor    import extract_scope
from .metadata_extractor import extract_metadata
from .toc_extractor      import extract_toc, _extract_path_from_definition


# ---------------------------------------------------------------------------
# RC Filename extraction  (Source Name from the metadata table in the doc)
# ---------------------------------------------------------------------------

_SOURCE_NAME_KEYS: tuple[str, ...] = (
    "source name", "source name*", "*source name",
    "content category name",        # newer-format BRDs (MX.CNBV, JP.Diet, etc.)
    "rc filename", "rc file name",
    "document name",
)

_BOILERPLATE_HEADER_PHRASES: tuple[str, ...] = (
    "office of legal obligations",
    "research and data management",
    "content extraction spec",
    "version",
    "draft brd",
    "product owner",
    "contributors",
    "last edit",
)


# ---------------------------------------------------------------------------
# File Delivery extraction  (File Naming Conventions section)
# ---------------------------------------------------------------------------

_FILE_TRIGGER_HEADINGS: tuple[str, ...] = (
    "file delivery", "file separation", "file naming", "delivery requirement",
)
_NAMING_TRIGGER_HEADINGS: tuple[str, ...] = ("file naming", "rc file naming", "naming convention")
_ZIP_TRIGGER_HEADINGS:    tuple[str, ...] = ("zip file naming", "zip naming")
_SEP_TRIGGER_HEADINGS:    tuple[str, ...] = ("file separation",)
_FILE_STOP_HEADINGS: tuple[str, ...] = (
    "citation", "metadata", "levels", "structuring", "source",
    "appendix", "exceptions", "assumptions", "updates", "content category",
    "how to identify", "document structure",
)
_FILE_BOILERPLATE: tuple[str, ...] = (
    "innodata/tech will use",
    "not to be changed by the sme",
    "if limitations or concerns arise",
    "both parties must agree",
    "sme checkpoint",
    "sme check-point",
)



def _fd_clean(text: str) -> str:
    import re as _re
    text = text.strip()
    text = _re.sub(r"[\u201c\u201d\u2018\u2019]", '"', text)
    text = _re.sub(r"\s{2,}", " ", text)
    return text


def _collect_file_delivery_paragraphs(doc) -> list[tuple[str, str]]:
    """Walk paragraphs and collect those under the File Delivery heading."""
    result: list[tuple[str, str]] = []
    collecting = False
    for p in doc.paragraphs:
        style = p.style.name if p.style else ""
        is_h  = style.startswith("Heading")
        text  = p.text.strip()
        if not text:
            continue
        tl = text.lower()
        if is_h:
            if any(k in tl for k in _FILE_TRIGGER_HEADINGS):
                collecting = True
                result.append((style, text))
                continue
            if collecting:
                if any(s in tl for s in _FILE_STOP_HEADINGS):
                    break
                result.append((style, text))
                continue
        if collecting and not any(b in tl for b in _FILE_BOILERPLATE):
            result.append((style, text))
    return result


def _extract_file_delivery(doc) -> dict:
    """
    Extract File Delivery Requirements (File Separation + RC/Zip naming).
    Returns dict with keys:
      file_separation, rc_naming_convention, rc_naming_example,
      zip_naming_convention, zip_naming_example
    """
    import re as _re

    _EXAMPLE_RE = _re.compile(
        r"^[Ee]xample" + r"\s*:?\s*" + r'[^\S\r\n]*(.+?)\s*$'
    )
    # Simpler: match lines that start with "Example" (case-insensitive)
    _EXAMPLE_START = _re.compile(r"^example\s*:?\s*", _re.IGNORECASE)

    _SEP_PATS = [
        _re.compile(r"separated\s+by\s+[^.\"\n,]+", _re.IGNORECASE),
        _re.compile(r"(?:delivered|extracted)\s+as\s+(?:individual\s+)?files?\s+by\s+(\w+)", _re.IGNORECASE),
        _re.compile(r"separated\s+(?:at\s+the\s+)?(<[^>]+>|level\s+\d+)", _re.IGNORECASE),
        _re.compile(r"divided\s+at\s+(<[^>]+>|level\s+\d+)", _re.IGNORECASE),
        _re.compile(r"separate\s+files?\s+by\s+(<[^>]+>|level\s+\d+)", _re.IGNORECASE),
    ]
    # More targeted sep extractor
    _SEP_EXACT = [
        _re.compile(r'separated\s+by\s+["\'\u201c]?([^"\'.\n\u201d,]+)["\'\u201d]?', _re.IGNORECASE),
        _re.compile(r'(?:delivered|extracted)\s+as\s+(?:individual\s+)?files?\s+by\s+(\w+)', _re.IGNORECASE),
        _re.compile(r'separated\s+(?:at\s+the\s+)?(<[^>]+>|level\s+\d+)', _re.IGNORECASE),
        _re.compile(r'divided\s+at\s+(<[^>]+>|level\s+\d+)', _re.IGNORECASE),
        _re.compile(r'separate\s+files?\s+by\s+(<[^>]+>|level\s+\d+)', _re.IGNORECASE),
    ]

    paragraphs = _collect_file_delivery_paragraphs(doc)

    # ── File Separation ────────────────────────────────────────────────────────
    sep_texts: list[str] = []
    in_sep = False
    for style, text in paragraphs:
        tl   = text.lower()
        is_h = style.startswith("Heading")
        if is_h and any(k in tl for k in _SEP_TRIGGER_HEADINGS):
            in_sep = True; continue
        if is_h and in_sep:
            break
        if in_sep:
            sep_texts.append(text)

    combined_sep   = " ".join(sep_texts)
    file_separation = ""
    for pat in _SEP_EXACT:
        m = pat.search(combined_sep)
        if m:
            file_separation = _fd_clean(m.group(1))
            break
    if not file_separation and sep_texts:
        file_separation = _fd_clean(sep_texts[0])

    # ── Naming convention ──────────────────────────────────────────────────────
    rc_lines:    list[str] = []
    zip_lines:   list[str] = []
    plain_lines: list[str] = []
    in_rc = in_zip = in_plain = False

    for style, text in paragraphs:
        tl   = text.lower()
        is_h = style.startswith("Heading")
        if is_h:
            if any(k in tl for k in _ZIP_TRIGGER_HEADINGS):
                in_zip = True;  in_rc = in_plain = False; continue
            if any(k in tl for k in ["rc file naming", "rc file name"]):
                in_rc  = True;  in_zip = in_plain = False; continue
            if any(k in tl for k in _NAMING_TRIGGER_HEADINGS):
                in_plain = True; in_rc = in_zip = False; continue
            # Delaware: "The file should be named" is itself a Heading 3
            if (in_rc or in_plain) and "should be named" in tl:
                (rc_lines if in_rc else plain_lines).append(text); continue
            if in_zip and "should be named" in tl:
                zip_lines.append(text); continue
            if in_rc or in_zip or in_plain:
                if not any(k in tl for k in _NAMING_TRIGGER_HEADINGS + _ZIP_TRIGGER_HEADINGS):
                    in_rc = in_zip = in_plain = False
            continue
        if in_zip:    zip_lines.append(text)
        elif in_rc:   rc_lines.append(text)
        elif in_plain: plain_lines.append(text)

    def _is_example_line(line: str) -> bool:
        return bool(_EXAMPLE_START.match(line))

    def _parse_naming(lines: list[str]) -> tuple[str, str]:
        """Return (convention, example) from naming paragraphs."""
        # Pre-pass: merge "The files should be named," + next pattern line
        merged: list[str] = []
        i = 0
        while i < len(lines):
            line = lines[i]
            tl   = line.lower().strip()
            next_is_pattern = (
                i + 1 < len(lines)
                and not _is_example_line(lines[i + 1])
                and (lines[i + 1].startswith(chr(34))
                     or "+" in lines[i + 1]
                     or "<level" in lines[i + 1].lower())
            )
            if "should be named" in tl and next_is_pattern and len(tl) < 50:
                merged.append(line.rstrip(",").strip() + " " + lines[i + 1])
                i += 2; continue
            merged.append(line); i += 1

        convention = example = ""
        for line in merged:
            tl = line.lower()
            if _is_example_line(line):
                val = _EXAMPLE_START.sub("", line).strip().strip(chr(34)).strip()
                if not example:
                    example = _fd_clean(val)
            elif ("should be named" in tl or line.startswith(chr(34))
                  or "<level" in tl or "+" in line):
                if not convention:
                    raw = _fd_clean(line)
                    # Strip leading prose like "The file(s) should be named: "
                    # so the convention starts at the actual format pattern.
                    import re as _re_strip
                    raw = _re_strip.sub(
                        r"(?i)^the files?\s+should be named[,:]?\s*", "", raw
                    ).strip()
                    convention = raw
        if not convention and merged:
            for line in merged:
                if not _is_example_line(line):
                    convention = _fd_clean(line); break
        return convention, example

    naming_lines = rc_lines if rc_lines else plain_lines
    rc_conv,  rc_ex  = _parse_naming(naming_lines)
    zip_conv, zip_ex = _parse_naming(zip_lines)

    return {
        "file_separation":       file_separation,
        "rc_naming_convention":  rc_conv,
        "rc_naming_example":     rc_ex,
        "zip_naming_convention": zip_conv,
        "zip_naming_example":    zip_ex,
    }


def _extract_short_rc_code(naming_convention: str) -> str:
    """
    Extract the RC filename code from the naming convention string.

    The first quoted token before a "+" is the RC filename code, e.g.:
      '"AlabamaAdministrativeCode" + "Title" + ...'  → "AlabamaAdministrativeCode"
      '"CFR" + " – " + <Level 2> + ...'              → "CFR"
      '"MXCNBVReglas" + " – " + <Level 2> + ...'     → "MXCNBVReglas"
      '"JPDietActs" + " – " + <Level 2> + ...'        → "JPDietActs"

    Accepted forms:
      - All-uppercase acronym >= 2 chars  (CFR, IRS, US)
      - CamelCase single word with any internal uppercase (AlabamaAdministrativeCode,
        MXCNBVReglas, JPDietActs)

    Rejected: plain lowercase words, multi-word phrases, single words with no
    internal structure (e.g. "Oklahoma", "Innodata").
    """
    import re as _re
    m = _re.search(r'["“]([A-Za-z][A-Za-z0-9]{1,})["”]\s*\+', naming_convention)
    if not m:
        return ""
    token = m.group(1)
    # All-uppercase acronym (CFR, IRS, etc.) — accept if >= 2 chars
    if token.isupper() and len(token) >= 2:
        return token
    # CamelCase: has at least one uppercase letter after the first character
    # Accepts: AlabamaAdministrativeCode, MXCNBVReglas, JPDietActs
    # Rejects: Oklahoma (no internal uppercase), innodata (starts lowercase)
    if _re.search(r'[A-Z]', token[1:]):
        return token
    return ""


def _extract_rc_filename(doc) -> str:
    """
    Extract the RC Filename / Source Name from the document.

    Strategy (in priority order):
      1. Scan every table for a row whose first cell matches a known
         "Source Name" / "Content Category Name" label.
         The second cell is the value.
      2. Fall back to the cover-page header table — the third non-empty line
         after "Office of Legal Obligations" / "Research and Data Management"
         is typically the source name.
      3. Fall back to the document's Heading 1, if it looks like a source name
         (not a generic heading like "Document History").
    """
    import re as _re

    _GENERIC_HEADINGS = {
        "document history", "table of contents", "introduction",
        "overview", "scope", "references", "appendix",
    }

    # ── 1. Scan tables for labelled Source Name row ──────────────────────────
    for table in doc.tables:
        for row in table.rows:
            cells = row.cells
            if len(cells) < 2:
                continue
            key = cells[0].text.strip().lower().replace("*", "").strip()
            if key in _SOURCE_NAME_KEYS:
                val = cells[1].text.strip().strip('"').strip("“”").strip()
                if val and len(val) > 2:
                    return val

    # ── 2. Cover-page header table fallback ─────────────────────────────────
    # The first (or second) table is usually a 1-row or 2-col header block.
    # It contains lines like:
    #   "Office of Legal Obligations"
    #   "Research and Data Management"
    #   "California Code"          ← this is the source name
    #   "Content extraction specification"
    for table in doc.tables[:3]:
        all_lines: list[str] = []
        for row in table.rows:
            for c in row.cells:
                for ln in c.text.split("\n"):
                    stripped = ln.strip()
                    if stripped:
                        all_lines.append(stripped)
        lines = all_lines
        found_header_marker = False
        for line in lines:
            line_lower = line.lower()
            if any(bp in line_lower for bp in _BOILERPLATE_HEADER_PHRASES):
                found_header_marker = True
                continue
            if found_header_marker:
                # Skip version-like lines ("Version 3.0", "V1.7")
                if _re.match(r"^v(?:ersion)?\s*[\d\.]+", line, _re.IGNORECASE):
                    continue
                # Skip short single-word tokens
                if len(line.split()) < 2:
                    continue
                # Accept as source name
                if line_lower not in _GENERIC_HEADINGS and len(line) > 4:
                    return line

    # ── 3. Heading 1 fallback ────────────────────────────────────────────────
    for p in doc.paragraphs:
        style = p.style.name if p.style else ""
        if style == "Heading 1":
            val = p.text.strip()
            if val and val.lower() not in _GENERIC_HEADINGS and len(val) > 4:
                return val

    return ""


# ---------------------------------------------------------------------------
# REDJAy XML tag builder
# ---------------------------------------------------------------------------

_HARDCODED_LEVELS = {"0", "1"}


def _split_examples(example: str) -> list[str]:
    example = example.strip().strip('"\'\u201c\u201d')
    for suffix in ("; etc.", ", etc.", " etc."):
        if example.endswith(suffix):
            example = example[: -len(suffix)].strip()
    for sep in (";", "\n", " / "):
        if sep in example:
            tokens = [t.strip().strip('"\'\u201c\u201d') for t in example.split(sep)]
            return [t for t in tokens if t]
    return [example] if example else []


def _build_redjay_tag(level: str, example: str) -> str:
    level = str(level).strip()
    if level in _HARDCODED_LEVELS:
        return "Hardcoded"
    tokens = _split_examples(example)
    if not tokens:
        return f'<section level="{level}"><title></title></section>'
    return "\n".join(
        f'<section level="{level}"><title>{token}</title></section>'
        for token in tokens
    )


# ---------------------------------------------------------------------------
# Whitespace rules
# ---------------------------------------------------------------------------

def _build_whitespace_rules(identifier_levels: str = "") -> list[dict]:
    title_rule_2 = (
        f"1 space after title with identifier ({identifier_levels})."
        if identifier_levels
        else "1 space after title with identifier."
    )
    return [
        {
            "tags":         "</title>",
            "innodReplace": "2 hard returns after title with heading.",
        },
        {
            "tags":         "</title>",
            "innodReplace": title_rule_2,
        },
        {
            "tags":         "</paragraph>",
            "innodReplace": "2 hard returns after closing para and before opening para",
        },
        {
            "tags":         "</ul>",
            "innodReplace": "1 hard return after",
        },
        {
            "tags":         "</li>",
            "innodReplace": "1 hard return after",
        },
        {
            "tags":         "<p> within <li>",
            "innodReplace": (
                "</innodReplace><ul><innodReplace>\n"
                "  </innodReplace><li><innodReplace></innodReplace><p>(text)</p>"
                '<innodReplace text="&#10;&#10;">\n'
                "  </innodReplace><li><innodReplace>...\n"
                "</innodReplace></ul><innodReplace>"
            ),
        },
        {
            "tags":         "table\n<td>\n<th>",
            "innodReplace": (
                "</innodReplace><innodTd><td><innodReplace></innodReplace><p>...</p><innodReplace>\n"
                "                   </innodReplace><p>...</p><innodReplace>\n"
                "                   </innodReplace><p>...</p><innodReplace>\n"
                "</innodReplace></td></innodTd>\n"
                "</innodReplace></tr><innodTr><innodReplace>"
            ),
        },
    ]


# ---------------------------------------------------------------------------
# Public extractor
# ---------------------------------------------------------------------------

def extract_content_profile(doc) -> dict:
    """
    Aggregate scope, metadata, and toc results into a content profile
    matching the DE source spreadsheets.
    """

    # ── 1. Delegate to the three source extractors ──────────────────────────
    scope    = extract_scope(doc)
    metadata = extract_metadata(doc)
    toc      = extract_toc(doc)

    # ── 2. Top-level scalar fields ───────────────────────────────────────────
    toc_sections_pre: list[dict] = toc.get("sections") or []

    import re as _re_path

    def _path_from_section(sec: dict) -> str:
        """Return the extracted hardcoded path token for a Level 0 or 1 section."""
        path = str(sec.get("path") or "").strip()
        if path:
            return path
        defn = str(sec.get("definition") or "")
        return _extract_path_from_definition(defn)

    _level_paths: dict[str, str] = {}
    for _sec in toc_sections_pre:
        _lv_raw = str(_sec.get("level", "")).strip()
        _lv_match = _re_path.search(r"\d+", _lv_raw)
        _lv = _lv_match.group(0) if _lv_match else _lv_raw
        if _lv in ("0", "1"):
            _level_paths[_lv] = _path_from_section(_sec)

    _derived_path = _level_paths.get("0", "") + _level_paths.get("1", "")

    hardcoded_path = (
        _derived_path
        or metadata.get("hardcoded_path")
        or scope.get("hardcoded_path")
        or toc.get("hardcoded_path")
        or ""
    )

    # rc_filename = the full naming convention format string from the File
    # Naming section, e.g.:
    #   '"CFR" + " – " + <Level 2> + " – " + <MM/DD/YYYY of extraction>'
    #   '"AlabamaAdministrativeCode" + "Title" + title number from <Level 2> + ...'
    # We extract file_delivery first so we can use it here.
    file_delivery = _extract_file_delivery(doc) if hasattr(doc, "paragraphs") else {}
    rc_filename = file_delivery.get("rc_naming_convention", "").strip()

    # ── 3. Build Level rows from extracted TOC ───────────────────────────────
    toc_sections: list[dict] = toc.get("sections") or []
    levels = []

    for sec in toc_sections:
        level_raw = str(sec.get("level", "")).strip()
        if not level_raw:
            continue

        required     = str(sec.get("required",    "")).strip()
        name         = str(sec.get("name",        "")).strip()
        definition   = str(sec.get("definition",  "")).strip()
        example      = str(sec.get("example",     "")).strip()
        note         = str(sec.get("note",        "")).strip()
        sme_comments = str(sec.get("smeComments", "")).strip()

        # Path: prefer the pre-extracted "path" key (populated by toc_extractor
        # for Level 0/1 from their "Hardcoded – /xxx" definition), then fall
        # back to building it from the name for numbered levels.
        extracted_path = str(sec.get("path") or "").strip()
        if extracted_path:
            row_path = extracted_path
        elif name:
            row_path = f"/{name}"
        else:
            row_path = ""

        description_parts: list[str] = []
        if required:   description_parts.append(f"Required: {required}")
        if name:       description_parts.append(f"Name: {name}")
        if definition: description_parts.append(f"Definition: {definition}")
        if example:    description_parts.append(f"Example: {example}")

        levels.append({
            "levelNumber":  f"Level {level_raw}",
            "description":  "\n".join(description_parts),
            "redjayXmlTag": _build_redjay_tag(level_raw, example),
            "path":         row_path,
            "remarksNotes": note or sme_comments,
        })

    # ── 4. Whitespace rules ──────────────────────────────────────────────────
    extracted_whitespace: list[dict] = (
        toc.get("whitespace")
        or metadata.get("whitespace")
        or scope.get("whitespace")
        or []
    )
    identifier_levels: str = toc.get("identifier_levels") or ""
    whitespace = extracted_whitespace or _build_whitespace_rules(identifier_levels)

    # ── 5. Analytics passed through from scope ───────────────────────────────
    complexity         = scope.get("complexity", "medium")
    key_themes         = scope.get("key_themes", [])
    functional_areas   = scope.get("functional_areas") or toc.get("functional_areas", [])
    requirements_count = scope.get("requirements_count", 0)
    completeness_score = scope.get("completeness_score", 0)
    quality_notes      = scope.get("quality_notes", [])
    word_count         = scope.get("word_count", 0)
    has_diagrams: bool = scope.get("has_diagrams", False) or metadata.get("has_diagrams", False)
    has_tables:   bool = scope.get("has_tables",   False) or metadata.get("has_tables",   False)
    table_count        = scope.get(
        "table_count",
        len(doc.tables) if hasattr(doc, "tables") else 0
    )

    # ── 6. Return unified profile ────────────────────────────────────────────
    return {
        "rc_filename":        rc_filename,
        "hardcoded_path":     hardcoded_path,
        "heading_annotation": "Level 2",
        "levels":             levels,
        "whitespace":         whitespace,

        # ── File Delivery ──────────────────────────────────────────────────
        "file_separation":       file_delivery.get("file_separation",       ""),
        "rc_naming_convention":  file_delivery.get("rc_naming_convention",  ""),
        "rc_naming_example":     file_delivery.get("rc_naming_example",     ""),
        "zip_naming_convention": file_delivery.get("zip_naming_convention", ""),
        "zip_naming_example":    file_delivery.get("zip_naming_example",    ""),

        "document_type":      rc_filename,
        "complexity":         complexity,
        "primary_domain":     hardcoded_path,
        "key_themes":         key_themes,
        "functional_areas":   functional_areas,
        "requirements_count": requirements_count,
        "has_diagrams":       has_diagrams,
        "has_tables":         has_tables,
        "completeness_score": completeness_score,
        "quality_notes":      quality_notes,
        "word_count":         word_count,
        "table_count":        table_count,
        "source_config_key":  "",
    }