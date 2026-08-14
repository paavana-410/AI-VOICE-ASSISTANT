import pytest
import uuid
from app.agents.crew_agents import run_crew
from app.agents.single_agent import get_memory_client

@pytest.fixture
def test_user():
    user_id = f"crew_test_user_{uuid.uuid4().hex[:8]}"
    yield user_id
    # Teardown
    mem = get_memory_client()
    mem.delete_all(user_id=user_id)

def test_crew_shared_memory(test_user):
    """
    Test that the CrewAI Researcher agent stores facts that the
    Assistant agent can successfully retrieve to answer the user.
    """
    # 1. Ask the crew to remember a specific weird fact (so it must use memory)
    # The Researcher will process this and store it in Mem0.
    # The Assistant will reply acknowledging it.
    prompt1 = "Remember this secret code: 'ALPHA-99'. Tell me you've saved it."
    reply1 = run_crew(prompt1, user_id=test_user)
    assert "ALPHA-99" in reply1 or "saved" in reply1.lower()

    # 2. Ask the crew about the secret code.
    # The Assistant should query memory and find the fact stored by the Researcher.
    prompt2 = "What is the secret code I gave you earlier?"
    reply2 = run_crew(prompt2, user_id=test_user)
    
    # 3. Assert correct recall
    assert "ALPHA-99" in reply2, f"Crew failed to recall shared memory. Reply: {reply2}"
