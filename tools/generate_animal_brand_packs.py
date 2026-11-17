#!/usr/bin/env python3
"""
generate_animal_brand_packs.py - Generate brand assets (SVGs, PNGs, mipmaps)
for 03_lsx (Волк) and 04_angular_x (Медведь) from user uploaded geometric artwork.
"""
import os
import re
import json
import subprocess
from pathlib import Path
from PIL import Image, ImageFilter
import numpy as np

CACHE_DIR = Path("/data/user/0/com.agyru.t2/cache")
CACHE_DIR.mkdir(parents=True, exist_ok=True)

ROOT = Path(__file__).resolve().parent.parent
BRAND_DIR = ROOT / "app/assets/web/brand"
ARTIFACTS_DIR = Path("/data/user/0/com.agyru.t2/files/.gemini/antigravity-app/brain/35992690-5d12-45b0-8327-dbf68bc3bb09/logos")
ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)

WOLF_IMG = "/data/user/0/com.agyru.t2/files/.gemini/antigravity-app/brain/35992690-5d12-45b0-8327-dbf68bc3bb09/.user_uploaded/media_1794899024973_dbf08566.jpg"
BEAR_IMG = "/data/user/0/com.agyru.t2/files/.gemini/antigravity-app/brain/35992690-5d12-45b0-8327-dbf68bc3bb09/.user_uploaded/media_1794899025111_0e701fd2.jpg"

def make_cutouts(img_path):
    img = Image.open(img_path).convert('RGB')
    arr = np.array(img, dtype=np.float32)
    br = np.max(arr, axis=2)
    # Soft alpha cutoff
    alpha = np.clip((br - 8.0) / 16.0 * 255.0, 0.0, 255.0).astype(np.uint8)
    rgba = np.dstack([arr.astype(np.uint8), alpha])
    color_img = Image.fromarray(rgba, 'RGBA')
    
    # White silhouette for notification icon
    white_arr = np.zeros_like(rgba)
    white_arr[:, :, :3] = 255
    white_arr[:, :, 3] = alpha
    white_img = Image.fromarray(white_arr, 'RGBA')
    
    return color_img, white_img

def save_png_pack(pack_id, color_img, white_img):
    dest = BRAND_DIR / pack_id
    dest.mkdir(parents=True, exist_ok=True)
    
    # Root level pngs
    color_img.resize((512, 512), Image.Resampling.LANCZOS).save(dest / "icon_512.png")
    color_img.resize((512, 512), Image.Resampling.LANCZOS).save(dest / "preview.png")
    color_img.resize((540, 540), Image.Resampling.LANCZOS).save(dest / "splash_logo.png")
    color_img.resize((432, 432), Image.Resampling.LANCZOS).save(dest / "ic_launcher_logo.png")
    white_img.resize((432, 432), Image.Resampling.LANCZOS).save(dest / "ic_notification.png")
    
    # Save artifacts for user inspection
    color_img.resize((512, 512), Image.Resampling.LANCZOS).save(ARTIFACTS_DIR / f"{pack_id}.png")
    color_img.resize((512, 512), Image.Resampling.LANCZOS).save(ARTIFACTS_DIR / f"{pack_id}_512.png")
    
    # source_res drawables and mipmaps
    s_res = dest / "source_res"
    (s_res / "drawable-nodpi").mkdir(parents=True, exist_ok=True)
    color_img.resize((432, 432), Image.Resampling.LANCZOS).save(s_res / "drawable-nodpi/ic_launcher_logo.png")
    color_img.resize((540, 540), Image.Resampling.LANCZOS).save(s_res / "drawable-nodpi/splash_logo.png")
    
    # notification icon densities
    notif_sizes = {
        "mdpi": 24,
        "hdpi": 36,
        "xhdpi": 48,
        "xxhdpi": 72,
        "xxxhdpi": 96
    }
    for density, size in notif_sizes.items():
        d_dir = s_res / f"drawable-{density}"
        d_dir.mkdir(parents=True, exist_ok=True)
        white_img.resize((size, size), Image.Resampling.LANCZOS).save(d_dir / "ic_notification.png")
        
    # launcher mipmap densities
    launcher_sizes = {
        "mdpi": 48,
        "hdpi": 72,
        "xhdpi": 96,
        "xxhdpi": 144,
        "xxxhdpi": 192
    }
    for density, size in launcher_sizes.items():
        m_dir = s_res / f"mipmap-{density}"
        m_dir.mkdir(parents=True, exist_ok=True)
        # Pad the icon slightly so it sits nicely inside launcher icons (padding 8%)
        padded = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        inner_size = int(size * 0.88)
        offset = (size - inner_size) // 2
        resized = color_img.resize((inner_size, inner_size), Image.Resampling.LANCZOS)
        padded.paste(resized, (offset, offset), resized)
        padded.save(m_dir / "ic_launcher.png")
        padded.save(m_dir / "ic_launcher_round.png")

def trace_svg(pack_id, img_path):
    img = Image.open(img_path)
    # Despeckle JPEG compression noise
    smooth = img.filter(ImageFilter.MedianFilter(size=3))
    arr = np.array(smooth)
    bg_mask = np.max(arr, axis=2) <= 18
    
    # 1. Silhouette mask for mono and base
    sil_mask = np.where(~bg_mask, 0, 255).astype(np.uint8)
    sil_bmp = CACHE_DIR / f"{pack_id}_sil.bmp"
    Image.fromarray(sil_mask).save(sil_bmp)
    sil_svg = CACHE_DIR / f"{pack_id}_sil.svg"
    subprocess.run(['potrace', '-s', '--flat', '-t', '15', '-O', '0.4', '-a', '0.8', str(sil_bmp), '-o', str(sil_svg)], check=True)
    sil_d = re.findall(r'<path d=\"([^\"]+)\"', open(sil_svg).read())[0]
    
    # 2. Color layers using quantize
    arr_clean = arr.copy()
    arr_clean[bg_mask] = [0, 0, 0]
    clean_img = Image.fromarray(arr_clean)
    q = clean_img.quantize(colors=6, method=Image.Quantize.FASTOCTREE)
    pal = q.getpalette()[:18]
    q_arr = np.array(q)
    
    layer_info = []
    for i in range(6):
        c = (pal[i*3], pal[i*3+1], pal[i*3+2])
        cnt = np.sum(q_arr == i)
        dist = c[0]**2 + c[1]**2 + c[2]**2
        if dist > 400 and cnt > 2500:
            layer_info.append((i, '#%02x%02x%02x' % c, c, cnt))
            
    def bright(item):
        c = item[2]
        return 0.299*c[0] + 0.587*c[1] + 0.114*c[2]
    layer_info.sort(key=bright)
    
    color_paths = []
    # Darkest base silhouette
    dark_c = layer_info[0][1]
    color_paths.append({'d': sil_d, 'fill': dark_c, 'transform': 'translate(0,1024) scale(0.1,-0.1)'})
    
    for l_idx, hex_c, c, cnt in layer_info[1:]:
        l_mask = np.where(q_arr == l_idx, 0, 255).astype(np.uint8)
        l_bmp = CACHE_DIR / f"{pack_id}_l{l_idx}.bmp"
        Image.fromarray(l_mask).save(l_bmp)
        l_svg = CACHE_DIR / f"{pack_id}_l{l_idx}.svg"
        subprocess.run(['potrace', '-s', '--flat', '-t', '20', '-O', '0.4', '-a', '0.8', str(l_bmp), '-o', str(l_svg)], check=True)
        paths = re.findall(r'<path d=\"([^\"]+)\"', open(l_svg).read())
        for p in paths:
            color_paths.append({'d': p, 'fill': hex_c, 'transform': 'translate(0,1024) scale(0.1,-0.1)'})
            
    mono_paths = [{'d': sil_d, 'transform': 'translate(0,1024) scale(0.1,-0.1)'}]
    
    # Complete SVG files
    col_svg_content = "<?xml version='1.0' encoding='utf-8'?>\n"
    col_svg_content += '<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="1024" height="1024" viewBox="0 0 1024 1024">\n'
    for cp in color_paths:
        col_svg_content += f'<path d="{cp["d"]}" fill="{cp["fill"]}" transform="{cp["transform"]}"/>\n'
    col_svg_content += '</svg>\n'
    (BRAND_DIR / f"{pack_id}.svg").write_text(col_svg_content, encoding="utf-8")
    (ARTIFACTS_DIR / f"{pack_id}.svg").write_text(col_svg_content, encoding="utf-8")
    
    mono_svg_content = "<?xml version='1.0' encoding='utf-8'?>\n"
    mono_svg_content += '<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="1024" height="1024" viewBox="0 0 1024 1024">\n'
    for mp in mono_paths:
        mono_svg_content += f'<path d="{mp["d"]}" fill="currentColor" transform="{mp["transform"]}"/>\n'
    mono_svg_content += '</svg>\n'
    (BRAND_DIR / f"{pack_id}-mono.svg").write_text(mono_svg_content, encoding="utf-8")
    (ARTIFACTS_DIR / f"{pack_id}-mono.svg").write_text(mono_svg_content, encoding="utf-8")
    
    return {
        "viewBox": "0 0 1024 1024",
        "colorPaths": color_paths,
        "monoPaths": mono_paths,
        "monoInner": f'<path d="{sil_d}" fill="currentColor" transform="translate(0,1024) scale(0.1,-0.1)"/>',
        "colorInner": "\n".join([f'<path d="{cp["d"]}" fill="{cp["fill"]}" transform="{cp["transform"]}"/>' for cp in color_paths])
    }

def main():
    print("Processing Wolf (03_lsx)...")
    w_col, w_white = make_cutouts(WOLF_IMG)
    save_png_pack("03_lsx", w_col, w_white)
    w_data = trace_svg("03_lsx", WOLF_IMG)
    print("Wolf completed.")
    
    print("Processing Bear (04_angular_x)...")
    b_col, b_white = make_cutouts(BEAR_IMG)
    save_png_pack("04_angular_x", b_col, b_white)
    b_data = trace_svg("04_angular_x", BEAR_IMG)
    print("Bear completed.")
    
    out_json = CACHE_DIR / "animal_vector_data.json"
    out_json.write_text(json.dumps({
        "03_lsx": w_data,
        "04_angular_x": b_data
    }, indent=2), encoding="utf-8")
    print(f"Vector data saved to {out_json}")

if __name__ == "__main__":
    main()
