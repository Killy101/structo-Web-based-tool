import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from src.services.xml_compare import compare_xml


class XmlCompareInnodRulesTests(unittest.TestCase):
    def test_innod_heading_and_identifier_wrappers_are_ignored(self):
        old_xml = """
<root>
  <section>
    <title><innodIdentifier>a</innodIdentifier>. Scope</title>
  </section>
</root>
""".strip()

        new_xml = """
<root>
  <section>
    <innodHeading><title>a. Scope</title></innodHeading>
  </section>
</root>
""".strip()

        diff = compare_xml(old_xml, new_xml)
        self.assertEqual(diff["summary"]["total_additions"], 0)
        self.assertEqual(diff["summary"]["total_removals"], 0)
        self.assertEqual(diff["summary"]["total_modifications"], 0)
        self.assertEqual(diff["summary"]["total_mismatches"], 0)

    def test_double_paragraph_footnote_is_compared_as_single_entity(self):
        old_xml = """
<root>
  <footnote id="f1">
    <p>First paragraph.</p>
    <p>Second paragraph.</p>
  </footnote>
</root>
""".strip()

        new_xml = """
<root>
  <footnote id="f1">
    <p>First paragraph updated.</p>
    <p>Second paragraph.</p>
  </footnote>
</root>
""".strip()

        diff = compare_xml(old_xml, new_xml)
        self.assertEqual(diff["summary"]["total_mismatches"], 0)
        self.assertEqual(diff["summary"]["total_modifications"], 1)
        self.assertTrue(diff["modifications"][0]["path"].endswith("/footnote[0]"))


if __name__ == "__main__":
    unittest.main()
