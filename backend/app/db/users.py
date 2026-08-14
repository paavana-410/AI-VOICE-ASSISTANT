"""
db/users.py — User account persistence using the existing Motor client.

Calls get_db() from db/mongo.py so the users collection lives in the SAME
database (MONGODB_DB_NAME) and uses the SAME connection as conversation_history.
No new client, no new URI, no new config variable.
"""
from datetime import datetime
from bson import ObjectId

from .mongo import get_db          # ← reuse existing client / database


async def _col():
    """Return the 'users' collection, ensuring the unique email index exists."""
    db = get_db()
    if db is None:
        raise RuntimeError("MongoDB is not connected. Check MONGODB_ATLAS_URI in .env.")
    coll = db["users"]
    await coll.create_index("email", unique=True)
    return coll


async def create_user(email: str, password_hash: str) -> str:
    """Insert a new user document. Returns the new _id as a string."""
    coll = await _col()
    result = await coll.insert_one({
        "email": email,
        "password_hash": password_hash,
        "created_at": datetime.utcnow(),
    })
    return str(result.inserted_id)


async def get_user_by_email(email: str) -> dict | None:
    coll = await _col()
    return await coll.find_one({"email": email})


async def get_user_by_id(user_id: str) -> dict | None:
    coll = await _col()
    try:
        oid = ObjectId(user_id)
    except Exception:
        return None
    return await coll.find_one({"_id": oid})
