"""Opt in to this repository's versioned hooks without changing global Git."""
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[1]
existing = subprocess.run(["git", "config", "--get", "core.hooksPath"], cwd=root,
                          capture_output=True, text=True).stdout.strip()
if existing and existing != ".githooks":
    raise SystemExit(f"Existing hooksPath {existing!r}; integrate these hooks manually instead of overwriting it.")
for hook in (root / ".githooks").iterdir():
    hook.chmod(hook.stat().st_mode | 0o111)
subprocess.run(["git", "config", "--local", "core.hooksPath", ".githooks"], cwd=root, check=True)
print("Installed local hooks. Run uv run python scripts/check.py for the same quality checks.")
