"""Command-line entry point: serve the local app or export the static data bundle."""
import argparse
import sys
from pathlib import Path


def _serve(args):
    import uvicorn
    from .watch_public import create_app

    if args.demo:
        from .demo import DemoMedia, DemoSources
        app = create_app(DemoSources(), DemoMedia())
    else:
        app = create_app()
    uvicorn.run(app, host=args.host, port=args.port)


def _export(args):
    from .export import InvalidBundle, write_bundle
    from .watch_sources import PublicSources, SourceUnavailable

    if args.demo:
        from .demo import DemoSources
        sources = DemoSources()
    else:
        sources = PublicSources(refresh=True)
    try:
        manifest = write_bundle(sources, Path(args.out), season=args.season, week=args.week, demo=args.demo,
                                headshots=not args.no_headshots, logos=not args.no_logos)
    except (InvalidBundle, SourceUnavailable) as exc:
        print(f"export failed, existing bundle left in place: {exc}", file=sys.stderr)
        return 1
    print(f"wrote {args.out}: {manifest['season']} week {manifest['week']}")
    return 0


def main():
    parser = argparse.ArgumentParser(description="FF Watchlist")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8793)
    parser.add_argument("--demo", action="store_true", help="Synthetic offline data; no provider requests")
    commands = parser.add_subparsers(dest="command")
    export = commands.add_parser("export", help="Write the static data bundle for the browser app")
    export.add_argument("--out", default="web/dist/data")
    export.add_argument("--demo", action="store_true", help="Synthetic offline data; no provider requests")
    export.add_argument("--season", type=int)
    export.add_argument("--week", type=int)
    export.add_argument("--no-headshots", action="store_true", help="Tell the app not to load player photos")
    export.add_argument("--no-logos", action="store_true", help="Tell the app not to load team logos")
    args = parser.parse_args()
    if args.command == "export":
        if (args.season is None) != (args.week is None):
            parser.error("--season and --week must be given together")
        return _export(args)
    return _serve(args)


if __name__ == "__main__":
    raise SystemExit(main())
