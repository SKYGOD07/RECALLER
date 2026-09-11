"""Build standalone Windows executable with PyInstaller."""

import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent

def build_standalone():
    print("=== RECALLER Standalone Windows Builder ===")
    
    # 1. Build frontend console
    print("\n1. Building Frontend Console...")
    app_dir = ROOT / "app"
    if (app_dir / "package.json").exists():
        subprocess.run(["npm", "--prefix", "app", "run", "build"], cwd=str(ROOT), check=True, shell=True)
    
    # 2. Run PyInstaller
    print("\n2. Packaging with PyInstaller...")
    policy_dir = ROOT / "policy"
    app_dist = ROOT / "app" / "dist"
    
    cmd = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--onedir",
        "--name",
        "recaller",
        "--add-data",
        f"{policy_dir};policy",
        "--add-data",
        f"{app_dist};app/dist",
        "--paths",
        str(ROOT),
        str(ROOT / "recaller" / "cli.py"),
    ]
    print(f"Running command: {' '.join(cmd)}")
    subprocess.run(cmd, cwd=str(ROOT), check=True)
    
    print("\n=== Build Complete ===")
    dist_dir = ROOT / "dist" / "recaller"
    print(f"Output directory: {dist_dir}")
    if (dist_dir / "recaller.exe").exists():
        print(f"Executable created: {dist_dir / 'recaller.exe'}")

if __name__ == "__main__":
    build_standalone()
