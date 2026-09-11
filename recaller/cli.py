"""RECALLER — command line interface and server launcher.

  recaller serve [--host 127.0.0.1] [--port 4180] [--no-browser] [--reload]
  recaller test                         run the full test suite
"""

import argparse
from pathlib import Path
import sys
import threading
import time
import webbrowser

ROOT = Path(__file__).resolve().parent.parent


def run_tests() -> None:
    tests = ROOT / "tests"
    if not tests.is_dir():
        print("Tests are not bundled with this build; running the embedded sanity check.")
        from recaller.credit_engine.engine import calculate_emi

        assert calculate_emi(100000, 12, 36) > 0
        print("Credit engine sanity check passed.")
        sys.exit(0)
    try:
        import pytest
    except ImportError:
        import unittest

        suite = unittest.defaultTestLoader.discover(start_dir=str(tests), pattern="test_*.py", top_level_dir=str(ROOT))
        sys.exit(0 if unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful() else 1)
    sys.exit(pytest.main([str(tests), "-q"]))


def serve(host: str = "127.0.0.1", port: int = 4180, no_browser: bool = False, reload: bool = False) -> None:
    import uvicorn

    url = f"http://{host}:{port}/"
    print("\n  RECALLER Loan Officer Console")
    print("  AI agentic credit underwriter for thin-file green borrowers")
    print(f"  Console  {url}")
    print(f"  API docs {url}docs\n")

    if not no_browser:
        def open_browser() -> None:
            time.sleep(1.2)
            webbrowser.open(url)

        threading.Thread(target=open_browser, daemon=True).start()

    uvicorn.run("recaller.app.server:create_app", factory=True, host=host, port=port, reload=reload)


def main() -> None:
    parser = argparse.ArgumentParser(prog="recaller", description="RECALLER underwriting platform")
    sub = parser.add_subparsers(dest="command")
    s = sub.add_parser("serve", help="Start the console and API server")
    s.add_argument("--host", default="127.0.0.1")
    s.add_argument("--port", type=int, default=4180)
    s.add_argument("--no-browser", action="store_true")
    s.add_argument("--reload", action="store_true", help="Auto-reload on code changes (development)")
    sub.add_parser("test", help="Run the test suite")
    args = parser.parse_args()

    if args.command == "test":
        run_tests()
    else:
        serve(
            host=getattr(args, "host", "127.0.0.1"),
            port=getattr(args, "port", 4180),
            no_browser=getattr(args, "no_browser", False),
            reload=getattr(args, "reload", False),
        )


if __name__ == "__main__":
    main()
