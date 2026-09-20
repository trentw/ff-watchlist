"""Small local quality gate; no network or provider data is needed."""
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def forbidden_path(name):
    parts = Path(name).parts
    return (name == "PROJECT-PLAN.md" or any(part in {".local", "data", ".venv", "__pycache__"} for part in parts)
            or any(part.startswith(".env") and part != ".env.example" for part in parts)
            or name.endswith((".pem", ".key")))


def main():
    # Inspect the index too: gitignore cannot protect a force-added file.
    files = subprocess.check_output(["git", "ls-files", "-z"], cwd=ROOT).decode().split("\0")
    bad = [name for name in files if name and forbidden_path(name)]
    if bad:
        print("Remove private/generated files from the index: " + ", ".join(bad), file=sys.stderr)
        return 1
    for command in (["git", "diff", "--cached", "--check"],
                    [sys.executable, "-m", "ruff", "check", "."],
                    [sys.executable, "-m", "pytest", "-q"]):
        result = subprocess.run(command, cwd=ROOT)
        if result.returncode:
            return result.returncode
    return browser_checks()


def browser_checks():
    npm = shutil.which("npm")
    if not npm or not (ROOT / "node_modules").is_dir():
        print("Skipping browser checks: run `npm ci` to enable them.")
        return 0
    return subprocess.run([npm, "run", "--silent", "check"], cwd=ROOT).returncode


if __name__ == "__main__":
    raise SystemExit(main())
