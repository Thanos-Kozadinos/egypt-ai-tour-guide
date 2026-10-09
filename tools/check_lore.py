#!/usr/bin/env python3
"""Validate lore files for one site:  python -I tools/check_lore.py <site>
Checks: valid JSON, every skeleton id present exactly once, required fields, narration length by priority,
related ids exist, no markdown/em dashes in narration, details count.
"""
import glob
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIMITS = {1: (1100, 1350), 2: (800, 1050), 3: (450, 700)}
TOL = 0.12  # 12% tolerance before it is an error


def main():
    if len(sys.argv) < 2:
        sys.exit("usage: check_lore.py <site>")
    site = sys.argv[1]
    skel_path = os.path.join(ROOT, "content", "skeleton", site + ".json")
    if not os.path.exists(skel_path):
        sys.exit(f"no skeleton {skel_path}")
    with open(skel_path, encoding="utf-8") as f:
        skel = json.load(f)
    want = {e["id"]: e for e in skel}
    all_ids = set()
    ap = os.path.join(ROOT, "content", "all_ids.txt")
    if os.path.exists(ap):
        with open(ap, encoding="utf-8") as f:
            all_ids = {line.split("\t")[0].strip() for line in f if line.strip()}

    files = sorted(glob.glob(os.path.join(ROOT, "content", "lore", site + "-*.json")) + glob.glob(os.path.join(ROOT, "content", "lore", site + ".json")))
    if not files:
        sys.exit(f"ERROR: no lore files content/lore/{site}-*.json")
    errors, warns = [], []
    seen = {}
    for p in files:
        try:
            with open(p, encoding="utf-8") as f:
                arr = json.load(f)
        except Exception as e:  # noqa: BLE001
            errors.append(f"{os.path.basename(p)}: invalid JSON: {e}")
            continue
        if not isinstance(arr, list):
            errors.append(f"{os.path.basename(p)}: top level must be a list")
            continue
        for e in arr:
            eid = e.get("id")
            if eid not in want:
                errors.append(f"{os.path.basename(p)}: unknown id {eid}")
                continue
            if eid in seen:
                errors.append(f"{eid}: duplicated (also in {seen[eid]})")
            seen[eid] = os.path.basename(p)
            pr = want[eid].get("priority", 2)
            for k in ("summary", "look", "story", "details", "fun_fact", "narration"):
                if not e.get(k):
                    errors.append(f"{eid}: missing {k}")
            if "period" not in e:
                warns.append(f"{eid}: no period field (use empty string if none)")
            d = e.get("details") or []
            if not (3 <= len(d) <= 5):
                errors.append(f"{eid}: details must have 3-5 items, has {len(d)}")
            for x in d:
                if len(x) > 160:
                    warns.append(f"{eid}: detail too long ({len(x)}): {x[:50]}...")
            if len(e.get("summary", "")) > 180:
                warns.append(f"{eid}: summary long ({len(e['summary'])})")
            n = e.get("narration", "")
            lo, hi = LIMITS.get(pr, LIMITS[2])
            if n and not (lo * (1 - TOL) <= len(n) <= hi * (1 + TOL)):
                errors.append(f"{eid}: narration {len(n)} chars, priority {pr} wants {lo}-{hi}")
            elif n and not (lo <= len(n) <= hi):
                warns.append(f"{eid}: narration {len(n)} chars, slightly outside {lo}-{hi}")
            if re.search(r"[*#_`\[\]{}|<>]|—|–", n):
                errors.append(f"{eid}: narration has markdown or dashes (— – * # _ ` [ ] | < >)")
            if re.search(r"\(|\)", n):
                warns.append(f"{eid}: narration has parentheses")
            if re.search(r"\bc\.\s?\d", n):
                errors.append(f"{eid}: narration uses 'c.' abbreviation; write 'about'")
            if re.search(r"\b(KV|TT|QV)\d", n):
                errors.append(f"{eid}: narration has KV/TT/QV glued to a number; write 'K V 62'")
            for r in e.get("related", []) or []:
                if all_ids and r not in all_ids:
                    errors.append(f"{eid}: related id does not exist: {r}")
            story_words = len(re.findall(r"\w+", e.get("story", "")))
            if story_words > 420:
                warns.append(f"{eid}: story is long ({story_words} words)")
    missing = [i for i in want if i not in seen]
    if missing:
        errors.append(f"missing {len(missing)} ids: {', '.join(missing)}")
    for w in warns:
        print("warn:", w)
    for er in errors:
        print("ERROR:", er)
    total_chars = 0
    for p in files:
        try:
            with open(p, encoding="utf-8") as f:
                total_chars += sum(len(e.get("narration", "")) for e in json.load(f))
        except Exception:  # noqa: BLE001
            pass
    print(f"{site}: {len(seen)}/{len(want)} entries in {len(files)} files, narration chars {total_chars:,}, errors {len(errors)}, warnings {len(warns)}")
    if errors:
        sys.exit(1)
    print("OK")


if __name__ == "__main__":
    main()
