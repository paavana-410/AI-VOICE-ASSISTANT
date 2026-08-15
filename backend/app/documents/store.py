"""
documents/store.py — Embedding + MongoDB persistence for document chunks.

Design decisions:
  - Uses the SAME Motor client / database already configured in app/db/mongo.py.
    No new connection string. No new config variable.
  - Collection: "document_chunks"  (separate from Mem0's mem0_memories collection).
  - Vector index name: "doc_chunks_vector_index"  (separate from mem0_vector_index).
  - Same embedding model as Mem0 (sentence-transformers/all-MiniLM-L6-v2, 384-dim)
    so we don't load a second model into memory.
  - Context stitching in search_chunks(): when a table or image_caption chunk is
    returned, its parent paragraph chunk is fetched and included in the result
    so the LLM always sees the explanatory text alongside the structured data.
"""
from __future__ import annotations

import asyncio
from typing import Optional

from app.db.mongo import get_db

# ── Embedding model (singleton, loaded once) ──────────────────────────────────
_embedder = None

def _get_embedder():
    global _embedder
    if _embedder is None:
        from sentence_transformers import SentenceTransformer
        _embedder = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")
    return _embedder


def _embed(text: str) -> list[float]:
    model = _get_embedder()
    vec = model.encode(text, normalize_embeddings=True)
    return vec.tolist()


# ── Collection helper ─────────────────────────────────────────────────────────

def _col():
    db = get_db()
    if db is None:
        raise RuntimeError("MongoDB not connected")
    return db["document_chunks"]


# ── Index creation ────────────────────────────────────────────────────────────

async def ensure_vector_index() -> None:
    """
    Create the Atlas vector search index for document_chunks if it doesn't exist.
    Index is created async; Atlas typically provisions it within 60 seconds.
    Safe to call on every startup — silently skips if already present.
    """
    col = _col()
    index_name = "doc_chunks_vector_index"
    try:
        existing = await col.list_search_indexes().to_list(50)
        names = [idx.get("name") for idx in existing]
        if index_name in names:
            return
        index_def = {
            "name": index_name,
            "type": "vectorSearch",
            "definition": {
                "fields": [{
                    "type":          "vector",
                    "path":          "embedding",
                    "numDimensions": 384,
                    "similarity":    "cosine",
                }]
            },
        }
        await col.create_search_index(index_def)
    except Exception as exc:
        # Non-fatal: log and continue (index may already exist or Atlas free tier
        # FTS index limit reached)
        import logging
        logging.getLogger(__name__).warning(
            "document_chunks vector index creation skipped: %s", exc
        )


# ── Store a single chunk ──────────────────────────────────────────────────────

async def store_chunk(chunk: dict) -> None:
    """Embed chunk.content and insert the full document into document_chunks."""
    col = _col()
    # Embed in a thread so we don't block the event loop
    loop = asyncio.get_event_loop()
    embedding = await loop.run_in_executor(None, _embed, chunk["content"])

    doc = {
        "chunk_id":        chunk["chunk_id"],
        "document_id":     chunk["document_id"],
        "page_number":     chunk["page_number"],
        "section_heading": chunk["section_heading"],
        "chunk_type":      chunk["chunk_type"],
        "content":         chunk["content"],
        "parent_id":       chunk.get("parent_id"),
        "image_path":      chunk.get("image_path"),
        "embedding":       embedding,
    }
    await col.insert_one(doc)


async def store_chunks(chunks: list[dict]) -> None:
    """Store multiple chunks (sequential to avoid overwhelming Atlas free tier)."""
    for chunk in chunks:
        await store_chunk(chunk)


# ── Vector search with context stitching ─────────────────────────────────────

async def search_chunks(
    query: str,
    document_id: Optional[str] = None,
    top_k: int = 5,
) -> list[dict]:
    """
    Vector search over document_chunks.

    After retrieving top_k results, for any chunk whose chunk_type is
    "table" or "image_caption" we also fetch the parent paragraph chunk
    (matching parent_id) and prepend it to the result set so the LLM
    receives the explanatory prose alongside the structured data.

    Returns a deduplicated list of chunk dicts (no embeddings — stripped
    to save token space in the prompt).
    """
    col = _col()
    loop = asyncio.get_event_loop()
    query_vec = await loop.run_in_executor(None, _embed, query)

    # Build Atlas $vectorSearch pipeline
    vector_stage: dict = {
        "$vectorSearch": {
            "index":         "doc_chunks_vector_index",
            "path":          "embedding",
            "queryVector":   query_vec,
            "numCandidates": top_k * 10,
            "limit":         top_k,
        }
    }
    if document_id:
        vector_stage["$vectorSearch"]["filter"] = {"document_id": {"$eq": document_id}}

    pipeline = [
        vector_stage,
        {"$project": {"embedding": 0, "_id": 0}},
    ]

    try:
        raw = await col.aggregate(pipeline).to_list(top_k)
        if not raw:
            raise ValueError("empty")
    except Exception:
        # Vector index not ready — fall back to regex text search on document_chunks
        import re
        filter_q: dict = {}
        if document_id:
            filter_q["document_id"] = document_id
        words = [w for w in query.split() if len(w) > 3]
        if words:
            filter_q["content"] = {
                "$regex": "|".join(re.escape(w) for w in words[:8]),
                "$options": "i",
            }
        # Sort by _id descending = most recent first
        raw = await col.find(
            filter_q, {"embedding": 0, "_id": 0}
        ).sort("_id", -1).limit(top_k).to_list(top_k)

        # If still empty, return most recent chunks regardless of keyword
        if not raw:
            raw = await col.find(
                {"document_id": document_id} if document_id else {},
                {"embedding": 0, "_id": 0}
            ).sort("_id", -1).limit(top_k).to_list(top_k)

    # ── Context stitching ─────────────────────────────────────────────────────
    seen_ids: set[str] = set()
    stitched: list[dict] = []

    for chunk in raw:
        cid = chunk.get("chunk_id", "")
        if cid in seen_ids:
            continue
        seen_ids.add(cid)

        # For table / image_caption, fetch parent paragraph first
        if chunk.get("chunk_type") in ("table", "image_caption"):
            parent_id = chunk.get("parent_id")
            if parent_id and parent_id not in seen_ids:
                parent = await col.find_one(
                    {"chunk_id": parent_id},
                    {"embedding": 0, "_id": 0},
                )
                if parent:
                    seen_ids.add(parent_id)
                    stitched.append(parent)

        stitched.append(chunk)

    return stitched


# ── Listing helper (for debug endpoint) ──────────────────────────────────────

async def list_chunks(document_id: str) -> list[dict]:
    col = _col()
    docs = await col.find(
        {"document_id": document_id},
        {"embedding": 0, "_id": 0},
    ).sort("page_number", 1).to_list(500)
    return docs


async def delete_document_chunks(document_id: str) -> int:
    col = _col()
    result = await col.delete_many({"document_id": document_id})
    return result.deleted_count
