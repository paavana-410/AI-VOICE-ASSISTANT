def print_status(msg: str):
    print(f"\033[90m[{msg}]\033[0m")

def print_user(msg: str):
    print(f"\n\033[94mYou:\033[0m {msg}")

def print_assistant(msg: str):
    print(f"\033[92mAssistant:\033[0m {msg}\n")
