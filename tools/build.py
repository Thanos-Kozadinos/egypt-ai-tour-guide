#!/usr/bin/env python3
"""Assemble data/entries.json and data/assets.json, make icons, stamp the service worker version.

    python tools/build.py

Inputs : content/skeleton/*.json  (id, name, site, area, type, priority, wiki, aliases, note, also_in)
         content/lore/*.json      (id, period, summary, look, story, details, fun_fact, narration, related)
         data/images.json         (from fetch_wiki.py)
         img/<id>.jpg, audio/<id>.mp3, audio/phrases/*.mp3, docs/*.pdf
Outputs: data/entries.json, data/assets.json, icons/*.png, sw.js VERSION
"""
import glob
import json
import os
import re
import struct
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
J = os.path.join


def load_json(p, default=None):
    if not os.path.exists(p):
        return default
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def mp3_seconds(path):
    """Rough duration for CBR 64 kbps mono MP3 (what ElevenLabs returns): bytes*8/64000."""
    try:
        return int(os.path.getsize(path) * 8 / 64000)
    except OSError:
        return None


def make_icons():
    from PIL import Image, ImageDraw
    os.makedirs(J(ROOT, "icons"), exist_ok=True)

    def draw(size, maskable=False):
        im = Image.new("RGB", (size, size), "#161311")
        d = ImageDraw.Draw(im)
        pad = size * (0.18 if maskable else 0.08)
        # sun disc
        r = size * 0.14
        cx, cy = size / 2, size * (0.36 if maskable else 0.32)
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill="#e2b85a")
        # pyramid
        base_y = size - pad - size * 0.06
        half = size / 2 - pad
        apex = (size / 2, size * (0.42 if maskable else 0.36))
        d.polygon([(pad, base_y), (size - pad, base_y), apex], fill="#b8892b")
        d.polygon([(size / 2, base_y), (size - pad, base_y), apex], fill="#8a641c")
        # ground line
        d.rectangle([pad, base_y, size - pad, base_y + size * 0.03], fill="#e2b85a")
        return im

    draw(192).save(J(ROOT, "icons", "icon-192.png"))
    draw(512).save(J(ROOT, "icons", "icon-512.png"))
    draw(512, maskable=True).save(J(ROOT, "icons", "icon-512-maskable.png"))


def main():
    sites = load_json(J(ROOT, "data", "sites.json"))
    images = load_json(J(ROOT, "data", "images.json"), {})
    lore = {}
    for p in sorted(glob.glob(J(ROOT, "content", "lore", "*.json"))):
        for e in load_json(p, []):
            lore[e["id"]] = e

    entries = []
    missing_lore, missing_img, with_audio = [], [], 0
    for p in sorted(glob.glob(J(ROOT, "content", "skeleton", "*.json"))):
        for s in load_json(p, []):
            e = {k: s[k] for k in ("id", "name", "site", "area", "type", "priority") if k in s}
            e["aliases"] = s.get("aliases", [])
            if s.get("also_in"):
                e["also_in"] = s["also_in"]
            e["note"] = s.get("note", "")
            L = lore.get(s["id"])
            if L:
                for k in ("period", "summary", "look", "story", "details", "fun_fact", "narration", "related"):
                    if L.get(k):
                        e[k] = L[k]
            else:
                missing_lore.append(s["id"])
            img = J(ROOT, "img", s["id"] + ".jpg")
            if os.path.exists(img):
                e["image"] = f"img/{s['id']}.jpg"
                info = images.get(s["id"])
                if info:
                    credit = " ".join(x for x in [info.get("artist", ""), info.get("license", "")] if x).strip()
                    e["image_credit"] = re.sub(r"\s+", " ", credit)[:90]
                    e["image_source"] = info.get("source")
            else:
                missing_img.append(s["id"])
            mp3 = J(ROOT, "audio", s["id"] + ".mp3")
            if os.path.exists(mp3):
                e["audio"] = f"audio/{s['id']}.mp3"
                e["audio_secs"] = mp3_seconds(mp3)
                with_audio += 1
            # sources: wikipedia titles
            titles = s.get("wiki") or []
            if isinstance(titles, str):
                titles = [titles]
            e["sources"] = ["https://en.wikipedia.org/wiki/" + t.replace(" ", "_") for t in titles[:2]]
            entries.append(e)

    os.makedirs(J(ROOT, "data"), exist_ok=True)
    with open(J(ROOT, "data", "entries.json"), "w", encoding="utf-8") as f:
        json.dump(entries, f, ensure_ascii=False, separators=(",", ":"))

    # ---- assets manifest (per-site packs)
    version = time.strftime("%Y%m%d-%H%M")
    packs = {}
    for site in sites:
        files, bytes_ = [], 0
        for e in entries:
            if e["site"] != site["id"]:
                continue
            for k in ("image", "audio"):
                if e.get(k):
                    files.append(e[k]); bytes_ += os.path.getsize(J(ROOT, e[k]))
        packs[site["id"]] = {"name": site["name"], "files": files, "bytes": bytes_}
    pf = sorted(glob.glob(J(ROOT, "audio", "phrases", "*.mp3")))
    packs["phrases"] = {"name": "Phrasebook audio", "files": ["audio/phrases/" + os.path.basename(p) for p in pf], "bytes": sum(os.path.getsize(p) for p in pf)}
    docs = []
    for p in sorted(glob.glob(J(ROOT, "docs", "*.pdf"))):
        name = {"evisa.pdf": "Egypt e-Visa", "gem-tickets.pdf": "Grand Egyptian Museum tickets"}.get(os.path.basename(p), os.path.basename(p))
        docs.append({"file": "docs/" + os.path.basename(p), "name": name, "bytes": os.path.getsize(p)})
    packs["docs"] = {"name": "Documents (tickets, visa)", "files": [d["file"] for d in docs], "bytes": sum(d["bytes"] for d in docs)}
    assets = {"version": version, "packs": packs, "docs": docs}
    with open(J(ROOT, "data", "assets.json"), "w", encoding="utf-8") as f:
        json.dump(assets, f, ensure_ascii=False, separators=(",", ":"))

    # ---- service worker version
    sw = J(ROOT, "sw.js")
    with open(sw, encoding="utf-8") as f:
        src = f.read()
    src = re.sub(r"const VERSION = '[^']*';", f"const VERSION = '{version}';", src, count=1)
    with open(sw, "w", encoding="utf-8") as f:
        f.write(src)

    make_icons()
    total = sum(p["bytes"] for p in packs.values())
    print(f"version {version}: {len(entries)} entries, {len(entries)-len(missing_img)} images, {with_audio} audio, lore missing {len(missing_lore)}, packs total {total/1e6:.0f} MB")
    if missing_lore:
        print("no lore yet:", len(missing_lore), "e.g.", ", ".join(missing_lore[:8]))
    if missing_img:
        print("no image:", len(missing_img), "e.g.", ", ".join(missing_img[:12]))


if __name__ == "__main__":
    main()
