import os
import sys
import tempfile
import unittest
from pathlib import Path

from docx import Document

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from src.services import extractor


MHTML_DOC_SAMPLE = """MIME-Version: 1.0
Content-Type: multipart/related; boundary=\"----=_Part_1\"

------=_Part_1
Content-Type: text/html; charset=UTF-8
Content-Transfer-Encoding: quoted-printable

<html>
  <body>
    <h1>Structuring Requirements</h1>
    <h2>Scope</h2>
    <p>The scope of regulatory content should be extracted.</p>
    <table>
      <tr>
        <td><strong>Document title</strong></td>
        <td><strong>Reference URL</strong></td>
      </tr>
      <tr>
        <td>Title 26: Internal Revenue</td>
        <td>https://www.ecfr.gov/</td>
      </tr>
    </table>
    <h1>Citation Format Requirements</h1>
    <table>
      <tr>
        <td><strong>Level</strong></td>
        <td><strong>Citation rules</strong></td>
        <td><strong>Source Of Law</strong></td>
        <td><strong>SME Comments</strong></td>
      </tr>
      <tr>
        <td>3</td>
        <td>Title 26 | Chapter I</td>
        <td>Chapter</td>
        <td>Looks good</td>
      </tr>
    </table>
    <h1>Metadata</h1>
    <table>
      <tr>
        <td><strong>Metadata Element</strong></td>
        <td><strong>Document Location</strong></td>
        <td><strong>SME Comments</strong></td>
      </tr>
      <tr>
        <td>Source Name</td>
        <td>Code of Federal Regulations</td>
        <td>Correct</td>
      </tr>
    </table>
  </body>
</html>
------=_Part_1--
"""


class ConvertDocToDocxTests(unittest.TestCase):
    def test_prefers_native_converter_before_mhtml_fallback(self):
        with tempfile.NamedTemporaryFile("w", suffix=".doc", delete=False, encoding="utf-8") as handle:
            handle.write(MHTML_DOC_SAMPLE)
            src_path = handle.name

        converted_path = None
        original_is_mhtml = extractor._is_mhtml_doc
        original_word = extractor._convert_doc_to_docx_with_word
        original_soffice = extractor._convert_doc_to_docx_with_soffice
        original_mhtml = extractor._convert_mhtml_doc_to_docx
        mhtml_called = False

        def fake_word(_src: str, dst: str) -> bool:
            doc = Document()
            scope = doc.add_table(rows=2, cols=2)
            scope.rows[0].cells[0].text = "Document title"
            scope.rows[0].cells[1].text = "Reference URL"
            scope.rows[1].cells[0].text = "Title 26: Internal Revenue"
            scope.rows[1].cells[1].text = "https://www.ecfr.gov/"

            metadata = doc.add_table(rows=2, cols=3)
            metadata.rows[0].cells[0].text = "Metadata Element"
            metadata.rows[0].cells[1].text = "Document Location"
            metadata.rows[0].cells[2].text = "SME Comments"
            metadata.rows[1].cells[0].text = "Source Name"
            metadata.rows[1].cells[1].text = "Code of Federal Regulations"
            metadata.rows[1].cells[2].text = "Correct"

            citation = doc.add_table(rows=2, cols=4)
            citation.rows[0].cells[0].text = "Level"
            citation.rows[0].cells[1].text = "Citation rules"
            citation.rows[0].cells[2].text = "Source Of Law"
            citation.rows[0].cells[3].text = "SME Comments"
            citation.rows[1].cells[0].text = "3"
            citation.rows[1].cells[1].text = "Title 26 | Chapter I"
            citation.rows[1].cells[2].text = "Chapter"
            citation.rows[1].cells[3].text = "Looks good"

            doc.save(dst)
            return True

        def fake_mhtml(_src: str, _dst: str) -> bool:
            nonlocal mhtml_called
            mhtml_called = True
            return False

        try:
            extractor._is_mhtml_doc = lambda _path: True
            extractor._convert_doc_to_docx_with_word = fake_word
            extractor._convert_doc_to_docx_with_soffice = lambda *_args, **_kwargs: False
            extractor._convert_mhtml_doc_to_docx = fake_mhtml

            converted_path = extractor.convert_doc_to_docx(src_path)

            self.assertIsNotNone(converted_path)
            self.assertFalse(mhtml_called, "HTML fallback should not run when native conversion succeeds")
            assert converted_path is not None
            doc = Document(converted_path)
            all_cells = [cell.text for table in doc.tables for row in table.rows for cell in row.cells]
            self.assertIn("Code of Federal Regulations", all_cells)
        finally:
            extractor._is_mhtml_doc = original_is_mhtml
            extractor._convert_doc_to_docx_with_word = original_word
            extractor._convert_doc_to_docx_with_soffice = original_soffice
            extractor._convert_mhtml_doc_to_docx = original_mhtml
            Path(src_path).unlink(missing_ok=True)
            if converted_path:
                Path(converted_path).unlink(missing_ok=True)

    def test_mhtml_doc_converts_without_external_tools(self):
        with tempfile.NamedTemporaryFile("w", suffix=".doc", delete=False, encoding="utf-8") as handle:
            handle.write(MHTML_DOC_SAMPLE)
            src_path = handle.name

        converted_path = None
        original_word = extractor._convert_doc_to_docx_with_word
        original_soffice = extractor._convert_doc_to_docx_with_soffice

        try:
            extractor._convert_doc_to_docx_with_word = lambda *_args, **_kwargs: False
            extractor._convert_doc_to_docx_with_soffice = lambda *_args, **_kwargs: False

            converted_path = extractor.convert_doc_to_docx(src_path)

            self.assertIsNotNone(converted_path)
            assert converted_path is not None
            self.assertTrue(os.path.exists(converted_path))

            doc = Document(converted_path)
            paragraphs = "\n".join(p.text for p in doc.paragraphs)
            self.assertIn("Structuring Requirements", paragraphs)
            self.assertIn("The scope of regulatory content should be extracted.", paragraphs)

            self.assertGreaterEqual(len(doc.tables), 3)
            all_cells = [cell.text for table in doc.tables for row in table.rows for cell in row.cells]
            self.assertIn("Document title", all_cells)
            self.assertIn("Title 26: Internal Revenue", all_cells)
            self.assertIn("Citation rules", all_cells)
            self.assertIn("Metadata Element", all_cells)
            self.assertIn("Code of Federal Regulations", all_cells)
        finally:
            extractor._convert_doc_to_docx_with_word = original_word
            extractor._convert_doc_to_docx_with_soffice = original_soffice
            Path(src_path).unlink(missing_ok=True)
            if converted_path:
                Path(converted_path).unlink(missing_ok=True)


if __name__ == "__main__":
    unittest.main()
