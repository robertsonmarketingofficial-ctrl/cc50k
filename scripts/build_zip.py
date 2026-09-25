"""Package the system into dist/cc50k-email-system.zip (run from the repo root)."""
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INCLUDE = ["README.md", "coldflow.example.toml", "coldflow", "campaigns", "templates", "playbook", "scripts", "tests", "extras", "detective"]
SKIP = {"__pycache__", ".pyc"}

out = ROOT / "dist" / "cc50k-email-system.zip"
out.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
    for item in INCLUDE:
        path = ROOT / item
        files = [path] if path.is_file() else sorted(p for p in path.rglob("*") if p.is_file())
        for f in files:
            if any(part in SKIP for part in f.parts) or f.suffix in SKIP:
                continue
            zf.write(f, Path("cc50k") / f.relative_to(ROOT))
print(f"Wrote {out} ({out.stat().st_size / 1024:.0f} KB)")
