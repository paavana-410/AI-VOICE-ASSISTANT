"""
agents/tools.py — LangChain tools ARIA can invoke during conversation.

Tools (all sync wrappers around async DB ops):
  create_task        — add a task to the task manager
  update_task_status — mark a task todo/in_progress/done
  get_tasks          — list current tasks
  search_documents   — semantic search over uploaded docs
  summarise_document — structured summary of uploaded doc content
"""
from __future__ import annotations

import asyncio
import concurrent.futures
from datetime import datetime

from langchain.tools import tool


def _run(coro):
    """Run an async coroutine safely from sync context."""
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                return pool.submit(asyncio.run, coro).result(timeout=20)
        return loop.run_until_complete(coro)
    except RuntimeError:
        return asyncio.run(coro)


def make_tools(user_id: str) -> list:
    """Return all tools bound to the given user_id."""

    @tool
    def create_task(title: str, description: str = "", priority: str = "medium", due_date: str = "") -> str:
        """Create a new task. Use when user says 'add task', 'remind me', 'schedule', 'create a task'.
        priority: low|medium|high. due_date: YYYY-MM-DD or empty."""
        async def _go():
            from app.db.mongo import get_db
            db = get_db()
            if db is None:
                return "error: db not connected"
            await db["tasks"].insert_one({
                "title": title,
                "description": description,
                "priority": priority if priority in ("low", "medium", "high") else "medium",
                "due_date": due_date or None,
                "status": "todo",
                "progress": 0,
                "user_id": user_id,
                "created_at": datetime.utcnow(),
            })
            return "ok"
        res = _run(_go())
        if res == "ok":
            due = f", due {due_date}" if due_date else ""
            return f"✅ Task created: '{title}' ({priority} priority{due})"
        return f"Could not create task: {res}"

    @tool
    def update_task_status(task_title: str, new_status: str) -> str:
        """Update a task status. Use when user says they started or finished a task.
        new_status: todo|in_progress|done."""
        async def _go():
            from app.db.mongo import get_db
            db = get_db()
            if db is None:
                return None
            valid = {"todo": 0, "in_progress": 50, "done": 100}
            status = new_status if new_status in valid else "in_progress"
            doc = await db["tasks"].find_one_and_update(
                {"user_id": user_id, "title": {"$regex": task_title, "$options": "i"}},
                {"$set": {"status": status, "progress": valid[status]}},
                return_document=True,
            )
            return doc
        doc = _run(_go())
        if not doc:
            return f"No task found matching '{task_title}'"
        return f"✅ '{doc['title']}' updated to {new_status}"

    @tool
    def get_tasks(status_filter: str = "all") -> str:
        """List user's tasks. Use when asked 'what tasks do I have', 'what's pending', 'show my tasks'.
        status_filter: all|todo|in_progress|done."""
        async def _go():
            from app.db.mongo import get_db
            db = get_db()
            if db is None:
                return []
            q = {"user_id": user_id}
            if status_filter != "all":
                q["status"] = status_filter
            return await db["tasks"].find(q).sort("created_at", -1).to_list(20)
        tasks = _run(_go())
        if not tasks:
            return "No tasks found."
        lines = []
        for t in tasks:
            due = f" (due {t['due_date']})" if t.get("due_date") else ""
            lines.append(f"• [{t['status'].upper()}] {t['title']} — {t['priority']}{due}")
        return "\n".join(lines)

    @tool
    def search_documents(query: str) -> str:
        """Search uploaded business documents for information. Use when asked about
        uploaded files, reports, invoices, or any document content."""
        async def _go():
            from app.documents.store import search_chunks
            return await search_chunks(query, top_k=4)
        chunks = _run(_go())
        if not chunks:
            return "No relevant content found in uploaded documents."
        parts = []
        for c in chunks:
            label = f"[Page {c.get('page_number','?')}] ({c.get('chunk_type','text')})"
            parts.append(f"{label}\n{c['content'][:500]}")
        return "\n\n---\n\n".join(parts)

    @tool
    def summarise_document(topic: str) -> str:
        """Generate a structured summary of uploaded documents on a given topic.
        Use when user asks to 'summarise', 'give an overview', or 'analyse' a document.
        topic: keyword describing the document e.g. 'carbon emissions', 'invoice'."""
        async def _go():
            from app.documents.store import search_chunks
            return await search_chunks(topic, top_k=10)
        chunks = _run(_go())
        if not chunks:
            return f"No documents found related to '{topic}'."

        text_chunks  = [c for c in chunks if c.get("chunk_type") == "text"]
        table_chunks = [c for c in chunks if c.get("chunk_type") == "table"]
        img_chunks   = [c for c in chunks if c.get("chunk_type") == "image_caption"
                        and "unavailable" not in c.get("content", "")
                        and "[Image on page" not in c.get("content", "")]

        parts = [f"**Summary: {topic}**"]
        if text_chunks:
            parts.append("**Key Points:**")
            for c in text_chunks[:4]:
                parts.append(f"• {c['content'][:250]}")
        if table_chunks:
            parts.append("**Tables:**")
            for i, c in enumerate(table_chunks, 1):
                parts.append(f"Table {i} (p{c.get('page_number','?')}):\n{c['content'][:600]}")
        if img_chunks:
            parts.append("**Figures:**")
            for c in img_chunks:
                parts.append(f"• {c['content'][:200]}")
        return "\n\n".join(parts)

    return [create_task, update_task_status, get_tasks, search_documents, summarise_document]
