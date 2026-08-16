"""
db/mongo.py — MongoDB Atlas connection and conversation history helpers.

Uses motor (async pymongo) for non-blocking I/O inside FastAPI.
The memory vectors themselves are managed by Mem0; this module only
handles the raw conversation_history collection.
"""
import datetime
from motor.motor_asyncio import AsyncIOMotorClient
from app.config import MONGODB_ATLAS_URI, MONGODB_DB_NAME, CONVERSATION_COLLECTION

_client = None

def get_client() -> AsyncIOMotorClient | None:
    global _client
    if not MONGODB_ATLAS_URI:
        return None
    if _client is None:
        _client = AsyncIOMotorClient(MONGODB_ATLAS_URI)
    return _client


def get_db():
    client = get_client()
    return client[MONGODB_DB_NAME] if client is not None else None


def get_conversation_collection():
    db = get_db()
    return db[CONVERSATION_COLLECTION] if db is not None else None


async def save_turn(user_id: str, role: str, content: str) -> None:
    """Append a single conversation turn to the history collection."""
    col = get_conversation_collection()
    if col is None:
        return
    doc = {
        "user_id": user_id,
        "role": role,          # "user" | "assistant"
        "content": content,
        "timestamp": datetime.datetime.now(datetime.timezone.utc),
    }
    await col.insert_one(doc)


async def get_history(user_id: str, limit: int = 20) -> list[dict]:
    """Return the N most-recent turns for a user, oldest-first."""
    col = get_conversation_collection()
    if col is None:
        return []
    cursor = (
        col
        .find({"user_id": user_id}, {"_id": 0})
        .sort("timestamp", -1)
        .limit(limit)
    )
    docs = await cursor.to_list(length=limit)
    return list(reversed(docs))  # chronological order


async def clear_history(user_id: str) -> int:
    """Delete all conversation history for a user. Returns deleted count."""
    col = get_conversation_collection()
    if col is None:
        return 0
    result = await col.delete_many({"user_id": user_id})
    return result.deleted_count
