# AI Assistant with Memory

A full-stack AI assistant with persistent, cross-session memory, exposed through MCP tools, orchestrated with LangChain (single-agent) and CrewAI (multi-agent).

## Features

- **Persistent Memory**: Remembers facts and preferences across different chat sessions.
- **Zero Cost**: Built entirely on free-tier services (Groq, MongoDB Atlas Free Tier, local embeddings).
- **Multi-Agent**: Includes a CrewAI setup where multiple agents share the same memory store.
- **MCP Integration**: Memory is exposed as standard Model Context Protocol (MCP) tools.
- **Memory Inspector**: A UI to view, edit, and delete what the assistant has remembered.

## Prerequisites

- Python 3.11+
- Node.js 18+ (for local frontend dev)
- MongoDB Atlas Free Tier account
- Groq API Key

## Setup

1. **MongoDB Atlas setup**:
   - Create a free M0 cluster on MongoDB Atlas.
   - Create a database called `ai_assistant` and a collection called `mem0_memories`.
   - In the Atlas UI, go to **Atlas Search** and create a **Vector Search Index** on the `mem0_memories` collection.
   - Use this exact JSON for the index configuration:
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
   - Name the index `mem0_vector_index`.
   - Get your MongoDB connection string (looks like `mongodb+srv://...`).

2. **Environment Variables**:
   - Copy `.env.example` to `.env`
   - Fill in your `GROQ_API_KEY` and `MONGODB_ATLAS_URI`.

3. **Backend Setup**:
   ```bash
   cd backend
   python -m venv .venv
   source .venv/bin/activate  # Or .venv\Scripts\activate on Windows
   pip install -r requirements.txt
   uvicorn app.main:app --reload --port 8000
   ```

4. **Frontend Setup**:
   ```bash
   cd frontend
   npm install
   npm run dev
   ```

## Running Tests

To verify that cross-session memory works correctly:
```bash
cd backend
python -m pytest tests/test_memory_recall.py -v
python -m pytest tests/test_crew_shared_memory.py -v
```

## Architecture

- **LLM**: Groq (Llama 3.3 70B)
- **Embeddings**: Local `sentence-transformers/all-MiniLM-L6-v2`
- **Memory Layer**: Mem0
- **Database**: MongoDB Atlas
- **Backend**: FastAPI
- **Frontend**: React + Vite
