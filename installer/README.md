# Packaging RECALLER for Windows & Winget Distribution

The RECALLER Loan Officer Console is a high-performance Python application backed by FastAPI, deterministic underwriting engines, and a compiled static frontend console.

## Packaging Options

### Option 1: Standalone Distribution (PyInstaller)

To build a standalone portable executable package that includes Python runtime, FastAPI server, and the compiled console:

```powershell
python scripts/build_standalone.py
```

This creates:
- `dist/recaller/` — Standalone portable folder with `recaller.exe`.
- `dist/recaller-windows-x64.zip` — Compressed release archive.

The user can extract `dist/recaller-windows-x64.zip` and run `recaller.exe` without installing Python or Node.js.

### Option 2: Windows Package Manager (`winget`)

Manifests are provided in `winget/manifests/s/SKYGOD07/RECALLER/1.0.0/`:

```powershell
# Local validation
winget validate winget\manifests\s\SKYGOD07\RECALLER\1.0.0\

# Install via winget
winget install SKYGOD07.RECALLER
```

### Option 3: Source Distribution (Developer Mode)

```
RECALLER/
├── Start RECALLER.cmd      <- Double-click launcher
├── scripts/
│   ├── start-recaller.ps1
│   └── build_standalone.py
├── recaller/               <- Ported Python core & server
├── app/                    <- Frontend console
├── policy/
├── packages/
├── tests/
└── pyproject.toml
```

## What the Launcher Checks

| Condition | Behaviour |
|---|---|
| Python missing | Instructs user to install Python 3.10+ from python.org with PATH enabled |
| Python older than 3.10 | Reports version found and required version (>= 3.10) |
| Python packages missing | Automatically installs `fastapi`, `uvicorn`, and `pydantic` via pip |
| Engine self-check fails | **Refuses to start** and shows test results |
| Console build missing | Compiles frontend if Node/npm is present |
| Port in use | Names port and shows `-Port` override flag |
| Launch | Starts server on `http://127.0.0.1:4180/` and opens the default browser |

## Command-Line Usage

```powershell
# Run with Python CLI
python -m recaller.cli serve --port 4180
python -m recaller.cli test

# Run with PowerShell Launcher
powershell -ExecutionPolicy Bypass -File scripts\start-recaller.ps1 -Port 4200
powershell -ExecutionPolicy Bypass -File scripts\start-recaller.ps1 -Dev
powershell -ExecutionPolicy Bypass -File scripts\start-recaller.ps1 -NoBrowser
```
