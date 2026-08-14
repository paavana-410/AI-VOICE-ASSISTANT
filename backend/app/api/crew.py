"""
api/crew.py — POST /api/crew-chat (multi-agent, CrewAI path)
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.config import DEFAULT_USER_ID
try:
    from app.agents.crew_agents import run_crew
except ModuleNotFoundError:
    # crewai not installed – provide a stub that returns a clear error
    def run_crew(*_, **__):
        raise HTTPException(status_code=501, detail="CrewAI functionality not available – missing 'crewai' dependency.")
from app.db.mongo import save_turn

router = APIRouter()


class CrewChatRequest(BaseModel):
    message: str
    user_id: str = DEFAULT_USER_ID


class CrewChatResponse(BaseModel):
    reply: str
    user_id: str


@router.post("/crew-chat", response_model=CrewChatResponse)
async def crew_chat(req: CrewChatRequest):
    """
    Multi-agent chat endpoint.

    Spins up a CrewAI crew (Researcher + Personal Assistant) that share
    the same MongoDB Atlas memory store, then returns the final reply.
    """
    try:
        reply = run_crew(user_message=req.message, user_id=req.user_id)

        await save_turn(req.user_id, "user", req.message)
        await save_turn(req.user_id, "assistant", f"[crew] {reply}")

        return CrewChatResponse(reply=reply, user_id=req.user_id)

    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
