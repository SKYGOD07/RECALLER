"""Build standalone Windows executable and winget distribution with PyInstaller."""

import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent


def sha256_file(filepath: Path) -> str:
    h = hashlib.sha256()
    with open(filepath, "rb") as f:
        while chunk := f.read(8192):
            h.update(chunk)
    return h.hexdigest()


def build_standalone():
    print("=== RECALLER Standalone Windows Builder ===")

    # 1. Build frontend console
    print("\n1. Building Frontend Console...")
    app_dir = ROOT / "app"
    if (app_dir / "package.json").exists():
        subprocess.run(["npm", "--prefix", "app", "run", "build"], cwd=str(ROOT), check=True, shell=True)

    # 2. Run PyInstaller
    print("\n2. Packaging with PyInstaller (Directory build)...")
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
        "--collect-all",
        "uvicorn",
        "--collect-all",
        "fastapi",
        "--collect-all",
        "pydantic",
        "--collect-all",
        "starlette",
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

    dist_dir = ROOT / "dist" / "recaller"
    exe_path = dist_dir / "recaller.exe"
    print(f"\nDirectory build complete: {exe_path}")

    # 3. Create zip archive for distribution
    zip_path = ROOT / "dist" / "recaller-windows-x64.zip"
    print(f"\n3. Creating release archive {zip_path.name}...")
    if zip_path.exists():
        zip_path.unlink()
    shutil.make_archive(str(ROOT / "dist" / "recaller-windows-x64"), "zip", root_dir=str(ROOT / "dist"), base_dir="recaller")

    if zip_path.exists():
        hash_val = sha256_file(zip_path)
        print(f"Archive SHA256: {hash_val}")
        hash_file = ROOT / "dist" / "recaller-windows-x64.zip.sha256"
        hash_file.write_text(hash_val, encoding="utf-8")

    print("\n=== Build Complete ===")


if __name__ == "__main__":
    build_standalone()
