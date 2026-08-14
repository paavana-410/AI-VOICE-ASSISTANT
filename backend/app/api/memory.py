"""
api/memory.py — CRUD endpoints for the Memory Inspector UI.

GET    /api/memories            → list all memories for the authenticated user
GET    /api/memories/search?q=  → semantic search
POST   /api/memories            → add a memory manually
PUT    /api/memories/{id}       → update memory text
DELETE /api/memories/{id}       → delete a specific memory
DELETE /api/memories            → delete ALL memories for the authenticated user

user_id is always derived from the JWT token — never accepted from the client.
"""
from fastapi import APIRouter, HTTPException, Query, Depends
from pydantic import BaseModel

from app.agents.single_agent import get_memory_client
from app.auth import get_current_user_id

router = APIRouter()


# ── Models ───────────────────────────────────────────────────────────────────

class MemoryItem(BaseModel):
    id: str
    memory: str
    user_id: str | None = None
    score: float | None = None


class UpdateMemoryRequest(BaseModel):
    memory: str


class AddMemoryRequest(BaseModel):
    memory: str


# ── Helpers ──────────────────────────────────────────────────────────────────

def _normalize(raw: list | dict) -> list[dict]:
    """Mem0 returns different shapes depending on version; normalise to list."""
    if isinstance(raw, dict):
        return raw.get("results", [])
    return raw or []


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/memories", response_model=list[MemoryItem])
async def list_memories(user_id: str = Depends(get_current_user_id)):
    """Return all stored memories for the authenticated user."""
    try:
        mem = get_memory_client()
        raw = mem.get_all(user_id=user_id)
        items = _normalize(raw)
        return [
            MemoryItem(
                id=str(item.get("id", "")),
                memory=item.get("memory", item.get("text", str(item))),
                user_id=item.get("user_id", user_id),
                score=item.get("score"),
            )
            for item in items
        ]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/memories", response_model=MemoryItem)
async def add_memory(
    body: AddMemoryRequest,
    user_id: str = Depends(get_current_user_id),
):
    """Add a new memory manually for the authenticated user."""
    try:
        mem = get_memory_client()
        result = mem.add(messages=body.memory, user_id=user_id)
        return MemoryItem(id=str(result.get("id", "")), memory=body.memory, user_id=user_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/memories/search", response_model=list[MemoryItem])
async def search_memories(
    q: str = Query(..., description="Search query"),
    user_id: str = Depends(get_current_user_id),
):
    """Semantically search memories for the authenticated user."""
    try:
        mem = get_memory_client()
        raw = mem.search(query=q, filters={"user_id": user_id}, limit=10)
        items = _normalize(raw)
        return [
            MemoryItem(
                id=str(item.get("id", "")),
                memory=item.get("memory", item.get("text", str(item))),
                user_id=item.get("user_id", user_id),
                score=item.get("score"),
            )
            for item in items
        ]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.put("/memories/{memory_id}", response_model=MemoryItem)
async def update_memory(
    memory_id: str,
    body: UpdateMemoryRequest,
    user_id: str = Depends(get_current_user_id),
):
    """Update the text of an existing memory (must belong to authenticated user)."""
    try:
        mem = get_memory_client()
        mem.update(memory_id=memory_id, data=body.memory)
        return MemoryItem(id=memory_id, memory=body.memory, user_id=user_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.delete("/memories/{memory_id}")
async def delete_memory(
    memory_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """Delete a specific memory by id."""
    try:
        mem = get_memory_client()
        mem.delete(memory_id=memory_id)
        return {"deleted": memory_id}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.delete("/memories")
async def delete_all_memories(user_id: str = Depends(get_current_user_id)):
    """Delete ALL memories for the authenticated user."""
    try:
        mem = get_memory_client()
        mem.delete_all(user_id=user_id)
        return {"message": f"All memories deleted for user '{user_id}'"}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
