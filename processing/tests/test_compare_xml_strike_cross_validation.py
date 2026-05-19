import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from src.services.comp_extractor import (  # noqa: E402
    Chunk,
    KIND_EMP,
    _XmlIndex,
    _xml_cross_validate_chunks,
)


class CompareXmlStrikeCrossValidationTests(unittest.TestCase):
    def test_strike_related_emp_is_not_suppressed_by_plain_xml_match(self):
        xml_text = "<document><p>Dispõe sobre os critérios gerais para elaboração e divulgação.</p></document>"
        xml_index_b = _XmlIndex(xml_text)

        ch = Chunk(
            kind=KIND_EMP,
            block_a=1,
            block_b=1,
            text_a="Dispõe sobre os critérios gerais para elaboração e divulgação.",
            text_b="Dispõe sobre os critérios gerais para elaboração e divulgação.",
        )
        ch.emp_detail = "strikeout changed"

        out = _xml_cross_validate_chunks([ch], None, xml_index_b)

        self.assertEqual(len(out), 1)
        self.assertEqual(out[0].kind, KIND_EMP)
        self.assertIn("strike", out[0].emp_detail.lower())

    def test_non_strike_emp_is_suppressed_when_xml_text_is_equivalent(self):
        xml_text = "<document><p>Dispõe sobre os critérios gerais para elaboração e divulgação.</p></document>"
        xml_index_b = _XmlIndex(xml_text)

        ch = Chunk(
            kind=KIND_EMP,
            block_a=2,
            block_b=2,
            text_a="Dispõe sobre os critérios gerais para elaboração e divulgação.",
            text_b="Dispõe sobre os critérios gerais para elaboração e divulgação.",
        )
        ch.emp_detail = "bold removed: divulgação"

        out = _xml_cross_validate_chunks([ch], None, xml_index_b)

        self.assertEqual(len(out), 0)


if __name__ == "__main__":
    unittest.main()
