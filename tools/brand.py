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
import os
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
    data = {}
    if cfg.exists():
        try:
            data = json.loads(cfg.read_text(encoding="utf-8"))
        except Exception:
            data = {}

    home_cfg = Path(os.environ.get("HOME", "/data/user/0/com.agyru.t2/files")) / "web/brand/config.json"
    if home_cfg.exists():
        try:
            home_data = json.loads(home_cfg.read_text(encoding="utf-8"))
            if isinstance(home_data, dict):
                data.update(home_data)
        except Exception:
            pass

    if not isinstance(data, dict):
        return None
    pack = data.get("pack")
    if pack not in PACK_IDS:
        return None
    name = data.get("name") or "Leostryx"
    color = data.get("color") or "#ec4899"
    recolor = bool(data.get("recolorLogo", True))

    try:
        cfg.write_text(json.dumps({
            "pack": pack,
            "name": name,
            "color": color,
            "recolorLogo": recolor
        }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    except Exception:
        pass

    return {
        "pack": pack,
        "name": str(name),
        "color": color,
        "recolorLogo": recolor,
    }


def tint_png_bytes(png_bytes, hex_color):
    """Tint RGBA 8-bit PNG foreground with hex_color using pure stdlib."""
    import zlib
    if png_bytes[:8] != b"\x89PNG\r\n\x1a\n":
        return png_bytes
    h = hex_color.lstrip("#")
    if len(h) != 6:
        return png_bytes
    tr, tg, tb = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)

    pos = 8
    chunks = []
    idat_parts = []
    width = height = bit_depth = color_type = 0
    while pos < len(png_bytes):
        length = struct.unpack(">I", png_bytes[pos:pos + 4])[0]
        ctype = png_bytes[pos + 4:pos + 8]
        cdata = png_bytes[pos + 8:pos + 8 + length]
        pos += 12 + length
        if ctype == b"IHDR":
            width, height, bit_depth, color_type = struct.unpack(">IIBB", cdata[:10])
            chunks.append((ctype, cdata))
        elif ctype == b"IDAT":
            idat_parts.append(cdata)
        elif ctype == b"IEND":
            break
        else:
            chunks.append((ctype, cdata))

    if bit_depth != 8 or color_type != 6 or not idat_parts:
        return png_bytes
    try:
        raw = bytearray(zlib.decompress(b"".join(idat_parts)))
    except Exception:
        return png_bytes

    stride = width * 4
    if len(raw) != height * (1 + stride):
        return png_bytes

    # Unfilter scanlines
    pixels = bytearray(height * stride)
    for y in range(height):
        f = raw[y * (1 + stride)]
        row_in = raw[y * (1 + stride) + 1:(y + 1) * (1 + stride)]
        row_out = memoryview(pixels)[y * stride:(y + 1) * stride]
        prev_out = memoryview(pixels)[(y - 1) * stride:y * stride] if y > 0 else None
        for i in range(stride):
            x = row_in[i]
            a = row_out[i - 4] if i >= 4 else 0
            b = prev_out[i] if prev_out is not None else 0
            c = prev_out[i - 4] if (prev_out is not None and i >= 4) else 0
            if f == 0:
                val = x
            elif f == 1:
                val = (x + a) & 0xFF
            elif f == 2:
                val = (x + b) & 0xFF
            elif f == 3:
                val = (x + ((a + b) >> 1)) & 0xFF
            elif f == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                val = (x + pr) & 0xFF
            else:
                return png_bytes
            row_out[i] = val

    # Tint non-dark/colored or foreground pixels while preserving dark background and cream highlights
    cr, cg, cb = int(tr * 0.25 + 255 * 0.75), int(tg * 0.25 + 255 * 0.75), int(tb * 0.25 + 255 * 0.75)
    out_raw = bytearray(height * (1 + stride))
    for y in range(height):
        out_raw[y * (1 + stride)] = 0  # Filter None
        base_p = y * stride
        base_o = y * (1 + stride) + 1
        for x in range(width):
            r = pixels[base_p]
            g = pixels[base_p + 1]
            b = pixels[base_p + 2]
            a = pixels[base_p + 3]
            if a > 0:
                if g > 175 and b > 155:
                    r, g, b = cr, cg, cb
                else:
                    lum = max(r, g, b)
                    if lum > 36:
                        factor = min(1.0, lum / 203.0)
                        r = min(255, int(tr * factor))
                        g = min(255, int(tg * factor))
                        b = min(255, int(tb * factor))
            out_raw[base_o] = r
            out_raw[base_o + 1] = g
            out_raw[base_o + 2] = b
            out_raw[base_o + 3] = a
            base_p += 4
            base_o += 4

    new_idat = zlib.compress(bytes(out_raw), 6)

    def make_chunk(ctype, cdata):
        crc = zlib.crc32(ctype + cdata) & 0xFFFFFFFF
        return struct.pack(">I", len(cdata)) + ctype + cdata + struct.pack(">I", crc)

    out = bytearray(b"\x89PNG\r\n\x1a\n")
    for ctype, cdata in chunks:
        out += make_chunk(ctype, cdata)
    out += make_chunk(b"IDAT", new_idat)
    out += make_chunk(b"IEND", b"")
    return bytes(out)


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
    over the tree copies; PNGs are mapped straight from the pack directory
    (or tinted when recolorLogo is enabled).
    """
    if not cfg:
        return {}
    root = Path(root)
    workdir = Path(workdir)
    workdir.mkdir(parents=True, exist_ok=True)

    pack_dir = root / "app/assets/web/brand" / cfg["pack"]
    if not pack_dir.is_dir():
        raise SystemExit("brand: pack not found: %s" % pack_dir)

    recolor = bool(cfg.get("recolorLogo")) and bool(cfg.get("color"))
    color_hex = cfg.get("color") or "#ec4899"

    def maybe_tint(src_path, rel_key):
        if not recolor:
            return src_path
        out_path = workdir / "tinted" / rel_key
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(tint_png_bytes(src_path.read_bytes(), color_hex))
        return out_path

    overlay = {}
    for dst, src in RES_MAP:
        src_path = pack_dir / src
        if not src_path.exists():
            raise SystemExit("brand: missing %s (needed for %s)" % (src_path, dst))
        overlay[dst] = maybe_tint(src_path, dst)

    # Keep the 4 base per-pack launcher icons in original designer colors (for when accent toggle is OFF)
    for pid in PACK_IDS:
        pdir = root / "app/assets/web/brand" / pid
        if not pdir.is_dir():
            continue
        fg_src = pdir / "source_res/drawable-nodpi/ic_launcher_logo.png"
        if fg_src.exists():
            dst_fg = "res/drawable-nodpi-v4/ic_launcher_logo_%s.png" % pid
            overlay[dst_fg] = fg_src
        for _d in ("mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"):
            for suffix in ("", "_round"):
                m_src = pdir / ("source_res/mipmap-%s/ic_launcher%s.png" % (_d, suffix))
                if m_src.exists():
                    dst_m = "res/mipmap-%s-v4/ic_launcher_%s%s.png" % (_d, pid, suffix)
                    overlay[dst_m] = m_src

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
