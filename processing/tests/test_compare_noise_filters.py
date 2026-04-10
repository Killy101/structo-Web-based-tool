import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from src.services.comp_extractor import Block, _is_noise, _norm_cmp, _seq_key


class CompareNoiseFilterTests(unittest.TestCase):
    def test_amendment_leader_lines_are_not_suppressed_as_noise(self):
        self.assertFalse(_is_noise("F278(2) ............................"))
        self.assertFalse(_is_noise("[F278](2) ............................"))
        self.assertFalse(_is_noise("F278 (2) ............................"))

    def test_plain_dot_leaders_remain_noise(self):
        self.assertTrue(_is_noise("............................"))
        self.assertTrue(_is_noise("(2) ............................"))

    def test_seq_key_ignores_leading_citation_residue_for_same_section(self):
        def make_block(text: str) -> Block:
            return Block(anchor="sec:104", text=text, cmp=_norm_cmp(text), lines=[], x_min=0, y=0)

        clean = make_block("104 General rule for calculating cost of providing accommodation")
        cited = make_block("Act 2017 (c. 10), Sch. 2 para. 15 104 General rule for calculating cost of providing accommodation")
        amended = make_block("F2815. 103A inserted by Finance Act 2017 (c. 10), Sch. 2 para. 15 104 General rule for calculating cost of providing accommodation")

        self.assertEqual(_seq_key(clean), _seq_key(cited))
        self.assertEqual(_seq_key(clean), _seq_key(amended))


if __name__ == "__main__":
    unittest.main()
