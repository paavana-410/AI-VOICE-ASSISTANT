"""
documents/parser.py — Layout-aware PDF element extractor.

Primary engine  : LlamaParse (cloud AI — handles borderless tables, multi-column
                  layouts, academic papers, invoices, reports correctly)
Secondary engine: PyMuPDF (fitz) — used ONLY for embedded image extraction,
                  since LlamaParse does not return raw image bytes.

Fallback        : If LLAMA_CLOUD_API_KEY is not set, falls back to the original
                  PyMuPDF + pdfplumber dual-pass approach so the system still works.

Returned element schema:
  {
    "type":        "heading" | "paragraph" | "table" | "image",
    "page_number": int,           # 1-based
    "content":     str | bytes,   # str for text/table/heading, bytes for image
    "bbox":        tuple,         # (x0, y0, x1, y1) — approx for LlamaParse elements
    "font_size":   float | None
  }
"""
from __future__ import annotations

import io
import re
from pathlib import Path
from typing import Any

import fitz  # PyMuPDF — always available, used for images

from app.config import LLAMA_CLOUD_API_KEY


# ── LlamaParse primary path ───────────────────────────────────────────────────

def _parse_with_llamaparse(file_path: Path) -> list[dict[str, Any]]:
    """
    Use LlamaParse to extract text, headings and tables from the PDF.
    Returns elements in reading order with approximate bboxes.

    LlamaParse returns one markdown string per page. We then classify
    each block within that markdown as heading / table / paragraph.
    """
    from llama_parse import LlamaParse

    parser = LlamaParse(
        api_key=LLAMA_CLOUD_API_KEY,
        result_type="markdown",
        verbose=False,
        language="en",
    )

    documents = parser.load_data(str(file_path))

    elements: list[dict] = []

    for doc in documents:
        # LlamaParse embeds page info in metadata when available
        page_num = doc.metadata.get("page_label", None)
        try:
            page_num = int(page_num)
        except (TypeError, ValueError):
            page_num = 1

        md_text: str = doc.text or ""
        if not md_text.strip():
            continue

        # Split markdown into blocks separated by blank lines
        blocks = re.split(r"\n{2,}", md_text.strip())

        y_pos = 0.0   # synthetic y position — increments per block
        for block in blocks:
            block = block.strip()
            if not block:
                continue

            # ── Detect markdown table (starts with |) ─────────────────────
            lines = block.splitlines()
            if len(lines) >= 2 and lines[0].startswith("|"):
                # Validate it looks like a real GFM table (has separator row)
                has_sep = any(
                    re.match(r"^\|[-| :]+\|$", l.strip())
                    for l in lines
                )
                if has_sep:
                    # Clean up: remove extra spaces inside cells
                    cleaned_lines = []
                    for ln in lines:
                        cells = [c.strip() for c in ln.strip().strip("|").split("|")]
                        cleaned_lines.append("| " + " | ".join(cells) + " |")
                    elements.append({
                        "type":        "table",
                        "page_number": page_num,
                        "content":     "\n".join(cleaned_lines),
                        "bbox":        (0, y_pos, 600, y_pos + 20),
                        "font_size":   None,
                    })
                    y_pos += 30
                    continue

            # ── Detect heading (# or ## prefix, or short bold lines) ──────
            if re.match(r"^#{1,4}\s+", block):
                heading_text = re.sub(r"^#{1,4}\s+", "", block).strip()
                # Strip bold markers
                heading_text = re.sub(r"\*\*(.*?)\*\*", r"\1", heading_text)
                elements.append({
                    "type":        "heading",
                    "page_number": page_num,
                    "content":     heading_text,
                    "bbox":        (0, y_pos, 600, y_pos + 12),
                    "font_size":   16.0,
                })
                y_pos += 14
                continue

            # ── Everything else is paragraph ───────────────────────────────
            # Clean markdown formatting: bold, italic, links
            clean = re.sub(r"\*\*(.*?)\*\*", r"\1", block)
            clean = re.sub(r"\*(.*?)\*",     r"\1", clean)
            clean = re.sub(r"\[(.*?)\]\(.*?\)", r"\1", clean)
            clean = clean.strip()
            if not clean:
                continue

            elements.append({
                "type":        "paragraph",
                "page_number": page_num,
                "content":     clean,
                "bbox":        (0, y_pos, 600, y_pos + 10),
                "font_size":   11.0,
            })
            y_pos += 12

    return elements


# ── PyMuPDF image extraction ──────────────────────────────────────────────────

def _extract_images_fitz(file_path: Path) -> list[dict[str, Any]]:
    """
    Extract embedded images from every page using PyMuPDF.
    Returns image elements only — text/tables come from LlamaParse.
    Skips tiny images (< 2KB) that are likely icons or decorations.
    """
    elements: list[dict] = []
    fitz_doc = fitz.open(str(file_path))

    for page_idx in range(len(fitz_doc)):
        page = fitz_doc[page_idx]
        page_num = page_idx + 1

        for img_info in page.get_images(full=True):
            xref = img_info[0]
            try:
                base_img = fitz_doc.extract_image(xref)
            except Exception:
                continue

            img_bytes = base_img.get("image", b"")
            if len(img_bytes) < 2048:   # skip icons / tiny decorations
                continue

            img_rects = page.get_image_rects(xref)
            bbox = tuple(img_rects[0]) if img_rects else (0, 0, 600, 400)

            # Normalise to PNG
            try:
                from PIL import Image as PILImage
                buf = io.BytesIO()
                PILImage.open(io.BytesIO(img_bytes)).save(buf, format="PNG")
                png_bytes = buf.getvalue()
            except Exception:
                png_bytes = img_bytes

            elements.append({
                "type":        "image",
                "page_number": page_num,
                "content":     png_bytes,
                "bbox":        bbox,
                "font_size":   None,
            })

    fitz_doc.close()
    return elements


# ── PyMuPDF + pdfplumber fallback ─────────────────────────────────────────────

def _parse_fallback(file_path: Path) -> list[dict[str, Any]]:
    """
    Original dual-pass parser used when LLAMA_CLOUD_API_KEY is not set.
    PyMuPDF for text/images, pdfplumber for tables.
    Limited on borderless tables but works for simple PDFs.
    """
    import pdfplumber

    elements: list[dict] = []
    fitz_doc  = fitz.open(str(file_path))
    plumb_doc = pdfplumber.open(str(file_path))

    def _median(vals):
        if not vals: return 12.0
        s = sorted(vals)
        m = len(s) // 2
        return (s[m] + s[m-1]) / 2 if len(s) % 2 == 0 else s[m]

    def _block_text(blk):
        return " ".join(
            span.get("text", "")
            for line in blk.get("lines", [])
            for span in line.get("spans", [])
        ).strip()

    def _plumber_bbox(bbox, ph):
        x0, top, x1, bot = bbox
        return (x0, ph - bot, x1, ph - top)

    def _overlaps(a, b, t=0.5):
        ix0, iy0 = max(a[0],b[0]), max(a[1],b[1])
        ix1, iy1 = min(a[2],b[2]), min(a[3],b[3])
        if ix1 <= ix0 or iy1 <= iy0: return False
        inter = (ix1-ix0)*(iy1-iy0)
        area  = (a[2]-a[0])*(a[3]-a[1])
        return inter / max(area, 1) >= t

    for pi in range(len(fitz_doc)):
        fp = fitz_doc[pi]
        pp = plumb_doc.pages[pi]
        pn = pi + 1
        ph = fp.rect.height
        raw_blocks = fp.get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE)["blocks"]

        sizes = [
            sp.get("size", 0)
            for b in raw_blocks if b.get("type") == 0
            for ln in b.get("lines", [])
            for sp in ln.get("spans", [])
            if sp.get("size", 0) > 0
        ]
        med = _median(sizes)

        # Tables
        table_bboxes: list[tuple] = []
        for strat in [
            {"vertical_strategy": "lines",  "horizontal_strategy": "lines"},
            {"vertical_strategy": "text",   "horizontal_strategy": "text"},
        ]:
            try:
                tbls = pp.find_tables(strat)
                if tbls:
                    for tbl in tbls:
                        rows = tbl.extract()
                        if not rows or len(rows) < 2: continue
                        ncols = max(len(r) for r in rows)
                        if ncols < 2: continue
                        ne = sum(1 for r in rows for c in r if c and str(c).strip())
                        tot = sum(len(r) for r in rows)
                        if tot and ne / tot < 0.25: continue
                        bfitz = _plumber_bbox(tbl.bbox, ph)
                        table_bboxes.append(bfitz)
                        # Convert to markdown
                        cleaned = [[str(c).strip() if c else "" for c in r] for r in rows]
                        nc = max(len(r) for r in cleaned)
                        padded = [r + [""]*(nc-len(r)) for r in cleaned]
                        def row_str(r): return "| " + " | ".join(r) + " |"
                        md = row_str(padded[0]) + "\n"
                        md += "| " + " | ".join(["---"]*nc) + " |\n"
                        md += "\n".join(row_str(r) for r in padded[1:])
                        elements.append({
                            "type": "table", "page_number": pn,
                            "content": md, "bbox": bfitz, "font_size": None,
                        })
                    break
            except Exception:
                continue

        # Text
        for blk in raw_blocks:
            if blk.get("type") != 0: continue
            bbox = tuple(blk["bbox"])
            text = _block_text(blk)
            if not text: continue
            if any(_overlaps(bbox, tb) for tb in table_bboxes): continue
            dom = max(
                (sp.get("size",0) for ln in blk.get("lines",[]) for sp in ln.get("spans",[])),
                default=0
            )
            kind = "heading" if dom >= med * 1.3 else "paragraph"
            elements.append({
                "type": kind, "page_number": pn,
                "content": text, "bbox": bbox, "font_size": dom,
            })

        # Images
        for img_info in fp.get_images(full=True):
            xref = img_info[0]
            try: base_img = fitz_doc.extract_image(xref)
            except: continue
            img_bytes = base_img.get("image", b"")
            if len(img_bytes) < 512: continue
            rects = fp.get_image_rects(xref)
            bbox  = tuple(rects[0]) if rects else (0, 0, fp.rect.width, fp.rect.height)
            try:
                from PIL import Image as PILImage
                buf = io.BytesIO()
                PILImage.open(io.BytesIO(img_bytes)).save(buf, format="PNG")
                img_bytes = buf.getvalue()
            except: pass
            elements.append({
                "type": "image", "page_number": pn,
                "content": img_bytes, "bbox": bbox, "font_size": None,
            })

    fitz_doc.close()
    plumb_doc.close()
    elements.sort(key=lambda e: (e["page_number"], e["bbox"][1]))
    return elements


# ── Public entry point ────────────────────────────────────────────────────────

def parse_pdf(file_path: str | Path) -> list[dict[str, Any]]:
    """
    Parse a PDF using local PyMuPDF + pdfplumber.
    Fast, offline, no external API dependency.
    LlamaParse integration is disabled — free tier API keeps changing its interface.
    """
    return _parse_fallback(Path(file_path))
