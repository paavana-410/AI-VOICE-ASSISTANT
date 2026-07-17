# Step 8: Next Task — Voice Assistant Integration

## Objective
Implement the local AI Voice Assistant client inside the root `src` directory using the packages listed in the root `requirements.txt`. The Voice Assistant will capture audio input, convert it to text, send the text to the memory-augmented backend API `/api/chat`, and speak the returned response back to the user. This turns the text-based memory system into a fully functioning, stateful Voice Assistant.

---

## Technical Stack
- **Speech-to-Text (STT):** `SpeechRecognition` package (utilizing the free Google Web Speech API wrapper).
- **Text-to-Speech (TTS):** `pyttsx3` for offline, cross-platform voice generation.
- **Backend Connection:** `requests` to call the local FastAPI backend `/api/chat` route.
- **Environment:** `python-dotenv` to manage user configurations (such as custom backend URL or default user ID).

---

## File Structure to Implement
Under the root `src/` directory, write the following modules:
```text
src/
  assistant/
    __init__.py
    core.py            # Main conversation loop
  speech/
    __init__.py
    recognition.py     # Speech-to-Text handler
    tts.py             # Text-to-Speech handler
  utils/
    __init__.py
    helpers.py         # Helper utilities (loading env, print formatters)
```

---

## Instructions

### 1. Speech-to-Text Module (`src/speech/recognition.py`)
- Implement a class or function that wraps `speech_recognition.Recognizer`.
- Access the default microphone (`speech_recognition.Microphone()`).
- Calibrate for ambient noise.
- Listen for audio input and use `recognize_google()` to translate speech to text.
- Handle error exceptions gracefully (e.g. `UnknownValueError` for unrecognized speech, and `RequestError` for network failures).

### 2. Text-to-Speech Module (`src/speech/tts.py`)
- Implement a class or function wrapping `pyttsx3`.
- Initialize the speech engine.
- Configure properties:
  - Voice: Allow selection between male and female system voices.
  - Speech Rate: Set to a natural reading pace (e.g., 175-200 words per minute).
  - Volume: Set to max (1.0).
- Expose a `speak(text)` method that blocks until speech finishes.

### 3. Core Logic (`src/assistant/core.py`)
- Implement the `VoiceAssistant` class.
- Read settings from environment variables (e.g. `BACKEND_URL` defaulting to `http://localhost:8000/api/chat` and `USER_ID` defaulting to `voice_user`).
- Build a run loop:
  1. Print visual indicator (e.g. `"🎙️ Listening..."`).
  2. Record audio and convert to text using `recognition.py`.
  3. If text contains exit phrases (like `"exit"`, `"goodbye"`, `"quit"`), output a farewell phrase and break the loop.
  4. Call the FastAPI backend `/api/chat` via `requests.post` with the user message and `USER_ID`.
  5. Print the text response to stdout.
  6. Speak the response aloud using the TTS module.

### 4. Entrypoint (`main.py`)
Ensure the root `main.py` executes correctly:
```python
from src.assistant.core import VoiceAssistant

if __name__ == "__main__":
    assistant = VoiceAssistant()
    assistant.run()
```

---

## Verification Tasks
1. Ensure the backend FastAPI server is running (`uvicorn app.main:app --port 8000` inside `ai-assistant-memory/backend/`).
2. Run the voice assistant from the root directory:
   ```bash
   python main.py
   ```
3. Speak into your microphone: *"Remember that my favourite dessert is chocolate ice cream."*
4. Confirm the assistant speaks a confirmation back.
5. Exit the script (say *"goodbye"*).
6. Start the voice assistant again to verify persistent memory across sessions.
7. Speak: *"What is my favourite dessert?"*
8. **Success Criteria:** The assistant speaks *"Your favourite dessert is chocolate ice cream."*
