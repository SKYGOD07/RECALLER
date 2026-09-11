"""Document reading — text out of uploaded files.

RECALLER's own document service, following the workflow of the Hermes ``pdf``
skill (PyMuPDF fast path, scanned-page detection, OCR hand-off) without copying
it. It reads; it never interprets. Interpretation happens in the pattern
extractor or the evidence agent, and both must quote this text.

Supported:
  application/pdf   text layer via PyMuPDF; OCR via Tesseract when installed
  text/plain        pages separated by form feeds (\\f)
  image/*           stored and page-counted; text only with OCR available
"""

from __future__ import annotations

import hashlib
import shutil
from dataclasses import dataclass, field
from typing import List, Optional

import pymupdf

TEXT_CHARS_PER_PAGE_FLOOR = 25  # below this a page is treated as scanned (image-only)
IMAGE_TYPES = {"image/png", "image/jpeg", "image/jpg", "image/webp", "image/tiff"}
ACCEPTED_TYPES = {"application/pdf", "text/plain", *IMAGE_TYPES}


@dataclass
class ReadResult:
    media_type: str
    page_count: int
    pages: List[str] = field(default_factory=list)
    sha256: str = ""
    scanned: bool = False
    ocr_used: bool = False
    warnings: List[str] = field(default_factory=list)

    @property
    def text_chars(self) -> int:
        return sum(len(p.strip()) for p in self.pages)


def ocr_available() -> bool:
    return shutil.which("tesseract") is not None


def sniff_media_type(data: bytes, filename: str, declared: Optional[str]) -> str:
    if data[:5] == b"%PDF-":
        return "application/pdf"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    lower = filename.lower()
    if lower.endswith(".txt"):
        return "text/plain"
    return (declared or "application/octet-stream").split(";")[0].strip().lower()


def read_document(data: bytes, filename: str, declared_type: Optional[str] = None) -> ReadResult:
    media_type = sniff_media_type(data, filename, declared_type)
    digest = hashlib.sha256(data).hexdigest()

    if media_type == "text/plain":
        pages = data.decode("utf-8", errors="replace").split("\f")
        return ReadResult(media_type, len(pages), pages, digest)

    if media_type == "application/pdf" or media_type in IMAGE_TYPES:
        try:
            doc = pymupdf.open(stream=data, filetype="pdf" if media_type == "application/pdf" else media_type.split("/")[1])
        except Exception as exc:
            raise ValueError(f"The file could not be opened as {media_type}: {exc}") from exc
        with doc:
            if doc.needs_pass:
                raise ValueError("The PDF is password-protected. Ask for an unlocked copy.")
            pages = [page.get_text("text") if media_type == "application/pdf" else "" for page in doc]
            result = ReadResult(media_type, doc.page_count, pages, digest)
            thin = [i for i, t in enumerate(pages) if len(t.strip()) < TEXT_CHARS_PER_PAGE_FLOOR]
            if thin:
                if ocr_available():
                    for i in thin:
                        try:
                            tp = doc[i].get_textpage_ocr(full=True)
                            result.pages[i] = doc[i].get_text("text", textpage=tp)
                            result.ocr_used = True
                        except Exception as exc:  # OCR is best effort; the gate handles what it misses
                            result.warnings.append(f"OCR failed on page {i + 1}: {exc}")
                    result.scanned = result.text_chars < TEXT_CHARS_PER_PAGE_FLOOR * max(1, result.page_count)
                else:
                    result.scanned = len(thin) == len(pages)
                    result.warnings.append(
                        f"{len(thin)} page(s) have no text layer and OCR (Tesseract) is not installed; "
                        "fields on those pages will be held for the officer."
                    )
            return result

    raise ValueError(f"Unsupported file type {media_type}. Upload a PDF, a text file or an image.")
