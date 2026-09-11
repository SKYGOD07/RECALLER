<#
  RECALLER - Windows launcher.

  Checks Python 3.10+, dependencies, verifies the deterministic credit engine,
  builds the loan officer console if needed, serves it on a local port, and
  opens a browser. Everything is resolved relative to this script, so the
  repository can live anywhere on the machine - there are no absolute paths and
  no developer-specific configuration.

    powershell -ExecutionPolicy Bypass -File scripts\start-recaller.ps1
    powershell -ExecutionPolicy Bypass -File scripts\start-recaller.ps1 -Dev
    powershell -ExecutionPolicy Bypass -File scripts\start-recaller.ps1 -Port 4200 -NoBrowser

  NOTE: this file is deliberately plain ASCII. Windows PowerShell 5.1 reads a
  .ps1 without a byte-order mark as ANSI, which turns a UTF-8 em dash into a
  curly closing quote - and PowerShell treats that as a string delimiter, so a
  stray dash several lines up breaks the whole script. Keep it ASCII.
#>

[CmdletBinding()]
param(
  [int]$Port = 4180,
  [string]$HostAddress = "127.0.0.1",
  [switch]$Dev,
  [switch]$NoBrowser,
  [switch]$Rebuild
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$App = Join-Path $Root 'app'
$Dist = Join-Path $App 'dist'

function Write-Step($text) { Write-Host "  $text" -ForegroundColor Gray }
function Write-Good($text) { Write-Host "  [ok] $text" -ForegroundColor Green }
function Write-Bad($text)  { Write-Host "  [!] $text" -ForegroundColor Red }

Write-Host ''
Write-Host '  RECALLER' -ForegroundColor Green -NoNewline
Write-Host '  Loan Officer Console' -ForegroundColor White
Write-Host '  AI agentic credit underwriter for thin-file green borrowers' -ForegroundColor DarkGray
Write-Host ''

# ---- Python dependency checks -------------------------------------------
$PythonCmd = $null
if (Get-Command python -ErrorAction SilentlyContinue) {
  $PythonCmd = "python"
} elseif (Get-Command py -ErrorAction SilentlyContinue) {
  $PythonCmd = "py"
}

if (-not $PythonCmd) {
  Write-Bad 'Python was not found on this machine.'
  Write-Host ''
  Write-Host '  RECALLER needs Python 3.10 or newer. Install it from:' -ForegroundColor White
  Write-Host '    https://www.python.org/downloads/' -ForegroundColor Cyan
  Write-Host '  (Make sure to check "Add Python to PATH" during installation)' -ForegroundColor DarkGray
  Write-Host ''
  Write-Host '  Then close this window, open a new one, and run this again.' -ForegroundColor White
  Write-Host ''
  exit 1
}

$pyVerOutput = & $PythonCmd -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}')" 2>&1
$pyMajor = [int]($pyVerOutput -split '\.')[0]
$pyMinor = [int]($pyVerOutput -split '\.')[1]

if ($pyMajor -lt 3 -or ($pyMajor -eq 3 -and $pyMinor -lt 10)) {
  Write-Bad "Python $pyVerOutput is too old. RECALLER needs Python 3.10 or newer."
  Write-Host '  Update from https://www.python.org/downloads/ and run this again.' -ForegroundColor White
  Write-Host ''
  exit 1
}
Write-Good "Python $pyVerOutput ($PythonCmd)"

# ---- Project virtual environment ----------------------------------------
# RECALLER runs from its own .venv, so it never touches - or gets blocked by -
# a system-managed Python (PEP 668). The first run creates it and installs the
# package with its dependencies; later runs only check.
$Venv = Join-Path $Root '.venv'
$VenvPy = Join-Path $Venv 'Scripts\python.exe'
if (-not (Test-Path $VenvPy)) {
  Write-Step 'Creating the project virtual environment (.venv)...'
  & $PythonCmd -m venv $Venv
  if ($LASTEXITCODE -ne 0) {
    Write-Bad 'Could not create the .venv virtual environment.'
    exit 1
  }
}
$reqCheck = & $VenvPy -c "import fastapi, uvicorn, pydantic, pymupdf, multipart, anthropic, instructor, pytest; print('OK')" 2>&1
if ($reqCheck -ne 'OK') {
  Write-Step 'Installing RECALLER and its dependencies into .venv (first run only)...'
  & $VenvPy -m pip install --upgrade pip | Out-Null
  & $VenvPy -m pip install -e "$Root[dev]"
  if ($LASTEXITCODE -ne 0) {
    Write-Bad 'Dependency installation failed. The pip output above says why.'
    exit 1
  }
  Write-Good 'Dependencies installed into .venv'
} else {
  Write-Good 'Dependencies present in .venv (FastAPI, PyMuPDF, Anthropic, Instructor)'
}
$PythonCmd = $VenvPy

# ---- Self-check / Test suite --------------------------------------------
# An unverified credit engine must never reach a loan officer, so a failing
# self-check stops the launch rather than warning and continuing.
Write-Step 'Verifying the deterministic credit engine...'
$env:PYTHONPATH = $Root
& $PythonCmd -m pytest -q (Join-Path $Root 'tests') | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Bad 'The credit engine self-check failed. RECALLER will not start.'
  Write-Host '  Run this to inspect the failure:' -ForegroundColor White
  Write-Host '    python -m unittest discover -s tests -p "test_*.py"' -ForegroundColor Cyan
  Write-Host ''
  exit 1
}
Write-Good 'Credit engine verified (100% assertions & audit chain pass)'

# ---- Port availability --------------------------------------------------
$inUse = $null
try { $inUse = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop } catch { $inUse = $null }
if ($inUse) {
  Write-Bad "Port $Port is already in use."
  Write-Host '  Something else is listening there, possibly RECALLER already running.' -ForegroundColor White
  Write-Host "  Open http://$HostAddress`:$Port/ to check, or start on another port:" -ForegroundColor White
  Write-Host "    powershell -ExecutionPolicy Bypass -File scripts\start-recaller.ps1 -Port 4200" -ForegroundColor Cyan
  Write-Host ''
  exit 1
}

# ---- Console build check ------------------------------------------------
if (-not (Test-Path (Join-Path $Dist 'index.html')) -or $Rebuild) {
  if (Get-Command npm -ErrorAction SilentlyContinue) {
    Write-Step 'Building the loan officer frontend console...'
    Push-Location $App
    try {
      if (-not (Test-Path (Join-Path $App 'node_modules'))) {
        Write-Step 'Installing npm dependencies...'
        & npm install --no-audit --no-fund | Out-Null
      }
      & npm run build | Out-Null
      if ($LASTEXITCODE -ne 0) {
        Write-Bad "Build failed with exit code $LASTEXITCODE."
        exit 1
      }
      Write-Good 'Console built'
    } finally {
      Pop-Location
    }
  } else {
    if (-not (Test-Path (Join-Path $Dist 'index.html'))) {
      Write-Bad 'Frontend console build missing and npm is not installed to compile it.'
      Write-Host '  Please ensure app/dist is present or install Node.js.' -ForegroundColor White
      exit 1
    }
  }
} else {
  Write-Good 'Console build present'
}

# ---- Launch server ------------------------------------------------------
$url = "http://$HostAddress`:$Port/"
Write-Host ''
Write-Host "  Console  $url" -ForegroundColor Green
Write-Host '  Press Ctrl+C to stop.' -ForegroundColor DarkGray
Write-Host ''

$cliArgs = @("-m", "recaller.cli", "serve", "--host", $HostAddress, "--port", "$Port")
if ($NoBrowser) {
  $cliArgs += "--no-browser"
}
if ($Dev) {
  $cliArgs += "--reload"
}

& $PythonCmd $cliArgs
