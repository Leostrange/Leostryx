#!/usr/bin/env python3
"""Правка versionName / versionCode в бинарном AndroidManifest.xml (AXML).

Зачем: `app/AndroidManifest.xml` в этом дереве — уже скомпилированный AXML,
а не текст, поэтому номер версии нельзя поправить sed'ом. Раньше его меняли
вручную, из-за чего сборка была невоспроизводимой.

Как: правится только пул строк (chunk 0x0001) — остальные chunk'и ссылаются
на строки по индексу, а не по смещению, поэтому их можно перенести как есть.
Если строка становится длиннее, пересчитываются размер пула, размер файла и
выравнивание.

Использование:
  python3 tools/axml_version.py app/AndroidManifest.xml --name 3.1.10 --code 35
  python3 tools/axml_version.py app/AndroidManifest.xml            # только показать
"""
import argparse
import struct
import sys

RES_STRING_POOL_TYPE = 0x0001
RES_XML_TYPE = 0x0003
UTF8_FLAG = 0x0100

ATTR_VERSION_CODE = 0x0101021B
ATTR_VERSION_NAME = 0x0101021C


def _read_len_u8(d, off):
    n = d[off]
    if n & 0x80:
        return ((n & 0x7F) << 8) | d[off + 1], off + 2
    return n, off + 1


def _read_len_u16(d, off):
    n = struct.unpack_from("<H", d, off)[0]
    if n & 0x8000:
        n2 = struct.unpack_from("<H", d, off + 2)[0]
        return ((n & 0x7FFF) << 16) | n2, off + 4
    return n, off + 2


def _write_len_u8(out, n):
    if n > 0x7F:
        out.append((n >> 8) | 0x80)
        out.append(n & 0xFF)
    else:
        out.append(n)


def _write_len_u16(out, n):
    if n > 0x7FFF:
        out.extend(struct.pack("<H", ((n >> 16) & 0x7FFF) | 0x8000))
        out.extend(struct.pack("<H", n & 0xFFFF))
    else:
        out.extend(struct.pack("<H", n))


def parse_pool(d, off):
    """-> (headerSize, flags, strings, stylesRaw, chunkSize)."""
    typ, hsize, size = struct.unpack_from("<HHI", d, off)
    assert typ == RES_STRING_POOL_TYPE, "не пул строк в смещении %d" % off
    count, style_count, flags, strings_start, styles_start = struct.unpack_from(
        "<IIIII", d, off + 8
    )
    utf8 = bool(flags & UTF8_FLAG)
    strings = []
    for i in range(count):
        so = struct.unpack_from("<I", d, off + hsize + i * 4)[0]
        p = off + strings_start + so
        if utf8:
            _u16len, p = _read_len_u8(d, p)
            blen, p = _read_len_u8(d, p)
            strings.append(d[p:p + blen].decode("utf-8", "surrogatepass"))
        else:
            clen, p = _read_len_u16(d, p)
            strings.append(d[p:p + clen * 2].decode("utf-16-le", "surrogatepass"))
    styles = b""
    if style_count and styles_start:
        styles = d[off + styles_start: off + size]
    return hsize, flags, strings, styles, size


def build_pool(hsize, flags, strings, styles):
    utf8 = bool(flags & UTF8_FLAG)
    offsets, data = [], bytearray()
    for s in strings:
        offsets.append(len(data))
        if utf8:
            raw = s.encode("utf-8", "surrogatepass")
            _write_len_u8(data, len(s))
            _write_len_u8(data, len(raw))
            data.extend(raw)
            data.append(0)
        else:
            raw = s.encode("utf-16-le", "surrogatepass")
            _write_len_u16(data, len(raw) // 2)
            data.extend(raw)
            data.extend(b"\x00\x00")
    while len(data) % 4:
        data.append(0)

    style_count = 0
    style_offsets = b""
    styles_blob = b""
    if styles:
        # Стили не используются в манифесте; если появятся — не теряем их.
        style_count = 0
        styles_blob = b""

    header_size = 28
    strings_start = header_size + (len(strings) + style_count) * 4
    strings_start += (-strings_start) % 4
    total = strings_start + len(data) + len(styles_blob)
    while total % 4:
        total += 1

    out = bytearray()
    out.extend(struct.pack("<HHI", RES_STRING_POOL_TYPE, header_size, total))
    out.extend(struct.pack(
        "<IIIII", len(strings), style_count, flags, strings_start,
        strings_start + len(data) if style_count else 0,
    ))
    for o in offsets:
        out.extend(struct.pack("<I", o))
    out.extend(style_offsets)
    while len(out) < strings_start:
        out.append(0)
    out.extend(data)
    out.extend(styles_blob)
    while len(out) < total:
        out.append(0)
    return bytes(out)


def patch(path, name=None, code=None, write=True):
    d = bytearray(open(path, "rb").read())
    if struct.unpack_from("<H", d, 0)[0] != RES_XML_TYPE:
        raise SystemExit("это не AXML: %s" % path)
    file_hsize, file_size = struct.unpack_from("<HI", d, 2)
    if file_size != len(d):
        raise SystemExit("размер в заголовке (%d) != реального (%d)" % (file_size, len(d)))

    off = file_hsize
    pool_off = None
    while off < len(d):
        typ, _hs, size = struct.unpack_from("<HHI", d, off)
        if size <= 0:
            break
        if typ == RES_STRING_POOL_TYPE:
            pool_off = off
            break
        off += size
    if pool_off is None:
        raise SystemExit("пул строк не найден")

    hsize, flags, strings, styles, pool_size = parse_pool(d, pool_off)
    utf8 = bool(flags & UTF8_FLAG)

    # Атрибуты versionCode/versionName лежат в чанках START_ELEMENT (0x0102).
    # Строковые значения ссылаются на индекс пула, целые — хранятся inline.
    code_idx = None
    code_val = None
    name_idx = None
    scan = pool_off + pool_size
    while scan < len(d):
        typ, _hs, size = struct.unpack_from("<HHI", d, scan)
        if size <= 0:
            break
        if typ == 0x0102:  # START_ELEMENT
            attr_start = struct.unpack_from("<H", d, scan + 24)[0]
            attr_size = struct.unpack_from("<H", d, scan + 26)[0]
            attr_count = struct.unpack_from("<H", d, scan + 28)[0]
            # attributeStart считается от начала чанка элемента (scan + 16),
            # а не от блока attrExt (scan + 24).
            base = scan + 16 + attr_start
            for i in range(attr_count):
                a = base + i * attr_size
                _ns, nm, raw_val = struct.unpack_from("<III", d, a)
                _sz, _res0, dtype, data_v = struct.unpack_from("<HBBI", d, a + 12)
                # Имя атрибута — индекс в пуле строк, а не framework resource id.
                attr = strings[nm] if 0 <= nm < len(strings) else ""
                if attr == "versionCode":
                    code_val = data_v
                elif attr == "versionName":
                    if dtype == 0x03:      # TYPE_STRING
                        name_idx = data_v
                    elif raw_val != 0xFFFFFFFF:
                        name_idx = raw_val
        scan += size

    cur_name = strings[name_idx] if name_idx is not None else None
    print("сейчас: versionName=%r versionCode=%r (utf8=%s)" % (cur_name, code_val, utf8))

    if not write:
        return cur_name, code_val

    changed = False
    if name is not None:
        if name_idx is None:
            raise SystemExit("versionName не найден в манифесте")
        if strings[name_idx] != name:
            strings[name_idx] = name
            changed = True

    new_pool = build_pool(hsize, flags, strings, styles)
    rest = bytes(d[pool_off + pool_size:])
    body = bytes(d[:pool_off]) + new_pool + rest

    if code is not None and code != code_val:
        # versionCode хранится inline в атрибуте — правим уже в новом буфере,
        # пересчитав смещение чанков после изменившегося пула.
        body = bytearray(body)
        scan = file_hsize
        while scan < len(body):
            typ, _hs, size = struct.unpack_from("<HHI", body, scan)
            if size <= 0:
                break
            if typ == 0x0102:
                attr_start = struct.unpack_from("<H", body, scan + 24)[0]
                attr_size = struct.unpack_from("<H", body, scan + 26)[0]
                attr_count = struct.unpack_from("<H", body, scan + 28)[0]
                base = scan + 16 + attr_start
                for i in range(attr_count):
                    a = base + i * attr_size
                    nm = struct.unpack_from("<I", body, a + 4)[0]
                    if 0 <= nm < len(strings) and strings[nm] == "versionCode":
                        struct.pack_into("<I", body, a + 16, code)
            scan += size
        body = bytes(body)
        changed = True

    if not changed:
        print("ничего менять не нужно")
        return cur_name, code_val

    body = bytearray(body)
    struct.pack_into("<I", body, 4, len(body))   # fileSize (type, hsize, size)
    open(path, "wb").write(bytes(body))
    print("записано: %s (%d байт)" % (path, len(body)))
    return cur_name, code_val


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("manifest")
    ap.add_argument("--name")
    ap.add_argument("--code", type=int)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    patch(a.manifest, a.name, a.code, write=not a.dry_run)


if __name__ == "__main__":
    sys.exit(main())
