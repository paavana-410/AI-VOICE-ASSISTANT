# Market Requirements Document (MRD)
## AI Assistant with Persistent Memory

**Version:** 2.0 — zero-cost stack finalized
**Owner:** [Your name]
**Status:** Draft for build

---

## 1. Problem Statement

Most chatbot/agent apps are stateless: every new session starts from zero. Users have to
re-explain who they are, what they prefer, and what they've already discussed. This breaks
trust for any assistant meant to be used repeatedly (personal assistant, customer support bot,
coding copilot, internal tool) and makes multi-agent workflows unreliable, since agents can't
build on facts learned in earlier runs.

**Goal:** build an AI assistant that stores long-term memory of a user's facts, preferences,
and conversation history, retrieves the right memories at the right time, and uses that memory
to give more personalized, accurate answers across sessions and across multiple cooperating
agents — **at zero infrastructure cost.**

## 2. Target Users

- **Primary:** developers/founders who want to embed a memory-aware assistant into their own
  product (support bot, internal copilot, personal AI).
- **Secondary:** end users of that product, who benefit from not repeating themselves.
- **Portfolio/demo use case (this build):** a personal AI assistant you can show as a working
  product — chat UI + API + persistent memory across sessions — runnable and demoable without
  spending anything.

## 3. Goals & Success Metrics

| Goal | Metric | Target |
|---|---|---|
| Memory persists across sessions | % of stated facts correctly recalled in a later, separate session | ≥ 90% on a 20-scenario test set |
| Personalization improves over time | Qualitative: response references prior context without being asked | Demonstrable in demo script |
| Multi-agent workflows share memory | Two agents can read/write the same memory store without conflict | Pass integration test |
| Low latency | Time from query to first token | < 3s for a memory-augmented chat turn (Groq free tier is fast, but rate-limited — see risks) |
| Deployable | App runs from a fresh clone with documented env vars | One-command local run |
| **Zero cost** | Total monthly spend to run and demo the project | **$0** |

## 4. Scope

### In scope (v1 / MVP)
- Text chat interface (web) with an AI assistant backed by Groq's free LLM API.
- Persistent memory layer (Mem0) storing facts/preferences per user, addressable across
  sessions, backed by a free MongoDB Atlas cluster.
- Memory exposed as MCP tools (OpenMemory MCP) so any MCP-compatible agent/client can read
  and write memory using a standard protocol instead of a custom integration.
- Orchestration with LangChain (single-agent path) and CrewAI (multi-agent path — e.g. a
  "researcher" agent and a "personal assistant" agent sharing the same memory store).
- Basic conversation history + memory inspector UI (see what the assistant remembers, allow
  deleting/correcting memories).
- Local-only run for now (no paid hosting); deploy is a later, optional step.

### Out of scope (v1)
- Voice input/output.
- Document ingestion / RAG over files (can be a v2 add-on).
- Multi-tenant billing/auth beyond a simple login or fixed demo user id.
- Fine-tuning any model.
- Paid hosting/deployment (deferred; when you do deploy, this 2-service app fits a free tier
  like Render's free web service).

## 5. Key Features (MoSCoW)

**Must have**
1. User can chat with the assistant; each turn calls Groq's API with relevant memories injected.
2. Assistant writes new facts/preferences to memory automatically after a conversation turn.
3. Memory correctly recalled in a brand-new session (different chat window/day).
4. Memory read/write exposed as MCP tools, not hardcoded function calls, so the tool layer is
   swappable and standards-based.
5. At least two agents (via CrewAI) that both read from and write to the same MongoDB Atlas
   memory store, demonstrating shared, scalable multi-agent memory.
6. Runs entirely on free infrastructure — no paid API keys, no paid hosting, no local DB
   software installation beyond Python/Node tooling.

**Should have**
7. Memory inspector UI: list, search, edit, delete stored memories.
8. Source attribution: assistant indicates when a response is based on stored memory.
9. Basic auth (per-user memory isolation, enforced via a `user_id` field in Atlas documents).

**Could have**
10. Streaming responses.
11. Multiple memory "spaces" (e.g. work vs personal).
12. Analytics on memory usage (most-recalled facts, memory growth over time).
13. Deploy to a free hosting tier (Render free web service) once local build is solid.

## 6. Tech Stack (finalized, $0)

| Layer | Choice | Cost | Why |
|---|---|---|---|
| LLM | **Groq API** | Free tier, generous rate limits | Fast inference on strong open models (Llama 3.3 70B etc.); same "call an API" pattern as any OpenAI-compatible client |
| Embeddings | **sentence-transformers** (`all-MiniLM-L6-v2`), local | Free, no API | Runs in-process, no external call, 384-dim output |
| Memory | **Mem0** | Free, open source | Purpose-built long-term memory layer; has native MongoDB Atlas support |
| Vector store + conversation DB | **MongoDB Atlas free tier (M0, 512MB)** | Free forever | One hosted cluster does double duty: Mem0's vector store (Atlas Vector Search) *and* raw conversation history, in separate collections. No local DB software to install — just a connection string. |
| Tool protocol | **OpenMemory MCP** | Free | Exposes Mem0 as standard MCP tools (`memory_search`, `memory_add`, `memory_delete`) |
| Orchestration (single-agent) | **LangChain** | Free | Retrieval + tool-calling pipeline |
| Orchestration (multi-agent) | **CrewAI** | Free | Role-based agents sharing the same memory tools |
| Backend | **FastAPI** | Free | Python, async |
| Frontend | **React + Vite** | Free | Chat UI + memory inspector |
| Deployment | **Local only for now** | $0 | Defer hosting; when ready, 2-service app (backend + frontend) fits Render's free tier |

**What you need to install locally:** Python, pip packages, Node, npm. **What you don't
install:** any database server (Mongo runs entirely on Atlas's servers, reached over a
connection string).

**One manual setup step (not software, just config):** create a free MongoDB Atlas account and
cluster, and create the vector search index once via the Atlas UI (a few clicks) or one API call.

## 7. Non-Functional Requirements

- **Cost:** total spend must remain $0. Any dependency change that introduces a paid tier or
  API must be flagged before being added.
- **Local-first dev:** the whole app should run via local Python/Node processes (or
  `docker-compose up` for the two app services) with zero external dependencies except the
  Groq API key and the MongoDB Atlas connection string.
- **Reliability:** if memory lookup fails, the assistant should still respond (degrade
  gracefully, don't fabricate memories).
- **Rate-limit tolerance:** Groq's free tier has requests/tokens-per-minute limits; the
  backend should handle 429s gracefully (backoff/retry) rather than crashing, especially
  during automated test runs.
- **Security:** memory is per-user (`user_id` field on every Atlas document); no user can
  read another user's memories. API keys never exposed to the frontend, kept in `.env`.
- **Modularity:** swap the LLM provider or memory backend without rewriting the orchestration
  layer — this is exactly what the MCP tool boundary is for.
- **Auditability:** log every memory write with a timestamp and source conversation turn.

## 8. Risks

| Risk | Mitigation |
|---|---|
| Groq free-tier rate limits throttle heavy testing | Add retry/backoff; keep automated recall tests small (10–20 scenarios, spaced out) |
| Memory recall benchmarks are vendor-contested (Mem0 vs alternatives) | Run your own small recall test set rather than trusting marketing claims |
| Atlas free tier (512MB) fills up | Keep memory entries concise; periodically prune test/demo data; 512MB is generous for personal-scale memory but not unlimited |
| Memory pollution (assistant stores wrong/irrelevant facts) | Add a review/edit UI; only auto-write high-confidence facts |
| Embedding dimension mismatch between `sentence-transformers` and the Atlas vector index | Set the Atlas index to exactly 384 dimensions to match `all-MiniLM-L6-v2`; verify before first write |
| Scope creep toward the full "voice business copilot" concept | Ship the MVP above first; treat voice + RAG-over-documents as v2 |

## 9. Milestones

1. **Step 1:** Backend skeleton — FastAPI + LangChain + Groq API, no memory yet (stateless chat works).
2. **Step 2:** Create MongoDB Atlas free cluster + vector search index; wire up Mem0 against it; verify manual cross-session recall.
3. **Step 3:** Wrap Mem0 in an OpenMemory MCP server; rewire the agent to use MCP tools instead of direct SDK calls.
4. **Step 4:** Frontend chat UI + memory inspector.
5. **Step 5:** Add CrewAI multi-agent path sharing memory via MCP.
6. **Step 6:** Write and pass the automated recall test set (≥90% cross-session accuracy).
7. **Step 7 (optional, later):** Deploy to a free hosting tier once the local build is solid.

## 10. Open Questions (resolved)

- ~~Claude vs OpenAI vs Groq~~ → **Groq**, free tier.
- ~~Self-hosted Mem0 vector store vs hosted~~ → **MongoDB Atlas free tier**, native Mem0 support.
- ~~Postgres vs Mongo~~ → **Mongo**, since it covers both vector store and conversation history
  in one free hosted cluster with no local install.
- Auth: still open — simple email/password, or skip auth for the demo and use a fixed demo
  user id. Doesn't block the build; decide during Step 4.
