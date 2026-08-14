import pytest
import time
import uuid

from app.agents.single_agent import chat_with_memory, get_memory_client

@pytest.fixture
def test_user():
    user_id = f"test_user_{uuid.uuid4().hex[:8]}"
    yield user_id
    # Teardown: clean up memories for this test user
    mem = get_memory_client()
    mem.delete_all(user_id=user_id)

def test_memory_recall_across_sessions(test_user):
    """
    Test that a fact stated in one 'session' (turn) is correctly
    recalled in a later turn, proving that memory persists and is retrieved.
    """
    # 1. State a fact
    fact = "My favorite programming language is Rust."
    reply1 = chat_with_memory(user_message=fact, user_id=test_user, mcp_client=None)
    assert reply1 is not None

    # Wait a moment to ensure vector indexing completes (Atlas is usually fast, but just in case)
    time.sleep(2)

    # 2. Ask about the fact in a 'new' session (new turn)
    question = "What did I say my favorite programming language is?"
    reply2 = chat_with_memory(user_message=question, user_id=test_user, mcp_client=None)
    
    # 3. Assert the model recalled it correctly
    assert "Rust" in reply2, f"Failed to recall 'Rust'. Assistant replied: {reply2}"

def test_multiple_facts_recall(test_user):
    """Test recalling multiple disjoint facts."""
    chat_with_memory("I have a pet dog named Max.", user_id=test_user, mcp_client=None)
    chat_with_memory("I am allergic to peanuts.", user_id=test_user, mcp_client=None)
    time.sleep(2)
    
    reply = chat_with_memory("What should I avoid eating?", user_id=test_user, mcp_client=None)
    assert "peanut" in reply.lower(), f"Failed to recall peanut allergy. Reply: {reply}"
