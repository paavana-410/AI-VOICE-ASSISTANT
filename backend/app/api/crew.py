"""
api/crew.py — POST /api/crew-chat (multi-agent, CrewAI path)
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import get_current_user_id

try:
    from app.agents.crew_agents import run_crew
except ModuleNotFoundError:
    def run_crew(*_, **__):
        raise HTTPException(status_code=501, detail="CrewAI not available — missing 'crewai' dependency.")

from app.db.mongo import save_turn

router = APIRouter()


class CrewChatRequest(BaseModel):
    message: str


class CrewChatResponse(BaseModel):
    reply: str
    user_id: str


@router.post("/crew-chat", response_model=CrewChatResponse)
async def crew_chat(
    req: CrewChatRequest,
    user_id: str = Depends(get_current_user_id),   # always from JWT, never from client
):
    """
    Multi-agent chat endpoint.
    Spins up a CrewAI crew (Researcher + Personal Assistant) sharing MongoDB memory.
    """
    try:
        reply = run_crew(user_message=req.message, user_id=user_id)

        await save_turn(user_id, "user", req.message)
        await save_turn(user_id, "assistant", f"[crew] {reply}")

        return CrewChatResponse(reply=reply, user_id=user_id)

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
