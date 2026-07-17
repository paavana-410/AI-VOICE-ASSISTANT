# Step 2: Connect MongoDB Atlas and Mem0 Memory

## Objective
Establish a persistent database layer. You will connect to MongoDB Atlas for two purposes:
1. **Raw Conversation Logging:** An asynchronous Motor connection to store message history.
2. **Semantic Memory Store:** Instantiating the Mem0 package, configured to store facts in MongoDB and query them via local `sentence-transformers` vector search.

---

## Instructions

### 1. MongoDB Atlas Setup (Developer Manual Step)
Before coding, the developer must configure the Atlas Cluster:
- Database Name: `ai_assistant`
- Collection: `mem0_memories`
- Vector Search Index: Create an index named `mem0_vector_index` on `mem0_memories` using this JSON configuration:
  ```json
  {
    "fields": [
      {
        "type": "vector",
        "path": "embedding",
        "numDimensions": 384,
        "similarity": "cosine"
      }
    ]
  }
  ```
  *Note: The dimension MUST be 384 to match `sentence-transformers/all-MiniLM-L6-v2`.*

### 2. Database Connection (`backend/app/db/mongo.py`)
- Write an asynchronous database connector using `motor.motor_asyncio.AsyncIOMotorClient`.
- Implement `save_turn(user_id: str, role: str, content: str)` to append logs with a UTC timestamp to the `conversation_history` collection.
- Implement `get_history(user_id: str, limit: int)` to retrieve recent chat logs chronological-first.

### 3. Configure Mem0 client (`backend/app/agents/single_agent.py`)
Create a singleton Mem0 `Memory` instance:
- **Vector Store Config:** Provider `mongodb`, connection parameters referencing MongoDB URL, DB name, collection name, index name, and `embedding_model_dims: 384`.
- **Embedder Config:** Provider `huggingface` with model `"sentence-transformers/all-MiniLM-L6-v2"`.
- **LLM Config:** Provider `groq` with `api_key` and `model` parameters.

### 4. Memory-Augmented Chat flow (`backend/app/agents/single_agent.py`)
Refactor `chat_with_memory` to execute these four phases:
1. **Search:** Query Mem0 via `mem.search(query, user_id)` to pull the top 5 relevant facts.
2. **Inject:** Format retrieved facts (e.g. `"- Fact 1\n- Fact 2"`) and render them into the System Prompt.
3. **Execute LLM:** Generate the assistant response using `ChatGroq`.
4. **Learn:** Run `mem.add(messages, user_id)` in the background to automatically process new facts from the user-assistant exchange.

---

## Verification Tasks
1. Start the FastAPI server.
2. Simulate a memory storage interaction:
   ```bash
   curl -X POST http://localhost:8000/api/chat -H "Content-Type: application/json" -d '{"message": "Remember that my favourite coding language is Rust and I live in Paris", "user_id": "user_123"}'
   ```
3. Verify recall in a new isolated API call:
   ```bash
   curl -X POST http://localhost:8000/api/chat -H "Content-Type: application/json" -d '{"message": "What is my favourite language?", "user_id": "user_123"}'
   ```
   *Expected reply: The agent should state your name/preference is "Rust" by extracting it from MongoDB Atlas.*
