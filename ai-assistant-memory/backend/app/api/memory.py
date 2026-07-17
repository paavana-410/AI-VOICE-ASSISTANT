"""
api/memory.py — CRUD endpoints for the Memory Inspector UI.

GET    /api/memories?user_id=...         → list all memories for a user
GET    /api/memories/search?q=...        → semantic search
PUT    /api/memories/{memory_id}         → update memory text
DELETE /api/memories/{memory_id}         → delete a specific memory
DELETE /api/memories?user_id=...         → delete ALL memories for a user
"""
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.config import DEFAULT_USER_ID
from app.agents.single_agent import get_memory_client

router = APIRouter()


# ---------------------------------------------------------------------------
# Response / request models
# ---------------------------------------------------------------------------

class MemoryItem(BaseModel):
    id: str
    memory: str
    user_id: str | None = None
    score: float | None = None


class UpdateMemoryRequest(BaseModel):
    memory: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _normalize(raw: list | dict) -> list[dict]:
    """Mem0 returns different shapes depending on version; normalise to list."""
    if isinstance(raw, dict):
        return raw.get("results", [])
    return raw or []


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/memories", response_model=list[MemoryItem])
async def list_memories(user_id: str = Query(default=DEFAULT_USER_ID)):
    """Return all stored memories for a user."""
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


class AddMemoryRequest(BaseModel):
    memory: str

@router.post("/memories", response_model=MemoryItem)
async def add_memory(
    body: AddMemoryRequest,
    user_id: str = Query(default=DEFAULT_USER_ID),
):
    """Add a new memory manually."""
    try:
        mem = get_memory_client()
        result = mem.add(messages=body.memory, user_id=user_id)
        return MemoryItem(id=str(result.get("id", "")), memory=body.memory, user_id=user_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/memories/search", response_model=list[MemoryItem])
async def search_memories(
    q: str = Query(..., description="Search query"),
    user_id: str = Query(default=DEFAULT_USER_ID),
):
    """Semantically search memories for a user."""
    try:
        mem = get_memory_client()
        raw = mem.search(query=q, user_id=user_id, limit=10)
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
    user_id: str = Query(default=DEFAULT_USER_ID),
):
    """Update the text of an existing memory."""
    try:
        mem = get_memory_client()
        mem.update(memory_id=memory_id, data=body.memory)
        return MemoryItem(id=memory_id, memory=body.memory, user_id=user_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.delete("/memories/{memory_id}")
async def delete_memory(memory_id: str):
    """Delete a specific memory by id."""
    try:
        mem = get_memory_client()
        mem.delete(memory_id=memory_id)
        return {"deleted": memory_id}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.delete("/memories")
async def delete_all_memories(user_id: str = Query(default=DEFAULT_USER_ID)):
    """Delete ALL memories for a given user."""
    try:
        mem = get_memory_client()
        mem.delete_all(user_id=user_id)
        return {"message": f"All memories deleted for user '{user_id}'"}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
