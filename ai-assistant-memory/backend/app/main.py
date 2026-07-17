from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import os

from app.api.chat import router as chat_router
from app.api.memory import router as memory_router
from app.api.crew import router as crew_router
from app.auth import router as auth_router
from app.health import router as health_router

app = FastAPI(title="AI Assistant with Memory")

# Enable CORS for the React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(chat_router, prefix="/api")
app.include_router(memory_router, prefix="/api")
app.include_router(crew_router, prefix="/api")
app.include_router(health_router, prefix="/api")

if __name__ == "__main__":
    import uvicorn
    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run(app, host=host, port=port, reload=True)

