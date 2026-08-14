"""
api/history.py — Chat session history endpoints

GET  /api/sessions          → list all sessions (grouped by day) for user
GET  /api/sessions/{id}     → get all messages in a session
POST /api/sessions/new      → start a fresh session (clear active, create new)
DELETE /api/sessions/{id}   → delete a session
"""
from __future__ import annotations
from datetime import datetime, timezone
from typing import List, Optional
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from bson import ObjectId

from app.auth import get_current_user_id
from app.db.mongo import get_db

router = APIRouter()


# ── Models ─────────────────────────────────────────────────────────────────────

class SessionOut(BaseModel):
    id: str
    title: str          # first user message truncated
    preview: str        # first assistant reply truncated
    message_count: int
    created_at: str
    updated_at: str

class MessageOut(BaseModel):
    role: str
    content: str
    timestamp: str

class SessionDetail(BaseModel):
    id: str
    title: str
    messages: List[MessageOut]
    created_at: str


# ── Helpers ────────────────────────────────────────────────────────────────────

def _sessions_col():
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database not connected")
    return db["chat_sessions"]

def _truncate(text: str, n: int = 60) -> str:
    return text[:n] + "..." if len(text) > n else text


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("/sessions", response_model=List[SessionOut])
async def list_sessions(user_id: str = Depends(get_current_user_id)):
    col = _sessions_col()
    docs = await col.find({"user_id": user_id}).sort("updated_at", -1).limit(50).to_list(50)
    return [
        SessionOut(
            id=str(d["_id"]),
            title=d.get("title", "Untitled"),
            preview=d.get("preview", ""),
            message_count=d.get("message_count", 0),
            created_at=d["created_at"].isoformat() if isinstance(d.get("created_at"), datetime) else str(d.get("created_at","")),
            updated_at=d["updated_at"].isoformat() if isinstance(d.get("updated_at"), datetime) else str(d.get("updated_at","")),
        )
        for d in docs
    ]


@router.get("/sessions/{session_id}", response_model=SessionDetail)
async def get_session(session_id: str, user_id: str = Depends(get_current_user_id)):
    col = _sessions_col()
    try:
        oid = ObjectId(session_id)
    except Exception:
        raise HTTPException(400, "Invalid session id")
    doc = await col.find_one({"_id": oid, "user_id": user_id})
    if not doc:
        raise HTTPException(404, "Session not found")
    messages = [
        MessageOut(
            role=m["role"],
            content=m["content"],
            timestamp=m["timestamp"].isoformat() if isinstance(m.get("timestamp"), datetime) else str(m.get("timestamp","")),
        )
        for m in doc.get("messages", [])
    ]
    return SessionDetail(
        id=str(doc["_id"]),
        title=doc.get("title", "Untitled"),
        messages=messages,
        created_at=doc["created_at"].isoformat() if isinstance(doc.get("created_at"), datetime) else "",
    )


@router.delete("/sessions/{session_id}")
async def delete_session(session_id: str, user_id: str = Depends(get_current_user_id)):
    col = _sessions_col()
    try:
        oid = ObjectId(session_id)
    except Exception:
        raise HTTPException(400, "Invalid session id")
    result = await col.delete_one({"_id": oid, "user_id": user_id})
    if result.deleted_count == 0:
        raise HTTPException(404, "Session not found")
    return {"deleted": session_id}


# ── Called internally by chat.py to persist each turn ─────────────────────────

async def append_turn_to_session(
    user_id: str,
    session_id: Optional[str],
    user_message: str,
    assistant_reply: str,
) -> str:
    """
    Append a user+assistant turn to the active session.
    Creates a new session document if session_id is None.
    Returns the session_id.
    """
    col = _sessions_col()
    now = datetime.now(timezone.utc)

    user_turn = {"role": "user", "content": user_message, "timestamp": now}
    asst_turn = {"role": "assistant", "content": assistant_reply, "timestamp": now}

    if session_id:
        try:
            oid = ObjectId(session_id)
            await col.update_one(
                {"_id": oid, "user_id": user_id},
                {
                    "$push": {"messages": {"$each": [user_turn, asst_turn]}},
                    "$set": {
                        "preview": _truncate(assistant_reply),
                        "updated_at": now,
                    },
                    "$inc": {"message_count": 2},
                }
            )
            return session_id
        except Exception:
            pass  # fall through to create new

    # Create new session
    title = _truncate(user_message, 60)
    result = await col.insert_one({
        "user_id": user_id,
        "title": title,
        "preview": _truncate(assistant_reply),
        "messages": [user_turn, asst_turn],
        "message_count": 2,
        "created_at": now,
        "updated_at": now,
    })
    return str(result.inserted_id)
