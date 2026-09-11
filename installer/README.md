# Packaging RECALLER for another Windows PC

The console is a static build plus a local server. Nothing in it depends on the
machine it was built on: paths are resolved relative to the launcher, and there
is no machine-specific configuration to edit.

## What to ship

```
RECALLER/
├── Start RECALLER.cmd      <- the user double-clicks this
├── scripts/
│   ├── start-recaller.ps1
│   ├── test-engine.mjs
│   └── verify-pipeline.mjs
├── app/                    (without node_modules or dist)
├── packages/
├── policy/
├── data/
├── docs/
└── package.json
```

Leave `n8n-master/` and every `node_modules/` out — the launcher installs
dependencies on first run.

```powershell
# From the repository root
$exclude = @('node_modules', 'dist', '.git', 'n8n-master', 'frontend')
$staging = Join-Path $env:TEMP 'RECALLER-dist'
Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue
robocopy . $staging /E /XD $exclude | Out-Null
Compress-Archive -Path "$staging\*" -DestinationPath RECALLER.zip -Force
```

## What the user does

1. Extract the zip anywhere — Desktop, Documents, a USB drive.
2. Double-click **Start RECALLER.cmd**.
3. The console opens in their browser at `http://127.0.0.1:4180/`.

First run takes about a minute while dependencies install and the console
builds. Subsequent runs start in seconds.

## What the launcher checks, and what it says when it fails

| Condition | Behaviour |
|---|---|
| Node.js missing | Names the download URL and explains that a new terminal window is needed for the PATH to update |
| Node.js older than 20 | Reports the version found and the version required |
| npm missing | Points at reinstalling Node.js, which ships npm |
| `app/` missing | Says the copy is incomplete and to re-extract |
| Port in use | Names the port, suggests checking whether RECALLER is already running, and shows the `-Port` flag |
| Engine self-check fails | **Refuses to start** and gives the command to see what failed |
| Build fails | Reports the exit code and gives the command to see what failed |

The self-check runs `scripts/test-engine.mjs` — 91 assertions pinning the
money arithmetic, the policy precedence rules, the audit chain and the what-if
solver's exactness. An unverified credit engine must never reach a loan
officer, so a failure stops the launch rather than warning and continuing.

## Options

```powershell
powershell -ExecutionPolicy Bypass -File scripts\start-recaller.ps1 -Port 4200
powershell -ExecutionPolicy Bypass -File scripts\start-recaller.ps1 -Dev
powershell -ExecutionPolicy Bypass -File scripts\start-recaller.ps1 -Rebuild
powershell -ExecutionPolicy Bypass -File scripts\start-recaller.ps1 -NoBrowser
```

## A note for anyone editing the launcher

`start-recaller.ps1` is deliberately plain ASCII. Windows PowerShell 5.1 reads a
`.ps1` without a byte-order mark as ANSI, which turns a UTF-8 em dash into a
curly closing quotation mark — and PowerShell treats that as a string
delimiter. A single stray dash breaks the entire script with a parse error
pointing somewhere else entirely. Keep it ASCII, or save with a BOM.
