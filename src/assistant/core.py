import os
import time
import requests
from dotenv import load_dotenv

from src.speech.recognition import SpeechRecognizer
from src.speech.tts import TTSEngine
from src.utils.helpers import print_status, print_assistant, print_user

load_dotenv()

class VoiceAssistant:
    def __init__(self):
        self.backend_url = os.getenv("BACKEND_URL", "http://localhost:8000/api/chat")
        self.user_id = os.getenv("USER_ID", "voice_user")
        self.recognizer = SpeechRecognizer()
        self.tts = TTSEngine()
        self.exit_phrases = ["exit", "goodbye", "quit"]

    def run(self):
        print_status(f"Starting Voice Assistant (User ID: {self.user_id})")
        print_status("Calibrating microphone...")
        self.recognizer.calibrate()
        
        self.tts.speak("Voice assistant activated. I am listening.")
        
        while True:
            print_status("🎙️ Listening...")
            text = self.recognizer.listen()
            
            if not text:
                continue
                
            print_user(text)
            
            if any(phrase in text.lower() for phrase in self.exit_phrases):
                farewell = "Goodbye! Have a great day."
                print_assistant(farewell)
                self.tts.speak(farewell)
                break
                
            # Send to backend
            try:
                response = requests.post(
                    self.backend_url,
                    json={"message": text, "user_id": self.user_id},
                    timeout=30
                )
                response.raise_for_status()
                reply = response.json().get("reply", "I did not get a response.")
            except requests.exceptions.RequestException as e:
                reply = f"Error connecting to backend: {e}"
                
            print_assistant(reply)
            self.tts.speak(reply)
