# Language Pattern Editing Guide

Language files are the source of truth for pattern behavior.
If you need to change regex rules, edit `languages/*.py` first.

## What Each File Controls

- `english.py`
  - `ENGLISH_META_DEFAULT_LEVEL_PATTERNS`
  - `ENGLISH_PATH_TRANSFORM_CLEANUP`

- `spanish.py`
  - `SPANISH_META_DEFAULT_LEVEL_PATTERNS`
  - `SPANISH_PATH_TRANSFORM_CLEANUP`

- `portuguese.py`
  - `PORTUGUESE_META_DEFAULT_LEVEL_PATTERNS`
  - `PORTUGUESE_PATH_TRANSFORM_CLEANUP`

- `japanese.py`
  - `JAPANESE_META_DEFAULT_LEVEL_PATTERNS`
  - `JAPANESE_PATH_TRANSFORM_CLEANUP`

- `chinese.py`
  - `CHINESE_META_DEFAULT_LEVEL_PATTERNS`
  - Chinese structural regex patterns used by `ChinesePatternGenerator`

- `korean.py`
  - `KOREAN_DEFAULT_PATTERNS`
  - `KOREAN_IDENTIFIER_PATTERNS`
  - `KOREAN_CUSTOM_TOC`

## How Runtime Uses These

- `pattern_generator.py`
  - Main implementation file.
  - Calls language generator classes.
  - Applies explicit regex overrides extracted from definition/citation text.
  - Uses `*_META_DEFAULT_LEVEL_PATTERNS` fallback from language files.
  - Assembles metajson and merges in scope/citation/brd_config inputs.



## Rule Row Format

Path transform cleanup rows use:

`[match_regex, replacement, flag, ""]`

Example:

`["Artículo", "Art.", 0, ""]`
