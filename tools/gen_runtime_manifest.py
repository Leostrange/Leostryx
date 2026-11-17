#!/usr/bin/env python3
"""gen_runtime_manifest.py — refresh the sha256 table in runtime/manifest.json.

`assets/runtime/manifest.json` is the integrity table the Java RuntimeManager
checks before it starts the core: every listed file under `filesDir/runtime`
must hash to the value shipped in the APK. A single stale entry aborts startup:

    runtime integrity check failed: hash mismatch for seed/AGENTS.md
        (expected=<manifest> actual=<file>)

The table is *generated data*: it describes whatever is actually inside
`app/assets/runtime`, and the bypass variant adds its own patched
`bin/liblanguage_server.so` on top. Editing a runtime file without refreshing
the table is exactly what broke 3.1.12 (seed/AGENTS.md was rewritten on
2026-11-15, the table still carried the 2026-10-22 hash).

This tool recomputes the table from the real files:

  * standard — everything under app/assets/runtime;
  * bypass   — the same tree with variants/bypass/assets/runtime on top.

`generated_at` is refreshed only when at least one hash changed, so a build
with an unchanged runtime keeps a byte-identical manifest (reproducible APKs,
and the device does not re-extract a runtime that did not change).

Usage:
    python3 tools/gen_runtime_manifest.py              # update both variants
    python3 tools/gen_runtime_manifest.py standard     # only the base table
    python3 tools/gen_runtime_manifest.py bypass       # only the bypass table
    python3 tools/gen_runtime_manifest.py --check      # report only, exit 1 if stale
"""
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASE = ROOT / "app/assets/runtime"
BYPASS = ROOT / "variants/bypass/assets/runtime"
MANIFESTS = {
    "standard": BASE / "manifest.json",
    "bypass": BYPASS / "manifest.json",
}
# The table itself is not one of the files it covers.
SKIP = {"manifest.json"}


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def runtime_files(variant: str) -> dict:
    """rel path -> absolute path of every runtime file shipped for `variant`."""
    files = {}
    for p in BASE.rglob("*"):
        if p.is_file():
            rel = p.relative_to(BASE).as_posix()
            if rel not in SKIP:
                files[rel] = p
    if variant == "bypass":
        for p in BYPASS.rglob("*"):
            if p.is_file():
                rel = p.relative_to(BYPASS).as_posix()
                if rel not in SKIP:
                    files[rel] = p
    return files


def refresh(variant: str, write: bool = True) -> list:
    """Recompute one manifest. Returns list of (rel, old, new) for stale entries."""
    manifest_path = MANIFESTS[variant]
    data = json.loads(manifest_path.read_text(encoding="utf-8"))
    listed = data.get("files", {})
    files = runtime_files(variant)

    missing = sorted(rel for rel in listed if rel not in files)
    if missing:
        raise SystemExit(
            f"{manifest_path}: listed file(s) absent from the {variant} tree: "
            + ", ".join(missing)
        )

    stale = []
    for rel in sorted(files):
        digest = sha256_file(files[rel])
        old = listed.get(rel)          # None also covers files not yet listed
        if old != digest:
            stale.append((rel, old, digest))
            listed[rel] = digest

    # Nothing changed: leave the manifest byte-identical (stable manifest hash
    # means repeated builds produce the same APK and the device does not
    # re-extract a runtime that did not change).
    if not stale:
        return []

    data["files"] = dict(sorted(listed.items()))
    data["generated_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    data.setdefault("schema", 1)
    text = json.dumps(
        {"files": data["files"],
         "generated_at": data["generated_at"],
         "schema": data["schema"]},
        indent=2,
    ) + "\n"

    if write:
        tmp = manifest_path.with_suffix(".json.tmp")
        tmp.write_text(text, encoding="utf-8")
        tmp.replace(manifest_path)
        print(f"{variant}: {len(stale)} hash(es) refreshed -> {manifest_path.relative_to(ROOT)}")
    return stale


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    check_only = "--check" in sys.argv
    variants = args[0:] or ["standard", "bypass"]
    bad = []
    for variant in variants:
        if variant not in MANIFESTS:
            raise SystemExit(f"unknown variant {variant!r}: use standard or bypass")
        stale = refresh(variant, write=not check_only)
        for rel, old, new in stale:
            bad.append((variant, rel, old, new))
            print(f"  {variant}: {rel}\n    old={old}\n    new={new}")
    if check_only and bad:
        print("runtime manifest is stale — run: python3 tools/gen_runtime_manifest.py",
              file=sys.stderr)
        return 1
    if not bad:
        print("runtime manifest already matches the shipped files")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
