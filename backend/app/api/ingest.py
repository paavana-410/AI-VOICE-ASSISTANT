"""
api/ingest.py — File ingestion endpoint for the business AI assistant.

Supported file types:
  - PDF (.pdf)          → pypdf text extraction → chunked → stored in Mem0
  - Word (.docx)        → python-docx extraction → chunked → stored in Mem0
  - Excel (.xlsx/.xls)  → openpyxl extraction → row summaries → stored in Mem0
  - Images (.png/.jpg/.jpeg/.webp/.gif) → Gemini Vision description → stored in Mem0
  - Plain text (.txt)   → direct chunking → stored in Mem0

All ingested content is stored as memories scoped to the authenticated user,
so the assistant can recall it in future conversations.
"""
from __future__ import annotations

import io
import os
import tempfile
from pathlib import Path
from typing import List

from fastapi import APIRouter, HTTPException, UploadFile, File, Depends
from pydantic import BaseModel

from app.auth import get_current_user_id
from app.agents.single_agent import get_memory_client
from app.config import GEMINI_API_KEY, GEMINI_MODEL, LLM_PROVIDER, GROQ_API_KEY

router = APIRouter()

# ── Constants ────────────────────────────────────────────────────────────────
CHUNK_SIZE = 1500       # characters per memory chunk
CHUNK_OVERLAP = 150     # overlap between chunks
MAX_FILE_SIZE = 20 * 1024 * 1024  # 20 MB

SUPPORTED_TYPES = {
    "application/pdf": "pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.ms-excel": "xlsx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "text/plain": "txt",
    "image/png": "image",
    "image/jpeg": "image",
    "image/webp": "image",
    "image/gif": "image",
}


# ── Response model ────────────────────────────────────────────────────────────
class IngestResponse(BaseModel):
    filename: str
    file_type: str
    chunks_stored: int
    message: str


# ── Text chunking ─────────────────────────────────────────────────────────────
def chunk_text(text: str, source: str) -> List[str]:
    """Split text into overlapping chunks with source label prepended."""
    text = text.strip()
    if not text:
        return []
    chunks = []
    start = 0
    while start < len(text):
        end = start + CHUNK_SIZE
        chunk = text[start:end]
        chunks.append(f"[Source: {source}]\n{chunk}")
        start += CHUNK_SIZE - CHUNK_OVERLAP
    return chunks


# ── Parsers ───────────────────────────────────────────────────────────────────
def parse_pdf(data: bytes, filename: str) -> str:
    """
    Layout-aware PDF parsing via the documents pipeline.
    Extracts text (with heading/paragraph classification), tables (as Markdown),
    and images (Gemini-captioned). Returns a single string representation
    for storage in Mem0 as memory chunks.

    The full structured pipeline (parser → chunker → store) is used by
    POST /api/documents/upload for vector-indexed retrieval.
    This function provides a flattened text version for backward-compatible
    Mem0 storage.
    """
    import tempfile
    from pathlib import Path as _Path

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp.write(data)
        tmp_path = tmp.name

    try:
        from app.documents.parser import parse_pdf as _parse_pdf
        from app.documents.chunker import chunk_elements, _table_to_markdown
        elements = _parse_pdf(tmp_path)
    finally:
        _Path(tmp_path).unlink(missing_ok=True)

    if not elements:
        # Fallback to pypdf
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(data))
        pages = []
        for i, page in enumerate(reader.pages):
            text = page.extract_text() or ""
            if text.strip():
                pages.append(f"[Page {i+1}]\n{text}")
        return "\n\n".join(pages)

    # Assemble a structured text representation from elements
    sections: list[str] = []
    current_heading = ""
    para_buffer: list[str] = []
    last_page = 0

    def flush_para():
        if para_buffer:
            joined = " ".join(para_buffer).strip()
            if joined:
                prefix = f"[{current_heading}] " if current_heading else ""
                sections.append(f"{prefix}{joined}")
            para_buffer.clear()

    for elem in elements:
        page = elem["page_number"]
        etype = elem["type"]

        if page != last_page:
            flush_para()
            sections.append(f"\n--- Page {page} ---")
            last_page = page

        if etype == "heading":
            flush_para()
            current_heading = elem["content"]
            sections.append(f"\n## {elem['content']}")

        elif etype == "paragraph":
            para_buffer.append(elem["content"])

        elif etype == "table":
            flush_para()
            content = elem["content"]
            # LlamaParse returns markdown string; fallback returns list[list]
            if isinstance(content, list):
                from app.documents.chunker import _table_to_markdown
                md = _table_to_markdown(content)
            else:
                md = str(content)
            if md:
                sections.append(f"\n[TABLE]\n{md}\n[/TABLE]")

        elif etype == "image":
            flush_para()
            try:
                from app.documents.chunker import _caption_image
                caption = _caption_image(elem["content"], page)
            except Exception:
                caption = f"[Image on page {page} — caption unavailable]"
            sections.append(f"\n[IMAGE on page {page}]: {caption}")

    flush_para()
    return "\n".join(sections)


def parse_docx(data: bytes, filename: str) -> str:
    from docx import Document
    doc = Document(io.BytesIO(data))
    paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
    # Also extract tables
    tables_text = []
    for table in doc.tables:
        rows = []
        for row in table.rows:
            cells = [cell.text.strip() for cell in row.cells if cell.text.strip()]
            if cells:
                rows.append(" | ".join(cells))
        if rows:
            tables_text.append("\n".join(rows))
    full = "\n\n".join(paragraphs)
    if tables_text:
        full += "\n\n[Tables]\n" + "\n\n".join(tables_text)
    return full


def parse_xlsx(data: bytes, filename: str) -> str:
    import openpyxl
    wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    sheets_text = []
    for sheet_name in wb.sheetnames:
        ws = wb[sheet_name]
        rows_text = []
        headers = []
        for i, row in enumerate(ws.iter_rows(values_only=True)):
            row_vals = [str(v) if v is not None else "" for v in row]
            if not any(v.strip() for v in row_vals):
                continue
            if i == 0:
                headers = row_vals
                rows_text.append("Headers: " + " | ".join(row_vals))
            else:
                if headers:
                    pairs = [f"{h}={v}" for h, v in zip(headers, row_vals) if v.strip()]
                    rows_text.append(", ".join(pairs))
                else:
                    rows_text.append(" | ".join(row_vals))
        if rows_text:
            sheets_text.append(f"[Sheet: {sheet_name}]\n" + "\n".join(rows_text))
    return "\n\n".join(sheets_text)


def parse_txt(data: bytes, filename: str) -> str:
    return data.decode("utf-8", errors="replace")


async def parse_image(data: bytes, filename: str) -> str:
    """Use Gemini Vision to describe the image content."""
    import base64
    import httpx

    if not GEMINI_API_KEY:
        return f"[Image: {filename}] — Gemini API key not set; cannot describe image."

    b64 = base64.b64encode(data).decode()
    # Detect mime type from filename
    ext = Path(filename).suffix.lower()
    mime_map = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                ".webp": "image/webp", ".gif": "image/gif"}
    mime = mime_map.get(ext, "image/jpeg")

    payload = {
        "contents": [{
            "parts": [
                {"inline_data": {"mime_type": mime, "data": b64}},
                {"text": (
                    "You are a business document analyst. Describe this image in detail. "
                    "If it contains text, tables, charts, graphs, logos, or business data, "
                    "extract and describe ALL of it thoroughly. Be specific and complete."
                )}
            ]
        }]
    }

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}",
            json=payload,
        )
        if resp.status_code == 200:
            result = resp.json()
            description = result["candidates"][0]["content"]["parts"][0]["text"]
            return f"[Image: {filename}]\n{description}"
        else:
            return f"[Image: {filename}] — Vision API error {resp.status_code}"


# ── Main endpoint ─────────────────────────────────────────────────────────────
@router.post("/ingest", response_model=IngestResponse)
async def ingest_file(
    file: UploadFile = File(...),
    user_id: str = Depends(get_current_user_id),
):
    """
    Upload a business document or image. The content is parsed, chunked,
    and stored permanently in the user's memory store so the assistant
    can reference it in any future conversation.
    """
    # Size check
    data = await file.read()
    if len(data) > MAX_FILE_SIZE:
        raise HTTPException(400, f"File too large. Max size is 20MB.")

    # Detect file type
    content_type = file.content_type or ""
    filename = file.filename or "unknown"
    ext = Path(filename).suffix.lower()

    # Map by extension if content_type is generic
    ext_type_map = {
        ".pdf": "pdf", ".docx": "docx", ".doc": "docx",
        ".xlsx": "xlsx", ".xls": "xlsx", ".txt": "txt",
        ".png": "image", ".jpg": "image", ".jpeg": "image",
        ".webp": "image", ".gif": "image",
    }
    file_type = SUPPORTED_TYPES.get(content_type) or ext_type_map.get(ext)

    if not file_type:
        raise HTTPException(400, f"Unsupported file type: {content_type} / {ext}")

    # Parse
    try:
        if file_type == "pdf":
            text = parse_pdf(data, filename)
        elif file_type == "docx":
            text = parse_docx(data, filename)
        elif file_type == "xlsx":
            text = parse_xlsx(data, filename)
        elif file_type == "txt":
            text = parse_txt(data, filename)
        elif file_type == "image":
            text = await parse_image(data, filename)
        else:
            raise HTTPException(400, "Unsupported file type")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Failed to parse {filename}: {str(e)}")

    if not text.strip():
        raise HTTPException(422, f"No text content could be extracted from {filename}.")

    # Chunk and store in Mem0
    chunks = chunk_text(text, filename)
    mem = get_memory_client()
    if mem is None:
        raise HTTPException(503, "Memory store is not available.")

    stored = 0
    errors = []
    for chunk in chunks:
        try:
            mem.add(
                messages=[{"role": "user", "content": f"Business document content: {chunk}"}],
                user_id=user_id,
            )
            stored += 1
        except Exception as e:
            errors.append(str(e))

    if stored == 0:
        raise HTTPException(500, f"Failed to store any chunks. Errors: {errors[:3]}")

    return IngestResponse(
        filename=filename,
        file_type=file_type,
        chunks_stored=stored,
        message=f"Successfully ingested '{filename}' — {stored} memory chunk(s) stored. The assistant can now recall this content.",
    )


@router.post("/ingest/multiple", response_model=List[IngestResponse])
async def ingest_multiple_files(
    files: List[UploadFile] = File(...),
    user_id: str = Depends(get_current_user_id),
):
    """Upload multiple files at once."""
    results = []
    for file in files:
        try:
            result = await ingest_file(file=file, user_id=user_id)
            results.append(result)
        except HTTPException as e:
            results.append(IngestResponse(
                filename=file.filename or "unknown",
                file_type="unknown",
                chunks_stored=0,
                message=f"Error: {e.detail}",
            ))
    return results
