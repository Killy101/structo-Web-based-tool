import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from src.services.comp_extractor import _should_suppress_chunk_inner


class CompareSampleDetectionTests(unittest.TestCase):
    def test_citation_spacing_noise_is_suppressed(self):
        a = "pension income (see Part 9), and"
        b = "pension income (see Part 9 ) , and"
        self.assertTrue(_should_suppress_chunk_inner(a, b))

    def test_real_word_substitution_is_not_suppressed(self):
        a = "allows deductions to be made from such income in respect of payroll giving (see Part 12)."
        b = "allows deductions to be made from such income in respect of payroll receiving (see Part 12)."
        self.assertFalse(_should_suppress_chunk_inner(a, b))

    def test_marker_letter_change_is_not_suppressed(self):
        a = "Subsection (2)(c) or (4) refers to any amount which counts as employment income by virtue of Part 6"
        b = "Subsection (2)(d) or (4) refers to any amount which counts as employment income by virtue of Part 6"
        self.assertFalse(_should_suppress_chunk_inner(a, b))


if __name__ == "__main__":
    unittest.main()
