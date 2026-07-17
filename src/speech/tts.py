import pyttsx3

class TTSEngine:
    def __init__(self):
        self.engine = pyttsx3.init()
        self.engine.setProperty('rate', 180)    # Natural reading pace
        self.engine.setProperty('volume', 1.0)  # Max volume
        
        # Set a female voice if available
        voices = self.engine.getProperty('voices')
        for voice in voices:
            if "female" in voice.name.lower() or "zira" in voice.name.lower():
                self.engine.setProperty('voice', voice.id)
                break

    def speak(self, text: str):
        self.engine.say(text)
        self.engine.runAndWait()
