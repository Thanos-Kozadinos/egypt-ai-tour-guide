#!/usr/bin/env python3
"""Fetch Wikipedia text and a photo for every skeleton entry.

Usage:
    python tools/fetch_wiki.py                 # all sites
    python tools/fetch_wiki.py --only gem,giza # some sites
    python tools/fetch_wiki.py --force         # refetch even if files exist
    python tools/fetch_wiki.py --images-only   # skip text

Writes:
    content/wiki/<id>.txt        plain-text extract (grounding for the lore writers)
    img/<id>.jpg                 photo, max 1000 px, JPEG
    data/images.json             {id: {file, artist, license, credit, source_page}}
    content/fetch_report.json    what was found / missing
"""
import argparse
import concurrent.futures as cf
import glob
import io
import json
import os
import re
import sys
import threading
import time

import urllib.parse
from html.parser import HTMLParser

import requests
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKEL_DIR = os.path.join(ROOT, "content", "skeleton")
WIKI_DIR = os.path.join(ROOT, "content", "wiki")
IMG_DIR = os.path.join(ROOT, "img")
IMAGES_JSON = os.path.join(ROOT, "data", "images.json")
REPORT_JSON = os.path.join(ROOT, "content", "fetch_report.json")

WIKI_API = "https://en.wikipedia.org/w/api.php"
COMMONS_API = "https://commons.wikimedia.org/w/api.php"
HEADERS = {"User-Agent": "EgyptGuide/0.1 (personal offline travel guide; python-requests)"}
MAX_TEXT = 14000
IMG_MAX = 1000
IMG_QUALITY = 82

_lock = threading.Lock()
_session = requests.Session()
_session.headers.update(HEADERS)


def api(url, **params):
    params.update(format="json", formatversion=2, maxlag=5)
    last = None
    for attempt in range(7):
        try:
            r = _session.get(url, params=params, timeout=40)
            if r.status_code in (429, 503):
                wait = min(float(r.headers.get("Retry-After", 0) or 0) or 4 * (attempt + 1), 45)
                time.sleep(wait)
                last = f"HTTP {r.status_code}"
                continue
            r.raise_for_status()
            d = r.json()
            if "error" in d:  # maxlag or ratelimited come back as 200 + error
                last = d["error"].get("code")
                time.sleep(4 * (attempt + 1))
                continue
            time.sleep(0.15)
            return d
        except requests.RequestException as e:
            last = str(e)[:80]
            time.sleep(3 * (attempt + 1))
    raise RuntimeError(f"api gave up: {last}")


def strip_html(s):
    return re.sub(r"<[^>]+>", "", s or "").strip()


REST = "https://en.wikipedia.org/api/rest_v1"
STOP_SECTIONS = {"references", "see also", "external links", "notes", "bibliography", "further reading", "sources", "citations", "footnotes", "gallery"}


def rest_get(path, as_json=True):
    last = None
    for attempt in range(5):
        try:
            r = _session.get(REST + path, timeout=(10, 60))
            if r.status_code == 404:
                return None
            if r.status_code in (429, 503):
                time.sleep(min(float(r.headers.get("Retry-After", 0) or 0) or 3 * (attempt + 1), 30))
                last = r.status_code
                continue
            r.raise_for_status()
            return r.json() if as_json else r.text
        except requests.RequestException as e:
            last = str(e)[:80]
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"rest gave up {path}: {last}")


class _Text(HTMLParser):
    """Parsoid HTML -> readable plain text (skips tables, figures, refs, infoboxes, navboxes)."""
    SKIP_TAGS = {"table", "style", "script", "sup", "figure", "figcaption", "math", "noscript", "ol.references"}
    SKIP_CLASS = ("mw-editsection", "infobox", "navbox", "reflist", "hatnote", "thumb", "mw-ref", "noprint", "reference", "sidebar", "metadata", "ambox", "mbox", "toc", "gallery", "wikitable", "mw-empty-elt", "shortdescription", "IPA")
    BLOCK = {"p", "li", "h2", "h3", "h4", "dd", "dt", "blockquote"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.blocks, self.cur, self.stack, self.skip, self.stop = [], [], [], 0, False

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        cls = a.get("class") or ""
        skipper = tag in self.SKIP_TAGS or any(c in cls for c in self.SKIP_CLASS) or a.get("role") in ("navigation", "note") or (tag == "section" and a.get("data-mw-section-id", "1").startswith("-"))
        self.stack.append((tag, skipper))
        if skipper:
            self.skip += 1
            return
        if self.skip or self.stop:
            return
        if tag in self.BLOCK:
            self._flush()
            self.cur_tag = tag
        elif tag == "br":
            self.cur.append(" ")

    def handle_endtag(self, tag):
        # pop to the matching tag
        while self.stack:
            t, skipper = self.stack.pop()
            if skipper:
                self.skip = max(0, self.skip - 1)
            if t == tag:
                break
        if tag in self.BLOCK and not self.skip:
            self._flush()

    def handle_startendtag(self, tag, attrs):
        if tag == "br" and not self.skip:
            self.cur.append(" ")

    def handle_data(self, data):
        if not self.skip and not self.stop:
            self.cur.append(data)

    def _flush(self):
        txt = re.sub(r"\s+", " ", "".join(self.cur)).strip()
        self.cur = []
        tag = getattr(self, "cur_tag", "p")
        if not txt:
            return
        if tag in ("h2", "h3", "h4"):
            if txt.lower().strip(" :") in STOP_SECTIONS and tag == "h2":
                self.stop = True
                return
            self.blocks.append(f"\n== {txt} ==")
        elif tag == "li":
            self.blocks.append("- " + txt)
        else:
            self.blocks.append(txt)

    def text(self):
        self._flush()
        return "\n".join(self.blocks).strip()


def wiki_page(title):
    """Return dict(title, extract, pageimage, url) or None if the page is missing.
    Uses the fast, CDN-cached REST endpoints (summary + Parsoid HTML)."""
    q = urllib.parse.quote(title.replace(" ", "_"), safe="")
    s = rest_get(f"/page/summary/{q}?redirect=true")
    if not s or s.get("type") in ("disambiguation", "no-extract") or not s.get("title"):
        return None
    real = s["title"]
    html = rest_get(f"/page/html/{urllib.parse.quote(real.replace(' ', '_'), safe='')}?redirect=true", as_json=False)
    extract = ""
    if html:
        p = _Text()
        try:
            p.feed(html)
            extract = p.text()
        except Exception:  # noqa: BLE001
            extract = ""
    if len(extract) < 400:
        extract = s.get("extract", "") or ""
    if len(extract) < 200:
        return None
    pageimage = None
    src = (s.get("originalimage") or {}).get("source") or (s.get("thumbnail") or {}).get("source")
    if src:
        src = src.split("?")[0]
        fn = urllib.parse.unquote(src.rsplit("/", 1)[-1])
        fn = re.sub(r"^\d+px-", "", fn)
        if "/thumb/" in src:
            # thumb URLs end with /<size>px-<name>; the original name is the segment before
            parts = src.split("/")
            if len(parts) >= 2:
                fn = urllib.parse.unquote(parts[-2])
        pageimage = fn
    url = (s.get("content_urls") or {}).get("desktop", {}).get("page") or f"https://en.wikipedia.org/wiki/{q}"
    return {"title": real, "extract": extract, "pageimage": pageimage, "url": url}


def image_info(filename, api_url=WIKI_API):
    d = api(api_url, action="query", prop="imageinfo", iiprop="url|extmetadata|mime|size",
            iiurlwidth=IMG_MAX, titles="File:" + filename)
    pages = d.get("query", {}).get("pages", [])
    if not pages or "imageinfo" not in pages[0]:
        return None
    ii = pages[0]["imageinfo"][0]
    md = ii.get("extmetadata", {}) or {}

    def g(k):
        return strip_html(md.get(k, {}).get("value", ""))

    url = ii.get("thumburl") or ii.get("url")
    if not url:
        return None
    return {"file": filename, "url": url, "mime": ii.get("mime"), "artist": g("Artist")[:120],
            "license": g("LicenseShortName"), "credit": g("Credit")[:160],
            "source": "https://commons.wikimedia.org/wiki/File:" + filename.replace(" ", "_")}


BAD_IMAGE_WORDS = re.compile(r"(map|plan|diagram|logo|flag|icon|svg|coat of arms|location|locator|chart|graph|drawing|sketch|cartouche|hieroglyph.*\.svg)", re.I)


def commons_search(query, want=1):
    d = api(COMMONS_API, action="query", list="search", srsearch=query, srnamespace=6, srlimit=12)
    out = []
    for hit in d.get("query", {}).get("search", []):
        t = hit["title"]
        if not re.search(r"\.(jpe?g|png)$", t, re.I):
            continue
        if BAD_IMAGE_WORDS.search(t):
            continue
        out.append(t[5:])
        if len(out) >= want:
            break
    return out


def save_image(url, out_path):
    r = _session.get(url, timeout=90)
    r.raise_for_status()
    im = Image.open(io.BytesIO(r.content))
    im = im.convert("RGB")
    im.thumbnail((IMG_MAX, IMG_MAX))
    im.save(out_path, "JPEG", quality=IMG_QUALITY, optimize=True, progressive=True)
    return os.path.getsize(out_path)


def process(entry, images_only=False, force=False, text_only=False):
    eid = entry["id"]
    res = {"id": eid, "text": None, "image": None, "notes": []}
    txt_path = os.path.join(WIKI_DIR, eid + ".txt")
    img_path = os.path.join(IMG_DIR, eid + ".jpg")
    candidates = entry.get("wiki") or []
    if isinstance(candidates, str):
        candidates = [candidates]
    need_text = (not images_only) and (force or not os.path.exists(txt_path))
    need_img = (not text_only) and (force or not os.path.exists(img_path))
    if not need_text and not need_img:
        res["text"] = "(exists)" if os.path.exists(txt_path) else None
        res["image"] = "(exists)" if os.path.exists(img_path) else None
        return res

    page = None
    pages_tried = []
    for t in candidates:
        try:
            page = wiki_page(t)
        except Exception as e:  # noqa: BLE001
            res["notes"].append(f"wiki error {t}: {e}")
            page = None
        pages_tried.append(t)
        if page:
            break

    # ---- text
    if not images_only:
        if page and (force or not os.path.exists(txt_path)):
            header = f"# {page['title']}\n# source: {page['url']}\n\n"
            with open(txt_path, "w", encoding="utf-8") as f:
                f.write(header + page["extract"][:MAX_TEXT])
            res["text"] = page["title"]
            # also append extra candidate pages (second source) if more than one resolves
            for t in candidates[1:3]:
                try:
                    p2 = wiki_page(t)
                except Exception:  # noqa: BLE001
                    p2 = None
                if p2 and p2["title"] != page["title"]:
                    with open(txt_path, "a", encoding="utf-8") as f:
                        f.write(f"\n\n# ---- {p2['title']}\n# source: {p2['url']}\n\n" + p2["extract"][:6000])
        elif os.path.exists(txt_path):
            res["text"] = "(exists)"
        else:
            res["notes"].append("no wikipedia page found: " + ", ".join(pages_tried))

    # ---- image
    if os.path.exists(img_path) and not force:
        res["image"] = "(exists)"
        return res
    if text_only:
        return res

    info = None
    tried = []
    # 1. explicit commons search term wins when given (more specific than page image)
    if entry.get("commons"):
        for fn in commons_search(entry["commons"], want=2):
            tried.append(fn)
            info = image_info(fn, COMMONS_API)
            if info and (info.get("mime") or "").startswith("image/"):
                break
            info = None
    # 2. page image of the Wikipedia article
    if not info and page and page.get("pageimage"):
        tried.append(page["pageimage"])
        info = image_info(page["pageimage"], WIKI_API)
        if info and BAD_IMAGE_WORDS.search(page["pageimage"]):
            info = None
    # 3. fall back to a commons search by entry name
    if not info:
        q = re.sub(r"[:(),'\"]", " ", entry["name"])
        for fn in commons_search(q, want=2):
            tried.append(fn)
            info = image_info(fn, COMMONS_API)
            if info:
                break
    if not info:
        res["notes"].append("no image found; tried: " + "; ".join(tried[:4]))
        return res
    try:
        size = save_image(info["url"], img_path)
        res["image"] = info["file"]
        res["image_size"] = size
        with _lock:
            IMAGES[eid] = {"file": info["file"], "artist": info["artist"], "license": info["license"],
                           "credit": info["credit"], "source": info["source"]}
    except Exception as e:  # noqa: BLE001
        res["notes"].append(f"image download failed {info.get('file')}: {e}")
    return res


IMAGES = {}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="", help="comma list of site ids / skeleton file stems")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--images-only", action="store_true")
    ap.add_argument("--text-only", action="store_true")
    ap.add_argument("--workers", type=int, default=2)
    args = ap.parse_args()
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        pass

    os.makedirs(WIKI_DIR, exist_ok=True)
    os.makedirs(IMG_DIR, exist_ok=True)
    if os.path.exists(IMAGES_JSON):
        with open(IMAGES_JSON, encoding="utf-8") as f:
            IMAGES.update(json.load(f))

    only = {s.strip() for s in args.only.split(",") if s.strip()}
    entries = []
    for path in sorted(glob.glob(os.path.join(SKEL_DIR, "*.json"))):
        stem = os.path.splitext(os.path.basename(path))[0]
        if only and stem not in only:
            continue
        with open(path, encoding="utf-8") as f:
            entries.extend(json.load(f))
    print(f"{len(entries)} entries", flush=True)

    results = []
    t0 = time.time()
    with cf.ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(process, e, args.images_only, args.force, args.text_only): e for e in entries}
        for i, fut in enumerate(cf.as_completed(futs), 1):
            e = futs[fut]
            try:
                r = fut.result()
            except Exception as exc:  # noqa: BLE001
                r = {"id": e["id"], "text": None, "image": None, "notes": [f"crash: {exc}"]}
            results.append(r)
            flag = ("T" if r.get("text") else "-") + ("I" if r.get("image") else "-")
            print(f"[{i:3}/{len(entries)}] {flag} {r['id']}" + (f"  !! {r['notes'][0]}" if r["notes"] else ""), flush=True)
            if i % 20 == 0:
                with _lock, open(IMAGES_JSON, "w", encoding="utf-8") as f:
                    json.dump(IMAGES, f, ensure_ascii=False, indent=1)

    with open(IMAGES_JSON, "w", encoding="utf-8") as f:
        json.dump(IMAGES, f, ensure_ascii=False, indent=1)
    results.sort(key=lambda r: r["id"])
    with open(REPORT_JSON, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=1)
    no_text = [r["id"] for r in results if not r.get("text")]
    no_img = [r["id"] for r in results if not r.get("image")]
    total_img = sum(os.path.getsize(p) for p in glob.glob(os.path.join(IMG_DIR, "*.jpg")))
    print(f"\ndone in {time.time()-t0:.0f}s. missing text: {len(no_text)}  missing image: {len(no_img)}  images total: {total_img/1e6:.1f} MB")
    if no_text:
        print("NO TEXT:", ", ".join(no_text))
    if no_img:
        print("NO IMAGE:", ", ".join(no_img))


if __name__ == "__main__":
    main()
