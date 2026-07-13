"""
config.py — Load and validate all environment variables.
All other modules import from here; nothing reads os.environ directly.
"""
import os
from dotenv import load_dotenv

load_dotenv()

# ---------- Groq ----------
GROQ_API_KEY: str = os.environ["GROQ_API_KEY"]
# Verify the current model name at https://console.groq.com/docs/models
GROQ_MODEL: str = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")

# ---------- MongoDB Atlas ----------
MONGODB_ATLAS_URI: str = os.environ["MONGODB_ATLAS_URI"]
MONGODB_DB_NAME: str = os.getenv("MONGODB_DB_NAME", "ai_assistant")
MEMORY_COLLECTION: str = os.getenv("MEMORY_COLLECTION", "mem0_memories")
CONVERSATION_COLLECTION: str = os.getenv("CONVERSATION_COLLECTION", "conversation_history")

# ---------- App ----------
APP_ENV: str = os.getenv("APP_ENV", "development")
BACKEND_PORT: int = int(os.getenv("BACKEND_PORT", "8000"))
DEFAULT_USER_ID: str = os.getenv("DEFAULT_USER_ID", "demo_user")
