"""
AI Voice Assistant - Entry Point
"""
from src.assistant.core import VoiceAssistant

if __name__ == "__main__":
    assistant = VoiceAssistant()
    assistant.run()
