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
    suite = None
    try:
        from tests import test_engine, test_pipeline, test_agent
        suite = unittest.TestSuite()
        suite.addTests(loader.loadTestsFromModule(test_engine))
        suite.addTests(loader.loadTestsFromModule(test_pipeline))
        suite.addTests(loader.loadTestsFromModule(test_agent))
    except Exception:
        test_dir = ROOT / "tests"
        if not test_dir.exists():
            test_dir = Path(__file__).resolve().parent.parent / "tests"
        if test_dir.exists():
            suite = loader.discover(start_dir=str(test_dir), pattern="test_*.py")
        else:
            print("Tests directory not found in standalone package. Running embedded health checks...")
            from recaller.credit_engine.engine import calculate_emi
            assert calculate_emi(10000000, 1200, 36) == 332143
            print("Embedded calculation sanity checks passed.")
            sys.exit(0)

    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)


def serve(host: str = "127.0.0.1", port: int = 4180, no_browser: bool = False, reload: bool = False):
    import uvicorn
    from recaller.app.server import app

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

    if reload:
        uvicorn.run("recaller.app.server:app", host=host, port=port, reload=True)
    else:
        uvicorn.run(app, host=host, port=port)


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
