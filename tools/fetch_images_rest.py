#!/usr/bin/env python3
"""Photo fetcher that avoids the throttled MediaWiki action API.

For each entry without img/<id>.jpg:
  1. REST page summary of the first working Wikipedia title (edge-cached, usually allowed even when throttled)
  2. take originalimage.source, build a 1000 px thumb URL on upload.wikimedia.org (image CDN, separate from the API)
  3. download, resize, save img/<id>.jpg; record source page + file in data/images.json

Entries that share a Wikipedia title get the same lead photo (marked "shared": true) so a later pass
(fetch_wiki.py --images-only, once the API throttle lifts) can replace them with a specific Commons search hit.

    python tools/fetch_images_rest.py [--only gem,giza] [--pace 1.5]
"""
import argparse
import glob
import io
import json
import os
import re
import sys
import time
import urllib.parse

import requests
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKEL_DIR = os.path.join(ROOT, "content", "skeleton")
IMG_DIR = os.path.join(ROOT, "img")
IMAGES_JSON = os.path.join(ROOT, "data", "images.json")
REST = "https://en.wikipedia.org/api/rest_v1"
HEADERS = {"User-Agent": "EgyptGuide/0.1 (personal offline travel guide; python-requests)"}
S = requests.Session()
S.headers.update(HEADERS)
IMG_MAX, IMG_QUALITY = 1000, 82
BAD = re.compile(r"(^|[_\-\s(])(map|plan|diagram|logo|flag|icon|chart|graph|drawing|sketch|banner|collage|coat_of_arms|location|locator)([_\-\s).]|$)|\.svg|\.png$", re.I)

summary_cache = {}


def get(url, pace, **kw):
    """GET with 429/503 handling; returns Response or None on 404."""
    for attempt in range(8):
        r = S.get(url, timeout=(10, 90), **kw)
        if r.status_code == 404:
            return None
        if r.status_code in (429, 503):
            ra = float(r.headers.get("Retry-After", 0) or 0)
            if "wikimedia.org" in url and "rest_v1" not in url and (ra > 45 or attempt >= 1):
                return r  # image host throttled: let the caller try a smaller, cached size
            wait = min(ra or 10, 45)
            print(f"      {r.status_code} on {url.split('/')[2]}, waiting {wait:.0f}s", flush=True)
            time.sleep(wait)
            continue
        if r.status_code >= 500:
            time.sleep(5)
            continue
        time.sleep(pace)
        return r
    return None


def summary(title, pace):
    if title in summary_cache:
        return summary_cache[title]
    q = urllib.parse.quote(title.replace(" ", "_"), safe="")
    r = get(f"{REST}/page/summary/{q}?redirect=true", pace)
    s = None
    if r is not None and r.status_code == 200:
        d = r.json()
        if d.get("type") not in ("disambiguation",) and d.get("title"):
            s = d
    summary_cache[title] = s
    return s


def thumb_candidates(summary_json):
    """Build thumbnail URLs from the summary's own thumbnail URL (thumb.wikimedia.org), largest first.
    Sizes above the original width are skipped (the thumbnailer answers 400 for those)."""
    th = (summary_json.get("thumbnail") or {}).get("source", "").split("?")[0]
    orig = summary_json.get("originalimage") or {}
    width = orig.get("width") or 10000
    out = []
    if th and re.search(r"/\d+px-", th):
        # the thumbnail host only serves bucket sizes: 250, 330, 500, 960, 1280, 1920
        for w in (960, 500):
            if w < width:
                out.append(re.sub(r"/\d+px-", f"/{w}px-", th, count=1))
        out.append(th)  # 330 px, the size the API itself serves (always cached)
    src = orig.get("source", "").split("?")[0]
    if src:
        out.append(src)
    return out


def save_image(url, out_path, pace):
    r = get(url, pace)
    if r is None or r.status_code != 200 or not r.headers.get("Content-Type", "").startswith("image/"):
        return False
    if len(r.content) < 3000:
        return False
    im = Image.open(io.BytesIO(r.content)).convert("RGB")
    im.thumbnail((IMG_MAX, IMG_MAX))
    im.save(out_path, "JPEG", quality=IMG_QUALITY, optimize=True, progressive=True)
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    ap.add_argument("--pace", type=float, default=1.5)
    ap.add_argument("--priority", type=int, default=3, help="only entries with priority <= this")
    args = ap.parse_args()
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        pass
    os.makedirs(IMG_DIR, exist_ok=True)
    images = {}
    if os.path.exists(IMAGES_JSON):
        with open(IMAGES_JSON, encoding="utf-8") as f:
            images = json.load(f)
    only = {s.strip() for s in args.only.split(",") if s.strip()}
    entries = []
    for path in sorted(glob.glob(os.path.join(SKEL_DIR, "*.json"))):
        stem = os.path.splitext(os.path.basename(path))[0]
        if only and stem not in only:
            continue
        with open(path, encoding="utf-8") as f:
            entries.extend(load for load in json.load(f))
    entries = [e for e in entries if e.get("priority", 2) <= args.priority]
    entries.sort(key=lambda e: e.get("priority", 2))
    todo = [e for e in entries if not os.path.exists(os.path.join(IMG_DIR, e["id"] + ".jpg"))]
    print(f"{len(todo)} entries need a photo (of {len(entries)})", flush=True)
    used_files = {}
    for v in images.values():
        used_files[v.get("file")] = used_files.get(v.get("file"), 0) + 1
    ok = fail = 0
    t0 = time.time()
    for i, e in enumerate(todo, 1):
        out = os.path.join(IMG_DIR, e["id"] + ".jpg")
        titles = e.get("wiki") or []
        if isinstance(titles, str):
            titles = [titles]
        got = False
        for t in titles:
            s = summary(t, args.pace)
            if not s:
                continue
            src = (s.get("originalimage") or {}).get("source") or (s.get("thumbnail") or {}).get("source")
            if not src:
                continue
            fname = urllib.parse.unquote(src.split("?")[0].rsplit("/", 1)[-1])
            if BAD.search(fname):
                continue
            for cand in thumb_candidates(s):
                try:
                    if save_image(cand, out, args.pace):
                        got = True
                        break
                except Exception as ex:  # noqa: BLE001
                    print(f"      download error: {str(ex)[:80]}", flush=True)
            if got:
                shared = used_files.get(fname, 0) > 0
                used_files[fname] = used_files.get(fname, 0) + 1
                images[e["id"]] = {"file": fname, "artist": "", "license": "", "credit": "Wikimedia Commons",
                                   "source": "https://commons.wikimedia.org/wiki/File:" + fname.replace(" ", "_"),
                                   "page": (s.get("content_urls") or {}).get("desktop", {}).get("page", ""), "shared": shared}
                print(f"[{i}/{len(todo)}] OK  {e['id']}  <- {s['title']}{' (shared)' if shared else ''}", flush=True)
                break
        if not got:
            fail += 1
            print(f"[{i}/{len(todo)}] --  {e['id']}  no usable lead image for {titles}", flush=True)
        else:
            ok += 1
        if i % 10 == 0:
            with open(IMAGES_JSON, "w", encoding="utf-8") as f:
                json.dump(images, f, ensure_ascii=False, indent=1)
    with open(IMAGES_JSON, "w", encoding="utf-8") as f:
        json.dump(images, f, ensure_ascii=False, indent=1)
    print(f"done: {ok} ok, {fail} without image, {(time.time()-t0)/60:.1f} min", flush=True)


if __name__ == "__main__":
    main()
