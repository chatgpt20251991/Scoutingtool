"""Verify unchanged handoff files before work begins (Python 3.10+)."""
from pathlib import Path
import hashlib
import json
import sys

ROOT = Path(__file__).resolve().parents[1]
manifest = json.loads((ROOT / "HANDOFF_MANIFEST.json").read_text(encoding="utf-8"))
errors = []
for item in manifest["files"]:
    relative = Path(item["path"])
    if relative.is_absolute() or ".." in relative.parts:
        errors.append("Unsafe manifest path")
        continue
    path = ROOT / relative
    if not path.is_file() or path.is_symlink():
        errors.append(f"Missing or unsafe: {relative}")
        continue
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != item["sha256"] or path.stat().st_size != item["bytes"]:
        errors.append(f"Changed: {relative}")
if errors:
    print("\n".join(errors))
    sys.exit(1)
print(f"OK: {len(manifest['files'])} handoff files match the manifest.")
print("This verifies package integrity, not remote transfer or product correctness.")
