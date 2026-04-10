import tempfile
import textwrap
import unittest
from pathlib import Path

from docx import Document

from src.services.extractor import convert_doc_to_docx, extract_all
from src.services.extractors.scope_extractor import _is_non_data_scope_row
from src.services.extractors.image_extractor import extract_and_store_images_from_mhtml
from src.services.extractors.toc_extractor import extract_toc
from src.services.extractors.citations_extractor import _normalise_citation_rule
from src.services.extractors.base import extract_url_and_note_from_text


_TINY_PNG_BASE64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/"
    "w8AAusB9Y9l9n8AAAAASUVORK5CYII="
)


class MhtmlBrdRegressionTests(unittest.TestCase):
    def test_scope_rows_with_real_titles_are_not_dropped_by_generic_sme_comments(self):
        self.assertFalse(
            _is_non_data_scope_row(
                "Manual de Normas B3",
                "https://www.b3.com.br/pt_br/regulacao/estrutura-normativa/regulamentos-e-manuais/negociacao.htm",
                "https://www.b3.com.br/data/files/example.pdf",
                'Please, rename the document title for the following: "Manual de Normas Plataforma de Negociação do Balcão B3"',
            )
        )
        self.assertFalse(
            _is_non_data_scope_row(
                "Manual de Certificação de Profissionais B3",
                "https://www.b3.com.br/pt_br/b3/educacao/certificacoes-pqo/sobre-a-certificacao/",
                "https://www.b3.com.br/data/files/example-2.pdf",
                "The following link is not working: https://example.invalid/file.pdf",
            )
        )

    def test_extracts_metadata_images_from_mhtml_confluence_exports(self):
        mhtml = textwrap.dedent(
            f'''\
            MIME-Version: 1.0
            Content-Type: multipart/related; boundary="BOUNDARY"

            --BOUNDARY
            Content-Type: text/html; charset=UTF-8
            Content-Transfer-Encoding: quoted-printable
            Content-Location: file:///C:/exported.html

            <html>
              <body>
                <h1>Metadata</h1>
                <table>
                  <tr><th>Metadata Element</th><th>Document Location</th></tr>
                  <tr>
                    <td><p><strong>Publication Date</strong></p></td>
                    <td>
                      <p>
                        Publication date can usually be found on the first page.<br>
                        <img src="pubdate-image.png" width="32" height="16" />
                      </p>
                    </td>
                  </tr>
                </table>
              </body>
            </html>

            --BOUNDARY
            Content-Type: image/png
            Content-Transfer-Encoding: base64
            Content-Location: file:///C:/pubdate-image.png

            {_TINY_PNG_BASE64}
            --BOUNDARY--
            '''
        )

        with tempfile.NamedTemporaryFile("w", suffix=".doc", delete=False, encoding="utf-8") as handle:
            handle.write(mhtml)
            doc_path = handle.name

        try:
            images = extract_and_store_images_from_mhtml(doc_path, brd_id="TEST-MHTML")
        finally:
            Path(doc_path).unlink(missing_ok=True)

        self.assertEqual(len(images), 1)
        self.assertEqual(images[0]["section"], "metadata")
        self.assertEqual(images[0]["fieldLabel"], "Publication Date")
        self.assertEqual(images[0]["mimeType"], "image/png")

    def test_octet_stream_mhtml_images_are_upgraded_to_png_for_display(self):
        mhtml = textwrap.dedent(
            f'''\
            MIME-Version: 1.0
            Content-Type: multipart/related; boundary="BOUNDARY"

            --BOUNDARY
            Content-Type: text/html; charset=UTF-8
            Content-Transfer-Encoding: quoted-printable
            Content-Location: file:///C:/exported.html

            <html>
              <body>
                <h1>Metadata</h1>
                <table>
                  <tr><th>Metadata Element</th><th>Document Location</th></tr>
                  <tr>
                    <td><p><strong>Publication Date</strong></p></td>
                    <td>
                      <p>
                        <img
                          src="737319a2dabd45e08220ff2e024f3246364948f82d0760e8336b5b3610779671"
                          data-image-src="/confluence/download/attachments/1/pubdate-image.png?version=1"
                          data-linked-resource-content-type="image/png"
                        />
                      </p>
                    </td>
                  </tr>
                </table>
              </body>
            </html>

            --BOUNDARY
            Content-Type: application/octet-stream
            Content-Transfer-Encoding: base64
            Content-Location: file:///C:/737319a2dabd45e08220ff2e024f3246364948f82d0760e8336b5b3610779671

            {_TINY_PNG_BASE64}
            --BOUNDARY--
            '''
        )

        with tempfile.NamedTemporaryFile("w", suffix=".doc", delete=False, encoding="utf-8") as handle:
            handle.write(mhtml)
            doc_path = handle.name

        try:
            images = extract_and_store_images_from_mhtml(doc_path, brd_id="TEST-MHTML-OCTET")
        finally:
            Path(doc_path).unlink(missing_ok=True)

        self.assertEqual(len(images), 1)
        self.assertEqual(images[0]["mimeType"], "image/png")
        self.assertTrue(images[0]["mediaName"].endswith(".png"))

    def test_citation_rule_soft_breaks_collapse_to_single_line_spacing(self):
        raw = 'This is the example for this level:\n\t<Level 2> + "," + <Level 3>\nCrystal-Based on discussion with Paula'
        self.assertEqual(
            _normalise_citation_rule(raw),
            'This is the example for this level: <Level 2> + "," + <Level 3> Crystal-Based on discussion with Paula',
        )

    def test_scope_url_with_parentheses_keeps_full_pdf_link(self):
        text = 'https://www.b3.com.br/data/files/82/91/0D/02/00D8C810719CE3C8DC0D8AA8/OC%20214-2023%20PRE%20PEC%20do%20PQO%20(PT).pdf'
        url, note = extract_url_and_note_from_text(text)
        self.assertEqual(url, text)
        self.assertEqual(note, '')

    def test_extract_all_preserves_metadata_content_uri_note_alongside_link(self):
        doc = Document()
        doc.add_heading("Metadata", level=1)
        table = doc.add_table(rows=2, cols=3)
        table.rows[0].cells[0].text = "Metadata Element"
        table.rows[0].cells[1].text = "Document Location"
        table.rows[0].cells[2].text = "SME Comments"
        table.rows[1].cells[0].text = "Content URI"
        table.rows[1].cells[1].text = (
            "URL of the specific Document (e.g.)\n"
            "https://www.b3.com.br/data/files/example.pdf"
        )
        table.rows[1].cells[2].text = "Ok"

        with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as handle:
            doc.save(handle.name)
            doc_path = handle.name

        try:
            extracted = extract_all(doc_path)
        finally:
            Path(doc_path).unlink(missing_ok=True)

        metadata = extracted["metadata"]
        self.assertEqual(metadata["Content URI"], "https://www.b3.com.br/data/files/example.pdf")
        self.assertEqual(metadata.get("Content URI Note"), "URL of the specific Document (e.g.)")

    def test_extract_all_preserves_scope_evergreen_and_ingestion_columns(self):
        doc = Document()
        doc.add_heading("Scope", level=1)
        table = doc.add_table(rows=2, cols=8)
        headers = [
            "Document Title", "Reference URL", "Content URL", "Issuing Authority",
            "ASRB ID", "SME Comments", "Initial / Evergreen", "Date of Ingestion",
        ]
        for idx, header in enumerate(headers):
            table.rows[0].cells[idx].text = header

        row = table.rows[1].cells
        row[0].text = "Banco Central Scope"
        row[1].text = "https://example.com/reference"
        row[2].text = "https://example.com/content.pdf"
        row[3].text = "BCRA"
        row[4].text = "ASRB-123"
        row[5].text = "Tracked for ingestion"
        row[6].text = "Evergreen"
        row[7].text = "2024-01-15"

        with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as handle:
            doc.save(handle.name)
            doc_path = handle.name

        try:
            extracted = extract_all(doc_path)
        finally:
            Path(doc_path).unlink(missing_ok=True)

        self.assertEqual(len(extracted["scope"]["in_scope"]), 1)
        scope_row = extracted["scope"]["in_scope"][0]
        self.assertEqual(scope_row["initial_evergreen"], "Evergreen")
        self.assertEqual(scope_row["date_of_ingestion"], "2024-01-15")

    def test_toc_requirements_preserve_italic_and_strikethrough_markup(self):
        doc = Document()
        table = doc.add_table(rows=2, cols=8)
        headers = [
            "Level", "Name", "Required", "Definition", "Example", "Note", "TOC Requirements", "SME Comments"
        ]
        for idx, header in enumerate(headers):
            table.rows[0].cells[idx].text = header

        row = table.rows[1].cells
        row[0].text = "8"
        row[1].text = "Paragraph"
        row[2].text = "True"
        row[3].text = "numeric"
        row[4].text = "8.1"
        row[5].text = "note"

        para = row[6].paragraphs[0]
        para.clear()
        italic_run = para.add_run("Visible till Level 5")
        italic_run.italic = True
        para.add_run(" ")
        strike_run = para.add_run("not to be included in the TOC")
        strike_run.font.strike = True

        toc = extract_toc(doc)
        self.assertEqual(len(toc["sections"]), 1)
        toc_requirements = toc["sections"][0]["tocRequirements"]
        self.assertIn("Visible till Level 5", toc_requirements)
        self.assertIn("not to be included in the TOC", toc_requirements)
        self.assertRegex(toc_requirements, r"<(em|i)>Visible till Level 5</(em|i)>")
        self.assertRegex(toc_requirements, r"<(s|strike|del)>not to be included in the TOC</(s|strike|del)>")

    def test_mhtml_doc_conversion_keeps_toc_rich_text_markup(self):
        mhtml = textwrap.dedent(
            '''\
            MIME-Version: 1.0
            Content-Type: multipart/related; boundary="BOUNDARY"

            --BOUNDARY
            Content-Type: text/html; charset=UTF-8
            Content-Transfer-Encoding: quoted-printable
            Content-Location: file:///C:/exported.html

            <html>
              <body>
                <h1>Document Structure</h1>
                <h2>Levels</h2>
                <table>
                  <tr>
                    <th>Level</th><th>Name</th><th>Required</th><th>Definition</th>
                    <th>Example</th><th>Note</th><th>TOC Requirements</th><th>SME Comments</th>
                  </tr>
                  <tr>
                    <td>8</td><td>Paragraph</td><td>True</td><td>numeric</td>
                    <td>8.1</td><td>Note</td>
                    <td><em>Visible till Level 5</em> <s>not to be included in the TOC</s></td>
                    <td>Comment</td>
                  </tr>
                </table>
              </body>
            </html>
            --BOUNDARY--
            '''
        )

        with tempfile.NamedTemporaryFile("w", suffix=".doc", delete=False, encoding="utf-8") as handle:
            handle.write(mhtml)
            doc_path = handle.name

        converted_path = None
        try:
            converted_path = convert_doc_to_docx(doc_path)
            self.assertIsNotNone(converted_path)
            converted = Document(converted_path)
            toc = extract_toc(converted)
        finally:
            Path(doc_path).unlink(missing_ok=True)
            if converted_path:
                Path(converted_path).unlink(missing_ok=True)

        self.assertEqual(len(toc["sections"]), 1)
        toc_requirements = toc["sections"][0]["tocRequirements"]
        self.assertRegex(toc_requirements, r"<(em|i)>Visible till Level 5</(em|i)>")
        self.assertRegex(toc_requirements, r"<(s|strike|del)>not to be included in the TOC</(s|strike|del)>")


if __name__ == "__main__":
    unittest.main()
