import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from docx import Document

from src.services.brd_data import BRDData, LevelData, brd_to_metajson_input
from src.services.extractors.metadata_extractor import extract_metadata


class BrdDataRoundTripTests(unittest.TestCase):
    def test_toc_and_citation_sme_fields_are_preserved(self):
        brd = BRDData(
            format="old",
            metadata={"_format": "old", "Source Name": "Example Source"},
            citation_style_guide={
                "description": "SME Checkpoint",
                "rows": [{"label": "Product Owner", "value": "Raut, Divya"}],
            },
            toc_sorting_order="Sort numerically in descending order.",
            toc_hiding_levels="Level 8-14 not to be included in the TOC.",
            levels=[
                LevelData(
                    level=3,
                    name="Chapter",
                    definition="\"Chapter\" + uppercase roman numerals",
                    examples=["Chapter I"],
                    required=True,
                    note="should have header text annotations captured",
                    toc_requirements="separate with a colon",
                    toc_sme_comments="Can we add section numbers on the right-hand side?",
                    citation_rules='26 C.F.R. Ch. I',
                    source_of_law="X",
                    is_citable="Y",
                    citation_sme_comments='Can we abbreviate Chapter to "Ch."?',
                )
            ],
        )

        payload = brd_to_metajson_input(brd)

        toc_row = payload["toc"]["sections"][0]
        self.assertEqual(toc_row["note"], "should have header text annotations captured")
        self.assertEqual(toc_row["tocRequirements"], "separate with a colon")
        self.assertEqual(toc_row["smeComments"], "Can we add section numbers on the right-hand side?")
        self.assertEqual(payload["toc"]["citationStyleGuide"]["rows"][0]["label"], "Product Owner")
        self.assertEqual(payload["toc"]["tocSortingOrder"], "Sort numerically in descending order.")
        self.assertEqual(payload["toc"]["tocHidingLevels"], "Level 8-14 not to be included in the TOC.")

        citation_row = payload["citations"]["references"][0]
        self.assertEqual(citation_row["smeComments"], 'Can we abbreviate Chapter to "Ch."?')

    def test_metadata_fields_and_comments_are_extracted_for_legacy_docs(self):
        doc = Document()
        table = doc.add_table(rows=1, cols=3)
        header = table.rows[0].cells
        header[0].text = "Metadata Element"
        header[1].text = "Document Location"
        header[2].text = "SME Comments"

        rows = [
            ("Source Name", "Code of Federal Regulations", "Primary governing source"),
            ("Content Type", "Regulation", ""),
            ("Payload Type", "Law", ""),
            ("Impacted Citation", "26 CFR 1.61-1", "Check citation formatting"),
        ]
        for label, value, comment in rows:
            cells = table.add_row().cells
            cells[0].text = label
            cells[1].text = value
            cells[2].text = comment

        metadata = extract_metadata(doc)

        self.assertEqual(metadata["_format"], "old")
        self.assertEqual(metadata["content_category_name"], "Code of Federal Regulations")
        self.assertEqual(metadata["content_type"], "Regulation")
        self.assertEqual(metadata["payload_type"], "Law")
        self.assertEqual(metadata["impacted_citation"], "26 CFR 1.61-1")
        self.assertIn("Source Name: Primary governing source", metadata["sme_comments"])
        self.assertIn("Impacted Citation: Check citation formatting", metadata["sme_comments"])


if __name__ == "__main__":
    unittest.main()
