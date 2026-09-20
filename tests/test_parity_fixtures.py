"""The committed browser-parity cases must match the Python core's output."""
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _generator():
    spec = importlib.util.spec_from_file_location("make_parity_fixtures", ROOT / "scripts" / "make_parity_fixtures.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_committed_cases_are_current():
    for path, expected in _generator().build().items():
        assert path.read_text(encoding="utf-8") == expected, "run: uv run python scripts/make_parity_fixtures.py"
