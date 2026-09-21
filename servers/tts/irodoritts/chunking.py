from __future__ import annotations

BOUNDARY_CHARS = frozenset("。、，,．.!！?？\n\r")
CLOSING_CHARS = frozenset("」』】）》〉〕］〗〙〛）)]}”’\"'")
_TRUE_WORD_CHARS = str.isalnum


def _is_decimal_dot(text: str, index: int) -> bool:
  if text[index] != ".":
    return False
  previous = text[index - 1] if index > 0 else ""
  following = text[index + 1] if index + 1 < len(text) else ""
  return previous.isdigit() or following.isdigit()


def _is_boundary(text: str, index: int) -> bool:
  char = text[index]
  if char not in BOUNDARY_CHARS:
    return False
  return not _is_decimal_dot(text, index)


def _consume_boundary_suffix(text: str, index: int) -> int:
  while index < len(text):
    char = text[index]
    if char in CLOSING_CHARS or char in BOUNDARY_CHARS:
      index += 1
      continue
    break
  return index


def _has_word_char(text: str) -> bool:
  return any(_TRUE_WORD_CHARS(char) for char in text)


def _nonspace_length(text: str) -> int:
  return sum(1 for char in text if not char.isspace())


def split_text_for_speech(text: str, *, min_chars: int) -> list[str]:
  """Split speech text at safe punctuation boundaries.

  Boundaries only become eligible after min_chars non-whitespace characters.
  Trailing terminators and closing quotes/brackets stay with the chunk they close,
  decimal points next to digits do not split, punctuation-only pieces are ignored,
  and a very short final tail is merged back into the previous chunk.
  """
  if min_chars <= 0:
    raise ValueError("min_chars must be greater than 0.")

  raw_chunks: list[str] = []
  start = 0
  current_chars = 0
  index = 0

  while index < len(text):
    char = text[index]
    if not char.isspace():
      current_chars += 1

    if current_chars >= min_chars and _is_boundary(text, index):
      cut = _consume_boundary_suffix(text, index + 1)
      raw_chunks.append(text[start:cut])
      start = cut
      current_chars = 0
      index = cut
      continue

    index += 1

  if start < len(text):
    raw_chunks.append(text[start:])

  chunks = [raw for raw in raw_chunks if _has_word_char(raw)]
  if not chunks:
    return []

  tail_merge_threshold = max(1, min_chars // 2)
  if len(chunks) > 1 and _nonspace_length(chunks[-1]) < tail_merge_threshold:
    chunks[-2] = chunks[-2] + chunks[-1]
    chunks.pop()

  return [chunk.strip() for chunk in chunks if chunk.strip()]
