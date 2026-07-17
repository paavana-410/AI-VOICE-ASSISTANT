# Step 6: Write Automated Recall and Integration Tests

## Objective
Implement validation scripts using `pytest` to verify the core functional requirements:
1. **Cross-Session Recall Accuracy:** Proving the assistant remembers facts in later turns (new execution scope).
2. **Shared Multi-Agent Memory:** Proving that CrewAI agents successfully read/write to the same MongoDB collection.

---

## Instructions

### 1. Test Setup (`backend/tests/conftest.py` or local fixture)
- Create a `test_user` fixture that generates a unique user identifier (e.g., `test_user_xxxxxxxx`).
- Write a teardown routine that calls the Mem0 client (`mem.delete_all(user_id=...)`) or database clear helper to wipe records for that test ID at the end of each test run.

### 2. Single Agent Recall Test (`backend/tests/test_memory_recall.py`)
Implement the following test cases:
1. `test_memory_recall_across_sessions`:
   - Send: `"My favorite programming language is Rust."`
   - Wait 2 seconds (to ensure Atlas Vector Search indexing completes).
   - Send: `"What did I say my favorite programming language is?"`
   - Assert: `"Rust"` is in the assistant's reply.
2. `test_multiple_facts_recall`:
   - Send: `"I have a pet dog named Max."`
   - Send: `"I am allergic to peanuts."`
   - Wait 2 seconds.
   - Send: `"What should I avoid eating?"`
   - Assert: `"peanut"` (case-insensitive) is in the reply.

### 3. Multi-Agent Shared Memory Test (`backend/tests/test_crew_shared_memory.py`)
- Implement a test to run the CrewAI agents.
- Send a prompt that triggers a research task: `"Find information about the user's pet and write it to memory. The user has a golden retriever named Rusty."`
- Run the crew.
- Query the database/Mem0 for `user_id` and assert that a fact containing `"Rusty"` or `"golden retriever"` was added to MongoDB.

### 4. Groq Rate Limit Mitigation
Since Groq's free tier has requests-per-minute (RPM) limits:
- Add a helper wrapper or use `tenacity` library to retry requests on `429` status codes with exponential backoff.
- Put explicit `time.sleep(2)` calls between test steps to reduce token usage spikes.

---

## Verification Tasks
1. Run the test suite:
   ```bash
   cd backend
   python -m pytest tests/test_memory_recall.py -v
   python -m pytest tests/test_crew_shared_memory.py -v
   ```
2. Verify all assertions pass with 100% success rate.
