"""
agents/tools.py — LangChain tools ARIA can invoke during conversation.

Tools (native async tools for LangGraph execution):
  create_task        — add a task to the task manager
  update_task_status — mark a task todo/in_progress/done
  get_tasks          — list current tasks
  search_documents   — semantic search over uploaded docs
  summarise_document — structured summary of uploaded doc content
"""
from __future__ import annotations

import re
from datetime import datetime
from langchain.tools import tool
from app.db.mongo import get_db


def make_tools(user_id: str) -> list:
    """Return all tools bound to the given user_id."""

    @tool
    async def create_task(title: str, description: str = "", priority: str = "medium", due_date: str = "") -> str:
        """Create a new task. Use when user says 'add task', 'remind me', 'schedule', 'create a task'.
        priority: low|medium|high. due_date: YYYY-MM-DD or empty."""
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
        due = f", due {due_date}" if due_date else ""
        return f"✅ Task created: '{title}' ({priority} priority{due})"

    @tool
    async def update_task_status(task_title: str, new_status: str) -> str:
        """Update a task status. Use when user says they started or finished a task.
        new_status: todo|in_progress|done."""
        db = get_db()
        if db is None:
            return "error: db not connected"
        valid = {"todo": 0, "in_progress": 50, "done": 100}
        status = new_status if new_status in valid else "in_progress"
        doc = await db["tasks"].find_one_and_update(
            {"user_id": user_id, "title": {"$regex": task_title, "$options": "i"}},
            {"$set": {"status": status, "progress": valid[status]}},
            return_document=True,
        )
        if not doc:
            return f"No task found matching '{task_title}'"
        return f"✅ '{doc['title']}' updated to {new_status}"

    @tool
    async def get_tasks(status_filter: str = "all") -> str:
        """List user's tasks. Use when asked 'what tasks do I have', 'what's pending', 'show my tasks'.
        status_filter: all|todo|in_progress|done."""
        db = get_db()
        if db is None:
            return "No tasks found."
        q = {"user_id": user_id}
        if status_filter != "all":
            q["status"] = status_filter
        tasks = await db["tasks"].find(q).sort("created_at", -1).to_list(20)
        if not tasks:
            return "No tasks found."
        lines = []
        for t in tasks:
            due = f" (due {t['due_date']})" if t.get("due_date") else ""
            lines.append(f"• [{t['status'].upper()}] {t['title']} — {t['priority']}{due}")
        return "\n".join(lines)

    @tool
    async def search_documents(query: str) -> str:
        """Search uploaded business documents for information. Use when asked about
        uploaded files, reports, invoices, or any document content."""
        results = []
        db = get_db()

        # Path 1: document_chunks collection (LlamaParse pipeline)
        try:
            from app.documents.store import search_chunks
            chunks = await search_chunks(query, top_k=4)
            for c in chunks:
                label = f"[Page {c.get('page_number','?')}] ({c.get('chunk_type','text')})"
                results.append(f"{label}\n{c['content'][:500]}")
        except Exception:
            pass

        # Path 2: mem0_memories collection (ingest/+ button path)
        if db is not None and len(results) < 3:
            try:
                words = [w for w in query.split() if len(w) > 3]
                if words:
                    regex = "|".join(re.escape(w) for w in words[:6])
                    docs = await db["mem0_memories"].find(
                        {"user_id": user_id, "memory": {"$regex": regex, "$options": "i"}},
                        {"_id": 0, "memory": 1, "metadata": 1}
                    ).limit(5).to_list(5)
                    for d in docs:
                        src = d.get("metadata", {}).get("source", "uploaded file") if isinstance(d.get("metadata"), dict) else "uploaded file"
                        results.append(f"[{src}]\n{d.get('memory','')[:500]}")
            except Exception:
                pass

        if not results:
            return "No relevant content found in uploaded documents."
        return "\n\n---\n\n".join(results)

    @tool
    async def summarise_document(topic: str) -> str:
        """Generate a structured summary of uploaded documents on a given topic.
        Use when user asks to 'summarise', 'give an overview', or 'analyse' a document.
        topic: keyword describing the document e.g. 'carbon emissions', 'invoice', 'sales'."""
        results = []
        db = get_db()

        # Path 1: document_chunks (structured — tables, images, text)
        try:
            from app.documents.store import search_chunks
            chunks = await search_chunks(topic, top_k=10)
            results.extend(chunks)
        except Exception:
            pass

        # Path 2: mem0_memories (flat chunks from ingest)
        if db is not None:
            try:
                words = [w for w in topic.split() if len(w) > 2]
                regex = "|".join(re.escape(w) for w in words[:8]) if words else topic
                docs = await db["mem0_memories"].find(
                    {"user_id": user_id, "memory": {"$regex": regex, "$options": "i"}},
                    {"_id": 0, "memory": 1, "metadata": 1}
                ).limit(10).to_list(10)
                for d in docs:
                    src = d.get("metadata", {}).get("source", "uploaded file") if isinstance(d.get("metadata"), dict) else "uploaded file"
                    results.append({"chunk_type": "text", "content": d.get("memory", ""), "source": src})
            except Exception:
                pass

        if not results:
            return f"No documents found related to '{topic}'. Try uploading a document first."

        text_chunks  = [c for c in results if c.get("chunk_type") in ("text", None) or "chunk_type" not in c]
        table_chunks = [c for c in results if c.get("chunk_type") == "table"]
        img_chunks   = [c for c in results if c.get("chunk_type") == "image_caption"
                        and "unavailable" not in c.get("content", "")]

        parts = [f"**Document Summary: {topic}**"]
        if text_chunks:
            parts.append("**Key Content:**")
            for c in text_chunks[:5]:
                src = c.get("source", "")
                prefix = f"[{src}] " if src else ""
                parts.append(f"• {prefix}{c.get('content','')[:300]}")
        if table_chunks:
            parts.append("**Tables Found:**")
            for i, c in enumerate(table_chunks, 1):
                parts.append(f"Table {i} (p{c.get('page_number','?')}):\n{c['content'][:600]}")
        if img_chunks:
            parts.append("**Figures:**")
            for c in img_chunks:
                parts.append(f"• {c['content'][:200]}")
        return "\n\n".join(parts)

    return [create_task, update_task_status, get_tasks, search_documents, summarise_document]
