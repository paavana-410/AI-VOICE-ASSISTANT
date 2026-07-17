# Step 1: Backend Skeleton and Stateless Routing

## Objective
Initialize the FastAPI backend server structure and set up a stateless `/api/chat` route that communicates directly with the Groq LLM using LangChain's `ChatGroq` package. No persistent memory integration should be built in this step.

---

## Folder Structure to Setup
Create the following empty structure under `backend/app/`:
```text
backend/
  app/
    __init__.py
    main.py
    config.py
    api/
      __init__.py
      chat.py
      crew.py
      memory.py
  requirements.txt
```

---

## Instructions

### 1. Backend Dependencies (`backend/requirements.txt`)
Configure `requirements.txt` with these dependencies:
```text
fastapi>=0.100.0
uvicorn>=0.22.0
langchain>=0.1.0
langchain-groq>=0.1.0
pydantic>=2.0.0
pydantic-settings>=2.0.0
python-dotenv>=1.0.0
motor>=3.3.0
pymongo>=4.5.0
mem0ai>=0.1.0
mcp>=1.0.0
pytest>=7.0.0
pytest-asyncio>=0.21.0
httpx>=0.24.0
crewai>=0.28.0
```

### 2. Configuration (`backend/app/config.py`)
Load key credentials from the environment. Use `pydantic-settings` to define and validate variables:
- `GROQ_API_KEY`: string (required)
- `GROQ_MODEL`: string (default: `"llama-3.3-70b-specdec"`)
- `MONGODB_ATLAS_URI`: string (required)
- `MONGODB_DB_NAME`: string (default: `"ai_assistant"`)
- `CONVERSATION_COLLECTION`: string (default: `"conversation_history"`)
- `MEMORY_COLLECTION`: string (default: `"mem0_memories"`)
- `DEFAULT_USER_ID`: string (default: `"demo_user"`)

Ensure it handles missing `.env` gracefully, providing helpful warnings.

### 3. API Router Stubs
Create temporary endpoints in:
- `backend/app/api/crew.py` (stub POST `/crew-chat` returning `{"reply": "Crew stub"}`)
- `backend/app/api/memory.py` (stub endpoints for GET, PUT, DELETE memory operations)

### 4. Stateless Chat API (`backend/app/api/chat.py`)
Implement the `/api/chat` route:
- Define request body model `ChatRequest` containing `message: str` and `user_id: str` (optional, default `"demo_user"`).
- Define response body model `ChatResponse` containing `reply: str` and `user_id: str`.
- Create a `chat_with_groq` method inside `backend/app/agents/single_agent.py` using `ChatGroq` from `langchain_groq` to call the Groq model. Set the system prompt to a standard helpful assistant message.
- Wire this agent call into the `POST /chat` endpoint.

### 5. Main Application Entrypoint (`backend/app/main.py`)
- Initialize the `FastAPI` instance.
- Configure `CORSMiddleware` to allow requests from the React frontend dev servers (`http://localhost:5173` and `http://127.0.0.1:5173`).
- Include the routers (`chat.router`, `crew.router`, `memory.router`) with the prefix `/api`.
- Add a simple `/health` GET endpoint checking app sanity.

---

## Verification Tasks
1. Run the backend server locally:
   ```bash
   cd backend
   python -m venv .venv
   source .venv/bin/activate # or .venv\Scripts\activate on Windows
   pip install -r requirements.txt
   uvicorn app.main:app --reload --port 8000
   ```
2. Run a health check:
   ```bash
   curl http://localhost:8000/health
   ```
   *Expected reply: `{"status": "ok"}`*
3. Test a stateless chat query:
   ```bash
   curl -X POST http://localhost:8000/api/chat -H "Content-Type: application/json" -d '{"message": "Hello!"}'
   ```
   *Expected reply: A valid JSON with a reply greeting from the Groq LLM.*
