"""Reject AI coauthor trailers; human collaborator attribution is welcome."""
from pathlib import Path
import re
import sys


def has_ai_coauthor(message):
    return any(re.search(r"^Co-authored-by:\s*.*\b(ai|codex|claude|chatgpt|copilot|openai|anthropic|gemini|cursor)\b",
                         line, re.IGNORECASE) for line in message.splitlines())


if __name__ == "__main__":
    if has_ai_coauthor(Path(sys.argv[1]).read_text()):
        raise SystemExit("Remove the AI Co-authored-by trailer. Keep the commit focused on the change.")
