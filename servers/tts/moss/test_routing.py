from __future__ import annotations

import unittest

from routing import resolve_mode, resolve_request_mode, resolve_warm_mode


class MossRoutingTests(unittest.TestCase):
  def test_auto_prefers_reference_when_both_shapes_are_present(self) -> None:
    self.assertEqual(resolve_request_mode("auto", "YXVkaW8=", "warm voice"), "clone")

  def test_auto_uses_instruct_without_reference(self) -> None:
    self.assertEqual(resolve_request_mode("auto", None, "warm voice"), "voice-design")

  def test_auto_requires_a_voice_source(self) -> None:
    with self.assertRaises(ValueError):
      resolve_request_mode("auto", None, None)

  def test_fixed_modes_require_their_matching_input(self) -> None:
    with self.assertRaises(ValueError):
      resolve_request_mode("clone", None, "warm voice")
    with self.assertRaises(ValueError):
      resolve_request_mode("voice-design", "YXVkaW8=", None)

  def test_mode_aliases(self) -> None:
    self.assertEqual(resolve_mode("voice_clone"), "clone")
    self.assertEqual(resolve_mode("design"), "voice-design")
    self.assertEqual(resolve_mode("AUTO"), "auto")

  def test_warm_mode_is_explicit(self) -> None:
    self.assertEqual(resolve_warm_mode("voice_design"), "voice-design")
    self.assertEqual(resolve_warm_mode("off"), "none")
    with self.assertRaises(ValueError):
      resolve_warm_mode("auto")


if __name__ == "__main__":
  unittest.main()
