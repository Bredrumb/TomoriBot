from __future__ import annotations

import math
import unicodedata

STRONG_BOUNDARY_CHARS = frozenset("。．.!！?？…\n\r")
SOFT_BOUNDARY_CHARS = frozenset("、，,")
BOUNDARY_CHARS = STRONG_BOUNDARY_CHARS | SOFT_BOUNDARY_CHARS
CLOSING_CHARS = frozenset("」』】）》〉〕］〗〙〛）)]}”’\"'")
TRAILING_ORNAMENT_CHARS = frozenset("〜～")
SOFT_BOUNDARY_FACTOR = 1.5
EMOJI_PRESENTATION_SELECTOR = "️"
FIRST_EMOJI_BLOCK_CODEPOINT = 0x1F000


def _is_decimal_dot(text: str, index: int) -> bool:
  if text[index] != ".":
    return False
  previous = text[index - 1] if index > 0 else ""
  following = text[index + 1] if index + 1 < len(text) else ""
  return previous.isdigit() or following.isdigit()


def _boundary_strength(text: str, index: int) -> str | None:
  char = text[index]
  if char not in BOUNDARY_CHARS:
    return None
  if _is_decimal_dot(text, index):
    return None
  return "strong" if char in STRONG_BOUNDARY_CHARS else "soft"


def _starts_emoji(text: str, index: int) -> bool:
  """Irodori reads an emoji as a delivery cue for the text after it, so it must open the next chunk."""
  if ord(text[index]) >= FIRST_EMOJI_BLOCK_CODEPOINT:
    return True
  following = text[index + 1] if index + 1 < len(text) else ""
  return following == EMOJI_PRESENTATION_SELECTOR


def _is_trailing_ornament(char: str) -> bool:
  if char in TRAILING_ORNAMENT_CHARS:
    return True
  return unicodedata.category(char) in {"So", "Sk"}


def _consume_boundary_suffix(text: str, index: int) -> int:
  consuming_ornament = False
  while index < len(text):
    char = text[index]
    if char in CLOSING_CHARS or char in BOUNDARY_CHARS:
      index += 1
      continue
    if _is_trailing_ornament(char) and not _starts_emoji(text, index):
      consuming_ornament = True
      index += 1
      continue
    if consuming_ornament and unicodedata.category(char) in {"Mn", "Me", "Cf"}:
      index += 1
      continue
    break
  return index


def _nonspace_length(text: str) -> int:
  return sum(1 for char in text if not char.isspace())


def split_text_for_speech(text: str, *, min_chars: int) -> list[str]:
  """Split speech text while preferring natural sentence endings.

  Strong boundaries become eligible after min_chars non-whitespace characters.
  Commas are fallback boundaries only after a longer 1.5x threshold. Trailing
  terminators, closing quotes/brackets, and text ornaments such as ♪ stay with
  the chunk they close, while an emoji after a boundary opens the next chunk. Decimal points next to digits do not split, and a very
  short final tail is merged back into the previous chunk.
  """
  if min_chars <= 0:
    raise ValueError("min_chars must be greater than 0.")

  soft_boundary_chars = max(min_chars + 1, math.ceil(min_chars * SOFT_BOUNDARY_FACTOR))
  raw_chunks: list[str] = []
  start = 0
  current_chars = 0
  index = 0

  while index < len(text):
    char = text[index]
    if not char.isspace():
      current_chars += 1

    strength = _boundary_strength(text, index)
    should_split = (
      strength == "strong" and current_chars >= min_chars
    ) or (
      strength == "soft" and current_chars >= soft_boundary_chars
    )
    if should_split:
      cut = _consume_boundary_suffix(text, index + 1)
      raw_chunks.append(text[start:cut])
      start = cut
      current_chars = 0
      index = cut
      continue

    index += 1

  if start < len(text):
    raw_chunks.append(text[start:])

  chunks = [raw for raw in raw_chunks if raw.strip()]
  if not chunks:
    return [text] if text else []

  tail_merge_threshold = max(1, min_chars // 2)
  if len(chunks) > 1 and _nonspace_length(chunks[-1]) < tail_merge_threshold:
    chunks[-2] = chunks[-2] + chunks[-1]
    chunks.pop()

  return [chunk.strip() for chunk in chunks if chunk.strip()]
