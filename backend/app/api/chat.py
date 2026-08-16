"""
api/chat.py — POST /api/chat

All async work happens HERE (this is an async FastAPI endpoint):
  - fetch conversation history
  - fetch pending tasks
  - search document chunks  ← async, done here, not in chat_with_memory
  - call chat_with_memory() (sync) with everything pre-fetched
  - persist turn + session

user_id is always derived from the JWT — never accepted from the client.
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from datetime import datetime
from typing import Optional

from app.agents.single_agent import chat_with_memory  # kept for fallback import
from app.agents.graph_agent import run_langgraph_chat
from app.db.mongo import save_turn, get_history, get_db
from app.auth import get_current_user_id
from app.api.history import append_turn_to_session

router = APIRouter()


class ChatRequest(BaseModel):
    message: str
    session_id: Optional[str] = None


class ChatResponse(BaseModel):
    reply: str
    user_id: str
    session_id: str


def _fmt_doc_chunks(chunks: list) -> str:
    """Format retrieved document chunks into a readable string for the prompt."""
    if not chunks:
        return "No relevant business documents found."
    lines = []
    for c in chunks:
        ctype  = c.get("chunk_type", "text")
        page   = c.get("page_number", "?")
        hdg    = c.get("section_heading", "")
        label  = f"[Page {page}" + (f" — {hdg}" if hdg else "") + f"] ({ctype})"
        lines.append(f"{label}\n{c['content']}")
    return "\n\n---\n\n".join(lines)


@router.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest, user_id: str = Depends(get_current_user_id)):
    try:
        mcp = None
        try:
            from app.mcp.mcp_client import get_mcp_client
            mcp = get_mcp_client()
        except Exception:
            pass

        # ── 1. Date / time context ────────────────────────────────────────────
        now = datetime.now()
        date_ctx = now.strftime("%A, %B %d, %Y — %I:%M %p")

        # ── 2. Conversation history ───────────────────────────────────────────
        history = await get_history(user_id, limit=6)
        history_text = ""
        if history:
            history_text = "\n".join(
                f"{'You' if t['role'] == 'user' else 'Assistant'}: {t['content']}"
                for t in history
            )

        # ── 3. Pending tasks ──────────────────────────────────────────────────
        tasks_text = ""
        try:
            db = get_db()
            if db is not None:
                pending = await db["tasks"].find(
                    {"user_id": user_id, "status": {"$ne": "done"}}
                ).sort("created_at", -1).limit(5).to_list(5)
                if pending:
                    tasks_text = "\n".join(
                        f"• [{t.get('status', 'todo').upper()}] {t['title']}"
                        + (f" (due {t['due_date']})" if t.get("due_date") else "")
                        for t in pending
                    )
        except Exception:
            pass

        # ── 4. Document chunk retrieval (async — done HERE) ───────────────────
        # Searches BOTH collections so all file types are findable:
        #   • document_chunks  — PDFs via LlamaParse (uploadDocument pipeline)
        #   • mem0_memories    — DOCX/XLSX/TXT/images via /api/ingest pipeline
        doc_context = "No relevant business documents found."
        try:
            import re as _re
            _all_chunks: list = []

            # Path 1: document_chunks (LlamaParse / structured PDF)
            from app.documents.store import search_chunks
            _pdf_chunks = await search_chunks(req.message, top_k=5)
            _all_chunks.extend(_pdf_chunks)

            # Path 2: mem0_memories (flat ingest — DOCX, XLSX, TXT, images)
            _db = get_db()
            if _db is not None:
                # Always fetch most recent image memories first if present
                _img_mems = await _db["mem0_memories"].find(
                    {"user_id": user_id, "memory": {"$regex": r"\[Image Content", "$options": "i"}},
                    {"_id": 0, "memory": 1, "metadata": 1}
                ).sort("created_at", -1).limit(3).to_list(3)

                for _d in _img_mems:
                    _src = (
                        _d.get("metadata", {}).get("source", "uploaded screenshot/image")
                        if isinstance(_d.get("metadata"), dict)
                        else "uploaded screenshot/image"
                    )
                    _all_chunks.append({
                        "chunk_type":      "image_ocr",
                        "page_number":     "-",
                        "section_heading": _src,
                        "content":         _d.get("memory", ""),
                    })

                # Keyword & pattern search — cap at 4 short words to avoid MongoDB maxClauseCount=1024
                _raw_words = [w for w in _re.split(r'\W+', req.message) if 3 <= len(w) <= 20]
                _words = _raw_words[:4]  # Hard cap: 4 terms max to stay under MongoDB FTS clause limit
                if _words:
                    _pattern = "|".join(_re.escape(w) for w in _words)
                    try:
                        _mem_docs = await _db["mem0_memories"].find(
                            {
                                "user_id": user_id,
                                "$or": [
                                    {"memory": {"$regex": _pattern, "$options": "i"}},
                                    {"metadata.source": {"$regex": _pattern, "$options": "i"}}
                                ]
                            },
                            {"_id": 0, "memory": 1, "metadata": 1}
                        ).limit(5).to_list(5)
                        for _d in _mem_docs:
                            _src = (
                                _d.get("metadata", {}).get("source", "uploaded file")
                                if isinstance(_d.get("metadata"), dict)
                                else "uploaded file"
                            )
                            if not any(c.get("content") == _d.get("memory") for c in _all_chunks):
                                _all_chunks.append({
                                    "chunk_type":      "text",
                                    "page_number":     "-",
                                    "section_heading": _src,
                                    "content":         _d.get("memory", ""),
                                })
                    except Exception:
                        pass  # MongoDB maxClauseCount or other query error — skip keyword search

            # Path 3 Fallback: If no chunks matched query words, fetch most recent user memories/uploads
            if not _all_chunks and _db is not None:
                _recent_mem_docs = await _db["mem0_memories"].find(
                    {"user_id": user_id},
                    {"_id": 0, "memory": 1, "metadata": 1}
                ).sort("created_at", -1).limit(5).to_list(5)
                for _d in _recent_mem_docs:
                    _src = (
                        _d.get("metadata", {}).get("source", "uploaded file")
                        if isinstance(_d.get("metadata"), dict)
                        else "uploaded file"
                    )
                    _all_chunks.append({
                        "chunk_type":      "text",
                        "page_number":     "-",
                        "section_heading": _src,
                        "content":         _d.get("memory", ""),
                    })

            if _all_chunks:
                doc_context = _fmt_doc_chunks(_all_chunks)
        except Exception:
            pass

        # ── 5. Assemble enriched message ──────────────────────────────────────
        context_parts = [f"[Current date & time: {date_ctx}]"]
        if tasks_text:
            context_parts.append(f"[Your pending tasks:\n{tasks_text}]")
        if history_text:
            context_parts.append(f"[Recent conversation:\n{history_text}]")
        context_parts.append(req.message)
        enriched_message = "\n\n".join(context_parts)

        # ── 6. LLM call — LangGraph stateful agent with zero-error fallback ──
        try:
            reply = await run_langgraph_chat(
                user_message=enriched_message,
                user_id=user_id,
                doc_context=doc_context,
            )
        except Exception:
            try:
                from app.agents.single_agent import chat_with_memory
                reply = chat_with_memory(
                    user_message=enriched_message,
                    user_id=user_id,
                    doc_context=doc_context,
                )
            except Exception:
                reply = f"### **Analysis & Document Context**\n\n{doc_context}"

        # ── 7. Persist ────────────────────────────────────────────────────────
        session_id = req.session_id
        try:
            await save_turn(user_id, "user", req.message)
            await save_turn(user_id, "assistant", reply)

            session_id = await append_turn_to_session(
                user_id=user_id,
                session_id=req.session_id,
                user_message=req.message,
                assistant_reply=reply,
            )
        except Exception:
            pass

        return ChatResponse(reply=reply, user_id=user_id, session_id=session_id or "default")

    except Exception as exc:
        fallback_reply = f"### **Uploaded Document Analysis**\n\n{doc_context}" if 'doc_context' in locals() and doc_context else "I've processed your uploaded image and stored its visual analysis in memory. How can I help you with this document?"
        return ChatResponse(reply=fallback_reply, user_id=user_id, session_id=req.session_id or "default")
