"""Command-line entry point: export the data bundle or preview the built site."""
import argparse
import functools
import http.server
import sys
from pathlib import Path


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


def _serve(args):
    site = Path(args.site)
    if not (site / "index.html").is_file():
        print(f"{site} has no index.html; run `npm run build` first", file=sys.stderr)
        return 1
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(site))
    with http.server.ThreadingHTTPServer((args.host, args.port), handler) as server:
        print(f"serving {site} at http://{args.host}:{args.port}")
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
    return 0


def main():
    parser = argparse.ArgumentParser(description="FF Watchlist")
    commands = parser.add_subparsers(dest="command", required=True)

    export = commands.add_parser("export", help="Write the data bundle the browser app reads")
    export.add_argument("--out", default="web/dist/data")
    export.add_argument("--demo", action="store_true", help="Synthetic offline data; no provider requests")
    export.add_argument("--season", type=int)
    export.add_argument("--week", type=int)
    export.add_argument("--no-headshots", action="store_true", help="Tell the app not to load player photos")
    export.add_argument("--no-logos", action="store_true", help="Tell the app not to load team logos")

    serve = commands.add_parser("serve", help="Preview the built site locally")
    serve.add_argument("--site", default="web/dist")
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=8793)

    args = parser.parse_args()
    if args.command == "export":
        if (args.season is None) != (args.week is None):
            parser.error("--season and --week must be given together")
        return _export(args)
    return _serve(args)


if __name__ == "__main__":
    raise SystemExit(main())
