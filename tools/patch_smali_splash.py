#!/usr/bin/env python3
"""
patch_smali_splash.py - Patch SplashLoadingHtml.smali with wolf & bear SVG paths and reassemble app/classes.dex.
"""
import re
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SMALI_DIR = Path("/data/user/0/com.agyru.t2/cache/smali_out")
SMALI_FILE = SMALI_DIR / "com/agy/ui/splash/SplashLoadingHtml.smali"

def main():
    animal_data = json.load(open("/data/user/0/com.agyru.t2/cache/animal_vector_data.json"))
    w_d = " ".join(animal_data["03_lsx"]["monoPaths"][0]["d"].split())
    b_d = " ".join(animal_data["04_angular_x"]["monoPaths"][0]["d"].split())

    smali_text = SMALI_FILE.read_text(encoding="utf-8")

    def replace_method(name, new_body):
        nonlocal smali_text
        pattern = r"(\.method public static " + name + r"\(\)Ljava/lang/String;[\s\S]*?\.end method)"
        m = re.search(pattern, smali_text)
        assert m, f"Method {name} not found!"
        smali_text = smali_text[:m.start()] + new_body + smali_text[m.end():]

    w_tag = f'<path d=\\"{w_d}\\" fill=\\"currentColor\\" transform=\\"translate(0,1024) scale(0.1,-0.1)\\"/>'
    b_tag = f'<path d=\\"{b_d}\\" fill=\\"currentColor\\" transform=\\"translate(0,1024) scale(0.1,-0.1)\\"/>'

    replace_method("in_3lsx", f""".method public static in_3lsx()Ljava/lang/String;
    .registers 1

    .line 29
    const-string v0, "{w_tag}"

    return-object v0
.end method""")

    replace_method("vb_3lsx", """.method public static vb_3lsx()Ljava/lang/String;
    .registers 1

    .line 25
    const-string v0, "0 0 1024 1024"

    return-object v0
.end method""")

    replace_method("in_4angularx", f""".method public static in_4angularx()Ljava/lang/String;
    .registers 1

    .line 37
    const-string v0, "{b_tag}"

    return-object v0
.end method""")

    replace_method("vb_4angularx", """.method public static vb_4angularx()Ljava/lang/String;
    .registers 1

    .line 33
    const-string v0, "0 0 1024 1024"

    return-object v0
.end method""")

    SMALI_FILE.write_text(smali_text, encoding="utf-8")
    print("SplashLoadingHtml.smali patched successfully! Reassembling with smali a...")

    cmd = ["/data/user/0/com.agyru.t2/files/runtime/bin/smali", "a", str(SMALI_DIR), "-o", str(ROOT / "app/classes.dex")]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        print("smali failed with exit code", res.returncode)
        print("stdout:", res.stdout)
        print("stderr:", res.stderr)
        raise RuntimeError("smali assembly failed")
    if res.stderr:
        print("smali stderr:", res.stderr)

    print("Reassembly successful! app/classes.dex size:", (ROOT / "app/classes.dex").stat().st_size)

if __name__ == "__main__":
    main()
