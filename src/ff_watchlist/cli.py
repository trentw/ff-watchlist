"""Local application entry point."""
import argparse
import uvicorn
from .watch_public import create_app


def main():
    parser = argparse.ArgumentParser(description="Run FF Watchlist locally")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8793)
    parser.add_argument("--demo", action="store_true", help="Synthetic offline data; no provider requests")
    args = parser.parse_args()
    if args.demo:
        from .demo import DemoSources, DemoMedia
        app = create_app(DemoSources(), DemoMedia())
    else:
        app = create_app()
    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
