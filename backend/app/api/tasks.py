"""
api/tasks.py — Task Manager CRUD API

GET    /api/tasks              → list all tasks for user
POST   /api/tasks              → create task
PATCH  /api/tasks/{id}         → update task (status, progress, title)
DELETE /api/tasks/{id}         → delete task
GET    /api/tasks/summary      → AI-powered voice summary of tasks
"""
from __future__ import annotations
from datetime import datetime
from typing import Optional, List
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from bson import ObjectId

from app.auth import get_current_user_id
from app.db.mongo import get_db

router = APIRouter()

# ── Models ────────────────────────────────────────────────────────────────────

class TaskCreate(BaseModel):
    title: str
    description: str = ""
    priority: str = "medium"   # low | medium | high
    due_date: Optional[str] = None
    status: str = "todo"       # todo | in_progress | done

class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    priority: Optional[str] = None
    due_date: Optional[str] = None
    status: Optional[str] = None
    progress: Optional[int] = None   # 0-100

class TaskOut(BaseModel):
    id: str
    title: str
    description: str
    priority: str
    due_date: Optional[str]
    status: str
    progress: int
    created_at: str
    user_id: str

class TaskSummary(BaseModel):
    summary: str
    total: int
    done: int
    in_progress: int
    todo: int

# ── Helpers ───────────────────────────────────────────────────────────────────

def _col():
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database not connected")
    return db["tasks"]

def _serialize(doc: dict) -> TaskOut:
    return TaskOut(
        id=str(doc["_id"]),
        title=doc.get("title", ""),
        description=doc.get("description", ""),
        priority=doc.get("priority", "medium"),
        due_date=doc.get("due_date"),
        status=doc.get("status", "todo"),
        progress=doc.get("progress", 0),
        created_at=doc.get("created_at", datetime.utcnow()).isoformat(),
        user_id=doc.get("user_id", ""),
    )

# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/tasks", response_model=List[TaskOut])
async def list_tasks(user_id: str = Depends(get_current_user_id)):
    col = _col()
    docs = await col.find({"user_id": user_id}).sort("created_at", -1).to_list(100)
    return [_serialize(d) for d in docs]


@router.post("/tasks", response_model=TaskOut, status_code=201)
async def create_task(body: TaskCreate, user_id: str = Depends(get_current_user_id)):
    col = _col()
    doc = {
        **body.model_dump(),
        "progress": 0,
        "user_id": user_id,
        "created_at": datetime.utcnow(),
    }
    result = await col.insert_one(doc)
    doc["_id"] = result.inserted_id
    return _serialize(doc)


@router.patch("/tasks/{task_id}", response_model=TaskOut)
async def update_task(task_id: str, body: TaskUpdate, user_id: str = Depends(get_current_user_id)):
    col = _col()
    try:
        oid = ObjectId(task_id)
    except Exception:
        raise HTTPException(400, "Invalid task id")

    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    # Auto-set progress based on status
    if "status" in updates:
        if updates["status"] == "done" and "progress" not in updates:
            updates["progress"] = 100
        elif updates["status"] == "todo" and "progress" not in updates:
            updates["progress"] = 0

    result = await col.find_one_and_update(
        {"_id": oid, "user_id": user_id},
        {"$set": updates},
        return_document=True,
    )
    if not result:
        raise HTTPException(404, "Task not found")
    return _serialize(result)


@router.delete("/tasks/{task_id}")
async def delete_task(task_id: str, user_id: str = Depends(get_current_user_id)):
    col = _col()
    try:
        oid = ObjectId(task_id)
    except Exception:
        raise HTTPException(400, "Invalid task id")
    result = await col.delete_one({"_id": oid, "user_id": user_id})
    if result.deleted_count == 0:
        raise HTTPException(404, "Task not found")
    return {"deleted": task_id}


@router.get("/tasks/summary", response_model=TaskSummary)
async def task_summary(user_id: str = Depends(get_current_user_id)):
    """Return task counts + a voice-ready summary string."""
    col = _col()
    docs = await col.find({"user_id": user_id}).to_list(100)
    total = len(docs)
    done = sum(1 for d in docs if d.get("status") == "done")
    in_progress = sum(1 for d in docs if d.get("status") == "in_progress")
    todo = sum(1 for d in docs if d.get("status") == "todo")

    # Find next due task
    upcoming = [d for d in docs if d.get("due_date") and d.get("status") != "done"]
    upcoming.sort(key=lambda d: d.get("due_date", ""))
    next_due = upcoming[0] if upcoming else None

    if total == 0:
        summary = "You have no tasks yet. Start by adding your first task."
    else:
        summary = (
            f"You have {total} task{'s' if total != 1 else ''}. "
            f"{done} completed, {in_progress} in progress, and {todo} pending."
        )
        if next_due:
            summary += f" Your next deadline is '{next_due['title']}'"
            if next_due.get("due_date"):
                summary += f" due on {next_due['due_date']}."
            else:
                summary += "."

    return TaskSummary(summary=summary, total=total, done=done, in_progress=in_progress, todo=todo)
