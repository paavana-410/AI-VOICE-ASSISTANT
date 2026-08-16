"""
documents/store.py — Document chunk storage and retrieval.

Atlas free tier has hit its FTS index limit, so vector search is unavailable.
We use fast regex search directly — no embedding needed at query time.
Embeddings are still stored for future use when a paid Atlas tier is available.
"""
from __future__ import annotations

import asyncio
import re
from typing import Optional

from app.db.mongo import get_db


# ── Embedding (stored but not used for search on free tier) ──────────────────
_embedder = None

def _get_embedder():
    global _embedder
    if _embedder is None:
        from sentence_transformers import SentenceTransformer
        _embedder = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")
    return _embedder

def _embed(text: str) -> list[float]:
    return _get_embedder().encode(text, normalize_embeddings=True).tolist()


# ── Collection helper ─────────────────────────────────────────────────────────

def _col():
    db = get_db()
    if db is None:
        raise RuntimeError("MongoDB not connected")
    return db["document_chunks"]


# ── Index creation (no-op on free tier) ──────────────────────────────────────

async def ensure_vector_index() -> None:
    """Attempt to create vector index — silently skips if FTS limit reached."""
    try:
        col = _col()
        existing = await col.list_search_indexes().to_list(50)
        if any(i.get("name") == "doc_chunks_vector_index" for i in existing):
            return
        await col.create_search_index({
            "name": "doc_chunks_vector_index",
            "type": "vectorSearch",
            "definition": {"fields": [{"type": "vector", "path": "embedding", "numDimensions": 384, "similarity": "cosine"}]},
        })
    except Exception:
        pass


# ── Store ─────────────────────────────────────────────────────────────────────

async def store_chunk(chunk: dict) -> None:
    col = _col()
    # Store embedding for future vector search (when index available)
    try:
        loop = asyncio.get_running_loop()
        embedding = await loop.run_in_executor(None, _embed, chunk["content"])
    except Exception:
        embedding = []
    await col.insert_one({
        "chunk_id":        chunk["chunk_id"],
        "document_id":     chunk["document_id"],
        "filename":        chunk.get("filename", ""),
        "page_number":     chunk["page_number"],
        "section_heading": chunk["section_heading"],
        "chunk_type":      chunk["chunk_type"],
        "content":         chunk["content"],
        "parent_id":       chunk.get("parent_id"),
        "image_path":      chunk.get("image_path"),
        "embedding":       embedding,
    })

async def store_chunks(chunks: list[dict]) -> None:
    for chunk in chunks:
        await store_chunk(chunk)


# ── Search (regex-based — fast, no index needed) ──────────────────────────────

async def search_chunks(
    query: str,
    document_id: Optional[str] = None,
    top_k: int = 5,
) -> list[dict]:
    """
    Search document chunks using regex (no vector index required).

    Priority order:
    1. Keyword match in content
    2. Keyword match in filename
    3. Most recent chunks (fallback)

    Context stitching: tables/images include their parent paragraph.
    """
    col = _col()
    base_filter: dict = {}
    if document_id:
        base_filter["document_id"] = document_id

    raw: list[dict] = []

    try:
        # ── Step 1: keyword search in content ────────────────────────────────────
        raw_words = [w for w in re.split(r'\W+', query) if 3 <= len(w) <= 20]
        words = raw_words[:4]
        if words:
            pattern = "|".join(re.escape(w) for w in words)
            q = {**base_filter, "content": {"$regex": pattern, "$options": "i"}}
            try:
                raw = await col.find(q, {"embedding": 0, "_id": 0}).sort("_id", -1).limit(top_k).to_list(top_k)
            except Exception:
                raw = []

        # ── Step 2: filename match ────────────────────────────────────────────────
        if not raw and words:
            pattern = "|".join(re.escape(w) for w in words[:3])
            q = {**base_filter, "filename": {"$regex": pattern, "$options": "i"}}
            try:
                raw = await col.find(q, {"embedding": 0, "_id": 0}).sort("_id", -1).limit(top_k).to_list(top_k)
            except Exception:
                raw = []

        # ── Step 3: return most recent chunks ─────────────────────────────────────
        if not raw:
            try:
                raw = await col.find(base_filter, {"embedding": 0, "_id": 0}).sort("_id", -1).limit(top_k).to_list(top_k)
            except Exception:
                raw = []

        if not raw:
            return []

        # ── Context stitching ─────────────────────────────────────────────────────
        seen: set[str] = set()
        result: list[dict] = []
        for chunk in raw:
            cid = chunk.get("chunk_id", "")
            if cid in seen:
                continue
            seen.add(cid)
            if chunk.get("chunk_type") in ("table", "image_caption"):
                pid = chunk.get("parent_id")
                if pid and pid not in seen:
                    try:
                        parent = await col.find_one({"chunk_id": pid}, {"embedding": 0, "_id": 0})
                        if parent:
                            seen.add(pid)
                            result.append(parent)
                    except Exception:
                        pass
            result.append(chunk)

        return result
    except Exception:
        return []


# ── List / delete ─────────────────────────────────────────────────────────────

async def list_chunks(document_id: str) -> list[dict]:
    col = _col()
    return await col.find({"document_id": document_id}, {"embedding": 0, "_id": 0}).sort("page_number", 1).to_list(500)

async def delete_document_chunks(document_id: str) -> int:
    col = _col()
    return (await col.delete_many({"document_id": document_id})).deleted_count

