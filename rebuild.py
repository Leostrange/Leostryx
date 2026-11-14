#!/usr/bin/env python3
"""Сборка Antigravity-BP 3.1.2 (standard / bypass) из полного дерева.

Источники:
  app/                      — распакованное дерево standard-APK (без META-INF)
  variants/bypass/          — дельта bypass (manifest.json + liblanguage_server.so)
  compress-map.json         — файлы, которые в APK хранятся без сжатия
  dist/antigravity-signing.p12 — ключ подписи (SHA-256 7360d934… — совпадает
                              с установленным приложением, APK встаёт поверх)

Сборка (нужны Python 3, Java 17 и apksigner):
  python3 rebuild.py            # оба APK
  python3 rebuild.py standard
  python3 rebuild.py bypass
Результат: dist/signed/<name>.apk

Финализация (переименование в Leostryx-<version>-<name>.apk, mtime, SHA256SUMS,
копирование в каталог проекта) применяется ТОЛЬКО к вариантам, собранным в этом
запуске. Несобранный вариант остаётся нетронутым: иначе старый бинарник получил бы
свежий mtime и строку в контрольных суммах, то есть выглядел бы актуальным.
"""
import json
import os
import shutil
import struct
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "tools"))
import brand  # noqa: E402  (Leostryx icon pack + display name overlay)
APP = ROOT / "app"
MAP = json.loads((ROOT / "compress-map.json").read_text(encoding="utf-8"))
BYPASS = {
    "assets/runtime/manifest.json": ROOT / "variants/bypass/assets/runtime/manifest.json",
    "assets/runtime/bin/liblanguage_server.so": ROOT / "variants/bypass/assets/runtime/bin/liblanguage_server.so",
}
KEYSTORE = ROOT / "dist/antigravity-signing.p12"


def which_exe(name):
    p = shutil.which(name)
    if p:
        return p
    prefix = os.environ.get("PREFIX", "/data/user/0/com.agyru.t2/files/usr")
    cand = Path(prefix) / "bin" / name
    return str(cand) if cand.exists() else name


def collect(overlay):
    files = {}
    for dirpath, _, names in os.walk(APP):
        for name in names:
            full = Path(dirpath) / name
            rel = full.relative_to(APP).as_posix()
            files[rel] = full
    for rel, src in overlay.items():
        files[rel] = src          # дельта bypass заменяет файлы из app/
    return files


def pack(out, overlay):
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.exists():
        out.unlink()
    files = collect(overlay)
    with zipfile.ZipFile(out, "w") as archive:
        for rel in sorted(files):
            info = zipfile.ZipInfo(rel)
            info.compress_type = MAP.get(rel, zipfile.ZIP_DEFLATED)
            info.date_time = (2026, 10, 16, 0, 0, 0)
            with open(files[rel], "rb") as src, archive.open(info, "w") as dst:
                shutil.copyfileobj(src, dst, 1024 * 1024)
    print("packed", out, out.stat().st_size)


def zipalign4(path):
    """Аналог `zipalign -f 4`: данные STORED-записей выравниваются по 4 байта.

    В extra локального заголовка добавляется валидная пустая запись (id+size=0
    байт) плюс 0..3 байта добивки — так данные начинаются по границе 4."""
    tmp = path.with_suffix(".aligned.tmp")
    zin = zipfile.ZipFile(path)
    with zipfile.ZipFile(tmp, "w") as zout:
        offset = 0
        for info in zin.infolist():
            data = zin.read(info.filename)
            new = zipfile.ZipInfo(info.filename, date_time=info.date_time)
            new.compress_type = info.compress_type
            new.external_attr = info.external_attr
            if info.compress_type == zipfile.ZIP_STORED:
                name_len = len(info.filename.encode("utf-8"))
                need = (-(offset + 30 + name_len)) % 4
                if need:
                    new.extra = struct.pack("<HH", 0x0001, 0) + b"\0" * need
            zout.writestr(new, data)
            offset += 30 + len(info.filename.encode("utf-8")) + len(new.extra) + new.compress_size
    zin.close()
    tmp.replace(path)
    # проверка выравнивания
    z = zipfile.ZipFile(path)
    base = 0
    bad = []
    for info in z.infolist():
        hdr = 30 + len(info.filename.encode("utf-8")) + len(info.extra)
        if info.compress_type == zipfile.ZIP_STORED and (base + hdr) % 4:
            bad.append(info.filename)
        base += hdr + info.compress_size
    z.close()
    if bad:
        raise SystemExit("zipalign: не выровнены: " + ", ".join(bad[:5]))
    print("zipalign4 ok:", path.name)


def sign(unsigned):
    signed_dir = ROOT / "dist/signed"
    signed_dir.mkdir(parents=True, exist_ok=True)
    out = signed_dir / (unsigned.stem.replace("-unsigned", "") + ".apk")
    if out.exists():
        out.unlink()

    # Prefer standalone apksigner binary; fall back to bundled uber-apk-signer.jar
    apksigner_bin = shutil.which("apksigner")
    uber_jar = ROOT / "tools/uber-apk-signer.jar"
    java_bin = which_exe("java")

    if apksigner_bin:
        subprocess.check_call([
            apksigner_bin, "sign",
            "--ks", str(KEYSTORE), "--ks-key-alias", "antigravity",
            "--ks-pass", "pass:android", "--key-pass", "pass:android",
            "--out", str(out), str(unsigned),
        ])
        subprocess.check_call([apksigner_bin, "verify", str(out)])
    elif uber_jar.exists():
        subprocess.check_call([
            java_bin, "-jar", str(uber_jar),
            "--apks", str(unsigned),
            "--ks", str(KEYSTORE), "--ksAlias", "antigravity",
            "--ksPass", "android", "--ksKeyPass", "android",
            "--out", str(signed_dir),
            "--skipZipAlign",
        ])
        # uber-apk-signer outputs <base>-aligned-signed.apk or <base>-signed.apk
        base_name = unsigned.stem.replace("-unsigned", "")
        candidates = list(signed_dir.glob(base_name + "*signed*.apk"))
        if candidates:
            candidates[0].replace(out)
    else:
        raise SystemExit(
            "Neither apksigner nor tools/uber-apk-signer.jar found. "
            "Install OpenJDK: pkg install openjdk-17"
        )
    print("signed", out)


def main():
    which = sys.argv[1] if len(sys.argv) > 1 else "both"
    jobs = []
    if which in ("standard", "both"):
        jobs.append(("standard", {}))
    if which in ("bypass", "both"):
        jobs.append(("bypass", BYPASS))
    if not jobs:
        print("usage: python3 rebuild.py [standard|bypass|both]")
        return 2
    # Leostryx branding: icon pack + display name, driven by
    # app/assets/web/brand/config.json. Sits on top of the variant delta so a
    # bypass build is branded the same way as standard.
    brand_cfg = brand.load_brand(ROOT)
    if brand_cfg:
        print("brand: pack=%s name=%s color=%s"
              % (brand_cfg["pack"], brand_cfg["name"], brand_cfg["color"]))
    else:
        print("brand: no valid app/assets/web/brand/config.json — building unbranded")

    for name, overlay in jobs:
        merged = dict(overlay)
        if brand_cfg:
            merged.update(brand.build_overlay(ROOT, brand_cfg, ROOT / "dist" / ".brand"))
        unsigned = ROOT / "dist" / f"{name}-unsigned.apk"
        pack(unsigned, merged)
        zipalign4(unsigned)
        sign(unsigned)

    # Finalize release 3.1.2 artifacts
    version = "3.1.2"
    signed_dir = ROOT / "dist/signed"
    parent_dir = ROOT.parent
    built = [name for name, _ in jobs]

    # 1. Versioned APKs with fresh mtime. Only the variants built in this run
    # are refreshed: touching an unbuilt one would give a stale binary a fresh
    # mtime and a matching checksum entry, so it looks valid when it is not.
    for kind in built:
        src_apk = signed_dir / f"{kind}.apk"
        src_idsig = signed_dir / f"{kind}.apk.idsig"
        target_apk = signed_dir / f"Leostryx-{version}-{kind}.apk"
        target_idsig = signed_dir / f"Leostryx-{version}-{kind}.apk.idsig"
        if src_apk.exists():
            if target_apk.exists():
                target_apk.unlink()
            shutil.copy2(src_apk, target_apk)
            os.utime(target_apk, None)
        if src_idsig.exists():
            if target_idsig.exists():
                target_idsig.unlink()
            shutil.copy2(src_idsig, target_idsig)
            os.utime(target_idsig, None)

    # 2. Re-pack source code zip (fast, exclude .git and dist to avoid hangs)
    zip_path = signed_dir / "Leostryx-repo.zip"
    if zip_path.exists():
        zip_path.unlink()
    print("packing source archive Leostryx-repo.zip...")
    sys.stdout.flush()
    exclude_dirs = {".git", "dist", ".brand", "__pycache__", ".idea", ".vscode"}
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=1) as zf:
        for dirpath, dirnames, filenames in os.walk(ROOT):
            dirnames[:] = [d for d in dirnames if d not in exclude_dirs]
            for f in filenames:
                if f.endswith((".pyc", ".tmp", ".log")) or (f.startswith(".") and f != ".gitignore"):
                    continue
                full = Path(dirpath) / f
                rel = full.relative_to(ROOT).as_posix()
                zf.write(full, rel)
    os.utime(zip_path, None)
    print("source archive created:", zip_path.stat().st_size)
    sys.stdout.flush()

    # Checksums cover every variant that is present, so building one variant
    # never drops the other one from the published list.
    sums_path = signed_dir / f"SHA256SUMS-{version}.txt"
    sums_plain = signed_dir / "SHA256SUMS.txt"
    present = [f"Leostryx-{version}-{k}.apk" for k in ("standard", "bypass")
               if (signed_dir / f"Leostryx-{version}-{k}.apk").exists()]
    with open(sums_path, "w", encoding="utf-8") as sf:
        subprocess.check_call(
            ["sha256sum"] + present + ["Leostryx-repo.zip"],
            cwd=str(signed_dir), stdout=sf)
    shutil.copy2(sums_path, sums_plain)
    os.utime(sums_path, None)
    os.utime(sums_plain, None)

    # 4. Sync to parent project directory and cleanup old stale files
    for old in ("bypass.apk", "standard.apk", "standard-unsigned.apk", "bypass-unsigned.apk"):
        p = parent_dir / old
        if p.exists():
            p.unlink()

    artifacts = []
    for kind in built:
        artifacts.append(f"Leostryx-{version}-{kind}.apk")
        artifacts.append(f"Leostryx-{version}-{kind}.apk.idsig")
    for item in artifacts + [
        "Leostryx-repo.zip",
        f"SHA256SUMS-{version}.txt",
        "SHA256SUMS.txt"
    ]:
        src = signed_dir / item
        if src.exists():
            dest = parent_dir / item
            if dest.exists():
                dest.unlink()
            shutil.copy2(src, dest)
            os.utime(dest, None)

    for doc in ("CHANGELOG.md", "README.md"):
        src = ROOT / doc
        if src.exists():
            dest = parent_dir / doc
            if dest.exists():
                dest.unlink()
            shutil.copy2(src, dest)
            os.utime(dest, None)

    # Remove intermediate unsigned files
    for uns in ROOT.glob("dist/*-unsigned.apk"):
        uns.unlink()

    print("ready in", ROOT / "dist/signed", "and synced to", parent_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
