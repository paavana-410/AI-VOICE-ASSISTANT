"""
api/tts.py — POST /api/tts

Converts text to speech using Microsoft Edge TTS (edge-tts package).
Returns audio/mpeg stream directly. No API key needed — uses Microsoft
Neural voices via Edge browser's TTS infrastructure.

Default voice: en-US-AriaNeural (natural, warm female voice)
Available voices: en-US-AriaNeural, en-US-JennyNeural, en-US-GuyNeural, etc.
"""
from __future__ import annotations

import io
import re

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.auth import get_current_user_id

router = APIRouter()

MAX_CHARS = 3000  # safety limit


def _clean_for_speech(text: str) -> str:
    """Strip markdown symbols so TTS reads clean prose."""
    text = re.sub(r"#{1,6}\s+", "", text)             # headings
    text = re.sub(r"\*\*(.*?)\*\*", r"\1", text)      # bold
    text = re.sub(r"\*(.*?)\*", r"\1", text)           # italic
    text = re.sub(r"`[^`]+`", "", text)                # inline code
    text = re.sub(r"```[\s\S]*?```", "", text)         # code blocks
    text = re.sub(r"^\s*[-•*]\s+", "", text, flags=re.MULTILINE)   # bullets
    text = re.sub(r"^\s*\d+\.\s+", "", text, flags=re.MULTILINE)   # numbered lists
    text = re.sub(r"\|[^\n]+\|", "", text)             # table rows
    text = re.sub(r"-{2,}", "", text)                  # dashes/hr
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)  # links
    text = re.sub(r"\n{2,}", ". ", text)               # blank lines → pause
    text = re.sub(r"\n", " ", text)                    # newlines → space
    text = re.sub(r"\s{2,}", " ", text)                # collapse spaces
    return text.strip()


class TTSRequest(BaseModel):
    text: str
    voice: str = "en-US-AriaNeural"  # default: warm natural female


@router.post("/tts")
async def text_to_speech(
    req: TTSRequest,
    user_id: str = Depends(get_current_user_id),
):
    try:
        import edge_tts  # type: ignore

        clean = _clean_for_speech(req.text)[:MAX_CHARS]
        if not clean:
            raise HTTPException(400, "No speakable text provided")

        communicate = edge_tts.Communicate(clean, req.voice)

        # Collect all audio chunks into memory buffer
        buf = io.BytesIO()
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                buf.write(chunk["data"])

        buf.seek(0)
        if buf.getbuffer().nbytes == 0:
            raise HTTPException(500, "TTS produced no audio")

        return StreamingResponse(
            buf,
            media_type="audio/mpeg",
            headers={"Cache-Control": "no-cache"},
        )

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(500, f"TTS failed: {exc}") from exc
