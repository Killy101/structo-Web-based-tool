import fitz  # PyMuPDF
import docx2txt
import os
import subprocess
import tempfile
from pathlib import Path
from zipfile import BadZipFile

def extract_text(file_path: str, suffix: str) -> str:
    """Extract raw text from PDF or DOCX."""
    suffix = suffix.lower()
    
    if suffix == ".pdf":
        return _extract_pdf(file_path)
    elif suffix == ".docx":
        return _extract_docx(file_path)
    elif suffix == ".doc":
        return _extract_doc(file_path)
    else:
        raise ValueError(f"Unsupported file type: {suffix}")

def _extract_pdf(path: str) -> str:
    doc = fitz.open(path)
    pages = []
    for page in doc:
        pages.append(page.get_text("text"))
    doc.close()
    return "\n\n".join(pages)

def _extract_docx(path: str) -> str:
    try:
        return docx2txt.process(path)
    except BadZipFile as exc:
        raise ValueError("Invalid .docx file content (not a valid DOCX/ZIP package).") from exc


def _extract_doc(path: str) -> str:
    """Extract text from legacy .doc by converting to temporary .docx."""
    temp_fd, temp_docx_path = tempfile.mkstemp(suffix=".docx")
    os.close(temp_fd)
    temp_docx = Path(temp_docx_path)

    try:
        if _convert_doc_to_docx_with_word(path, str(temp_docx)):
            return _extract_docx(str(temp_docx))

        if _convert_doc_to_docx_with_soffice(path, str(temp_docx)):
            return _extract_docx(str(temp_docx))

        raise ValueError(
            "Failed to read legacy .doc file. Install pywin32 in the active environment with Microsoft Word, "
            "or install LibreOffice and ensure 'soffice' is available in PATH."
        )
    finally:
        try:
            temp_docx.unlink(missing_ok=True)
        except Exception:
            pass


def _convert_doc_to_docx_with_word(src_path: str, dst_docx_path: str) -> bool:
    try:
        import pythoncom
        import win32com.client
    except ImportError:
        return False

    word = None
    document = None
    initialized = False
    try:
        pythoncom.CoInitialize()
        initialized = True
        word = win32com.client.DispatchEx("Word.Application")
        word.Visible = False
        word.DisplayAlerts = 0

        document = word.Documents.Open(os.path.abspath(src_path), ReadOnly=True)
        document.SaveAs(os.path.abspath(dst_docx_path), FileFormat=16)
        document.Close(False)
        document = None
        return Path(dst_docx_path).exists()
    except Exception:
        return False
    finally:
        if document is not None:
            try:
                document.Close(False)
            except Exception:
                pass
        if word is not None:
            try:
                word.Quit()
            except Exception:
                pass
        if initialized:
            pythoncom.CoUninitialize()


def _convert_doc_to_docx_with_soffice(src_path: str, dst_docx_path: str) -> bool:
    source = Path(src_path)
    target = Path(dst_docx_path)

    with tempfile.TemporaryDirectory() as out_dir:
        cmd = [
            "soffice",
            "--headless",
            "--convert-to",
            "docx",
            "--outdir",
            out_dir,
            str(source),
        ]
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        except (FileNotFoundError, subprocess.TimeoutExpired):
            return False

        if result.returncode != 0:
            return False

        converted = Path(out_dir) / f"{source.stem}.docx"
        if not converted.exists():
            return False

        target.write_bytes(converted.read_bytes())
        return True