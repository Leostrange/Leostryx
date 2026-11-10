"""brand.py — apply Leostryx branding (icon pack + display name) to the APK tree.

Driven by `app/assets/web/brand/config.json`:
    { "pack": "02_lynx", "name": "Leostryx", "color": "#0b84ff" }

Three layers are touched, each with a different safety constraint:

1. PNG resources (`res/**`) — plain file replacement. Paths and resource IDs
   are unchanged, so the existing binary AXML (splash_icon.xml, the adaptive
   mipmap-anydpi-v26/ic_launcher.xml → ic_launcher_foreground.xml → bitmap)
   automatically picks up the new artwork.

2. `resources.arsc` app label — the global string pool is UTF-8 and is NOT
   required to be sorted (verified: flags=0x100, no SORTED bit). We rebuild the
   pool chunk and shift the offsets array; the package chunk that follows is
   self-contained (its typeStrings/keyStrings are chunk-relative), so it is
   copied verbatim.

3. `classes*.dex` strings (notification title + channel names) — dex strings are
   sorted and referenced by index from type/field/method ids and `const-string`
   opcodes. To keep every offset and index valid we replace each string in place
   and pad the replacement with trailing spaces to the ORIGINAL byte length.
   The uleb128 length prefix stays identical too (same char count). Only the
   content changes — the string data table is not rewritten.
   Trailing spaces are invisible in notification titles and channel names.

Usage (from rebuild.py):
    import brand
    cfg = brand.load_brand(ROOT)
    overlay = brand.build_overlay(ROOT, cfg, ROOT/"dist"/".brand")
"""
import json
import struct
from pathlib import Path

PACK_IDS = ("01_owl", "02_lynx", "03_lsx", "04_angular_x")

# APK resource path  <-  file inside the brand pack directory
RES_MAP = [
    ("res/drawable-nodpi-v4/ic_launcher_logo.png", "source_res/drawable-nodpi/ic_launcher_logo.png"),
    ("res/drawable-nodpi-v4/splash_logo.png", "source_res/drawable-nodpi/splash_logo.png"),
    ("res/drawable-nodpi-v4/ic_notification.png", "ic_notification.png"),
]
for _d in ("mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"):
    RES_MAP.append(("res/mipmap-%s-v4/ic_launcher.png" % _d,
                    "source_res/mipmap-%s/ic_launcher.png" % _d))
    RES_MAP.append(("res/mipmap-%s-v4/ic_launcher_round.png" % _d,
                    "source_res/mipmap-%s/ic_launcher_round.png" % _d))

ARSC_OLD_LABEL = "Antigravity RU BP"

# dex strings that carry the app name. Longest first so a short entry can never
# shadow a longer one at the same position.
DEX_TEMPLATES = [
    ("Antigravity failed to start", "{} failed to start"),
    ("Antigravity Tasks", "{} Tasks"),
    ("Antigravity Alerts", "{} Alerts"),
    ("Antigravity Logs", "{} Logs"),
    ("Restarting Antigravity", "Restarting {}"),
    ("Antigravity", "{}"),
]


def load_brand(root):
    """Read brand config; returns dict or None when absent/invalid."""
    cfg = Path(root) / "app/assets/web/brand/config.json"
    if not cfg.exists():
        return None
    try:
        data = json.loads(cfg.read_text(encoding="utf-8"))
    except Exception:
        return None
    if not isinstance(data, dict):
        return None
    pack = data.get("pack")
    if pack not in PACK_IDS:
        return None
    name = data.get("name") or "Leostryx"
    return {"pack": pack, "name": str(name), "color": data.get("color") or "#0b84ff"}


# ------------------------------------------------------------------ uleb128
def _uleb_dec(buf, pos):
    result = 0
    shift = 0
    while True:
        b = buf[pos]
        pos += 1
        result |= (b & 0x7F) << shift
        if not (b & 0x80):
            return result, pos
        shift += 7


def _uleb_enc(value):
    out = bytearray()
    while True:
        b = value & 0x7F
        value >>= 7
        if value:
            out.append(b | 0x80)
        else:
            out.append(b)
            return bytes(out)


# --------------------------------------------------------------- arsc patch
def patch_arsc(data, old, new):
    """Replace `old` with `new` in the global string pool of a resources.arsc.

    The pool chunk is rebuilt (offsets array + string data), its size field and
    the ResTable_header size are updated. Everything after the pool is copied
    byte-for-byte, so the package chunk stays intact.
    """
    old_b = old.encode("utf-8")
    if old_b not in data:
        return data, False

    _t, hdr_size, _total, _pkgcount = struct.unpack("<HHII", data[0:12])
    pos = hdr_size
    (ptype, phsize, psize, scount, stylecount, flags, strstart, stylestart) = struct.unpack(
        "<HHIIIIII", data[pos:pos + 28]
    )
    if not (flags & 0x100):
        raise ValueError("patch_arsc: only UTF-8 string pools are supported")

    offs = list(struct.unpack("<%dI" % scount, data[pos + phsize:pos + phsize + 4 * scount]))
    base = pos + strstart
    strings = []
    for o in offs:
        a = base + o
        _clen, a = _uleb_dec(data, a)
        blen, a = _uleb_dec(data, a)
        strings.append(data[a:a + blen])

    hit = False
    for i, s in enumerate(strings):
        if s == old_b:
            strings[i] = new.encode("utf-8")
            hit = True
    if not hit:
        return data, False

    # Rebuild string data + offsets, keeping any trailing padding that followed
    # the last string so the pool only changes size by the replaced string.
    old_blob_len = psize - strstart
    max_end = 0
    for o in offs:
        a = base + o
        _c, a = _uleb_dec(data, a)
        b, a = _uleb_dec(data, a)
        max_end = max(max_end, a + b + 1 - base)

    blob = bytearray()
    new_offs = []
    for s in strings:
        new_offs.append(len(blob))
        blob += _uleb_enc(len(s.decode("utf-8", "surrogatepass")))
        blob += _uleb_enc(len(s))
        blob += s + b"\x00"
    pad = old_blob_len - max_end
    if pad > 0:
        blob += data[base + max_end:base + old_blob_len]

    # ARSC chunks must start on a 4-byte boundary, so the pool size (and the
    # table total) has to stay 4-byte aligned. Pad the blob with zeros.
    while (phsize + 4 * scount + 4 * stylecount + len(blob)) % 4:
        blob += b"\x00"

    new_strstart = phsize + 4 * scount + 4 * stylecount
    if new_strstart != strstart:
        raise ValueError("patch_arsc: unexpected pool layout")
    new_psize = new_strstart + len(blob)
    new_hdr = struct.pack("<HHIIIIII", ptype, phsize, new_psize, scount, stylecount,
                          flags, new_strstart, stylestart)
    new_pool = new_hdr + struct.pack("<%dI" % scount, *new_offs) + bytes(blob)
    assert len(new_pool) == new_psize

    rest = data[pos + psize:]
    total = hdr_size + new_psize + len(rest)
    out = bytearray(data[:4])
    out += struct.pack("<I", total)
    out += data[8:hdr_size]
    out += new_pool
    out += rest
    return bytes(out), True


# ---------------------------------------------------------------- dex patch
def patch_dex(data, replacements):
    """In-place same-length string replacement inside dex string data.

    Each replacement is padded with trailing spaces to the original UTF-8 byte
    length so no offsets move and the uleb128 length prefix stays identical.
    Returns (bytes, count_of_replacements).
    """
    buf = bytearray(data)
    done = 0
    for old, new in replacements:
        ob = old.encode("utf-8")
        nb = new.encode("utf-8")
        if len(nb) > len(ob):
            raise ValueError("patch_dex: %r -> %r grows the string" % (old, new))
        if len(old) != len(new):
            # pad keeps byte length; the uleb128 char count must also match
            nb = nb + b" " * (len(ob) - len(nb))
        # A dex string_data item is [uleb128 char_len][bytes][0x00]. For pure
        # ASCII the char_len prefix equals the byte length, which lets us
        # recognise a genuine standalone string without parsing the whole file.
        needle = ob + b"\x00"
        start = 0
        while True:
            i = data.find(needle, start)
            if i < 0:
                break
            if i > 0 and data[i - 1] == len(old):
                buf[i:i + len(ob)] = nb
                done += 1
            start = i + 1
    return bytes(buf), done


def dex_replacements(name):
    return [(src, tpl.format(name)) for src, tpl in DEX_TEMPLATES]


# ------------------------------------------------------------------- build
def build_overlay(root, cfg, workdir):
    """Return {apk_path: source_path} for the brand pack.

    Writes patched resources.arsc / classes*.dex into `workdir` and maps them
    over the tree copies; PNGs are mapped straight from the pack directory.
    """
    if not cfg:
        return {}
    root = Path(root)
    workdir = Path(workdir)
    workdir.mkdir(parents=True, exist_ok=True)

    pack_dir = root / "app/assets/web/brand" / cfg["pack"]
    if not pack_dir.is_dir():
        raise SystemExit("brand: pack not found: %s" % pack_dir)

    overlay = {}
    for dst, src in RES_MAP:
        src_path = pack_dir / src
        if not src_path.exists():
            raise SystemExit("brand: missing %s (needed for %s)" % (src_path, dst))
        overlay[dst] = src_path

    # resources.arsc — app label
    arsc_in = root / "app/resources.arsc"
    new_arsc, hit = patch_arsc(arsc_in.read_bytes(), ARSC_OLD_LABEL, cfg["name"])
    if hit:
        out = workdir / "resources.arsc"
        out.write_bytes(new_arsc)
        overlay["resources.arsc"] = out
        print("brand: app label %r -> %r" % (ARSC_OLD_LABEL, cfg["name"]))
    else:
        print("brand: app label %r not found in resources.arsc (skipped)" % ARSC_OLD_LABEL)

    # dex strings — notification title + channel names
    reps = dex_replacements(cfg["name"])
    for dex_name in ("classes.dex", "classes2.dex", "classes3.dex"):
        dex_in = root / "app" / dex_name
        if not dex_in.exists():
            continue
        new_dex, n = patch_dex(dex_in.read_bytes(), reps)
        if n:
            out = workdir / dex_name
            out.write_bytes(new_dex)
            overlay[dex_name] = out
            print("brand: %s — %d string(s) -> %r" % (dex_name, n, cfg["name"]))
    return overlay
