#!/usr/bin/env python3
"""Leostryx: allow attaching arbitrary file types in the chat composer.

Patches app/assets/web/generated/main.js in place:
  A. adds `agyMimeForName()` extension->mime resolver
  B. widens the drag&drop accept filter (dragover + drop)
  C. replaces the terminal `Unsupported file format` with a generic
     inline-data attach path (content sniffing for text vs. octet-stream)
  D. raises the text attachment cap 1MB -> 10MB

Идемпотентен: повторный запуск на уже пропатченном бандле ничего не делает.
Запускается один раз на каждой новой upstream-версии main.js:
    python3 tools/patch_main_any_files.py
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PATH = ROOT / "app/assets/web/generated/main.js"

EXT_MIME = {
    # code / config -> text
    "py": "text/x-python", "pyw": "text/x-python", "js": "text/javascript",
    "mjs": "text/javascript", "cjs": "text/javascript", "jsx": "text/javascript",
    "ts": "text/x-typescript", "tsx": "text/x-typescript", "json": "application/json",
    "jsonl": "application/json", "ipynb": "application/json", "md": "text/markdown",
    "markdown": "text/markdown", "mdx": "text/markdown", "rst": "text/plain",
    "txt": "text/plain", "log": "text/plain", "csv": "text/csv", "tsv": "text/csv",
    "html": "text/html", "htm": "text/html", "xhtml": "text/html", "css": "text/css",
    "scss": "text/css", "sass": "text/css", "less": "text/css", "xml": "text/xml",
    "xsl": "text/xml", "svg": "image/svg+xml", "yaml": "application/yaml",
    "yml": "application/yaml", "toml": "application/toml", "ini": "text/plain",
    "cfg": "text/plain", "conf": "text/plain", "properties": "text/plain",
    "env": "text/plain", "sh": "application/x-sh", "bash": "application/x-sh",
    "zsh": "application/x-sh", "fish": "application/x-sh", "bat": "text/plain",
    "cmd": "text/plain", "ps1": "text/plain", "c": "text/x-c", "h": "text/x-c",
    "cc": "text/x-c++", "cpp": "text/x-c++", "cxx": "text/x-c++", "hpp": "text/x-c++",
    "cs": "text/plain", "java": "text/x-java", "kt": "text/plain", "kts": "text/plain",
    "scala": "text/plain", "swift": "text/plain", "go": "text/x-go", "rs": "text/x-rust",
    "rb": "text/x-ruby", "php": "text/x-php", "pl": "text/x-perl", "lua": "text/x-lua",
    "r": "text/plain", "m": "text/plain", "mm": "text/plain", "dart": "text/plain",
    "gradle": "text/plain", "groovy": "text/plain", "sql": "application/sql",
    "proto": "text/plain", "graphql": "text/plain", "gql": "text/plain",
    "diff": "text/plain", "patch": "text/plain", "srt": "text/plain",
    "vtt": "text/vtt", "ass": "text/plain", "tex": "text/x-tex", "bib": "text/plain",
    "makefile": "text/plain", "mk": "text/plain", "dockerfile": "text/plain",
    "gitignore": "text/plain",
    # images (only used when File.type is empty)
    "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif",
    "webp": "image/webp", "bmp": "image/bmp", "ico": "image/x-icon",
    "avif": "image/avif", "heic": "image/heic",
    # audio / video
    "mp4": "video/mp4", "webm": "video/webm", "mov": "video/quicktime",
    "avi": "video/x-msvideo", "mkv": "video/x-matroska",
    "mp3": "audio/mpeg", "wav": "audio/wav", "m4a": "audio/mp4", "aac": "audio/aac",
    "ogg": "audio/ogg", "flac": "audio/flac", "opus": "audio/opus", "weba": "audio/webm",
    # office / archives / binaries
    "pdf": "application/pdf", "zip": "application/zip",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "doc": "application/msword", "xls": "application/vnd.ms-excel",
    "ppt": "application/vnd.ms-powerpoint",
    "gz": "application/gzip", "tgz": "application/gzip", "tar": "application/x-tar",
    "7z": "application/x-7z-compressed", "rar": "application/vnd.rar",
    "apk": "application/vnd.android.package-archive",
    "ttf": "font/ttf", "otf": "font/otf", "woff": "font/woff", "woff2": "font/woff2",
}
MIME_MAP = (
    'function agyMimeForName(a){'
    'a=(a||"").slice((a||"").lastIndexOf(".")+1).toLowerCase();'
    'return ' + json.dumps(EXT_MIME, ensure_ascii=True) + '[a]||""}'
)

GENERIC = (
    'else if(m.size===0)e?.("File is empty"),'
    'g("validation_check_failed",Error("File is empty"));'
    'else if(m.size>20971520)e?.("File size exceeds 20MB limit"),'
    'g("validation_check_failed",Error("File size exceeds 20MB limit"));'
    'else try{'
    'let x=m.type&&m.type!=="application/octet-stream"?m.type:agyMimeForName(m.name)||"",'
    'y=new Uint8Array(q(await n(m.arrayBuffer())));'
    'if(!x||x==="application/octet-stream"){'
    'let z=Math.min(y.length,65536),t=0,i=0;'
    'for(;i<z;i++){let c=y[i];if(c===0||c===127){t=1;break}if(c<7||c>13&&c<32)t++}'
    'x=!t||t/Math.max(z,1)<0.02?"text/plain":"application/octet-stream"'
    '}'
    'let B=p(I.MediaSchema,{mimeType:x,description:m.name,payload:{case:"inlineData",value:y}});'
    'BB(m)&&AB.set(B,m);'
    'a([B])'
    '}catch(x){q(),g("validation_check_failed",x)}'
)

DROP_OLD = (
    'Array.from(v.dataTransfer?.items||[]).some(w=>w.kind==="file"&&'
    '(CB("",w.type)||w.type.startsWith("image/")||w.type.startsWith("video/")||'
    'w.type.startsWith("audio/")||w.type==="application/pdf"||xNa(w.type)||pNa.includes(w.type)))'
)
DROP_NEW = 'Array.from(v.dataTransfer?.items||[]).some(w=>w.kind==="file")'

FILTER_OLD = '!y.has(C.name)&&CB(C.name,C.type)&&B.items.add(C)'
FILTER_NEW = '!y.has(C.name)&&B.items.add(C)'

TEXT_RE = re.compile(
    r'if\(u\)if\(m\.size>1048576\)e\?\.\("Text file size exceeds 1MB limit"\),'
    r'\s*g\("validation_check_failed",\s*Error\("Text file size exceeds 1MB limit"\)\);'
)
TEXT_NEW = (
    'if(u)if(m.size>10485760)e?.("Text file size exceeds 10MB limit"),'
    'g("validation_check_failed",Error("Text file size exceeds 10MB limit"));'
)

s = open(PATH, encoding="utf-8").read()
orig_len = len(s)


def sub_once(src, old, new, label):
    n = src.count(old)
    assert n == 1, f"{label}: expected 1 occurrence, got {n}"
    print(f"  [ok] {label}")
    return src.replace(old, new, 1)


if "agyMimeForName" in s:
    print("Already patched, aborting.")
    sys.exit(0)

s = sub_once(s, "var u5a=(a,b,c,e,f=10)=>{",
             MIME_MAP + "\nvar u5a=(a,b,c,e,f=10)=>{", "A mime resolver")
s = sub_once(s, DROP_OLD, DROP_NEW, "B dragover filter")
s = sub_once(s, FILTER_OLD, FILTER_NEW, "B drop filter")

assert s.count('else e?.("Unsupported file format")') == 1
s = sub_once(s, 'else e?.("Unsupported file format")', GENERIC, "C generic attach")

assert len(TEXT_RE.findall(s)) == 1, "text cap pattern mismatch"
s = TEXT_RE.sub(TEXT_NEW, s, count=1)
print("  [ok] D text cap 1MB->10MB")

assert "Unsupported file format" not in s
open(PATH, "w", encoding="utf-8", newline="").write(s)
print(f"written: {orig_len} -> {len(s)} bytes (delta {len(s)-orig_len})")
