"""
api/analytics.py — GET /api/analytics

Returns usage statistics for the authenticated user:
  - total_memories, memories_this_week
  - total_documents, total_doc_chunks, table_chunks, image_chunks
  - total_tasks, done_tasks, pending_tasks
  - total_sessions, total_messages
  - recent_activity (last 7 days message counts)
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import List

from app.auth import get_current_user_id
from app.db.mongo import get_db

router = APIRouter()


class DailyActivity(BaseModel):
    date:  str
    count: int


class AnalyticsResponse(BaseModel):
    # Memory
    total_memories:      int
    memories_this_week:  int
    # Documents
    total_documents:     int
    total_doc_chunks:    int
    table_chunks:        int
    image_chunks:        int
    # Tasks
    total_tasks:         int
    done_tasks:          int
    pending_tasks:       int
    # Conversations
    total_sessions:      int
    total_messages:      int
    # Activity
    recent_activity:     List[DailyActivity]


@router.get("/analytics", response_model=AnalyticsResponse)
async def get_analytics(user_id: str = Depends(get_current_user_id)):
    db = get_db()

    now   = datetime.now(timezone.utc)
    week_ago = now - timedelta(days=7)

    # ── Memories (Mem0 collection) ────────────────────────────────────────────
    total_memories     = 0
    memories_this_week = 0
    try:
        mem_col = db["mem0_memories"]
        total_memories = await mem_col.count_documents({"user_id": user_id})
        memories_this_week = await mem_col.count_documents({
            "user_id":    user_id,
            "created_at": {"$gte": week_ago},
        })
    except Exception:
        pass

    # ── Documents ─────────────────────────────────────────────────────────────
    total_doc_chunks = 0
    table_chunks     = 0
    image_chunks     = 0
    total_documents  = 0
    try:
        doc_col = db["document_chunks"]
        total_doc_chunks = await doc_col.count_documents({"user_id": {"$regex": f"^{user_id[:8]}"}})
        table_chunks     = await doc_col.count_documents({
            "user_id":    {"$regex": f"^{user_id[:8]}"},
            "chunk_type": "table",
        })
        image_chunks     = await doc_col.count_documents({
            "user_id":    {"$regex": f"^{user_id[:8]}"},
            "chunk_type": "image_caption",
        })
        # Count unique document_ids
        doc_ids = await doc_col.distinct("document_id", {"user_id": {"$regex": f"^{user_id[:8]}"}})
        total_documents = len(doc_ids)
    except Exception:
        pass

    # ── Tasks ─────────────────────────────────────────────────────────────────
    total_tasks   = 0
    done_tasks    = 0
    pending_tasks = 0
    try:
        task_col      = db["tasks"]
        total_tasks   = await task_col.count_documents({"user_id": user_id})
        done_tasks    = await task_col.count_documents({"user_id": user_id, "status": "done"})
        pending_tasks = await task_col.count_documents({"user_id": user_id, "status": {"$ne": "done"}})
    except Exception:
        pass

    # ── Sessions + messages ───────────────────────────────────────────────────
    total_sessions = 0
    total_messages = 0
    try:
        sess_col       = db["chat_sessions"]
        total_sessions = await sess_col.count_documents({"user_id": user_id})
        # Sum message_count across all sessions
        pipeline = [
            {"$match": {"user_id": user_id}},
            {"$group": {"_id": None, "total": {"$sum": "$message_count"}}},
        ]
        agg = await sess_col.aggregate(pipeline).to_list(1)
        total_messages = agg[0]["total"] if agg else 0
    except Exception:
        pass

    # ── Recent activity — last 7 days message counts ──────────────────────────
    recent_activity: list[DailyActivity] = []
    try:
        conv_col = db["conversation_history"]
        for i in range(6, -1, -1):  # 7 days, oldest first
            day_start = (now - timedelta(days=i)).replace(hour=0, minute=0, second=0, microsecond=0)
            day_end   = day_start + timedelta(days=1)
            count = await conv_col.count_documents({
                "user_id":   user_id,
                "role":      "user",
                "timestamp": {"$gte": day_start, "$lt": day_end},
            })
            recent_activity.append(DailyActivity(
                date=day_start.strftime("%b %d"),
                count=count,
            ))
    except Exception:
        recent_activity = [DailyActivity(date=f"Day {i}", count=0) for i in range(7)]

    return AnalyticsResponse(
        total_memories=total_memories,
        memories_this_week=memories_this_week,
        total_documents=total_documents,
        total_doc_chunks=total_doc_chunks,
        table_chunks=table_chunks,
        image_chunks=image_chunks,
        total_tasks=total_tasks,
        done_tasks=done_tasks,
        pending_tasks=pending_tasks,
        total_sessions=total_sessions,
        total_messages=total_messages,
        recent_activity=recent_activity,
    )
