"""
api/documents.py — Document upload and chunk inspection endpoints.

POST /api/documents/upload
    Multipart PDF upload. Runs parser → chunker → store pipeline.
    Returns document_id and chunk-type breakdown.

GET /api/documents/{document_id}/chunks
    Debug listing of all chunks for a document (mirrors Memory Inspector).
    Embeddings stripped from response to keep payload manageable.

DELETE /api/documents/{document_id}
    Remove all chunks for a document.

All routes require a valid JWT Bearer token.
user_id is NEVER accepted from the client — derived from the token only.
"""
from __future__ import annotations

import tempfile
import uuid
from pathlib import Path
from typing import List

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel

from app.auth import get_current_user_id
from app.documents.parser import parse_pdf
from app.documents.chunker import chunk_elements
from app.documents import store as doc_store

router = APIRouter()

MAX_PDF_SIZE = 50 * 1024 * 1024   # 50 MB


# ── Response models ───────────────────────────────────────────────────────────

class ChunkBreakdown(BaseModel):
    text:          int
    table:         int
    image_caption: int
    total:         int

class UploadResponse(BaseModel):
    document_id:  str
    filename:     str
    pages:        int
    chunks:       ChunkBreakdown

class ChunkOut(BaseModel):
    chunk_id:        str
    document_id:     str
    page_number:     int
    section_heading: str
    chunk_type:      str
    content:         str
    parent_id:       str | None
    image_path:      str | None


# ── Upload ────────────────────────────────────────────────────────────────────

@router.post("/documents/upload", response_model=UploadResponse, status_code=201)
async def upload_document(
    file: UploadFile = File(...),
    user_id: str = Depends(get_current_user_id),
):
    # Validate mime / extension
    filename = file.filename or "upload.pdf"
    if not filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Only PDF files are supported.")

    data = await file.read()
    if len(data) > MAX_PDF_SIZE:
        raise HTTPException(400, f"File exceeds {MAX_PDF_SIZE // (1024*1024)} MB limit.")
    if len(data) < 128:
        raise HTTPException(400, "File appears to be empty or invalid.")

    # Stamp document_id with user prefix so documents are user-scoped
    document_id = f"{user_id[:8]}_{uuid.uuid4().hex[:12]}"

    # Write to temp file (PyMuPDF needs a path)
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp.write(data)
        tmp_path = tmp.name

    try:
        # ── Parse ──────────────────────────────────────────────────────────
        elements = parse_pdf(tmp_path)
        if not elements:
            raise HTTPException(422, "No content could be extracted from this PDF.")

        pages = max(e["page_number"] for e in elements)

        # ── Chunk ──────────────────────────────────────────────────────────
        chunks = chunk_elements(elements, document_id)
        if not chunks:
            raise HTTPException(422, "Parser produced elements but chunker returned nothing.")

        # Tag each chunk with user_id AND filename for later retrieval
        for c in chunks:
            c["user_id"] = user_id
            c["filename"] = filename

        # ── Store ──────────────────────────────────────────────────────────
        await doc_store.store_chunks(chunks)
        await doc_store.ensure_vector_index()

        # ── Summary ────────────────────────────────────────────────────────
        n_text   = sum(1 for c in chunks if c["chunk_type"] == "text")
        n_table  = sum(1 for c in chunks if c["chunk_type"] == "table")
        n_image  = sum(1 for c in chunks if c["chunk_type"] == "image_caption")

        return UploadResponse(
            document_id=document_id,
            filename=filename,
            pages=pages,
            chunks=ChunkBreakdown(
                text=n_text,
                table=n_table,
                image_caption=n_image,
                total=len(chunks),
            ),
        )

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(500, f"Pipeline failed: {exc}") from exc
    finally:
        Path(tmp_path).unlink(missing_ok=True)


# ── Chunk inspector ───────────────────────────────────────────────────────────

@router.get("/documents", response_model=List[ChunkOut])
async def list_all_documents(user_id: str = Depends(get_current_user_id)):
    """Return one representative chunk per document — gives a document inventory."""
    from app.documents.store import list_chunks
    from motor.motor_asyncio import AsyncIOMotorCollection
    from app.db.mongo import get_db
    from bson import ObjectId

    db = get_db()
    if db is None:
        raise HTTPException(503, "Database not connected")

    col = db["document_chunks"]
    # Get distinct document_ids belonging to this user
    all_ids = await col.distinct("document_id")
    user_ids = [d for d in all_ids if d.startswith(user_id[:8])]

    results = []
    for did in user_ids:
        # Get first chunk as representative
        doc = await col.find_one({"document_id": did}, {"embedding": 0})
        if doc:
            results.append(ChunkOut(
                chunk_id=str(doc.get("chunk_id", "")),
                document_id=did,
                page_number=doc.get("page_number", 1),
                section_heading=doc.get("section_heading", ""),
                chunk_type=doc.get("chunk_type", "text"),
                content=doc.get("content", "")[:200],
                parent_id=doc.get("parent_id"),
                image_path=doc.get("image_path"),
            ))
    return results


class DocumentSummary(BaseModel):
    document_id:  str
    filename:     str
    chunk_count:  int
    table_count:  int
    image_count:  int
    text_count:   int
    uploaded_at:  str


@router.get("/documents/summary", response_model=List[DocumentSummary])
async def list_document_summaries(user_id: str = Depends(get_current_user_id)):
    """Return one summary card per uploaded document."""
    from app.db.mongo import get_db
    from bson import ObjectId
    import datetime

    db = get_db()
    if db is None:
        raise HTTPException(503, "Database not connected")

    col = db["document_chunks"]
    all_ids = await col.distinct("document_id")
    user_doc_ids = [d for d in all_ids if d.startswith(user_id[:8])]

    summaries = []
    for did in user_doc_ids:
        chunks = await col.find({"document_id": did}, {"chunk_type": 1, "content": 1, "section_heading": 1, "filename": 1, "_id": 1}).to_list(500)
        if not chunks:
            continue
        # Filename — try section_heading first, then content snippet
        first = chunks[0]
        oid = first.get("_id")
        import re

        # Best: filename field stored on chunk (new uploads)
        filename = first.get("filename", "")

        # Fallback 1: scan all chunks for [Source: filename] tag
        if not filename or filename == did:
            for chunk in chunks[:10]:
                c_str = str(chunk.get("content", ""))
                m = re.search(r'\[Source:\s*([^\]]+)\]', c_str)
                if m:
                    filename = m.group(1).strip()
                    break

        # Fallback 2: use section_heading if it looks like a filename
        if not filename or filename == did:
            hdg = first.get("section_heading", "")
            if hdg and ("." in hdg or len(hdg) < 50):
                filename = hdg

        # Fallback 3: check if any chunk has content starting with the PDF title
        if not filename or filename == did:
            # Look for a heading chunk which usually has the document title
            heading_chunks = [c for c in chunks if c.get("chunk_type") == "text"]
            if heading_chunks:
                txt = str(heading_chunks[0].get("content", ""))[:60]
                filename = txt if txt else did
            else:
                filename = did

        # Upload time from ObjectId
        try:
            uploaded_at = oid.generation_time.isoformat() if oid else ""
        except Exception:
            uploaded_at = ""

        summaries.append(DocumentSummary(
            document_id=did,
            filename=filename,
            chunk_count=len(chunks),
            table_count=sum(1 for c in chunks if c.get("chunk_type") == "table"),
            image_count=sum(1 for c in chunks if c.get("chunk_type") == "image_caption"),
            text_count=sum(1 for c in chunks if c.get("chunk_type") == "text"),
            uploaded_at=uploaded_at,
        ))

    # Sort newest first
    summaries.sort(key=lambda s: s.uploaded_at, reverse=True)
    return summaries


@router.get("/documents/{document_id}/chunks", response_model=List[ChunkOut])
async def list_document_chunks(
    document_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """Return all chunks for a document (no embeddings). Auth required."""
    chunks = await doc_store.list_chunks(document_id)
    if not chunks:
        raise HTTPException(404, f"No chunks found for document '{document_id}'.")
    # Verify this document belongs to the requesting user
    if not document_id.startswith(user_id[:8]):
        raise HTTPException(403, "Access denied.")
    return [
        ChunkOut(
            chunk_id        = c["chunk_id"],
            document_id     = c["document_id"],
            page_number     = c["page_number"],
            section_heading = c.get("section_heading", ""),
            chunk_type      = c["chunk_type"],
            content         = c["content"][:800],   # trim for display
            parent_id       = c.get("parent_id"),
            image_path      = c.get("image_path"),
        )
        for c in chunks
    ]


# ── Delete ────────────────────────────────────────────────────────────────────

@router.delete("/documents/{document_id}")
async def delete_document(
    document_id: str,
    user_id: str = Depends(get_current_user_id),
):
    if not document_id.startswith(user_id[:8]):
        raise HTTPException(403, "Access denied.")
    deleted = await doc_store.delete_document_chunks(document_id)
    return {"deleted_chunks": deleted, "document_id": document_id}
