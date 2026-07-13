"""
db/mongo.py — MongoDB Atlas connection and conversation history helpers.

Uses motor (async pymongo) for non-blocking I/O inside FastAPI.
The memory vectors themselves are managed by Mem0; this module only
handles the raw conversation_history collection.
"""
import datetime
from motor.motor_asyncio import AsyncIOMotorClient
from app.config import MONGODB_ATLAS_URI, MONGODB_DB_NAME, CONVERSATION_COLLECTION

# Lazy singleton client — created once on first use
_client: AsyncIOMotorClient | None = None


def get_client() -> AsyncIOMotorClient:
    global _client
    if _client is None:
        _client = AsyncIOMotorClient(MONGODB_ATLAS_URI)
    return _client


def get_db():
    return get_client()[MONGODB_DB_NAME]


def get_conversation_collection():
    return get_db()[CONVERSATION_COLLECTION]


async def save_turn(user_id: str, role: str, content: str) -> None:
    """Append a single conversation turn to the history collection."""
    doc = {
        "user_id": user_id,
        "role": role,          # "user" | "assistant"
        "content": content,
        "timestamp": datetime.datetime.utcnow(),
    }
    await get_conversation_collection().insert_one(doc)


async def get_history(user_id: str, limit: int = 20) -> list[dict]:
    """Return the N most-recent turns for a user, oldest-first."""
    cursor = (
        get_conversation_collection()
        .find({"user_id": user_id}, {"_id": 0})
        .sort("timestamp", -1)
        .limit(limit)
    )
    docs = await cursor.to_list(length=limit)
    return list(reversed(docs))  # chronological order


async def clear_history(user_id: str) -> int:
    """Delete all conversation history for a user. Returns deleted count."""
    result = await get_conversation_collection().delete_many({"user_id": user_id})
    return result.deleted_count
