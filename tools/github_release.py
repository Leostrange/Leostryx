#!/usr/bin/env python3
"""Publish a release to GitHub with APK assets and changelog notes.

Usage:
  python3 tools/github_release.py 3.1.13
"""

import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST_SIGNED = ROOT / "dist" / "signed"
CHANGELOG_PATH = ROOT / "CHANGELOG.md"


def get_token():
    token = os.environ.get("GH_TOKEN")
    if token:
        return token
    # Try reading from git config remote.origin.url
    try:
        url = subprocess.check_output(
            ["git", "config", "remote.origin.url"], cwd=ROOT, text=True
        ).strip()
        m = re.search(r"github_pat_[a-zA-Z0-9_]+", url)
        if m:
            return m.group(0)
    except Exception:
        pass
    sys.exit("Error: Could not find GitHub token in GH_TOKEN or git config remote.origin.url")


def extract_changelog(version):
    text = CHANGELOG_PATH.read_text(encoding="utf-8")
    # Match ## v{version} up to next ## v
    pattern = rf"(## v{re.escape(version)}[^\n]*\n.*?\n)(?=## v|\Z)"
    m = re.search(pattern, text, re.DOTALL)
    if not m:
        sys.exit(f"Error: Could not find section for ## v{version} in {CHANGELOG_PATH}")
    return m.group(1).strip()


def run_curl(args):
    cmd = ["curl", "-sS"] + args
    res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if res.returncode != 0:
        sys.exit(f"curl failed: {res.stderr}")
    return res.stdout


def main():
    if len(sys.argv) < 2:
        version = "3.1.15"
    else:
        version = sys.argv[1].lstrip("v")

    tag = f"v{version}"
    token = get_token()
    headers = [
        "-H", f"Authorization: token {token}",
        "-H", "Accept: application/vnd.github.v3+json",
    ]
    repo = "Leostrange/Leostryx"

    print(f"Preparing GitHub release for {tag} ({repo})...")
    body = extract_changelog(version)
    title = f"Leostryx {version} — автоопределение данных моделей, круг контекста в чате, фикс отправки standard"

    # Check if release exists
    check_url = f"https://api.github.com/repos/{repo}/releases/tags/{tag}"
    out = run_curl(headers + [check_url])
    data = json.loads(out)

    if "id" in data:
        release_id = data["id"]
        upload_url = data["upload_url"].split("{")[0]
        html_url = data.get("html_url", "")
        print(f"Release {tag} already exists (id={release_id}): {html_url}")
        update_url = f"https://api.github.com/repos/{repo}/releases/{release_id}"
        payload = json.dumps({"name": title, "body": body})
        run_curl(headers + ["-X", "PATCH", "-d", payload, update_url])
    else:
        # Create release
        create_url = f"https://api.github.com/repos/{repo}/releases"
        payload = json.dumps({
            "tag_name": tag,
            "target_commitish": "main",
            "name": title,
            "body": body,
            "draft": False,
            "prerelease": False,
        })
        out = run_curl(headers + ["-X", "POST", "-d", payload, create_url])
        data = json.loads(out)
        if "id" not in data:
            sys.exit(f"Failed to create release: {data}")
        release_id = data["id"]
        upload_url = data["upload_url"].split("{")[0]
        html_url = data.get("html_url", "")
        print(f"Created release {tag} (id={release_id}): {html_url}")

    # Check existing assets to avoid re-uploading duplicates
    existing_assets = {a["name"]: a["id"] for a in data.get("assets", [])}

    # Assets to upload
    files_to_upload = [
        DIST_SIGNED / f"Leostryx-{version}-standard.apk",
        DIST_SIGNED / f"Leostryx-{version}-bypass.apk",
        DIST_SIGNED / "Leostryx-repo.zip",
        DIST_SIGNED / f"SHA256SUMS-{version}.txt",
    ]

    for file_path in files_to_upload:
        if not file_path.exists():
            sys.exit(f"Error: Asset file not found: {file_path}")

        name = file_path.name
        if name in existing_assets:
            if "--replace" in sys.argv:
                print(f"Deleting existing asset {name} (id={existing_assets[name]})...")
                del_url = f"https://api.github.com/repos/{repo}/releases/assets/{existing_assets[name]}"
                run_curl(headers + ["-X", "DELETE", del_url])
            else:
                print(f"Asset {name} already uploaded (asset_id={existing_assets[name]}), skipping.")
                continue

        size_mb = file_path.stat().st_size / (1024 * 1024)
        print(f"Uploading {name} ({size_mb:.1f} MB)...")
        asset_url = f"https://uploads.github.com/repos/{repo}/releases/{release_id}/assets?name={name}"
        
        # Determine content type
        if name.endswith(".apk"):
            content_type = "application/vnd.android.package-archive"
        elif name.endswith(".zip"):
            content_type = "application/zip"
        else:
            content_type = "text/plain"

        cmd = [
            "curl",
            "-sS",
            "-X", "POST",
            "-H", f"Authorization: token {token}",
            "-H", f"Content-Type: {content_type}",
            "--data-binary", f"@{file_path}",
            asset_url,
        ]
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if res.returncode != 0:
            print(f"Failed to upload {name}: {res.stderr}")
            continue

        resp_data = json.loads(res.stdout)
        if "id" in resp_data:
            print(f"✓ Uploaded {name} (id={resp_data['id']})")
        else:
            print(f"✗ Failed to upload {name}: {resp_data}")

    print(f"\nAll assets processed for {tag}!")
    print(f"Release URL: {html_url}")


if __name__ == "__main__":
    main()
