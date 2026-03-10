"""
pattern_generator
-----------------
Language-aware regex pattern generation for metajson levelPatterns.

Public API:
    generate_level_patterns(language, levels) -> dict[str, list[str]]
    assemble_metajson(metadata, levels, language) -> (dict, str)
"""

from .pattern_generator import generate_level_patterns, get_generator, assemble_metajson

__all__ = [
    "generate_level_patterns",
    "get_generator",
    "assemble_metajson",
]