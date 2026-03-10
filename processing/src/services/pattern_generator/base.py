
"""Shared core types for language pattern generators."""

from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass(slots=True)
class LevelDefinition:
    """Single level metadata used by language generators."""

    level: int
    definition: str
    examples: list[str]
    required: bool = False
    name: str | None = None
 

class PatternGeneratorBase(ABC):
    """Base class for language-specific pattern generators."""

    # Subclasses declare which language(s) they handle
    supported_languages: list[str] = []

    def generate(self, levels: list[LevelDefinition]) -> dict[str, list[str]]:
        """
        Entry point. Validates input then delegates to generate_patterns.
        Returns: { "2": ["^regex$", ...], "3": [...], ... }
        """
        if not levels:
            return {}
        return self.generate_patterns(levels)

    @abstractmethod
    def generate_patterns(self, levels: list[LevelDefinition]) -> dict[str, list[str]]:
        """Implement language-specific regex inference per level."""
        pass
