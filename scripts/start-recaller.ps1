<#
  RECALLER - Windows launcher.

  Builds the loan officer console if needed, serves it on a local port, and
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
  [switch]$Dev,
  [switch]$NoBrowser,
  [switch]$Rebuild
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$App = Join-Path $Root 'app'

function Write-Step($text) { Write-Host "  $text" -ForegroundColor Gray }
function Write-Good($text) { Write-Host "  [ok] $text" -ForegroundColor Green }
function Write-Bad($text)  { Write-Host "  [!] $text" -ForegroundColor Red }

Write-Host ''
Write-Host '  RECALLER' -ForegroundColor Green -NoNewline
Write-Host '  Loan Officer Console' -ForegroundColor White
Write-Host '  AI agentic credit underwriter for thin-file green borrowers' -ForegroundColor DarkGray
Write-Host ''

# ---- dependency checks -------------------------------------------------
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Bad 'Node.js was not found on this machine.'
  Write-Host ''
  Write-Host '  RECALLER needs Node.js 20 or newer. Install it from:' -ForegroundColor White
  Write-Host '    https://nodejs.org/en/download' -ForegroundColor Cyan
  Write-Host ''
  Write-Host '  Then close this window, open a new one, and run this again.' -ForegroundColor White
  Write-Host '  (A new window is needed so Windows picks up the updated PATH.)' -ForegroundColor DarkGray
  Write-Host ''
  exit 1
}

$nodeVersion = (& node --version).TrimStart('v')
$nodeMajor = [int]($nodeVersion -split '\.')[0]
if ($nodeMajor -lt 20) {
  Write-Bad "Node.js $nodeVersion is too old. RECALLER needs 20 or newer."
  Write-Host '  Update from https://nodejs.org/en/download and run this again.' -ForegroundColor White
  Write-Host ''
  exit 1
}
Write-Good "Node.js $nodeVersion"

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Bad 'npm was not found, although Node.js is installed.'
  Write-Host '  Reinstall Node.js from https://nodejs.org/en/download - npm ships with it.' -ForegroundColor White
  Write-Host ''
  exit 1
}

if (-not (Test-Path $App)) {
  Write-Bad "The app folder is missing (expected at $App)."
  Write-Host '  This copy of RECALLER looks incomplete. Re-extract the download and try again.' -ForegroundColor White
  Write-Host ''
  exit 1
}

# ---- port availability -------------------------------------------------
$inUse = $null
try { $inUse = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop } catch { $inUse = $null }
if ($inUse) {
  Write-Bad "Port $Port is already in use."
  Write-Host '  Something else is listening there, possibly RECALLER already running.' -ForegroundColor White
  Write-Host "  Open http://127.0.0.1:$Port/ to check, or start on another port:" -ForegroundColor White
  Write-Host '    powershell -ExecutionPolicy Bypass -File scripts\start-recaller.ps1 -Port 4200' -ForegroundColor Cyan
  Write-Host ''
  exit 1
}

# ---- dependencies ------------------------------------------------------
if (-not (Test-Path (Join-Path $App 'node_modules'))) {
  Write-Step 'Installing dependencies (first run only, this takes a minute)...'
  Push-Location $App
  try {
    & npm install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "npm install failed with exit code $LASTEXITCODE" }
  } finally { Pop-Location }
  Write-Good 'Dependencies installed'
} else {
  Write-Good 'Dependencies present'
}

# ---- self-check --------------------------------------------------------
# An unverified credit engine must never reach a loan officer, so a failing
# self-check stops the launch rather than warning and continuing.
Write-Step 'Verifying the credit engine...'
& node (Join-Path $Root 'scripts\test-engine.mjs') | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Bad 'The credit engine self-check failed. RECALLER will not start.'
  Write-Host '  Run this to see what failed:' -ForegroundColor White
  Write-Host '    node scripts\test-engine.mjs' -ForegroundColor Cyan
  Write-Host ''
  exit 1
}
Write-Good 'Credit engine verified (91 checks)'

# ---- build -------------------------------------------------------------
Push-Location $App
try {
  if (-not $Dev) {
    $dist = Join-Path $App 'dist'
    if ($Rebuild -or -not (Test-Path (Join-Path $dist 'index.html'))) {
      Write-Step 'Building the console...'
      & npm run build | Out-Null
      if ($LASTEXITCODE -ne 0) {
        Write-Bad "Build failed with exit code $LASTEXITCODE."
        Write-Host '  Run this to see what failed:' -ForegroundColor White
        Write-Host '    npm --prefix app run build' -ForegroundColor Cyan
        Write-Host ''
        exit 1
      }
      Write-Good 'Console built'
    } else {
      Write-Good 'Console build present (pass -Rebuild to force a fresh build)'
    }
  }

  # ---- launch ----------------------------------------------------------
  $url = "http://127.0.0.1:$Port/"
  if (-not $NoBrowser) {
    Start-Job -ScriptBlock {
      param($u)
      Start-Sleep -Seconds 3
      Start-Process $u
    } -ArgumentList $url | Out-Null
  }

  Write-Host ''
  Write-Host "  Console  $url" -ForegroundColor Green
  Write-Host '  Press Ctrl+C to stop.' -ForegroundColor DarkGray
  Write-Host ''

  if ($Dev) {
    & npm run dev -- --port $Port
  } else {
    & npm run preview -- --port $Port --host 127.0.0.1
  }
} finally {
  Pop-Location
}
