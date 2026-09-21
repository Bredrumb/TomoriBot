import unittest

from chunking import split_text_for_speech


class SplitTextForSpeechTests(unittest.TestCase):
  def test_short_text_stays_in_one_chunk(self) -> None:
    text = "短い文章です。"
    self.assertEqual(split_text_for_speech(text, min_chars=80), [text])

  def test_closing_quote_stays_with_previous_chunk(self) -> None:
    first = "「" + ("あ" * 20) + "。」"
    second = ("い" * 20) + "次の文です。"
    self.assertEqual(
      split_text_for_speech(first + second, min_chars=10),
      [first, second],
    )

  def test_multiple_terminators_stay_together(self) -> None:
    first = ("あ" * 20) + "！？"
    second = ("い" * 20) + "そうですか。"
    self.assertEqual(
      split_text_for_speech(first + second, min_chars=10),
      [first, second],
    )

  def test_ascii_ellipsis_stays_together(self) -> None:
    first = ("a" * 20) + "..."
    second = ("b" * 20) + "maybe."
    self.assertEqual(
      split_text_for_speech(first + second, min_chars=10),
      [first, second],
    )

  def test_decimal_point_does_not_split(self) -> None:
    text = ("あ" * 20) + "3.14だと考えます。" + ("い" * 20) + "次です。"
    chunks = split_text_for_speech(text, min_chars=10)
    self.assertEqual(chunks[0], ("あ" * 20) + "3.14だと考えます。")
    self.assertNotIn("14だと", chunks[1][:5] if len(chunks) > 1 else "")

  def test_trailing_punctuation_does_not_become_its_own_chunk(self) -> None:
    text = ("あ" * 20) + "。。。"
    self.assertEqual(split_text_for_speech(text, min_chars=10), [text])

  def test_short_tail_is_merged_into_previous_chunk(self) -> None:
    first = ("あ" * 82) + "。"
    tail = "そうです。"
    self.assertEqual(
      split_text_for_speech(first + tail, min_chars=80),
      [first + tail],
    )

  def test_long_tail_remains_separate(self) -> None:
    first = ("あ" * 40) + "。"
    tail = ("い" * 20) + "最後です。"
    self.assertEqual(
      split_text_for_speech(first + tail, min_chars=30),
      [first, tail],
    )

  def test_short_sentences_accumulate_until_minimum(self) -> None:
    first = "短い。"
    second = ("う" * 40) + "。"
    self.assertEqual(
      split_text_for_speech(first + second, min_chars=30),
      [first + second],
    )

  def test_newline_is_a_chunk_boundary(self) -> None:
    first = ("え" * 40) + "\n"
    second = ("お" * 40) + "。"
    self.assertEqual(
      split_text_for_speech(first + second, min_chars=30),
      [first.strip(), second],
    )

  def test_inline_emoji_is_preserved(self) -> None:
    first = "👂" + ("さ" * 40) + "。"
    second = "😊" + ("し" * 40) + "。"
    self.assertEqual(
      split_text_for_speech(first + second, min_chars=30),
      [first, second],
    )

  def test_punctuation_only_input_produces_no_chunks(self) -> None:
    self.assertEqual(split_text_for_speech("。。。！？", min_chars=1), [])


if __name__ == "__main__":
  unittest.main()
