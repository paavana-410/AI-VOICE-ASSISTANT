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
from app.agents.tool_agent import chat_with_tools
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
        doc_context = "No relevant business documents found."
        try:
            from app.documents.store import search_chunks
            chunks = await search_chunks(req.message, top_k=5)
            doc_context = _fmt_doc_chunks(chunks)
        except Exception:
            pass   # degrade gracefully if doc store unavailable

        # ── 5. Assemble enriched message ──────────────────────────────────────
        context_parts = [f"[Current date & time: {date_ctx}]"]
        if tasks_text:
            context_parts.append(f"[Your pending tasks:\n{tasks_text}]")
        if history_text:
            context_parts.append(f"[Recent conversation:\n{history_text}]")
        context_parts.append(req.message)
        enriched_message = "\n\n".join(context_parts)

        # ── 6. LLM call — tool-calling agent ─────────────────────────────────
        reply = chat_with_tools(
            user_message=enriched_message,
            user_id=user_id,
            doc_context=doc_context,
            mcp_client=mcp,
        )

        # ── 7. Persist ────────────────────────────────────────────────────────
        await save_turn(user_id, "user", req.message)
        await save_turn(user_id, "assistant", reply)

        session_id = await append_turn_to_session(
            user_id=user_id,
            session_id=req.session_id,
            user_message=req.message,
            assistant_reply=reply,
        )

        return ChatResponse(reply=reply, user_id=user_id, session_id=session_id)

    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
