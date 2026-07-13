# Build Prompt — paste this into your IDE's LLM agent (Cursor / Claude Code / Windsurf / etc.)

Copy everything below the line into your agent as a single instruction. It's written to be
self-contained: goals, stack, file structure, and step-by-step build order. Attach
`MRD_AI_Assistant_With_Memory.md` too if your tool supports file attachments — it has the full
requirements and the reasoning behind each stack choice.

---

## Project

Build **"AI Assistant with Memory"** — a full-stack AI assistant with persistent, cross-session
memory, exposed through MCP tools, orchestrated with LangChain (single-agent) and CrewAI
(multi-agent). **The entire project must run at $0 cost** — every service used has a genuinely
free tier or runs locally with no license/subscription cost.

## Objective

Ship a working app, runnable locally, where:
1. A user chats with an AI assistant in a web UI.
2. The assistant remembers facts and preferences the user shares, and correctly recalls them
   in a **new, separate session** (not just within one chat).
3. Memory is stored and retrieved via **Mem0**, backed by a **free MongoDB Atlas cluster**,
   and exposed as callable tools through **OpenMemory MCP** — not hardcoded database calls.
4. There is a second, multi-agent path built with **CrewAI** where at least two agents
   (e.g. a "Researcher" agent and a "Personal Assistant" agent) share the same memory store.
5. There's a simple "memory inspector" screen where the user can see, edit, and delete what's
   been stored about them.

## Tech stack — use exactly this, it's already been decided for cost reasons

- **Backend:** Python, FastAPI
- **LLM:** **Groq API** (`groq` Python SDK or LangChain's `ChatGroq`) — free tier. Use a
  current Groq-hosted model (check Groq's docs for the current recommended model name, e.g. a
  Llama 3.3 70B variant — model names change, verify before hardcoding).
- **Embeddings:** **`sentence-transformers`**, model `all-MiniLM-L6-v2`, run locally in the
  backend process. Output is 384-dimensional — this must match the MongoDB Atlas vector index
  dimension exactly.
- **Memory:** **Mem0** (`mem0ai` package), configured with MongoDB as its vector store backend
  (Mem0 has native MongoDB Atlas support — use it, don't write a custom vector store adapter).
- **Database:** **MongoDB Atlas free tier (M0)** — one cluster, two collections:
  - one collection used by Mem0 for memory vectors (via Atlas Vector Search)
  - one collection for raw conversation history/logs
  No local MongoDB installation — connect via `pymongo`/`motor` using an Atlas connection
  string from `.env`. The developer will create the free Atlas cluster and the vector search
  index manually before you start Step 2 below (a few clicks in the Atlas UI, or one Atlas API
  call) — don't try to provision this in code.
- **Tool protocol:** OpenMemory MCP server wrapping Mem0, exposing `memory_search`,
  `memory_add`, `memory_delete` as MCP tools.
- **Single-agent orchestration:** LangChain
- **Multi-agent orchestration:** CrewAI
- **Frontend:** React + Vite, plain fetch calls to the FastAPI backend.
- **Deployment:** none yet — run locally via `uvicorn` (backend) and `npm run dev` (frontend),
  or a `docker-compose.yml` with just those two services. Do not add Qdrant, Postgres, or any
  other database service/container — MongoDB Atlas replaces all of that.

## Repository structure to create

```
ai-assistant-memory/
  backend/
    app/
      main.py                # FastAPI entrypoint
      api/
        chat.py               # POST /chat endpoint (single-agent, LangChain path)
        crew.py                # POST /crew-chat endpoint (multi-agent, CrewAI path)
        memory.py             # GET/PUT/DELETE endpoints for the memory inspector UI
      agents/
        single_agent.py        # LangChain agent wired to Groq + MCP memory tools
        crew_agents.py         # CrewAI agents (Researcher, Assistant) sharing memory
      mcp/
        memory_server.py       # OpenMemory MCP server wrapping Mem0 (Mongo-backed)
        mcp_client.py           # MCP client used by the LangChain/CrewAI agents
      db/
        mongo.py                 # MongoDB Atlas connection (pymongo/motor), conversation history helpers
      config.py                 # env var loading
    requirements.txt
    Dockerfile
  frontend/
    src/
      App.jsx
      components/
        ChatWindow.jsx
        MemoryInspector.jsx
      api.js                     # fetch wrappers to backend
    package.json
    Dockerfile
  docker-compose.yml             # backend + frontend only, no DB containers
  .env.example                    # GROQ_API_KEY, MONGODB_ATLAS_URI, etc.
  README.md
  tests/
    test_memory_recall.py         # scripted cross-session recall test
    test_crew_shared_memory.py
```

## Build order (do these as separate steps; run and verify each before moving on)

**1. Backend skeleton, no memory yet**
   - FastAPI app with `/chat` endpoint that calls Groq directly (LangChain `ChatGroq` or the
     Groq SDK), stateless. Confirm this returns a real response before adding anything else.

**2. Connect MongoDB Atlas + Mem0**
   - Add `MONGODB_ATLAS_URI` to `.env` (I will supply the connection string — ask me for it if
     it's missing rather than inventing one).
   - Configure Mem0 with MongoDB as the vector store, and `sentence-transformers`
     (`all-MiniLM-L6-v2`) as the embedder. Confirm the embedder's output dimension (384)
     matches the Atlas vector index dimension I created — flag it clearly if there's a
     mismatch instead of silently proceeding.
   - On each `/chat` call: search memory for relevant facts for this user, inject into the
     system prompt, call Groq, then write any new facts back to memory.
   - Verify manually: tell it your name in one request, then in a **new** process/session, ask
     "what's my name" and confirm it recalls correctly.

**3. Wrap Mem0 in an OpenMemory MCP server**
   - Stand up the MCP server exposing `memory_search`, `memory_add`, `memory_delete` as tools.
   - Rewire the LangChain agent to call these as MCP tools instead of calling Mem0's SDK
     directly. This is the architectural point of the project — don't skip it even though
     direct SDK calls would "work" too.

**4. Multi-agent CrewAI path**
   - Define two CrewAI agents: a "Researcher" (can search the web or a stub tool) and a
     "Personal Assistant" (talks to the user). Both get the MCP memory tools.
   - Build a scenario where the Researcher writes a fact to memory and the Assistant recalls
     it in the same or a later run — proving shared memory across agents, not just across
     sessions for one agent.

**5. Frontend**
   - Simple chat window hitting `/chat` (and a toggle to hit `/crew-chat`).
   - Memory inspector page listing stored memories with edit/delete, calling the memory CRUD
     endpoints.

**6. Tests**
   - `test_memory_recall.py`: script 5–10 "state a fact → new session → ask about it" scenarios
     and assert correct recall. This is your evidence the core claim of the project actually
     works — don't skip it. Add retry/backoff around Groq calls to tolerate free-tier rate
     limits during a full test run.
   - `test_crew_shared_memory.py`: assert the two CrewAI agents see the same memory in Atlas.

**7. Local run + README**
   - `docker-compose.yml` running just backend + frontend for local dev (no DB containers).
   - Write a README with setup instructions: how to create the free Atlas cluster + vector
     index, required env vars (`GROQ_API_KEY`, `MONGODB_ATLAS_URI`), and how to run the recall
     test. Deployment/hosting is explicitly deferred — note that in the README as a "Next
     steps" section rather than building it now.

## Constraints & instructions to the agent

- **Cost discipline:** don't introduce any paid API, paid tier, or local database server
  install. If a step seems to need one, stop and ask me first — there's almost always a free
  alternative already decided in the stack above.
- Ask me before introducing any new major dependency not listed above.
- After each numbered step, run it and show me the output/result before continuing — don't
  build all 7 steps blind and then report back.
- Groq, Mem0, OpenMemory MCP, and CrewAI move fast — if their current APIs differ from what you
  expect, check current docs/README before writing code against them rather than guessing.
- Keep secrets out of source control: use `.env` + `.env.example`, add `.env` to `.gitignore`.
  This especially matters for the Atlas connection string, which contains credentials.
- Prioritize memory-recall correctness (step 2's manual test, step 6's automated test) above UI
  polish. A correct, ugly memory system is a success; a pretty stateless chatbot is not.

---

## Notes for you (not part of the agent prompt)

- Before starting Step 2, go create your free MongoDB Atlas account + M0 cluster, and create a
  vector search index with `dimensions: 384` (to match `all-MiniLM-L6-v2`). Grab the connection
  string — the agent will ask for it.
- The MRD file explains *why* each piece is there and what "done" looks like — keep it next to
  this prompt so you (and the agent, if you attach it) can check scope against it.
- Suggested first message to your IDE agent: paste the "Project" through "Build order" sections
  above, then say "Start with step 1 and stop for my review before continuing."
