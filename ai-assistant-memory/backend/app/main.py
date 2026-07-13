"""
main.py — FastAPI application entrypoint.

Registers all API routers and starts the server.
Run with:  uvicorn app.main:app --reload --port 8000
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import chat, crew, memory

app = FastAPI(
    title="AI Assistant with Memory",
    description="Full-stack AI assistant with persistent cross-session memory via Mem0 + MongoDB Atlas.",
    version="1.0.0",
)

# Allow the Vite dev-server (port 5173) to call the API during local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ----- Routers -----
app.include_router(chat.router, prefix="/api", tags=["chat"])
app.include_router(crew.router, prefix="/api", tags=["crew"])
app.include_router(memory.router, prefix="/api", tags=["memory"])


@app.get("/health", tags=["health"])
async def health():
    return {"status": "ok"}
