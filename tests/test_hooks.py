"""Guard the private-file and AI-attribution policies without touching Git."""
import importlib.util
from pathlib import Path


def load(name):
    path = Path(__file__).resolve().parents[1] / "scripts" / f"{name}.py"
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_private_files_cannot_be_force_added():
    blocked = load("check").forbidden_path
    for name in ["PROJECT-PLAN.md", ".local/LEARNINGS.md", "data/source.json", ".env", ".env.production", "key.pem"]:
        assert blocked(name)
    for name in ["README.md", "docs/architecture.md", "src/ff_watchlist/demo.py", ".env.example"]:
        assert not blocked(name)


def test_ai_coauthors_rejected_but_humans_allowed():
    blocked = load("check_commit_message").has_ai_coauthor
    assert blocked("Fix ranking\n\nCo-authored-by: Codex <codex@openai.com>")
    assert blocked("Fix ranking\n\nco-authored-by: Claude <noreply@anthropic.com>")
    assert not blocked("Fix ranking\n\nCo-authored-by: Jane Developer <jane@example.org>")
    assert not blocked("Document how Codex can run the tests")
