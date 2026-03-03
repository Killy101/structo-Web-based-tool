"""
src/services/extractors/content_profile_extractor.py
Analyses a BRD .docx and produces a content profile summary.
"""

import re
from .base import iter_paragraphs, para_text, heading_level


def extract_content_profile(doc) -> dict:
    """Analyse document content and return a structured profile."""
    all_text = "\n".join(para_text(p) for p in iter_paragraphs(doc))
    word_count = len(all_text.split())

    req_pattern = re.compile(r"\b(must|shall|should|required|mandatory)\b", re.IGNORECASE)
    requirements_count = len(req_pattern.findall(all_text))

    has_tables   = len(doc.tables) > 0
    has_diagrams = any(
        shape.tag.endswith("drawing")
        for para in doc.paragraphs
        for shape in para._p
    )

    theme_keywords = {
        "legislation":   r"legislat|statut|act\b",
        "metadata":      r"metadata|publication date|issuing",
        "citations":     r"citation|cite|level \d+",
        "file_delivery": r"file naming|zip|delivery|extract",
        "structuring":   r"structur|toc|table of contents",
        "compliance":    r"compliance|audit|regulatory",
        "australia":     r"australia|au\.|apac",
    }
    key_themes = [
        theme for theme, pattern in theme_keywords.items()
        if re.search(pattern, all_text, re.IGNORECASE)
    ]

    functional_areas = list(dict.fromkeys(
        para_text(para)
        for para in doc.paragraphs
        if heading_level(para) in (1, 2)
        and para_text(para)
        and para_text(para).lower() != "table of contents"
    ))

    expected_sections = {"scope", "metadata", "citation", "file", "structur", "exception", "update"}
    found = sum(1 for s in expected_sections if s in all_text.lower())
    completeness_score = round((found / len(expected_sections)) * 100)

    quality_notes = []
    if "SME Checkpoint" in all_text:
        quality_notes.append("Document contains SME checkpoints indicating fields awaiting validation.")
    if any(r.font.strike for p in doc.paragraphs for r in p.runs if r.font.strike):
        quality_notes.append("Some items are struck through (out of scope or deprecated).")
    if completeness_score < 80:
        quality_notes.append("Some sections may be incomplete or placeholder.")

    complexity = "high" if word_count > 3000 else "medium" if word_count > 1000 else "low"

    return {
        "document_type":      "BRD",
        "complexity":         complexity,
        "primary_domain":     "Regulatory / Legal (Australian Legislative Instruments)",
        "key_themes":         key_themes,
        "functional_areas":   functional_areas,
        "requirements_count": requirements_count,
        "has_diagrams":       has_diagrams,
        "has_tables":         has_tables,
        "completeness_score": completeness_score,
        "quality_notes":      quality_notes,
        "word_count":         word_count,
        "table_count":        len(doc.tables),
    }