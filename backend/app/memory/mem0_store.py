import os
from mem0 import Memory
from app.config import MONGO_URI, GEMINI_API_KEY

def get_memory_client() -> Memory:
    """
    Initializes and returns a Mem0 Memory instance configured to use
    Gemini for LLM and Embeddings, and MongoDB Atlas for the vector store.
    """
    if not MONGO_URI:
        # Fallback to local memory if URI is missing for testing
        print("Falling back to local in-memory store because MONGO_URI is not set.")
        return Memory.from_config({
            "llm": {
                "provider": "gemini",
                "config": {
                    "model": "gemini-2.5-flash",
                    "api_key": GEMINI_API_KEY
                }
            },
            "embedder": {
                "provider": "gemini",
                "config": {
                    "model": "models/text-embedding-004",
                    "api_key": GEMINI_API_KEY
                }
            }
        })
        
    config = {
        "llm": {
            "provider": "gemini",
            "config": {
                "model": "gemini-2.5-flash",
                "api_key": GEMINI_API_KEY
            }
        },
        "embedder": {
            "provider": "gemini",
            "config": {
                "model": "models/text-embedding-004",
                "api_key": GEMINI_API_KEY
            }
        },
        "vector_store": {
            "provider": "mongodb",
            "config": {
                "collection_name": "memories",
                "db_name": "ai_assistant_db",
                "connection_string": MONGO_URI,
            }
        }
    }
    return Memory.from_config(config)

memory_client = get_memory_client()
