import os
from pathlib import Path
from dotenv import load_dotenv

# Load backend-specific .env (for JWT, PORT, etc.)
load_dotenv()
# Load project-level .env (for API keys, DB connection) from the parent directory
parent_env = Path(__file__).parent.parent.parent / ".env"
load_dotenv(parent_env)

GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")
MONGODB_ATLAS_URI: str = os.getenv("MONGODB_ATLAS_URI", os.getenv("MONGO_URI", ""))
MONGO_URI: str = MONGODB_ATLAS_URI

GEMINI_MODEL: str = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")
GROQ_API_KEY: str = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL: str = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
LLM_PROVIDER: str = os.getenv("LLM_PROVIDER", "groq")
LLAMA_CLOUD_API_KEY: str = os.getenv("LLAMA_CLOUD_API_KEY", "")

MONGODB_DB_NAME: str = os.getenv("MONGODB_DB_NAME", "ai_assistant_db")
MEMORY_COLLECTION: str = os.getenv("MEMORY_COLLECTION", "memories")
CONVERSATION_COLLECTION: str = os.getenv("CONVERSATION_COLLECTION", "conversation_history")
DEFAULT_USER_ID: str = os.getenv("DEFAULT_USER_ID", "demo_user_123")

if not GEMINI_API_KEY and LLM_PROVIDER == "gemini":
    print("WARNING: GEMINI_API_KEY is not set.")
if not MONGODB_ATLAS_URI:
    print("WARNING: MONGO_URI is not set. Memory features will crash when used.")
