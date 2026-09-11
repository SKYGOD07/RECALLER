"""RECALLER — command line interface and server launcher.

  recaller serve [--host H] [--port P] [--no-browser] [--reload]   host/port default to RECALLER_HOST / RECALLER_PORT
  recaller check-llm                    send the configured model one prompt and print its reply
  recaller test                         run the full test suite
"""

import argparse
import json
from pathlib import Path
import sys
import threading
import time
from typing import Optional
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


def check_llm() -> None:
    import asyncio

    from recaller.ai.hermes import ProviderError, check_provider, provider_from_env, provider_status

    status = provider_status()
    print(json.dumps(status, indent=2))
    provider = provider_from_env()
    if provider is None:
        print("\n  No model is configured. Put the model settings in .env (see .env.example) and try again.")
        sys.exit(2)
    try:
        result = asyncio.run(check_provider(provider))
    except ProviderError as exc:
        print(f"\n  FAILED: {exc}")
        sys.exit(1)
    print(f"\n  {result['provider']} · {result['model']} answered in {result['latency_ms']} ms "
          f"({result['usage'].get('output_tokens', 0)} tokens out):\n\n  {result['reply']}\n")
    sys.exit(0 if result["ok"] else 1)


def serve(host: Optional[str] = None, port: Optional[int] = None, no_browser: bool = False, reload: bool = False) -> None:
    import uvicorn

    from recaller.config import get_settings

    settings = get_settings()
    host = host or settings.host
    port = port or settings.port
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
    s.add_argument("--host", default=None, help="default: RECALLER_HOST")
    s.add_argument("--port", type=int, default=None, help="default: RECALLER_PORT")
    s.add_argument("--no-browser", action="store_true")
    s.add_argument("--reload", action="store_true", help="Auto-reload on code changes (development)")
    sub.add_parser("test", help="Run the test suite")
    sub.add_parser("check-llm", help="Send the configured model one prompt and print its reply")
    args = parser.parse_args()

    if args.command == "test":
        run_tests()
    elif args.command == "check-llm":
        check_llm()
    else:
        serve(
            host=getattr(args, "host", None),
            port=getattr(args, "port", None),
            no_browser=getattr(args, "no_browser", False),
            reload=getattr(args, "reload", False),
        )


if __name__ == "__main__":
    main()
