"""
documents/chunker.py — Converts raw parser elements into storable chunks.

Rules:
  TEXT (heading / paragraph)
    - Consecutive paragraphs under the same heading are merged into one chunk
      as long as the combined length stays under SOFT_MAX_CHARS.
    - When a new heading is encountered, the current text buffer is flushed
      and the heading becomes the new section_heading for subsequent paragraphs.
    - A heading itself is NOT emitted as a separate chunk; it is attached as
      section_heading metadata to the paragraphs that follow it.

  TABLE
    - Converted to a GitHub-flavoured Markdown table string.
    - Always one chunk, regardless of size — never split.
    - parent_id = chunk_id of the paragraph chunk immediately before this
      element on the same page.

  IMAGE
    - Bytes sent to Gemini Vision with a factual-description prompt.
    - Returned text becomes content; original bytes saved to
      backend/data/document_images/{document_id}_{page}_{idx}.png.
    - parent_id = chunk_id of the paragraph chunk immediately before this
      element on the same page.

Every chunk is a plain dict ready for store.py to embed and insert.
"""
from __future__ import annotations

import base64
import hashlib
import re
import time
import uuid
from pathlib import Path
from typing import Any

from app.config import GEMINI_API_KEY, GEMINI_MODEL

# ── Constants ─────────────────────────────────────────────────────────────────
SOFT_MAX_CHARS = 1200          # target max chars per text chunk before flushing
IMAGE_DIR = Path(__file__).parent.parent.parent / "data" / "document_images"


# ── Gemini Vision helper ──────────────────────────────────────────────────────

def _caption_image(png_bytes: bytes, page: int) -> str:
    """Send image bytes to Gemini and return a factual caption string."""
    if not GEMINI_API_KEY:
        return f"[Image on page {page} — Gemini API key not configured]"
    try:
        import httpx
        b64 = base64.b64encode(png_bytes).decode()
        payload = {
            "contents": [{
                "parts": [
                    {"inline_data": {"mime_type": "image/png", "data": b64}},
                    {"text": (
                        "Describe this image or diagram factually. "
                        "If it shows a process, flow, or relationship between things, "
                        "describe that explicitly. "
                        "If it contains numbers, labels, percentages, or monetary values, "
                        "include every one of them verbatim. "
                        "Be thorough — this description will be used to answer questions "
                        "about the document."
                    )},
                ]
            }]
        }
        models = ["gemini-3.6-flash", "gemini-2.5-flash-preview-05-20", "gemini-1.5-flash"]
        for m in list(dict.fromkeys(models)):
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{m}:generateContent?key={GEMINI_API_KEY}"
            resp = httpx.post(url, json=payload, timeout=60)
            if resp.status_code == 200:
                data = resp.json()
                return data["candidates"][0]["content"]["parts"][0]["text"].strip()
        return f"[Image on page {page} — vision unavailable]"
    except Exception as exc:
        return f"[Image on page {page} — caption skipped: {type(exc).__name__}]"


# ── Table → Markdown ──────────────────────────────────────────────────────────

def _table_to_markdown(rows: list[list]) -> str:
    """Convert pdfplumber rows (list[list[str|None]]) to GFM Markdown table."""
    if not rows:
        return ""
    # Normalise: replace None with empty string
    cleaned = [[str(cell).strip() if cell is not None else "" for cell in row]
               for row in rows]
    # Find max columns
    ncols = max(len(r) for r in cleaned)
    # Pad all rows to same width
    padded = [r + [""] * (ncols - len(r)) for r in cleaned]

    def _row(cells):
        return "| " + " | ".join(cells) + " |"

    lines = [_row(padded[0])]
    lines.append("| " + " | ".join(["---"] * ncols) + " |")
    for row in padded[1:]:
        lines.append(_row(row))
    return "\n".join(lines)


# ── Chunk ID factory ──────────────────────────────────────────────────────────

def _make_id() -> str:
    return str(uuid.uuid4())


# ── Main chunker ──────────────────────────────────────────────────────────────

def chunk_elements(
    elements: list[dict[str, Any]],
    document_id: str,
) -> list[dict[str, Any]]:
    """
    Convert raw parser elements into chunks ready for embedding + storage.

    Returns a list of chunk dicts:
      chunk_id, document_id, page_number, section_heading,
      chunk_type ("text"|"table"|"image_caption"),
      content (str), parent_id (str|None),
      image_path (str|None — only for image_caption chunks)
    """
    IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    chunks: list[dict] = []

    # State for text merging
    current_heading: str = ""
    text_buffer: list[str] = []
    buffer_page: int = 1

    # Track the last text chunk emitted per page for parent_id linking
    last_text_chunk_id_by_page: dict[int, str] = {}

    def _flush_text():
        nonlocal text_buffer, buffer_page
        if not text_buffer:
            return
        content = " ".join(text_buffer).strip()
        if not content:
            text_buffer = []
            return
        cid = _make_id()
        chunks.append({
            "chunk_id":        cid,
            "document_id":     document_id,
            "filename":        document_id,  # overwritten by upload endpoint with real filename
            "page_number":     buffer_page,
            "section_heading": current_heading,
            "chunk_type":      "text",
            "content":         content,
            "parent_id":       None,
            "image_path":      None,
        })
        last_text_chunk_id_by_page[buffer_page] = cid
        text_buffer = []

    for elem in elements:
        etype = elem["type"]
        page  = elem["page_number"]

        if etype == "heading":
            # Flush pending text under the OLD heading, then update heading
            _flush_text()
            buffer_page = page
            current_heading = elem["content"]

        elif etype == "paragraph":
            text = elem["content"]
            # If adding this paragraph would bust the soft limit, flush first
            combined_len = sum(len(t) for t in text_buffer) + len(text)
            if text_buffer and combined_len > SOFT_MAX_CHARS:
                _flush_text()
            if not text_buffer:
                buffer_page = page
            text_buffer.append(text)

        elif etype == "table":
            # Flush any pending text so parent_id resolves correctly
            _flush_text()
            content = elem["content"]
            # LlamaParse returns content as a markdown string already.
            # Fallback (pdfplumber) also returns markdown now.
            # Only call _table_to_markdown if content is a list (legacy path).
            if isinstance(content, list):
                md = _table_to_markdown(content)
            else:
                md = str(content)
            if not md.strip():
                continue
            parent_id = last_text_chunk_id_by_page.get(page)
            cid = _make_id()
            chunks.append({
                "chunk_id":        cid,
                "document_id":     document_id,
                "page_number":     page,
                "section_heading": current_heading,
                "chunk_type":      "table",
                "content":         md,
                "parent_id":       parent_id,
                "image_path":      None,
            })

        elif etype == "image":
            _flush_text()
            png_bytes: bytes = elem["content"]

            # Save image to disk
            img_hash = hashlib.md5(png_bytes).hexdigest()[:8]
            img_filename = f"{document_id}_p{page}_{img_hash}.png"
            img_path = IMAGE_DIR / img_filename
            img_path.write_bytes(png_bytes)

            # Get Gemini caption
            caption = _caption_image(png_bytes, page)

            parent_id = last_text_chunk_id_by_page.get(page)
            cid = _make_id()
            chunks.append({
                "chunk_id":        cid,
                "document_id":     document_id,
                "page_number":     page,
                "section_heading": current_heading,
                "chunk_type":      "image_caption",
                "content":         caption,
                "parent_id":       parent_id,
                "image_path":      str(img_path),
            })

    # Flush any remaining text
    _flush_text()
    return chunks
