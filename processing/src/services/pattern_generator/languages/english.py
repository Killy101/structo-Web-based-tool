"""
english.py
----------
Pattern generator for English-language documents.
Handles Latin script: keyword prefixes, Arabic numerals,
Roman numerals, alphabetic suffixes, and common legal structures.

Key improvements over previous version
---------------------------------------
1. § (section sign) patterns recognized and generated correctly.
2. Free-text heading levels (centered headings, definition-of-terms labels)
   detected via definition text and resolved to ^.*$ instead of producing
   junk keyword patterns from the heading text itself.
3. Multi-example fields (pipe or newline separated) are split and the
   FIRST structural example is used for pattern inference — subsequent
   definition-of-terms examples are never fed to the keyword heuristic.
4. Citation rule text is consulted first: if the citation rule for a level
   contains an explicit example like "§ 217.132" or "(b)", that drives
   inference rather than the raw definition keywords.
5. Parenthetical identifier patterns — (a), (1), (ii), (A) — are detected
   directly from examples and produce tight patterns, not catch-alls.
6. definition is now threaded into _detect_parenthetical so the roman-vs-
   alpha tiebreaker for single-char examples like (i) works correctly.
7. Mojibake § normalisation: "Â§" (UTF-8 § mis-decoded as Latin-1) and
   "\\xa7" (raw Latin-1 byte) are both collapsed to canonical § before any
   pattern detection, so BRD cells pasted from PDFs always match correctly.
8. §§ (double section sign) supported — patterns emit ^§{1,2}\\s*... when
   double-sign examples are present.
9. ENGLISH_META_DEFAULT_LEVEL_PATTERNS corrected:
   - L3 now defaults to [IVXLCDM]+$ (Roman) not [0-9]+$ — matches CFR Chapter I
   - L4 now defaults to [A-Z]+$ (uppercase letter) not [0-9]+$ — matches CFR Subchapter A
   - L5 defaults to [0-9]+$ (Arabic) — matches CFR Part 217
   - L8 defaults to §\\s*[0-9]+\\.[0-9]+$ — matches CFR § 217.132
   - L16–L22 added as ^.*$ catch-alls for appendix sub-levels
10. ENGLISH_PATH_TRANSFORM_CLEANUP corrected for CFR structure:
    - L4 now abbreviates Subchapter→Subch. (was incorrectly mapping Subpart→Subpt.)
    - L6 now abbreviates Subpart→Subpt. (correct for CFR L6)
    - L15 added: Appendix→App., "to Part"→"to Pt.", Supplement→Supp.
      (produces "App. B to Pt. 707" per CFR citation rules)
    - L16, L21, L22 added with generic paren-strip cleanup

Abbreviation recognition sourced directly from BRD citation rules:
  Alabama    - ALA. ADMIN. CODE r. x-x-x.x
  Alaska     - Alaska Admin. Code tit. x, § x.x  /  Alaska Stat. § x-x-x
  California - Cal. Code Regs. tit. x, § x
  Colorado   - Colo. Rev. Stat. § x-x-x
  Delaware   - DEL. ADMIN. CODE § x
  Georgia    - Ga. Code § x-x-x
  Hawaii     - Haw. Code R. § x-x-x  /  Haw. Rev. Stat. § x-x
  Idaho      - Idaho Admin. Code r. x.x.x.x  /  Idaho Code § x-x
  Iowa       - Iowa Admin. Code r. x-x.x  /  Iowa Code § x
  Kentucky   - Ky. Rev. Stat. § x-x
  Louisiana  - LA. ADMIN. CODE tit. x, § x
  CFR        - 12 C.F.R. Ch. I, Subch. A / Pt. 217, Subpt. E / § 217.132(b)(2)
               App. B to Pt. 707 (L15 appendix abbreviation)

Multi-word / compound prefix support added from BRDs:
  Maryland           - Article - Commercial Law (plain text article)
  Massachusetts      - Part III / Title XXVI / Chapter 92A / Chapter92A1/2
  Minnesota Admin    - Subpart 1. / Subp. 2.
  Missouri Code      - Title 15 / DIVISION 10 / Chapter 1 / 1 CSR 10-1.010
                       Schedule A / Appendix A
  Montana Admin      - 2.12 / 2.12.102 / Subchapter 1 General...
  Montana Code       - Title 17 / Chapter 4 / Part 1 / Article I
  New Hampshire      - TITLE I / TITLE XXXIV-A / CHAPTER 6 / CHAPTER 110-C
  New Mexico         - CHAPTER 46 / ARTICLE 2 / PART 1 / SUBPART 1
  New York CL        - Article 1 / Title 1 / Subtitle A / Part 1 / Sub_part 1
  NYCRR              - Title 1 / Subtitle A / Chapter I / Subchapter A
                       Article 1 / Subarticle M / Part 5
                       Appendix 7 / Appendix 12B / Appendix 17-D
                       Supervisory Policy 1 ...
  NC Admin Code      - Title 04 / Chapter 01 / SubChapter A / Section .0100
                       04 NCAC 10A .0101 / CHAPTER 8 APPENDIX
  NC Gen Statutes    - Chapter 47A / Subchapter (roman) / Article 1A / Part 1
                       Subpart A / Article (roman at leaf)
  Oklahoma           - Title 6 / 14A-1-102 / (aa) duplicate-letter
  Oregon Admin       - 441 (chapter number) / DIVISION 175 / 441-175-0130
  Oregon Revised     - Volume : 09 / TITLE 10 / Chapter 001 / 659A.001
  Rhode Island       - Title 34 / CHAPTER 34-25.2 / PART 31-10.3-1
                       Article I / Part I / SCHEDULE A
  South Dakota Admin - ARTICLE 20:07 / 20:07:03 / 20:07:03:01 / 20:07:03:01.01
  Tennessee Code     - Title 26 / Chapter 101 / Part 11 / 45-2-1106
  CFR (Title 12)     - Chapter I / Subchapter A / Part 217 / Subpart E
                       § 217.132 / (b) / (2) / (ii) / (A) / (5) / (i)
                       Appendix to Part / centered free-text headings
"""

import re
from ..base import PatternGeneratorBase, LevelDefinition


# ---------------------------------------------------------------------------
# Full-word keyword prefixes (as they appear verbatim in document headings)
# ---------------------------------------------------------------------------
_KEYWORD_PREFIXES = [
    # Four-word (longest first to avoid partial matches)
    "APPENDIX TO SUBPART", "Appendix to Subpart",
    "SUPPLEMENT TO PART", "Supplement to Part",
    # Three-word
    "APPENDIX TO PART", "Appendix to Part",
    "SUPERVISORY POLICY", "Supervisory Policy",
    # Two-word
    "SUB_PART", "Sub_part",
    "SUBCHAPTER", "Subchapter", "SubChapter",
    "SUBDIVISION", "Subdivision",
    "SUBARTICLE", "Subarticle",
    "SUBGROUP", "Subgroup",
    "SUBPART", "Subpart",
    "SUBTITLE", "Subtitle",
    # One-word
    "CHAPTER", "Chapter",
    "PART", "Part",
    "SECTION", "Section",
    "ARTICLE", "Article",
    "RULE", "Rule",
    "DIVISION", "Division",
    "TITLE", "Title",
    "VOLUME", "Volume",
    "APPENDIX", "Appendix",
    "SCHEDULE", "Schedule",
    "EXHIBIT", "Exhibit",
    "FORM", "Form",
    "ATTACHMENT", "Attachment",
    "GROUP", "Group",
    "SUPPLEMENT", "Supplement",
    "TABLE", "Table",
    "BYLAWS", "Bylaws",
]

# ---------------------------------------------------------------------------
# Abbreviated keyword prefixes extracted from BRD citation rules.
# Each entry: (canonical_abbrev, regex_pattern_matching_that_abbrev)
# Ordered longest-first so more-specific abbreviations match before shorter ones.
# ---------------------------------------------------------------------------
_ABBREV_PATTERNS: list[tuple[str, str]] = [
    # Multi-word / compound abbreviations first
    ("Subchap.",    r"Subchap\."),
    ("Subch.",      r"Subch\."),
    ("Subtit.",     r"Subtit\."),
    ("Subgr.",      r"Subgr\."),
    ("Subdiv.",     r"Subdiv\."),
    ("Subpt.",      r"Subpt\."),
    ("Subart.",     r"Subart\."),
    ("Subarticle.", r"Subarticle\."),
    ("Subp.",       r"Subp\."),    # Minnesota Admin: "Subp. 2."
    # Single-word abbreviations
    ("Chap.",       r"Chap\."),
    ("Ch.",         r"Ch\."),
    ("Tit.",        r"Tit\."),
    ("tit.",        r"tit\."),
    ("TIT.",        r"TIT\."),
    ("Pt.",         r"Pt\."),
    ("PT.",         r"PT\."),
    ("Art.",        r"Art\."),
    ("ART.",        r"ART\."),
    ("Sec.",        r"Sec\."),
    ("SEC.",        r"SEC\."),
    ("Div.",        r"Div\."),
    ("DIV.",        r"DIV\."),
    ("App.",        r"App\."),
    ("APP.",        r"APP\."),
    ("Sch.",        r"Sch\."),
    ("SCH.",        r"SCH\."),
    ("Ex.",         r"Ex\."),
    ("Att.",        r"Att\."),
    ("Vol.",        r"Vol\."),     # Volume abbreviation
    ("r.",          r"r\."),       # "rule" — used in Alabama, Alaska, Idaho, Iowa admin codes
    ("R.",          r"R\."),       # "Rule" — used in Hawaii admin code ("Haw. Code R.")
]

# Combined regex that matches any known abbreviation at the start of a string
_ABBREV_RE = re.compile(
    r"^(" + "|".join(re.escape(a) for a, _ in _ABBREV_PATTERNS) + r")\s*",
    re.IGNORECASE,
)

_ROMAN = r"[IVXLCDM]+"
_ROMAN_LOWER = r"[ivxlcdm]+"
_ARABIC = r"[0-9]+"
_ALPHA_SUFFIX = r"[A-Z]?"
_ALPHA_SUFFIX_REQUIRED = r"[A-Z]"


# ---------------------------------------------------------------------------
# Default level-pattern fallbacks (used when inference is inconclusive)
# ---------------------------------------------------------------------------
ENGLISH_META_DEFAULT_LEVEL_PATTERNS: dict[str, list[str]] = {
    "2":  ["^.*$"],
    # L3: most English BRDs use Chapter + Roman (CFR) or Chapter + Arabic.
    # Roman is the safer default — Arabic is caught by inference when examples exist.
    "3":  ["[IVXLCDM]+$", "[0-9]+$"],
    # L4: Subchapter + uppercase letter (CFR) is the dominant pattern.
    "4":  ["[A-Z]+$", "[0-9]+$"],
    "5":  ["[0-9]+$"],
    "6":  ["[A-Z]+$", "[0-9]+$"],
    "7":  ["^.*$"],
    # L8: § N.N section identifier (post-pathTransform the § prefix is kept)
    "8":  ["^§\\s*[0-9]+\\.[0-9]+$", "[0-9]+\\.[0-9]+$"],
    # L9–L14: CFR parenthetical sub-levels — loose catch-all since the actual
    # type is inferred per-document from BRD examples.
    "9":  ["^\\([a-z]+\\)$", "^\\([0-9]+\\)$", "^.*$"],
    "10": ["^\\([0-9]+\\)$"],
    "11": ["^\\([ivxlcdm]+\\)$"],
    "12": ["^\\([A-Z]+\\)$", "^\\([a-z]+\\)$", "^.*$"],
    "13": ["^\\([0-9]+\\)$", "^\\([a-z]+\\)$", "^.*$"],
    "14": ["^\\([ivxlcdm]+\\)$", "^\\([a-z]+\\)$", "^.*$"],
    # L15: Appendix / Supplement to Part
    "15": ["^(Appendix(es)?|APPENDIX|Supplement|SUPPLEMENT).*$", "^.*$"],
    # L16–L22: appendix sub-levels are heterogeneous; catch-all is correct.
    "16": ["^.*$"],
    "17": ["^.*$"],
    "18": ["^.*$"],
    "19": ["^.*$"],
    "20": ["^.*$"],
    "21": ["^.*$"],
    "22": ["^.*$"],
}

# ---------------------------------------------------------------------------
# pathTransform cleanup rows.
# Each row: [find, replace, 0, ""]
# Covers both full-word forms AND their abbreviations from BRD citation rules.
#
# CFR-specific abbreviation map (from citation standardization rules):
#   L3  Chapter      → Ch.      "12 C.F.R. Ch. I"
#   L4  Subchapter   → Subch.   "12 C.F.R. Ch. I, Subch. A"
#   L5  Part         → Pt.      "12 C.F.R. Pt. 217"
#   L6  Subpart      → Subpt.   "12 C.F.R. Pt. 217, Subpt. E"
#   L15 Appendix     → App.     "12 C.F.R. Pt. 217, App. B to Pt. 707"
#        …to Part    → to Pt.
# ---------------------------------------------------------------------------
ENGLISH_PATH_TRANSFORM_CLEANUP: dict[str, list[list]] = {
    # ── L3: Chapter + Roman  →  Ch. I
    # Raw CFR heading: "CHAPTER I—Comptroller of the Currency, Department of the Treasury"
    # Strip em-dash title suffix first, then abbreviate keyword.
    "3": [
        ["—.*$",                    "",       0, ""],
        ["–.*$",                    "",       0, ""],
        [" \\[Reserved\\]$",        "",       0, ""],
        ["CHAPTER|Chapter|SubChapter|SUBCHAPTER|Subchapter", "Ch.",    0, ""],
        ["PART|Part",               "Pt.",    0, ""],
        ["TITLE|Title",             "Tit.",   0, ""],
        ["VOLUME|Volume",           "Vol.",   0, ""],
        ["tit\\.|Tit\\.|TIT\\.",    "Tit.",   0, ""],
        ["Ch\\.|Chap\\.",           "Ch.",    0, ""],
        ["Pt\\.|PT\\.",             "Pt.",    0, ""],
        ["Vol\\.",                  "Vol.",   0, ""],
        ["\\([0-9]+\\) ",           "",       0, ""],
        ["\\.—$",                   "",       0, ""],
        [":\\s*",                   " ",      0, ""],
    ],
    # ── L4: Subchapter + uppercase letter  →  Subch. A
    # Strip em-dash suffix first. Also handle space-less glue: "Subch. AOrganization..."
    "4": [
        ["—.*$",                    "",       0, ""],
        ["–.*$",                    "",       0, ""],
        [" \\[Reserved\\]$",        "",       0, ""],
        # Space-less heading: "Subch. AOrganization..." → "Subch. A"
        ["^((?:Subch|Subchapter|SUBCHAPTER)\\.?\\s*[A-Z])\\s*[A-Z].*$", "\\1", 0, ""],
        # Trailing title with space separator (no em-dash): "Subch. B Regulations..."
        ["^((?:Subch|Subchapter|SUBCHAPTER)\\.?\\s*[A-Z])\\s+\\S.*$", "\\1", 0, ""],
        ["SUBCHAPTER|Subchapter|SubChapter", "Subch.", 0, ""],
        ["PART|Part",               "Pt.",    0, ""],
        ["TITLE|Title",             "Tit.",   0, ""],
        ["SUBTITLE|Subtitle",       "Subtit.",0, ""],
        ["Subch\\.|Subchap\\.",     "Subch.", 0, ""],
        ["Pt\\.|PT\\.",             "Pt.",    0, ""],
        ["Subtit\\.",               "Subtit.",0, ""],
        ["tit\\.|Tit\\.|TIT\\.",    "Tit.",   0, ""],
        ["\\([0-9]+\\) ",           "",       0, ""],
        ["\\.—$",                   "",       0, ""],
    ],
    # ── L5: Part + number  →  Pt. 217
    # Raw CFR heading: "PART 1—INVESTMENT SECURITIES"
    "5": [
        ["—.*$",                    "",       0, ""],
        ["–.*$",                    "",       0, ""],
        [" \\[Reserved\\]$",        "",       0, ""],
        # "Parts N-M [Reserved]" → keep only first number: "Part N"
        ["^Parts?\\s+([0-9]+)[^0-9].*$", "Part \\1", 0, ""],
        ["PART|Part",               "Pt.",    0, ""],
        ["CHAPTER|Chapter|SubChapter|SUBCHAPTER|Subchapter", "Ch.",    0, ""],
        ["SUBCHAPTER|Subchapter|SubChapter",                 "Subch.", 0, ""],
        ["Ch\\.|Chap\\.",           "Ch.",    0, ""],
        ["Subch\\.|Subchap\\.",     "Subch.", 0, ""],
        ["\\([0-9]+\\) ",           "",       0, ""],
        ["\\.—$",                   "",       0, ""],
    ],
    # ── L6: Subpart + uppercase letter  →  Subpart A  (full word, NOT abbreviated)
    # Raw CFR heading: "Subpt. A—General Provisions"
    # "Subpt.s E through G—Reserved" → "Subpart E" (first letter only from range)
    "6": [
        ["—.*$",                    "",       0, ""],
        ["–.*$",                    "",       0, ""],
        [" \\[Reserved\\]$",        "",       0, ""],
        # "Subpt.s X through Y" / "Subpt.s X-Y" → keep first letter only
        ["^Subpts?\\.?s?\\s+([A-Z])(?:\\s+through\\s+[A-Z]|-[A-Z]).*$", "Subpart \\1", 0, ""],
        # Normalise "Subpt." back to full word
        ["Subpt\\.",                "Subpart",0, ""],
        # Section / Subchapter for non-CFR BRDs
        ["SECTION|Section",         "Sec.",   0, ""],
        ["SUBCHAPTER|Subchapter|SubChapter",  "Subch.", 0, ""],
        ["Sec\\.|SEC\\.",           "Sec.",   0, ""],
        ["Subch\\.|Subchap\\.",     "Subch.", 0, ""],
        ["^r\\.",                   "",       0, ""],
        ["^R\\.",                   "",       0, ""],
        ["\\([0-9]+\\) ",           "",       0, ""],
        ["\\.—$",                   "",       0, ""],
    ],
    # ── L7: free-text centered heading — passthrough, no transform
    "7": [
        ["DIVISION|Division",       "Div.",   0, ""],
        ["SUBDIVISION|Subdivision", "Subdiv.",0, ""],
        ["Div\\.|DIV\\.",           "Div.",   0, ""],
        ["Subdiv\\.",               "Subdiv.",0, ""],
        ["\\([0-9]+\\) ",           "",       0, ""],
        ["\\.—$",                   "",       0, ""],
    ],
    # ── L8: § N.N  (identifier only, no title text)
    # "§ 1.1 Authority..." → "§ 1.1"
    # "§§ 3.4-3.9 [Reserved]" → "§ 3.4"  (take first section from range)
    # "§ 141.15-141.19 [Reserved]" → "§ 141.15"  (single § hyphen range)
    # "§ 261a.1 Authority..." → "§ 261a.1"  (letter in part number)
    "8": [
        # §§ range: extract first §N.N, normalise to single §
        ["^§§\\s*([0-9]+\\.[0-9]+[a-zA-Z]?).*$", "§ \\1", 0, ""],
        # Single § hyphen range "§ 141.15-141.19": extract first N.N only
        ["^(§\\s*[0-9]+[a-zA-Z]?\\.[0-9]+)-[0-9].*$", "\\1", 0, ""],
        # Standard: extract §N.N (including letter-in-part like §261a.1), strip title
        ["^(§\\s*[0-9]+[a-zA-Z]*\\.[0-9]+(?:[a-zA-Z]|-[0-9]+[a-zA-Z]?)?).*$", "\\1", 0, ""],
        # Non-§ Article/Rule for other BRDs
        ["ARTICLE|Article",         "Art.",   0, ""],
        ["SUBARTICLE|Subarticle",   "Subart.",0, ""],
        ["Art\\.|ART\\.",           "Art.",   0, ""],
        ["Subart\\.",               "Subart.",0, ""],
        ["\\([0-9]+\\) ",           "",       0, ""],
        ["-$",                      "",       0, ""],
        ["(?<![0-9]\\.[0-9])\\.$",  "",       0, ""],
        ["\\.—$",                   "",       0, ""],
    ],
    # ── L9: parenthetical identifier  →  (b)
    # "(b) Pooled investments —" → "(b)"
    # "Additional tier 1 capital" → "(Additional tier 1 capital)"  (definition-of-terms)
    # "Notice," → "(Notice)"  (strip trailing comma)
    # "Low-income credit union (LICU )" → "(Low-income credit union (LICU))"  (strip space before ))
    "9": [
        # Strip inline title after standard paren identifier
        ["^(\\([a-zA-Z0-9]+\\))[\\s—].*$", "\\1", 0, ""],
        # Trailing em-dash with no text
        ["[\\s—]+$",                "",       0, ""],
        # Prose definition-of-terms: wrap entire text in parens
        ["^([^(].+[^-])$",          "(\\1)",  0, ""],
        # Strip trailing comma inside parens: "(Notice,)" → "(Notice)"
        ["^(\\(.*),\\)$",           "\\1)",   0, ""],
        # Strip trailing space before closing paren: "(LICU )" → "(LICU)"
        ["\\s+\\)$",                ")",      0, ""],
        # Non-paren Article/Rule for other BRDs
        ["ARTICLE|Article",         "Art.",   0, ""],
        ["RULE|Rule",               "Rule",   0, ""],
        ["Art\\.|ART\\.",           "Art.",   0, ""],
        ["^r\\.",                   "",       0, ""],
        ["^R\\.",                   "",       0, ""],
        ["\\([0-9]+\\) ",           "",       0, ""],
        ["-$",                      "",       0, ""],
        ["(?<![0-9]\\.[0-9])\\.$",  "",       0, ""],
        ["\\.—$",                   "",       0, ""],
    ],
    # ── L10: parenthetical number  →  (2)
    # levelPattern: ^\\([0-9]+\\)$
    # Raw token: "(2) Title text" → "(2)", or bare "(2)" → "(2)"
    "10": [
        # Strip trailing title after paren identifier: "(2) Title" → "(2)"
        ["^(\\([0-9]+\\))[\\s—].*$", "\\1",   0, ""],
        ["[\\s—]+$",                "",       0, ""],
        ["-$",                      "",       0, ""],
        ["\\.—$",                   "",       0, ""],
    ],
    # ── L11: parenthetical lowercase roman  →  (ii)
    # levelPattern: ^\\([ivxlcdm]+\\)$
    # Raw token: "(ii) Title text" → "(ii)", or bare "(ii)" → "(ii)"
    "11": [
        # Strip trailing title after paren identifier: "(ii) Title" → "(ii)"
        ["^(\\([ivxlcdm]+\\))[\\s—].*$", "\\1", 0, ""],
        ["[\\s—]+$",                "",       0, ""],
        ["-$",                      "",       0, ""],
        ["(?<![0-9]\\.[0-9])\\.$",  "",       0, ""],
    ],
    # ── L12: parenthetical uppercase letter  →  (A)
    "12": [
        ["^(\\([a-zA-Z0-9]+\\))[\\s—].*$", "\\1", 0, ""],
        ["[\\s—]+$",                "",       0, ""],
        ["\\([0-9]+\\) ",           "",       0, ""],
        ["-$",                      "",       0, ""],
        ["(?<![0-9]\\.[0-9])\\.$",  "",       0, ""],
    ],
    # ── L13: parenthetical number  →  (5)
    "13": [
        ["^(\\([a-zA-Z0-9]+\\))[\\s—].*$", "\\1", 0, ""],
        ["[\\s—]+$",                "",       0, ""],
        ["\\([0-9]+\\) ",           "",       0, ""],
        ["-$",                      "",       0, ""],
        ["(?<![0-9]\\.[0-9])\\.$",  "",       0, ""],
    ],
    # ── L14: parenthetical lowercase roman  →  (i)
    "14": [
        ["^(\\([a-zA-Z0-9]+\\))[\\s—].*$", "\\1", 0, ""],
        ["[\\s—]+$",                "",       0, ""],
        ["\\([0-9]+\\) ",           "",       0, ""],
        ["-$",                      "",       0, ""],
        ["(?<![0-9]\\.[0-9])\\.$",  "",       0, ""],
    ],
    # ── L15: Appendix/Supplement to Part  →  App. A to Subpart C of Pt. 4
    "15": [
        ["—.*$",                    "",       0, ""],
        ["–.*$",                    "",       0, ""],
        [" \\[Reserved\\]$",        "",       0, ""],
        # "App. A-I" or "App. A-B" range → "Appendixes A-I"
        ["^App\\.\\s+([A-Z]-[A-Z])\\b", "Appendixes \\1", 0, ""],
        # "Supp. X" → "Supplement X"
        ["^Supp\\.",                "Supplement", 0, ""],
        ["APPENDIX|Appendix(?:es)?", "App.",  0, ""],
        ["SUPPLEMENT|Supplement",   "Supp.",  0, ""],
        ["\\bPART\\b",              "Pt.",    0, ""],
        ["\\bPart\\b",              "Pt.",    0, ""],
        ["App\\.|APP\\.",           "App.",   0, ""],
        ["Supp\\.",                 "Supp.",  0, ""],
        ["\\([0-9]+\\) ",           "",       0, ""],
        ["\\([0-9]+\\)",            "",       0, ""],
        ["-$",                      "",       0, ""],
        ["(?<![0-9]\\.[0-9])\\.$",  "",       0, ""],
    ],
    # ── L16: appendix sub-heading  →  (I) / (Appendix A) / (Statement...)
    # "I. Model Stipulation"       → "(I)"
    # "Subpart A—Uniform Rules"    → "(Subpart A)"
    # "App. A—Model Disclosure..." → "(Appendix A)"
    # "A-7—Model Clauses..."       → "(A-7)"
    # "Statement Clarifying..."    → "(Statement Clarifying...)"
    "16": [
        ["—.*$",                    "",       0, ""],
        ["–.*$",                    "",       0, ""],
        # "App. X" / "App. X-Y" → "Appendix X"
        ["^App\\.\\s+([A-Z](?:-[A-Z0-9])?)", "Appendix \\1", 0, ""],
        # Roman numeral + dot + title → extract roman only
        ["^([IVXivx]+)\\.\\s+.*$",  "(\\1)",  0, ""],
        # "Part I." / "Part II." label
        ["^(Part [IVXivx]+)\\..*$", "(\\1)",  0, ""],
        # "X-N—title" identifier
        ["^([A-Z0-9]+-[0-9]+)[—\\s].*$", "(\\1)", 0, ""],
        # "Subpart X" or "Subpart X—title"
        ["^(Subparts?\\s+[A-Z])(?:[—–\\s].*)?$", "(\\1)", 0, ""],
        # "Appendix X" bare or with title
        ["^(Appendix\\s+[A-Z0-9-]+)(?:[—–\\s].*)?$", "(\\1)", 0, ""],
        # Bare prose: wrap in parens
        ["^([^(].+)$",              "(\\1)",  0, ""],
    ],
    # ── L17: §N.N inside parens  →  (§ 19.1)
    # "§ 19.1 Scope"               → "(§ 19.1)"
    # "§§ 165.1-165.7 [Reserved]"  → "(§ 165.1)"
    # "b. Allocation of..."        → "(b)"
    # "a . Small banks..."         → "(a)"  (space before dot)
    # "Owner-occupied,"            → "(Owner-occupied)"  (trailing comma)
    # bare "a"                     → "(a)"
    "17": [
        # §§ range: extract first §N.N
        ["^§§\\s*([0-9]+\\.[0-9]+[a-zA-Z]?).*$", "(§ \\1)", 0, ""],
        # Standard §N.N
        ["^(§\\s*[0-9]+[a-zA-Z]*\\.[0-9]+(?:[a-zA-Z]|-[0-9]+[a-zA-Z]?)?).*$", "(\\1)", 0, ""],
        # "X. Title" (space after dot) → "(X)"
        ["^([A-Za-z0-9]+)\\.\\s+.*$", "(\\1)", 0, ""],
        # "X . Title" (space BEFORE dot) → "(X)"
        ["^([A-Za-z0-9]+)\\s+\\.\\s+.*$", "(\\1)", 0, ""],
        # Paren + trailing title: strip title
        ["^(\\([a-zA-Z0-9]+\\))[\\s—].*$", "\\1", 0, ""],
        # Trailing comma inside parens: "(Owner-occupied,)" → "(Owner-occupied)"
        ["^(\\(.*),\\)$",           "\\1)",   0, ""],
        # Trailing space before closing paren
        ["\\s+\\)$",                ")",      0, ""],
        # Bare non-paren token: wrap
        ["^([^(].*)$",              "(\\1)",  0, ""],
        ["\\([0-9]+\\) ",           "",       0, ""],
        ["-$",                      "",       0, ""],
        ["(?<![0-9]\\.[0-9])\\.$",  "",       0, ""],
    ],
    # ── L18: (1)  — bare/titled token → wrapped identifier
    # "1" → "(1)",  "(a) Appearance..." → "(a)",  "3. Banks..." → "(3)"
    # "Section 1." → "(Section 1)" (strip trailing dot),  "[Escrow..." → strip bracket
    "18": [
        # Strip leading bracket artifact
        ["^\\[",                    "",       0, ""],
        # Paren + trailing title: strip title
        ["^(\\([a-zA-Z0-9]+\\))[\\s—].*$", "\\1", 0, ""],
        ["[\\s—]+$",                "",       0, ""],
        # "N. Title text" (space after dot) → "(N)"
        ["^([A-Za-z0-9]+)\\.\\s+.*$", "(\\1)", 0, ""],
        # Wrap bare token (catches "Section 1.", "1.", bare words, etc.)
        ["^([^(].*[^)])$",          "(\\1)",  0, ""],
        ["^([^()])$",               "(\\1)",  0, ""],
        # Strip trailing dot inside parens: "(Section 1.)" → "(Section 1)"
        ["^(\\(.*)\\.\\)$",         "\\1)",   0, ""],
        ["\\.-$",                   "",       0, ""],
        ["\\. -$",                  "",       0, ""],
    ],
    # ── L19: (i)  — bare/titled token → wrapped identifier
    "19": [
        ["^(\\([a-zA-Z0-9]+\\))[\\s—].*$", "\\1", 0, ""],
        ["[\\s—]+$",                "",       0, ""],
        # "N. Title" → "(N)"
        ["^([A-Za-z0-9]+)\\.\\s+.*$", "(\\1)", 0, ""],
        # Wrap bare token
        ["^([^(].*[^)])$",          "(\\1)",  0, ""],
        ["^([^()])$",               "(\\1)",  0, ""],
        # Strip trailing dot inside parens
        ["^(\\(.*)\\.\\)$",         "\\1)",   0, ""],
    ],
    # ── L20: (a)/(1)  — bare token → wrapped; paren+title → strip title
    # "i. Examples" → "(i)"  (strip dot-title)
    # "—a" → "(a)"  (strip leading em-dash)
    "20": [
        # Strip leading em-dash artifact: "—a" → "a"
        ["^[—–]",                   "",       0, ""],
        # Paren identifier + trailing title: strip title
        ["^(\\([a-zA-Z0-9]+\\))[\\s—].*$", "\\1", 0, ""],
        ["[\\s—]+$",                "",       0, ""],
        # "i. Title" / "6. Title" → extract identifier, wrap
        ["^([a-zA-Z0-9]+)\\.\\s+.*$", "(\\1)", 0, ""],
        # Wrap bare (non-paren) token
        ["^([^(].*[^)])$",          "(\\1)",  0, ""],
        ["^([^()])$",               "(\\1)",  0, ""],
    ],
    # ── L21: (1)  — bare token → wrapped; curly quotes normalised
    # Trailing dot inside quoted string stripped: ("text.") → ("text")
    "21": [
        # Normalise curly quotes → straight  ('"Acceptance"' → '"Acceptance"')
        ["\\u201c",                 "\"",     0, ""],
        ["\\u201d",                 "\"",     0, ""],
        # Paren + trailing title/em-dash: strip
        ["^(\\([a-zA-Z0-9]+\\))[\\s—].*$", "\\1", 0, ""],
        ["[\\s—]+$",                "",       0, ""],
        # Wrap bare token
        ["^([^(].*[^)])$",          "(\\1)",  0, ""],
        ["^([^()])$",               "(\\1)",  0, ""],
        # Strip trailing dot inside parens before closing quote:
        # '("text.")' → '("text")'
        ["^(\\(\".*)\\.\"\\)$",     "\\1\")", 0, ""],
        # Strip trailing dot inside plain parens: "(text.)" → "(text)"
        ["^(\\(.*)\\.\\)$",         "\\1)",   0, ""],
    ],
    # ── L22: (A)  — bare token → wrapped
    "22": [
        ["^(\\([a-zA-Z0-9]+\\))[\\s—].*$", "\\1", 0, ""],
        ["[\\s—]+$",                "",       0, ""],
        ["^([^(].*[^)])$",          "(\\1)",  0, ""],
        ["^([^()])$",               "(\\1)",  0, ""],
        ["-$",                      "",       0, ""],
        ["(?<![0-9]\\.[0-9])\\.$",  "",       0, ""],
    ],
}


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _normalize_section_sign(text: str) -> str:
    """
    Normalise mojibake / encoding artifacts that masquerade as the section sign §.

    BRD cells pasted from PDFs or copied across encodings frequently arrive as:
      - "Â§"    — UTF-8 § (0xC2 0xA7) misread as Latin-1
      - "Â§§"   — double section sign with leading Â
      - "\\xa7"  — raw Latin-1 byte (U+00A7 section sign)
      - "§§"    — legitimate double section sign

    All forms are collapsed to the canonical "§" (U+00A7) so downstream
    detection and pattern-building see a consistent prefix.
    """
    # Remove the spurious Â that appears when UTF-8 § is decoded as Latin-1
    text = re.sub(r"Â(§+)", r"\1", text)
    # Raw Latin-1 byte U+00A7 → proper Unicode section sign
    text = text.replace("\xa7", "§")
    return text


def _split_primary_examples(examples: list[str]) -> list[str]:
    """
    Many BRDs (especially CFR) put multiple example types in one field,
    separated by newlines or pipe characters:

        "(b) | \"Financial end user\""   — structural id + definition term
        "(2) | \"Seller's interest\""

    Only the FIRST token per example entry is the structural identifier.
    The rest are definition-of-terms labels that should never drive
    pattern inference (they look like prose and trigger keyword heuristics).

    This function returns only the first structural token from each entry,
    with mojibake section-sign artifacts normalised (Â§ → §, \\xa7 → §).
    """
    result: list[str] = []
    for ex in examples:
        if not ex or not ex.strip():
            continue
        # Normalise encoding artifacts before any splitting or matching
        ex = _normalize_section_sign(ex)
        # Split on pipe or newline, take only the first non-empty part
        parts = re.split(r'\s*[\|\n]\s*', ex.strip())
        first = parts[0].strip().strip('"')
        if first:
            result.append(first)
    return result


def _is_free_text_heading(definition: str, examples: list[str]) -> bool:
    """
    Return True when a level is a free-text heading rather than a
    structured identifier.  These levels must resolve to ^.*$ because
    their content is arbitrary prose.

    Detection signals (in priority order):
      1. Primary examples look like structural identifiers → NOT free text
         (parentheticals, §, roman, bare numbers all override definition text)
      2. Definition contains "centered heading", "heading above", "free text"
      3. Definition contains "definition of terms" AND primary example is prose
         (NOT a parenthetical — these are mixed levels like CFR L9 which has
         both "(b)" structural ids AND "Financial end user" definition labels)
      4. Primary example contains spaces and no structural markers → free text
    """
    primary = _split_primary_examples(examples)
    first = primary[0].strip() if primary else ""

    # ── Step 1: structural overrides — always wins ────────────────────────────
    # If the first primary example is a structural identifier, it is NOT free text
    # regardless of what the definition text says.
    structural_patterns = [
        r"^§",                        # section sign: § 217.132
        r"^\([a-zA-Z0-9]+\)$",        # parenthetical: (b) (2) (ii) (A) (aa)
        r"^[IVXLCDM]+$",              # bare upper roman
        r"^[ivxlcdm]+$",              # bare lower roman
        r"^[0-9]+$",                  # bare number
        r"^[0-9]+\.[0-9]",            # dotted decimal: 1.1
        r"^[0-9]+-[0-9]",             # hyphenated number: 14A-1
        r"^\.[0-9]+$",                # dot-prefixed: .0100
        r"^[A-Z]\.$",                 # single cap + dot: A.
        r"^[0-9]+\.$",                # number + dot: 1.
        r"^[a-z]\.$",                 # lowercase + dot: a.
        r"^[ivxlcdm]+\.$",            # roman + dot: ii.
    ]
    if first:
        for pat in structural_patterns:
            if re.search(pat, first):
                return False
        # Known keyword prefix → structural
        if _detect_prefix(primary):
            return False
        if _detect_abbrev_prefix(primary):
            return False

    # ── Step 2: explicit heading signals in definition ────────────────────────
    defn_lower = definition.lower()
    if re.search(r"centered.{0,20}heading|heading.{0,20}above|free.?text", defn_lower):
        return True

    # ── Step 3: "definition of terms" only fires when example is also prose ──
    # CFR L9 definition = "Incrementing lowercase letter | Definition of terms"
    # but the primary example IS "(b)" — structural, already returned False above.
    # This branch only fires when primary example passed all structural checks.
    if "definition of terms" in defn_lower and first and " " in first:
        return True

    # ── Step 4: multi-word prose example with no structural markers ───────────
    if first and " " in first:
        # Allow known appendix / supplement / table keyword prefixes
        if not re.search(
            r"^(appendix|supplement|table|bylaws|schedule|exhibit)",
            first, re.IGNORECASE
        ):
            return True

    return False


def _detect_section_sign(examples: list[str]) -> bool:
    """Return True if examples contain § identifiers like '§ 217.132' or '§§ 217.132'.
    Also handles mojibake forms like 'Â§ 217.132'."""
    primary = _split_primary_examples(examples)
    return any(
        re.match(r"^§", _normalize_section_sign(ex.strip()))
        for ex in primary
    )


def _build_section_sign_pattern(examples: list[str]) -> list[str]:
    """
    Build a regex for § section identifiers.
    Handles:
      § 217.132          — standard single § with decimal
      §§ 217.132         — double section sign (cross-references)
      Â§ 217.132         — mojibake form (UTF-8 mis-decoded as Latin-1)
      § 217.132-1        — with hyphen sub-article
      § 217.132a         — with alpha suffix
      § 45.2             — plain decimal
      § 45               — plain integer (no decimal)
    """
    primary = _split_primary_examples(examples)
    # Normalise mojibake before analysis
    normalised = [_normalize_section_sign(ex.strip()) for ex in primary]
    stripped = [
        re.sub(r"^§{1,2}\s*", "", ex)
        for ex in normalised
        if re.match(r"^§", ex)
    ]

    # Detect structural variants
    has_hyphen  = any("-" in s for s in stripped)
    has_alpha   = any(re.search(r"[0-9][a-zA-Z]$", s) for s in stripped)
    has_decimal = any(re.search(r"[0-9]\.[0-9]", s) for s in stripped)

    # §§ present in any example → include double-sign variant in pattern
    has_double = any(re.match(r"^§§", ex) for ex in normalised)
    sign = r"§{1,2}" if has_double else r"§"

    if has_decimal:
        base = rf"^{sign}\s*[0-9]+\.[0-9]+"
        suffix = ""
        if has_alpha:
            suffix += r"[a-zA-Z]?"
        if has_hyphen:
            suffix += r"(?:-[0-9]+[a-zA-Z]?)?"
        return [base + suffix + r"$"]

    # Plain § + number (no decimal)
    return [rf"^{sign}\s*[0-9]+[a-zA-Z]?$"]


def _detect_parenthetical(examples: list[str], definition: str = "") -> str | None:
    """
    Detect pure parenthetical identifier styles from the PRIMARY examples.

    Returns one of:
      'lower_roman'  — (i), (ii), (iv), (xii)  — roman numerals take priority
      'lower_alpha'  — (b), (c), (d)            — non-roman single letters
      'upper_alpha'  — (A), (B), (AA)
      'number'       — (2), (5)
      'dup_lower'    — (aa), (bb) Oklahoma style
      None           — not a parenthetical level

    Priority rule: roman numeral letters (i v x l c d m) are checked BEFORE
    single-letter alpha so that (i) → lower_roman not lower_alpha.
    The definition text is used as a tiebreaker when the example is ambiguous.
    """
    primary = _split_primary_examples(examples)
    if not primary:
        return None

    _ROMAN_CHARS = set("ivxlcdm")

    def _classify(s: str, defn: str = "") -> str | None:
        if not re.fullmatch(r"\([a-zA-Z0-9]+\)", s):
            return None
        inner = s[1:-1]
        # Roman numeral check FIRST (before single-letter alpha)
        if re.fullmatch(r"[ivxlcdm]+", inner):
            # Single-char ambiguous: (i), (v), (x), (l)
            # Use definition text as tiebreaker; default to roman
            if len(inner) == 1:
                defn_lower = defn.lower()
                if "lowercase letter" in defn_lower and "roman" not in defn_lower:
                    return "lower_alpha"
                return "lower_roman"
            return "lower_roman"
        if re.fullmatch(r"[a-z]{2,}", inner):
            return "dup_lower"
        if re.fullmatch(r"[a-z]", inner):
            return "lower_alpha"
        if re.fullmatch(r"[A-Z]+", inner):
            return "upper_alpha"
        if re.fullmatch(r"[0-9]+", inner):
            return "number"
        return None

    types: list[str] = []
    for ex in primary:
        t = _classify(ex.strip(), definition)
        if t is not None:
            types.append(t)

    valid = [t for t in types if t is not None]
    if not valid:
        return None
    return max(set(valid), key=valid.count)


def _build_parenthetical_pattern(ptype: str) -> list[str]:
    """Return the regex for a given parenthetical type."""
    return {
        "lower_roman": [r"^\([ivxlcdm]+\)$"],
        "lower_alpha":  [r"^\([a-z]\)$"],
        "upper_alpha":  [r"^\([A-Z]+\)$"],
        "number":       [r"^\([0-9]+\)$"],
        "dup_lower":    [r"^\([a-z]{2,}\)$"],
    }[ptype]


def _detect_prefix(examples: list[str]) -> str | None:
    """
    Return the full-word keyword prefix if all PRIMARY examples share one.
    Handles multi-word prefixes like 'Supervisory Policy', 'Sub_part', 'SubChapter'.
    Tries longer (multi-word) prefixes before shorter ones to avoid false matches.
    """
    sample = _split_primary_examples(examples)
    if not sample:
        return None
    for kw in _KEYWORD_PREFIXES:
        if all(ex.upper().startswith(kw.upper()) for ex in sample):
            return kw
    return None


def _detect_abbrev_prefix(examples: list[str]) -> str | None:
    """
    Return the abbreviated keyword prefix if all PRIMARY examples share one.
    Handles forms like 'tit. 11', 'Ch. 5', 'Subch. 3', 'r. 000', 'Subp. 2.', etc.
    """
    sample = _split_primary_examples(examples)
    if not sample:
        return None
    for abbrev, abbrev_re in _ABBREV_PATTERNS:
        pat = re.compile(r"^" + abbrev_re, re.IGNORECASE)
        if all(pat.match(ex) for ex in sample):
            return abbrev
    return None


def _has_roman(examples: list[str]) -> bool:
    return any(re.search(r'\b[IVXLCDM]{2,}\b', ex) for ex in examples)


def _has_decimal(examples: list[str]) -> bool:
    return any(re.search(r'\d+\.\d+', ex) for ex in examples)


def _has_hyphen(examples: list[str]) -> bool:
    return any("-" in ex for ex in examples)


def _has_alpha_suffix(examples: list[str]) -> bool:
    return any(re.search(r'\d+[A-Z]', ex) for ex in examples)


def _has_colon_separator(examples: list[str]) -> bool:
    """Detect South Dakota style colon-separated identifiers: 20:07, 20:07:03."""
    return any(re.search(r'\d+:\d+', ex) for ex in examples)


def _has_fractional_suffix(examples: list[str]) -> bool:
    """Detect Mass. style fractions: Chapter92A1/2."""
    return any("/" in ex for ex in examples)


def _has_duplicate_alpha(examples: list[str]) -> bool:
    """Detect Oklahoma-style doubled letters in parens: (aa), (bb)."""
    return any(re.search(r'\([a-z]{2,}\)', ex) for ex in examples)


def _is_heterogeneous(examples: list[str]) -> bool:
    """
    Return True when examples contain more than one incompatible identifier
    type.  Levels like CFR L16-L21 list many different formats in one cell
    (roman numerals, numbers, keywords, parentheticals, prose) — no single
    tight regex can cover them all.  These levels must return ^.*$.

    A single-example level is never heterogeneous regardless of type.
    """
    if not examples or len(examples) < 2:
        return False

    type_checks = [
        ("roman_upper_dot", lambda s: bool(re.fullmatch(r"[IVXLCDM]+\.?", s) and len(s) > 1)),
        ("roman_lower_dot", lambda s: bool(re.fullmatch(r"[ivxlcdm]{2,}\.?", s))),
        ("number_dot",      lambda s: bool(re.fullmatch(r"[0-9]+\.", s))),
        ("paren_any",       lambda s: bool(re.fullmatch(r"\([a-zA-Z0-9]+\)", s))),
        ("keyword",         lambda s: bool(re.match(
            r"(Chapter|Part|Appendix|Table|Bylaws|Section|Supplement|Article)",
            s, re.IGNORECASE))),
        ("alpha_dot",       lambda s: bool(re.fullmatch(r"[A-Z]{1,3}\.", s))),
        ("alpha_hyphen",    lambda s: bool(re.search(r"^[A-Z]-[0-9]|^[0-9]+-[A-Z]", s))),
        ("composite",       lambda s: bool(re.search(r"\.[A-Z]|[A-Z]\.[0-9]", s))),
        ("bare_alpha_dot",  lambda s: bool(re.fullmatch(r"[a-z]\.", s))),
        ("prose",           lambda s: bool(
            " " in s
            and not re.match(r"(Appendix|Supplement|Chapter|Table|Section)", s, re.IGNORECASE)
        )),
    ]

    def _classify_het(s: str) -> str:
        if re.fullmatch(r"\([ivxlcdm]+\)", s): return "roman_paren"
        if re.fullmatch(r"\([a-zA-Z0-9]+\)", s): return "paren"
        if re.fullmatch(r"[IVXLCDM]+\.?", s) and len(s) > 1: return "roman_upper"
        if re.fullmatch(r"[ivxlcdm]{2,}\.?", s): return "roman_lower"
        if re.fullmatch(r"[0-9]+\.", s): return "number_dot"
        if re.fullmatch(r"[0-9]+", s): return "bare_number"
        if re.match(r"^§", s): return "section"
        if re.match(
            r"(Chapter|Part|Appendix|Table|Bylaws|Section|Supplement|Article)",
            s, re.IGNORECASE
        ): return "keyword"
        if re.fullmatch(r"[A-Z]{1,3}\.", s): return "alpha_dot"
        if re.fullmatch(r"[a-z]\.", s): return "bare_alpha_dot"
        if re.search(r"^[A-Z]-[0-9]|^[0-9]+-[A-Z]", s): return "alpha_hyphen"
        if re.search(r"\.[A-Z]|[A-Z]\.[0-9]", s): return "composite"
        # Prose / definition-of-terms labels — do NOT count toward heterogeneity
        return "prose_or_label"

    structural: set[str] = set()
    for ex in examples:
        s = ex.strip()
        if not s:
            continue
        t = _classify_het(s)
        if t != "prose_or_label":
            structural.add(t)

    # Multiple distinct structural types → heterogeneous → ^.*$
    return len(structural) > 1



def _abbrev_to_regex_group(abbrev: str) -> str:
    """
    Build a regex alternation group for a canonical abbreviation.
    E.g. 'Tit.' -> '(Tit\\.|tit\\.|TIT\\.)'
         'Subch.' -> '(Subch\\.|SUBCH\\.)'
         'r.' -> '(r\\.)'
         'Subp.' -> '(Subp\\.|subp\\.|SUBP\\.)'
    """
    esc   = re.escape(abbrev)
    upper = re.escape(abbrev.upper())
    title = re.escape(abbrev[0].upper() + abbrev[1:].lower())
    lower = re.escape(abbrev.lower())

    variants: list[str] = []
    for v in (esc, upper, title, lower):
        if v not in variants:
            variants.append(v)
    return "(" + "|".join(variants) + ")"


def _build_abbrev_pattern(abbrev: str, stripped: list[str]) -> list[str]:
    """
    Given an abbreviated prefix (e.g. 'Subch.') and the stripped
    numbering tokens, build one or more regex patterns.
    """
    kw = _abbrev_to_regex_group(abbrev)
    number_tail = r"[0-9A-Za-z]+(?:[.\-][0-9A-Za-z]+)*"

    # Pure roman numeral numbering (e.g. 'Part IV' abbreviated as 'Pt. IV')
    if stripped and all(re.fullmatch(r"[IVXLCDM]+", s) for s in stripped if s):
        return [f"^{kw}\\s*[IVXLCDM]+$"]

    # Plain number + optional alpha suffix
    if stripped and all(re.fullmatch(r"[0-9]+[A-Z]?\.?", s) for s in stripped if s):
        has_dot = any(s.endswith(".") for s in stripped if s)
        return [f"^{kw}\\s*{number_tail}{'\\.' if has_dot else ''}?$"]

    patterns: list[str] = []
    if _has_decimal(stripped) and _has_hyphen(stripped) and _has_alpha_suffix(stripped):
        patterns.append(f"^{kw}\\s*{_ARABIC}{_ALPHA_SUFFIX}$")
        patterns.append(f"^{kw}\\s*{_ARABIC}{_ALPHA_SUFFIX}-{_ARABIC}$")
        patterns.append(f"^{kw}\\s*{_ARABIC}{_ALPHA_SUFFIX}\\.{_ARABIC}$")
    elif _has_hyphen(stripped):
        patterns.append(f"^{kw}\\s*{_ARABIC}{_ALPHA_SUFFIX}$")
        patterns.append(f"^{kw}\\s*{_ARABIC}{_ALPHA_SUFFIX}-{_ARABIC}$")
    elif _has_decimal(stripped):
        patterns.append(f"^{kw}\\s*{_ARABIC}{_ALPHA_SUFFIX}$")
        patterns.append(f"^{kw}\\s*{_ARABIC}{_ALPHA_SUFFIX}\\.{_ARABIC}$")
    elif _has_alpha_suffix(stripped):
        patterns.append(f"^{kw}\\s*{_ARABIC}{_ALPHA_SUFFIX}$")
    else:
        # Plain number, possibly with alpha suffix
        _has_trailing = any(re.search(r'^[0-9]+\s+\S', s) for s in stripped if s)
        if _has_trailing:
            patterns.append(f"^{kw}\\s+{_ARABIC}(?:\\s+.*)?$")
        else:
            patterns.append(f"^{kw}\\s*{_ARABIC}$")

    # "Supervisory Policy N <subject>" — allow trailing text
    if abbrev.upper().replace(".", "") in ("SUPERVISORY POLICY",):
        patterns = [f"^{kw}\\s+{_ARABIC}(?:\\s+.*)?$"]

    return patterns if patterns else [f"^{re.escape(abbrev)}\\s*.*$"]


def _build_keyword_pattern(prefix: str, stripped: list[str]) -> list[str]:
    """
    Build regex patterns for a detected full-word keyword prefix.
    """
    kw_upper = prefix.upper()
    kw_title = prefix[0].upper() + prefix[1:].lower() if len(prefix) > 1 else prefix.upper()
    _kw_variants: set[str] = {prefix, kw_upper, kw_title}
    _mixed_map = {
        "SUBCHAPTER":         {"SubChapter", "Subchapter"},
        "SUB_PART":           {"Sub_part"},
        "SUBARTICLE":         {"Subarticle"},
        "SUBDIVISION":        {"Subdivision"},
        "SUBPART":            {"Subpart"},
        "SUBTITLE":           {"Subtitle"},
        "SUBGROUP":           {"Subgroup"},
        "SUPERVISORY POLICY": {"Supervisory Policy"},
        "SUPPLEMENT":         {"Supplement"},
        "BYLAWS":             {"Bylaws"},
        "TABLE":              {"Table"},
    }
    _kw_variants |= _mixed_map.get(kw_upper, set())
    kw = "(" + "|".join(re.escape(v) for v in sorted(_kw_variants, key=len, reverse=True)) + ")"

    patterns: list[str] = []

    # ── Special composite formats ────────────────────────────────────────────

    # "Appendix to Part NNN" / "Appendix MS to Part NNN" / "Appendix MS-1 to Part NNN"
    # "Appendix to Subpart A of Part NNN"
    # "Supplement I to Part NNN"
    if kw_upper in ("APPENDIX TO PART", "APPENDIX TO SUBPART", "SUPPLEMENT TO PART"):
        return [f"^{kw}\\s+.*$"]

    # RI PART with complex hyphen-decimal: "PART 31-10.3-1"
    if kw_upper == "PART" and stripped and any(re.match(r'[0-9]+-[0-9]', s) for s in stripped if s):
        patterns.append(f"^{kw}\\s+{_ARABIC}-{_ARABIC}(?:\\.{_ARABIC}+)?(?:-{_ARABIC}+)?$")
        return patterns

    # NYCRR Appendix with numeric identifier + optional letter or hyphen-letter
    if kw_upper == "APPENDIX" and stripped and any(re.match(r'[0-9]', s) for s in stripped if s):
        return [f"^{kw}\\s+{_ARABIC}[A-Z]?$", f"^{kw}\\s+{_ARABIC}-[A-Z]$"]

    # NC Admin: "CHAPTER 8 APPENDIX"
    if stripped and any(re.fullmatch(r'[0-9]+\s+APPENDIX', s, re.IGNORECASE) for s in stripped if s):
        patterns.append(f"^{kw}\\s+{_ARABIC}\\s+(APPENDIX|Appendix)$")
        return patterns

    # RI style: "34-25.2 Rhode Island Home Loan..."
    if stripped and any(re.match(r'[0-9]+-[0-9]+(?:\.[0-9]+)?(?:\s+\S+)?', s) for s in stripped if s):
        if any('-' in s and not re.fullmatch(r'[0-9]+-[A-Z]', s) for s in stripped if s):
            patterns.append(f"^{kw}\\s+{_ARABIC}-{_ARABIC}(?:\\.{_ARABIC}+)?(?:\\s+.*)?$")
            return patterns

    # South Dakota colon-separated: ARTICLE 20:07
    if _has_colon_separator(stripped):
        patterns.append(f"^{kw}\\s*{_ARABIC}:{_ARABIC}(?::{_ARABIC})*(?:\\.{_ARABIC}+)?$")
        return patterns

    # Missouri CSR: "1 CSR 10-1.010"
    if any(re.search(r'\d+\s+CSR\s+', ex) for ex in stripped):
        patterns.append(r"^[0-9]+\s+CSR\s+[0-9]+-[0-9]+\.[0-9]+$")
        return patterns

    # NC Admin NCAC: "04 NCAC 10A .0101"
    if any(re.search(r'NCAC', ex, re.IGNORECASE) for ex in stripped):
        patterns.append(r"^[0-9]+\s+NCAC\s+[0-9]+[A-Z]?\s+\.[0-9]+$")
        return patterns

    # Montana Admin dot-separated rule: "2.12.102"
    if stripped and all(re.fullmatch(r'[0-9]+(?:\.[0-9]+)+', s) for s in stripped if s):
        segments = max(s.count('.') + 1 for s in stripped if s)
        dot_seg = r"[0-9]+" + r"\.[0-9]+" * (segments - 1)
        patterns.append(f"^{dot_seg}$")
        return patterns

    # Mass. fraction suffix: "Chapter92A1/2"
    if _has_fractional_suffix(stripped):
        patterns.append(f"^{kw}\\s*{_ARABIC}[A-Z]?(?:[0-9]+/[0-9]+)?$")

    # ── Roman numeral numbering ─────────────────────────────────────────────
    if stripped and all(re.fullmatch(r'[IVXLCDM]+(?:-[A-Z])?', s) for s in stripped if s):
        if any("-" in s for s in stripped if s):
            return [f"^{kw}\\s+[IVXLCDM]+-[A-Z]$", f"^{kw}\\s+[IVXLCDM]+$"]
        return [f"^{kw}\\s+[IVXLCDM]+$"]

    # Lowercase roman (leaf sublevels)
    if stripped and all(re.fullmatch(r'[ivxlcdm]+', s) for s in stripped if s):
        return [f"^{kw}\\s+[ivxlcdm]+$"]

    # ── Uppercase letter identifier (SubChapter A, Subpart A, Subtitle A) ───
    if stripped and all(re.fullmatch(r'[A-Z]', s) for s in stripped if s):
        return [f"^{kw}\\s*[A-Z]$"]

    # Uppercase letter + optional trailing subject
    if stripped and all(re.fullmatch(r'[A-Z](?:\s+\S+)*', s) for s in stripped if s):
        if all(re.fullmatch(r'[A-Z]', s) for s in stripped if s):
            return [f"^{kw}\\s*[A-Z]$"]
        patterns.append(f"^{kw}\\s*[A-Z](?:\\s+.*)?$")
        return patterns

    # ── Arabic numbering with variations ────────────────────────────────────
    has_dec   = _has_decimal(stripped)
    has_hyp   = _has_hyphen(stripped)
    has_alpha = _has_alpha_suffix(stripped)

    if kw_upper == "SUPPLEMENT" and stripped:
        # "Supplement I to Part 1026" — allow free text after keyword
        return [f"^{kw}\\s+.*$"]

    if kw_upper in ("TABLE", "BYLAWS") and stripped:
        return [f"^{kw}\\s*.*$"]

    # Chapter 110-C — number-hyphen-single-uppercase-letter
    if has_hyp and stripped and any(re.fullmatch(r'[0-9]+-[A-Z]', s) for s in stripped if s):
        patterns.append(f"^{kw}\\s+{_ARABIC}-[A-Z]$")
        patterns.append(f"^{kw}\\s+{_ARABIC}$")
        return patterns

    if has_dec and has_hyp and has_alpha:
        patterns.append(f"^{kw}\\s+{_ARABIC}{_ALPHA_SUFFIX}$")
        patterns.append(f"^{kw}\\s+{_ARABIC}{_ALPHA_SUFFIX}-{_ARABIC}$")
        patterns.append(f"^{kw}\\s+{_ARABIC}{_ALPHA_SUFFIX}\\.{_ARABIC}$")
    elif has_hyp and has_alpha:
        patterns.append(f"^{kw}\\s+{_ARABIC}{_ALPHA_SUFFIX}$")
        patterns.append(f"^{kw}\\s+{_ARABIC}-[A-Z]$")
        patterns.append(f"^{kw}\\s+{_ARABIC}{_ALPHA_SUFFIX}-{_ARABIC}$")
    elif has_dec and has_alpha:
        patterns.append(f"^{kw}\\s*{_ARABIC}{_ALPHA_SUFFIX}$")
        patterns.append(f"^{kw}\\s*{_ARABIC}{_ALPHA_SUFFIX}\\.{_ARABIC}$")
    elif has_alpha:
        patterns.append(f"^{kw}\\s*{_ARABIC}{_ALPHA_SUFFIX}$")
    elif has_dec:
        patterns.append(f"^{kw}\\s*{_ARABIC}$")
        patterns.append(f"^{kw}\\s*{_ARABIC}\\.{_ARABIC}$")
    elif has_hyp:
        patterns.append(f"^{kw}\\s*{_ARABIC}$")
        patterns.append(f"^{kw}\\s*{_ARABIC}-{_ARABIC}$")
    else:
        # Plain number — detect if examples carry a trailing subject
        _has_trailing = any(re.search(r'^[0-9]+\s+\S', s) for s in stripped if s)
        if _has_trailing:
            patterns.append(f"^{kw}\\s+{_ARABIC}(?:\\s+.*)?$")
        else:
            patterns.append(f"^{kw}\\s*{_ARABIC}$")

    if kw_upper in ("SUPERVISORY POLICY",):
        patterns = [f"^{kw}\\s+{_ARABIC}(?:\\s+.*)?$"]

    return patterns if patterns else [f"^{re.escape(prefix)}\\s*.*$"]


def _infer_pattern(definition: str, examples: list[str]) -> list[str]:
    """
    Infer one or more regex patterns from the definition string and examples.

    Priority order:
      0. Free-text heading detection  — returns ^.*$ immediately
      1. § (section sign) identifiers — tight §N.N pattern
      2. Parenthetical identifiers    — (a) (1) (ii) (A) from PRIMARY examples
      3. Full-word keyword prefix     — CHAPTER, TITLE, SUBCHAPTER, etc.
      4. Abbreviated prefix           — tit., Subch., Ch., r., Subp., etc.
      5. Specialised structural formats (NCAC, CSR, colon-separated, etc.)
      6. Pure numbering heuristics    — bare numbers, roman, dotted chains
      7. Catch-all fallback           — ^.*$
    """
    # ── 0. Free-text heading / definition-of-terms level ─────────────────────
    if _is_free_text_heading(definition, examples):
        return [r"^.*$"]

    # ── 0.5 Heterogeneous examples → catch-all ──────────────────────────────
    # Levels with many incompatible identifier types (CFR L16-L21) cannot be
    # described by a single regex.  Detect this before any other inference.
    primary_for_het = _split_primary_examples(examples)
    if _is_heterogeneous(primary_for_het):
        return [r"^.*$"]

    # ── 1. § section sign ────────────────────────────────────────────────────
    if _detect_section_sign(examples):
        return _build_section_sign_pattern(examples)

    # ── 2. Parenthetical identifier ──────────────────────────────────────────
    ptype = _detect_parenthetical(examples, definition)
    if ptype:
        return _build_parenthetical_pattern(ptype)

    # Work with primary (structural) examples only from here on
    primary = _split_primary_examples(examples)

    # ── 3. Full-word keyword prefix ──────────────────────────────────────────
    # Special case: Appendix*/Supplement* levels (e.g. CFR L15) have examples
    # like "Appendix to Part 1016", "Appendix MS to Part 1024" — they all start
    # with Appendix/Supplement but have varied suffixes.  Detect this before
    # _detect_prefix so we emit the correct loose pattern rather than failing.
    if primary and all(
        re.match(r"(Appendix|APPENDIX|Appendixes|Supplement|SUPPLEMENT)", ex.strip(), re.IGNORECASE)
        for ex in primary
    ):
        return [r"^(Appendix(es)?|APPENDIX|Supplement|SUPPLEMENT).*$"]

    prefix = _detect_prefix(examples)
    if prefix:
        stripped = [ex[len(prefix):].strip() for ex in primary if ex.upper().startswith(prefix.upper())]
        return _build_keyword_pattern(prefix, stripped)

    # ── 4. Abbreviated prefix ────────────────────────────────────────────────
    abbrev = _detect_abbrev_prefix(examples)
    if abbrev:
        abbrev_re = re.compile(r"^" + re.escape(abbrev) + r"\s*", re.IGNORECASE)
        stripped = [abbrev_re.sub("", ex) for ex in primary]
        return _build_abbrev_pattern(abbrev, stripped)

    # ── 5. Specialised structural formats ────────────────────────────────────
    sample = primary  # already cleaned

    # Oregon Volume colon format: "Volume : 09"
    if sample and all(re.fullmatch(r'Volume\s*:\s*[0-9]+', ex, re.IGNORECASE) for ex in sample):
        return [r"^Volume\s*:\s*[0-9]+$"]

    # South Dakota colon-separated: "20:07", "20:07:03", "20:07:03:01"
    if sample and all(re.fullmatch(r'[0-9]+(?::[0-9]+)+(?:\.[0-9]+)?', ex) for ex in sample):
        return [r"^[0-9]+(?::[0-9]+)+(?:\.[0-9]+)?$"]

    # Missouri CSR composite: "1 CSR 10-1.010"
    if sample and all(re.search(r'CSR', ex) for ex in sample):
        return [r"^[0-9]+\s+CSR\s+[0-9]+-[0-9]+\.[0-9]+$"]

    # NC Admin NCAC composite: "04 NCAC 10A .0101"
    if sample and all(re.search(r'NCAC', ex, re.IGNORECASE) for ex in sample):
        return [r"^[0-9]+\s+NCAC\s+[0-9]+[A-Z]?\s+\.[0-9]+$"]

    # Montana Admin dot-chain: "2", "2.12", "2.12.102"
    if sample and all(re.fullmatch(r'[0-9]+(?:\.[0-9]+)*', ex) for ex in sample):
        if any('.' in ex for ex in sample):
            return [r"^[0-9]+(?:\.[0-9]+)*$"]

    # Oregon Revised Statutes section: "659A.001"
    if sample and all(re.fullmatch(r'[0-9]+[A-Z]?\.[0-9]+(?:\s+Note)?', ex) for ex in sample):
        return [r"^[0-9]+[A-Z]?\.[0-9]+(?:\s+Note)?$"]

    # Oregon Admin section: "441-175-0130"
    if sample and all(re.fullmatch(r'[0-9]+-[0-9]+-[0-9]+', ex) for ex in sample):
        return [r"^[0-9]+-[0-9]+-[0-9]+$"]

    # Oklahoma / Missouri multi-hyphen section: "14A-1-102"
    if sample and all(re.fullmatch(r'[0-9]+[A-Z]?-[0-9A-Z].*', ex) for ex in sample):
        return [
            r"^[0-9]+[A-Z]?-[0-9]+-[0-9]+(?:\.[0-9]+)?$",
            r"^[0-9]+[A-Z]?-[0-9]+(?:\.[0-9]+)?$",
        ]

    # RI CHAPTER with hyphen-dotted number
    if sample and all(re.match(r'(?:CHAPTER|Chapter)\s+[0-9]+-[0-9]+', ex, re.IGNORECASE) for ex in sample):
        return [r"^(CHAPTER|Chapter)\s+[0-9]+-[0-9]+(?:\.[0-9]+)?(?:\s+.*)?$"]

    # Schedule/Appendix with uppercase letter: "Schedule A"
    if sample and all(re.fullmatch(r'(?:SCHEDULE|Schedule|APPENDIX|Appendix)\s+[A-Z]', ex) for ex in sample):
        return [r"^(SCHEDULE|Schedule|APPENDIX|Appendix)\s+[A-Z]$"]

    # NYCRR Appendix with number
    if sample and all(re.match(r'(?:APPENDIX|Appendix)\s+[0-9]', ex) for ex in sample):
        return [r"^(APPENDIX|Appendix)\s+[0-9]+[A-Z]?$",
                r"^(APPENDIX|Appendix)\s+[0-9]+-[A-Z]$"]

    # Minnesota / NYCRR Subpart with trailing period
    if sample and all(re.fullmatch(r'(?:Subpart|Subp\.)\s*[0-9]+\.?', ex) for ex in sample):
        return [r"^(Subpart|Subp\.)\s*[0-9]+\.?$"]

    # ── 6. Pure numbering heuristics ─────────────────────────────────────────

    if sample and all(re.fullmatch(r'\([a-z]{2,}\)', ex) for ex in sample):
        return [r"^\([a-z]{2,}\)$"]
    if sample and all(re.fullmatch(r'\([a-z]+\)', ex) for ex in sample):
        return [r"^\([a-z]+\)$"]
    if sample and all(re.fullmatch(r'\([A-Z]+\)', ex) for ex in sample):
        return [r"^\([A-Z]+\)$"]
    if sample and all(re.fullmatch(r'\([0-9]+\.[0-9]+\)', ex) for ex in sample):
        return [r"^\([0-9]+(?:\.[0-9]+)?\)$"]
    if sample and all(re.fullmatch(r'\([0-9]+\)', ex) for ex in sample):
        return [r"^\([0-9]+\)$"]
    if sample and all(re.fullmatch(r'\([ivxl]+\)', ex) for ex in sample):
        return [r"^\([ivxl]+\)$"]
    if sample and all(re.fullmatch(r'\([IVXL]+\)', ex) for ex in sample):
        return [r"^\([IVXL]+\)$"]
    if sample and all(re.fullmatch(r'[0-9]+', ex) for ex in sample):
        return [r"^[0-9]+$"]
    if sample and all(re.fullmatch(r'[A-Z]+', ex) for ex in sample):
        return [r"^[A-Z]+$"]
    if sample and all(re.fullmatch(r'[a-z]+', ex) for ex in sample):
        return [r"^[a-z]+$"]
    if sample and all(re.fullmatch(r'[A-Z]\.', ex) for ex in sample):
        return [r"^[A-Z]\.$"]
    if sample and all(re.fullmatch(r'[0-9]+\.', ex) for ex in sample):
        return [r"^[0-9]+\.$"]
    if sample and all(re.fullmatch(r'[IVXLCDM]+', ex) for ex in sample):
        return [r"^[IVXLCDM]+$"]
    if sample and all(re.fullmatch(r'[ivxlcdm]+', ex) for ex in sample):
        return [r"^[ivxlcdm]+$"]
    if sample and all(re.fullmatch(r'[0-9]+[A-Z]?', ex) for ex in sample):
        if any(re.search(r'[A-Z]$', ex) for ex in sample):
            return [r"^[0-9]+[A-Z]?$"]
    if sample and all(re.fullmatch(r'\.[0-9]+', ex) for ex in sample):
        return [r"^\.[0-9]+$"]

    # ── 7. Catch-all ─────────────────────────────────────────────────────────
    return [r"^.*$"]


# ---------------------------------------------------------------------------
# Public generator class
# ---------------------------------------------------------------------------

class EnglishPatternGenerator(PatternGeneratorBase):
    supported_languages = [
        "english",
        "en",
        "en-us",
        "en-gb",
        "en-au",
        "en-ca",
        "en-nz",
        "en-ie",
        "en-za",
        "french", "fr",
        "german", "de",
        "italian", "it",
        "dutch", "nl",
        "polish", "pl",
        "other eu languages",
    ]

    def generate_patterns(self, levels: list[LevelDefinition]) -> dict[str, list[str]]:
        result: dict[str, list[str]] = {}
        for lvl in levels:
            # Level 2 is always the document title — always catch-all
            if lvl.level == 2:
                result["2"] = [r"^.*$"]
                continue
            patterns = _infer_pattern(lvl.definition, lvl.examples)
            result[str(lvl.level)] = patterns
        return result