import unittest

from server import split_text_for_speech


class SplitTextForSpeechTests(unittest.TestCase):
  def test_short_text_stays_in_one_chunk(self) -> None:
    text = "短い文章です。"
    self.assertEqual(split_text_for_speech(text, min_chars=80), [text])

  def test_long_text_splits_on_sentence_boundaries(self) -> None:
    first = ("あ" * 40) + "。"
    second = ("い" * 40) + "！"
    tail = "最後です。"

    self.assertEqual(
      split_text_for_speech(first + second + tail, min_chars=30),
      [first, second, tail],
    )

  def test_short_sentences_accumulate_until_minimum(self) -> None:
    first = "短い。"
    second = ("う" * 40) + "。"

    self.assertEqual(
      split_text_for_speech(first + second, min_chars=30),
      [first + second],
    )

  def test_inline_emoji_is_preserved(self) -> None:
    first = "👂" + ("さ" * 40) + "。"
    second = "😊" + ("し" * 40) + "。"

    self.assertEqual(
      split_text_for_speech(first + second, min_chars=30),
      [first, second],
    )


if __name__ == "__main__":
  unittest.main()
