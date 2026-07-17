import speech_recognition as sr
from src.utils.helpers import print_status

class SpeechRecognizer:
    def __init__(self):
        self.recognizer = sr.Recognizer()
        self.microphone = sr.Microphone()

    def calibrate(self):
        with self.microphone as source:
            self.recognizer.adjust_for_ambient_noise(source, duration=2)

    def listen(self) -> str:
        with self.microphone as source:
            try:
                audio = self.recognizer.listen(source, timeout=5, phrase_time_limit=15)
                text = self.recognizer.recognize_google(audio)
                return text
            except sr.WaitTimeoutError:
                return ""
            except sr.UnknownValueError:
                print_status("Could not understand audio")
                return ""
            except sr.RequestError as e:
                print_status(f"Could not request results; {e}")
                return ""
