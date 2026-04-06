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
  </body>
</html>
------=_Part_1--
"""


class ConvertDocToDocxTests(unittest.TestCase):
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

            self.assertGreaterEqual(len(doc.tables), 1)
            cells = [cell.text for row in doc.tables[0].rows for cell in row.cells]
            self.assertIn("Document title", cells)
            self.assertIn("Title 26: Internal Revenue", cells)
        finally:
            extractor._convert_doc_to_docx_with_word = original_word
            extractor._convert_doc_to_docx_with_soffice = original_soffice
            Path(src_path).unlink(missing_ok=True)
            if converted_path:
                Path(converted_path).unlink(missing_ok=True)


if __name__ == "__main__":
    unittest.main()
