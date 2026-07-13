"""
api/chat.py — POST /api/chat (single-agent, LangChain + Mem0 path)
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.config import DEFAULT_USER_ID
from app.agents.single_agent import chat_with_memory
from app.db.mongo import save_turn

router = APIRouter()


class ChatRequest(BaseModel):
    message: str
    user_id: str = DEFAULT_USER_ID


class ChatResponse(BaseModel):
    reply: str
    user_id: str


@router.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    """
    Single-agent chat endpoint.

    1. Retrieves relevant memories for the user.
    2. Calls ChatGroq with memory-enriched system prompt.
    3. Saves new facts to memory.
    4. Persists the turn in conversation_history.
    """
    try:
        # Import MCP client lazily to avoid startup cost if not yet initialized
        try:
            from app.mcp.mcp_client import get_mcp_client
            mcp = get_mcp_client()
        except Exception:
            mcp = None  # Fall back to direct Mem0 if MCP server isn't ready

        reply = chat_with_memory(
            user_message=req.message,
            user_id=req.user_id,
            mcp_client=mcp,
        )

        # Persist conversation history (fire-and-forget style)
        await save_turn(req.user_id, "user", req.message)
        await save_turn(req.user_id, "assistant", reply)

        return ChatResponse(reply=reply, user_id=req.user_id)

    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
