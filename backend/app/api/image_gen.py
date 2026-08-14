"""
api/image_gen.py — Image generation via Pollinations.ai (free, no API key needed).

POST /api/generate-image  { "prompt": "...", "width": 1024, "height": 1024 }
Returns a URL to the generated image.

Pollinations.ai is a free, open image generation service that supports
Stable Diffusion XL and Flux models with no API key required.
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
import httpx
import urllib.parse

from app.auth import get_current_user_id

router = APIRouter()

POLLINATIONS_BASE = "https://image.pollinations.ai/prompt"


class ImageGenRequest(BaseModel):
    prompt: str
    width: int = 1024
    height: int = 1024
    model: str = "flux"      # flux | turbo | dreamshaper


class ImageGenResponse(BaseModel):
    url: str
    prompt: str
    width: int
    height: int


@router.post("/generate-image", response_model=ImageGenResponse)
async def generate_image(
    req: ImageGenRequest,
    user_id: str = Depends(get_current_user_id),
):
    """
    Generate an image from a text prompt using Pollinations.ai.
    Free, no API key required. Returns a direct image URL.
    """
    if not req.prompt.strip():
        raise HTTPException(400, "Prompt cannot be empty.")

    encoded_prompt = urllib.parse.quote(req.prompt)
    url = (
        f"{POLLINATIONS_BASE}/{encoded_prompt}"
        f"?width={req.width}&height={req.height}"
        f"&model={req.model}&nologo=true&enhance=true"
    )

    # Verify the URL is reachable (HEAD request)
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.head(url, follow_redirects=True)
            if resp.status_code not in (200, 302):
                raise HTTPException(502, f"Image generation service returned {resp.status_code}")
    except httpx.TimeoutException:
        raise HTTPException(504, "Image generation timed out. Try a simpler prompt.")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Image generation failed: {str(e)}")

    return ImageGenResponse(
        url=url,
        prompt=req.prompt,
        width=req.width,
        height=req.height,
    )
