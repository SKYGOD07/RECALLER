# RECALLER Winget Package & Installation Guide

This directory contains the Windows Package Manager (`winget`) manifest definitions for RECALLER.

## Repository Structure

```
winget/
├── manifests/
│   └── s/
│       └── SKYGOD07/
│           └── RECALLER/
│               └── 1.0.0/
│                   ├── SKYGOD07.RECALLER.yaml              <- Version manifest
│                   ├── SKYGOD07.RECALLER.locale.en-US.yaml  <- Locale metadata manifest
│                   └── SKYGOD07.RECALLER.installer.yaml    <- Installer & SHA256 manifest
├── SKYGOD07.RECALLER.singleton.yaml                        <- Single manifest file for direct local install
└── README.md
```

## 1. Local Testing & Validation

### Validate Manifests
Run the Windows Package Manager manifest validator:
```powershell
winget validate winget\manifests\s\SKYGOD07\RECALLER\1.0.0\
```
Or validate the singleton manifest:
```powershell
winget validate winget\SKYGOD07.RECALLER.singleton.yaml
```

### Install Locally Using Manifest
You can test installing RECALLER directly on your Windows machine using winget:
```powershell
winget install --manifest winget\manifests\s\SKYGOD07\RECALLER\1.0.0\
```

Once installed, RECALLER is available in your PATH as `recaller`:
```powershell
# Start the Loan Officer Console
recaller serve

# Run the deterministic credit engine test suite
recaller test
```

## 2. Submitting to the Official Microsoft Winget Repository (`microsoft/winget-pkgs`)

1. **Fork and Clone** [microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs).
2. **Copy the manifest folder**:
   Copy `winget/manifests/s/SKYGOD07/RECALLER/1.0.0/` into `manifests/s/SKYGOD07/RECALLER/1.0.0/` in the `winget-pkgs` repository.
3. **Submit a Pull Request**:
   Create a PR with the title:
   `New package: SKYGOD07.RECALLER version 1.0.0`
4. Once merged, any Windows user can install RECALLER directly via:
   ```powershell
   winget install SKYGOD07.RECALLER
   ```
   or
   ```powershell
   winget install recaller
   ```

## 3. Building Standalone Binaries & Updating Hashes

To build a fresh release zip and calculate its SHA256 checksum:
```powershell
python scripts/build_standalone.py
```
This outputs:
- `dist/recaller/` (Standalone directory build)
- `dist/recaller-windows-x64.zip` (Release archive)
- `dist/recaller-windows-x64.zip.sha256` (Checksum)
