from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import os

from app.api.chat import router as chat_router
from app.api.memory import router as memory_router
from app.api.crew import router as crew_router
from app.api.ingest import router as ingest_router
from app.api.image_gen import router as image_gen_router
from app.api.tasks import router as tasks_router
from app.api.history import router as history_router
from app.api.documents import router as documents_router
from app.api.analyse import router as analyse_router
from app.api.analytics import router as analytics_router
from app.auth import router as auth_router
from app.health import router as health_router

app = FastAPI(title="Business AI Assistant with Memory")

# CORS — reads from env so it works both locally and in production
_raw_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000")
_allowed_origins = [o.strip() for o in _raw_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(chat_router, prefix="/api")
app.include_router(memory_router, prefix="/api")
app.include_router(crew_router, prefix="/api")
app.include_router(ingest_router, prefix="/api")
app.include_router(image_gen_router, prefix="/api")
app.include_router(tasks_router, prefix="/api")
app.include_router(history_router, prefix="/api")
app.include_router(documents_router, prefix="/api")
app.include_router(analyse_router, prefix="/api")
app.include_router(analytics_router, prefix="/api")
app.include_router(health_router, prefix="/api")

if __name__ == "__main__":
    import uvicorn
    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run(app, host=host, port=port, reload=True)

