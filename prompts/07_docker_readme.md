# Step 7: Docker Compose Setup and Documentation

## Objective
Containerize both the FastAPI backend and React frontend services using Docker, and document the complete setup, configuration, and verification steps in the repository's main `README.md` file.

---

## Instructions

### 1. Write the Docker Configuration

#### Backend Dockerfile (`backend/Dockerfile`)
- Base image: `python:3.11-slim`
- Working dir: `/app`
- Copy `requirements.txt` and install dependencies.
- Copy application code.
- Command: `uvicorn app.main:app --host 0.0.0.0 --port 8000`

#### Frontend Dockerfile (`frontend/Dockerfile.dev`)
- Base image: `node:18-alpine`
- Working dir: `/app`
- Copy `package.json` and install dependencies.
- Copy frontend source.
- Command: `npm run dev -- --host` (ensuring it binds to interface `0.0.0.0`).

#### Docker Compose Config (`docker-compose.yml`)
Configure a compose script at the project root declaring:
- `backend` service:
  - Builds from `backend/` folder.
  - Ports: map `8000:8000`.
  - Environment variables: load directly from `.env`.
- `frontend` service:
  - Builds from `frontend/` folder with `Dockerfile.dev`.
  - Ports: map `5173:5173`.
  - Depends on: `backend`.

### 2. Configure environment examples (`.env.example`)
Create a `.env.example` in the root containing:
```text
GROQ_API_KEY=your-groq-api-key-here
MONGODB_ATLAS_URI=mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
GROQ_MODEL=llama-3.3-70b-specdec
MONGODB_DB_NAME=ai_assistant
CONVERSATION_COLLECTION=conversation_history
MEMORY_COLLECTION=mem0_memories
DEFAULT_USER_ID=demo_user
```

### 3. Create the Main project Documentation (`README.md`)
Write a detailed user manual outlining:
1. **Features:** persistent memory, multi-agent CrewAI path, MCP structure, and zero-cost strategy.
2. **Prerequisites:** Python 3.11, Node.js 18, and a MongoDB Atlas Account.
3. **Atlas Vector Search configuration details:** the exact JSON parameters for creating the `mem0_vector_index` index.
4. **Local Startup Guide:** commands to spin up the virtual environment, install requirements, start FastAPI, install node packages, and launch the Vite dev server.
5. **Docker Compose Startup Guide:** `docker-compose up --build`.
6. **Test Running instructions:** `python -m pytest tests/` commands.

---

## Verification Tasks
1. Copy `.env.example` to `.env` and fill in mock credentials.
2. Run docker compose:
   ```bash
   docker-compose up --build
   ```
3. Verify both containers build successfully, establish networks, and ports `8000` and `5173` are listening.
