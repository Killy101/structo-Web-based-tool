import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from src.services.comp_extractor import (
    Chunk,
    KIND_ADD,
    KIND_DEL,
    KIND_MOD,
    _convert_high_similarity_del_add_to_mod,
)


class CompareNumericModConversionTests(unittest.TestCase):
    def test_compilation_line_numeric_change_converts_to_mod(self):
        chunks = [
            Chunk(
                kind=KIND_DEL,
                block_a=1,
                block_b=-1,
                text_a="Compilation No. 172 Compilation date: 18/02/2026",
                text_b="",
            ),
            Chunk(
                kind=KIND_ADD,
                block_a=-1,
                block_b=2,
                text_a="",
                text_b="Compilation No. 173 Compilation date: 14/03/2026",
            ),
        ]

        out = _convert_high_similarity_del_add_to_mod(chunks)

        self.assertEqual(len(out), 1)
        self.assertEqual(out[0].kind, KIND_MOD)
        self.assertIn("Compilation No.", out[0].text_a)
        self.assertIn("Compilation No.", out[0].text_b)

    def test_unrelated_add_del_do_not_force_mod(self):
        chunks = [
            Chunk(kind=KIND_DEL, block_a=1, block_b=-1, text_a="Section 1 Repeal", text_b=""),
            Chunk(kind=KIND_ADD, block_a=-1, block_b=2, text_a="", text_b="Completely different heading text"),
        ]

        out = _convert_high_similarity_del_add_to_mod(chunks)

        self.assertEqual(len(out), 2)
        self.assertEqual(out[0].kind, KIND_DEL)
        self.assertEqual(out[1].kind, KIND_ADD)

    def test_attached_number_change_converts_to_mod(self):
        chunks = [
            Chunk(
                kind=KIND_DEL,
                block_a=3,
                block_b=-1,
                text_a="Division 82-Sabotage176",
                text_b="",
            ),
            Chunk(
                kind=KIND_ADD,
                block_a=-1,
                block_b=4,
                text_a="",
                text_b="Division 82-Sabotage175",
            ),
        ]

        out = _convert_high_similarity_del_add_to_mod(chunks)

        self.assertEqual(len(out), 1)
        self.assertEqual(out[0].kind, KIND_MOD)
        self.assertIn("Sabotage176", out[0].text_a)
        self.assertIn("Sabotage175", out[0].text_b)


if __name__ == "__main__":
    unittest.main()
