"""RECALLER — command line interface and server launcher."""

import argparse
from pathlib import Path
import subprocess
import sys
import unittest
import webbrowser

ROOT = Path(__file__).resolve().parent.parent


def run_tests():
    print("\nRunning RECALLER engine test suite...")
    loader = unittest.TestLoader()
    suite = loader.discover(start_dir=str(ROOT / "tests"), pattern="test_*.py")
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)


def serve(host: str = "127.0.0.1", port: int = 4180, no_browser: bool = False, reload: bool = False):
    import uvicorn

    url = f"http://{host}:{port}/"
    print(f"\n  RECALLER Loan Officer Console")
    print(f"  AI agentic credit underwriter for thin-file green borrowers")
    print(f"  Server starting at: {url}\n")

    if not no_browser:
        import threading

        def open_browser():
            import time

            time.sleep(1.2)
            webbrowser.open(url)

        threading.Thread(target=open_browser, daemon=True).start()

    uvicorn.run("recaller.app.server:app", host=host, port=port, reload=reload)


def main():
    parser = argparse.ArgumentParser(description="RECALLER Underwriting Platform")
    subparsers = parser.add_subparsers(dest="command")

    # serve command
    serve_parser = subparsers.add_parser("serve", help="Start the RECALLER console & API server")
    serve_parser.add_argument("--host", default="127.0.0.1", help="Host address (default: 127.0.0.1)")
    serve_parser.add_argument("--port", type=int, default=4180, help="Port (default: 4180)")
    serve_parser.add_argument("--no-browser", action="store_true", help="Do not open browser automatically")
    serve_parser.add_argument("--reload", action="store_true", help="Enable auto-reload for development")

    # test command
    subparsers.add_parser("test", help="Run deterministic engine test suite")

    args = parser.parse_args()

    if args.command == "test":
        run_tests()
    elif args.command == "serve" or args.command is None:
        port = getattr(args, "port", 4180)
        host = getattr(args, "host", "127.0.0.1")
        no_browser = getattr(args, "no_browser", False)
        reload = getattr(args, "reload", False)
        serve(host=host, port=port, no_browser=no_browser, reload=reload)


if __name__ == "__main__":
    main()
