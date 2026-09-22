import unittest

from chunking import split_text_for_speech


class SplitTextForSpeechTests(unittest.TestCase):
  def test_short_text_stays_in_one_chunk(self) -> None:
    text = "短い文章です。"
    self.assertEqual(split_text_for_speech(text, min_chars=80), [text])

  def test_comma_waits_for_soft_fallback_threshold(self) -> None:
    before = ("あ" * 80) + "、"
    sentence_end = ("い" * 20) + "。"
    tail = ("う" * 40) + "。"
    self.assertEqual(
      split_text_for_speech(before + sentence_end + tail, min_chars=80),
      [before + sentence_end, tail],
    )

  def test_comma_splits_after_soft_fallback_threshold(self) -> None:
    first = ("あ" * 120) + "、"
    second = ("い" * 80) + "。"
    self.assertEqual(
      split_text_for_speech(first + second, min_chars=80),
      [first, second],
    )

  def test_ellipsis_is_a_strong_boundary(self) -> None:
    first = ("あ" * 80) + "……"
    second = ("い" * 80) + "。"
    self.assertEqual(
      split_text_for_speech(first + second, min_chars=80),
      [first, second],
    )

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

  def test_sentence_final_symbols_stay_with_previous_chunk(self) -> None:
    for suffix in ("♪", "♡", "😊", "……", "〜"):
      with self.subTest(suffix=suffix):
        first = ("あ" * 20) + "。" + suffix
        second = ("い" * 20) + "次です。"
        self.assertEqual(
          split_text_for_speech(first + second, min_chars=10),
          [first, second],
        )

  def test_emoji_variation_sequence_stays_with_previous_chunk(self) -> None:
    first = ("あ" * 20) + "。❤️"
    second = ("い" * 20) + "次です。"
    self.assertEqual(
      split_text_for_speech(first + second, min_chars=10),
      [first, second],
    )

  def test_short_tail_is_merged_into_previous_chunk(self) -> None:
    first = ("あ" * 82) + "。"
    tail = "そうです。"
    self.assertEqual(
      split_text_for_speech(first + tail, min_chars=80),
      [first + tail],
    )

  def test_symbol_only_tail_is_kept_with_previous_chunk(self) -> None:
    first = ("あ" * 82) + "。"
    tail = "😊"
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

  def test_symbol_only_input_is_preserved(self) -> None:
    for text in ("😊", "♪♡", "。。。！？", "……"):
      with self.subTest(text=text):
        self.assertEqual(split_text_for_speech(text, min_chars=1), [text])


if __name__ == "__main__":
  unittest.main()
