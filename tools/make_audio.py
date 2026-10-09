#!/usr/bin/env python3
"""ElevenLabs batch text-to-speech for the Egypt guide.

Reads ELEVENLABS_API_KEY from .env in the project root (never printed).

Commands:
    python tools/make_audio.py status                       credits left + what the plan would cost
    python tools/make_audio.py voices                       voices in your account
    python tools/make_audio.py library "egyptian arabic"    search the public voice library (Arabic voices)
    python tools/make_audio.py add <public_owner_id> <voice_id> "<name>"   copy a library voice into your account
    python tools/make_audio.py sample <voice_id> [model_id] [en|ar]       one test clip -> audio/samples/
    python tools/make_audio.py entries --voice <voice_id> [--model eleven_flash_v2_5] [--only gem,giza] [--dry] [--limit N]
    python tools/make_audio.py phrases --voice <voice_id> [--model eleven_v3] [--dry]

Default models: English narration eleven_flash_v2_5 (0.5 credits per character),
Arabic phrases eleven_v3 (1 credit per character; falls back to eleven_multilingual_v2 if rejected).
Output: 64 kbps mono MP3 (about 0.5 MB per minute).
"""
import argparse
import json
import os
import sys
import time

import requests

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENTRIES_JSON = os.path.join(ROOT, "data", "entries.json")
PHRASES_JSON = os.path.join(ROOT, "data", "phrases.json")
AUDIO_DIR = os.path.join(ROOT, "audio")
PHRASE_DIR = os.path.join(AUDIO_DIR, "phrases")
SAMPLE_DIR = os.path.join(AUDIO_DIR, "samples")
API = "https://api.elevenlabs.io/v1"
OUTPUT_FORMAT = "mp3_44100_64"
EN_MODEL = "eleven_flash_v2_5"
AR_MODEL = "eleven_v3"
AR_FALLBACK = "eleven_multilingual_v2"
CREDITS_PER_CHAR = {"eleven_flash_v2_5": 0.5, "eleven_turbo_v2_5": 0.5, "eleven_v3": 1.0, "eleven_multilingual_v2": 1.0}

SAMPLE_EN = ("You are standing in front of the gold mask of Tutankhamun. It weighs about ten kilograms, "
             "and it was made for a boy who died before he turned twenty. Look at the eyes: quartz and obsidian, "
             "set so that they seem to follow you. On the back, a spell from the Book of the Dead protects each "
             "part of his face. For more than three thousand years nobody saw it. Then, in 1925, Howard Carter "
             "lifted the lid of the third coffin, and there it was.")
SAMPLE_AR = "أهلاً. إزيك؟ بكام ده؟ غالي أوي. خلاص، شكراً. مصر جميلة أوي."


def load_key():
    env = os.path.join(ROOT, ".env")
    key = os.environ.get("ELEVENLABS_API_KEY", "")
    if not key and os.path.exists(env):
        with open(env, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith("ELEVENLABS_API_KEY="):
                    key = line.split("=", 1)[1].strip().strip('"').strip("'")
    if not key:
        sys.exit("ELEVENLABS_API_KEY missing: put it in .env")
    return key


def headers():
    return {"xi-api-key": load_key()}


def get(path, **params):
    r = requests.get(API + path, headers=headers(), params=params, timeout=60)
    r.raise_for_status()
    return r.json()


def tts(text, voice_id, model_id, lang=None, out_path=None, retries=4):
    body = {"text": text, "model_id": model_id,
            "voice_settings": {"stability": 0.5, "similarity_boost": 0.75, "style": 0.0, "use_speaker_boost": True}}
    if lang and model_id in ("eleven_flash_v2_5", "eleven_turbo_v2_5"):
        body["language_code"] = lang
    url = f"{API}/text-to-speech/{voice_id}"
    for attempt in range(retries):
        r = requests.post(url, headers={**headers(), "Content-Type": "application/json"},
                          params={"output_format": OUTPUT_FORMAT}, json=body, timeout=180)
        if r.status_code == 200:
            if out_path:
                with open(out_path, "wb") as f:
                    f.write(r.content)
            return r.content
        if r.status_code in (429, 500, 502, 503, 504):
            wait = 5 * (attempt + 1)
            print(f"   {r.status_code}, retrying in {wait}s", flush=True)
            time.sleep(wait)
            continue
        raise RuntimeError(f"TTS failed {r.status_code}: {r.text[:300]}")
    raise RuntimeError("TTS failed after retries")


def credits():
    s = get("/user/subscription")
    used, limit = s.get("character_count", 0), s.get("character_limit", 0)
    return used, limit, limit - used, s.get("tier"), s.get("next_character_count_reset_unix")


def cmd_status(args):
    used, limit, left, tier, reset = credits()
    print(f"plan: {tier}   credits used {used:,} of {limit:,}   left: {left:,}")
    if reset:
        print("resets:", time.strftime("%Y-%m-%d", time.localtime(reset)))
    if os.path.exists(ENTRIES_JSON):
        with open(ENTRIES_JSON, encoding="utf-8") as f:
            entries = json.load(f)
        chars = sum(len(e.get("narration", "")) for e in entries)
        missing = [e for e in entries if e.get("narration") and not os.path.exists(os.path.join(AUDIO_DIR, e["id"] + ".mp3"))]
        mchars = sum(len(e["narration"]) for e in missing)
        print(f"entries: {len(entries)}  narration chars: {chars:,}  still to generate: {len(missing)} ({mchars:,} chars)")
        for m, rate in CREDITS_PER_CHAR.items():
            print(f"   {m:24s} -> {int(mchars*rate):,} credits for the missing ones")
    with open(PHRASES_JSON, encoding="utf-8") as f:
        ph = json.load(f)
    pchars = sum(len(fm["ar"]) for p in ph["phrases"] for fm in p["forms"])
    print(f"phrases: {len(ph['phrases'])} with {sum(len(p['forms']) for p in ph['phrases'])} clips, {pchars:,} Arabic chars (~{pchars} credits on v3)")


def cmd_voices(args):
    v = get("/voices")
    for x in sorted(v.get("voices", []), key=lambda x: (x.get("category", ""), x.get("name", ""))):
        labels = x.get("labels") or {}
        print(f"{x['voice_id']}  {x['name']:22s} {x.get('category',''):12s} {labels.get('accent','')} {labels.get('gender','')} {labels.get('age','')} {labels.get('use_case','')}")


def cmd_library(args):
    params = {"page_size": 30, "search": args.query}
    if args.language:
        params["language"] = args.language
    v = get("/shared-voices", **params)
    for x in v.get("voices", []):
        print(f"owner={x.get('public_owner_id')}  voice={x.get('voice_id')}  {x.get('name'):24s} {x.get('language','')} {x.get('accent','')} {x.get('gender','')} {x.get('age','')}  {x.get('description','')[:70]}")


def cmd_add(args):
    r = requests.post(f"{API}/voices/add/{args.owner}/{args.voice}", headers={**headers(), "Content-Type": "application/json"},
                      json={"new_name": args.name}, timeout=60)
    print(r.status_code, r.text[:300])


def cmd_sample(args):
    os.makedirs(SAMPLE_DIR, exist_ok=True)
    lang = args.lang
    model = args.model or (AR_MODEL if lang == "ar" else EN_MODEL)
    text = SAMPLE_AR if lang == "ar" else SAMPLE_EN
    out = os.path.join(SAMPLE_DIR, f"{args.voice}_{model}_{lang}.mp3")
    try:
        tts(text, args.voice, model, lang=lang, out_path=out)
    except RuntimeError as e:
        if lang == "ar" and model == AR_MODEL:
            print("v3 rejected, falling back to multilingual v2:", str(e)[:120])
            model = AR_FALLBACK
            out = os.path.join(SAMPLE_DIR, f"{args.voice}_{model}_{lang}.mp3")
            tts(text, args.voice, model, lang=lang, out_path=out)
        else:
            raise
    print("wrote", out, os.path.getsize(out), "bytes")


def cmd_entries(args):
    with open(ENTRIES_JSON, encoding="utf-8") as f:
        entries = json.load(f)
    only = {s.strip() for s in args.only.split(",") if s.strip()}
    todo = []
    for e in entries:
        if only and e.get("site") not in only:
            continue
        text = e.get("narration", "").strip()
        if not text:
            continue
        out = os.path.join(AUDIO_DIR, e["id"] + ".mp3")
        if os.path.exists(out) and not args.force:
            continue
        todo.append((e, text, out))
    todo.sort(key=lambda t: (t[0].get("priority", 2), t[0]["id"]))
    if args.limit:
        todo = todo[: args.limit]
    chars = sum(len(t[1]) for t in todo)
    rate = CREDITS_PER_CHAR.get(args.model, 1.0)
    print(f"{len(todo)} clips, {chars:,} chars, ~{int(chars*rate):,} credits with {args.model}")
    if args.dry:
        return
    used, limit, left, _, _ = credits()
    if chars * rate > left:
        sys.exit(f"not enough credits: need ~{int(chars*rate):,}, have {left:,}. Use --only / --limit.")
    t0 = time.time()
    for i, (e, text, out) in enumerate(todo, 1):
        try:
            tts(text, args.voice, args.model, lang="en", out_path=out)
            print(f"[{i}/{len(todo)}] {e['id']}  {os.path.getsize(out)/1024:.0f} KB", flush=True)
        except Exception as exc:  # noqa: BLE001
            print(f"[{i}/{len(todo)}] {e['id']}  FAILED: {exc}", flush=True)
    print(f"done in {(time.time()-t0)/60:.1f} min")


def cmd_phrases(args):
    os.makedirs(PHRASE_DIR, exist_ok=True)
    with open(PHRASES_JSON, encoding="utf-8") as f:
        ph = json.load(f)
    todo = []
    for p in ph["phrases"]:
        for fm in p["forms"]:
            name = f"{p['id']}__{fm['who']}{fm['to']}.mp3"
            out = os.path.join(PHRASE_DIR, name)
            if os.path.exists(out) and not args.force:
                continue
            todo.append((p["id"], fm["ar"], out))
    chars = sum(len(t[1]) for t in todo)
    print(f"{len(todo)} clips, {chars:,} chars, ~{int(chars*CREDITS_PER_CHAR.get(args.model,1.0)):,} credits with {args.model}")
    if args.dry:
        return
    model = args.model
    for i, (pid, text, out) in enumerate(todo, 1):
        try:
            tts(text, args.voice, model, lang="ar", out_path=out)
        except RuntimeError as exc:
            if model == AR_MODEL:
                print("v3 rejected, switching to multilingual v2:", str(exc)[:120])
                model = AR_FALLBACK
                tts(text, args.voice, model, lang="ar", out_path=out)
            else:
                print(f"[{i}] {pid} FAILED: {exc}")
                continue
        print(f"[{i}/{len(todo)}] {os.path.basename(out)}", flush=True)


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("status")
    sub.add_parser("voices")
    p = sub.add_parser("library"); p.add_argument("query"); p.add_argument("--language", default="ar")
    p = sub.add_parser("add"); p.add_argument("owner"); p.add_argument("voice"); p.add_argument("name")
    p = sub.add_parser("sample"); p.add_argument("voice"); p.add_argument("model", nargs="?", default=None); p.add_argument("lang", nargs="?", default="en")
    p = sub.add_parser("entries"); p.add_argument("--voice", required=True); p.add_argument("--model", default=EN_MODEL)
    p.add_argument("--only", default=""); p.add_argument("--dry", action="store_true"); p.add_argument("--force", action="store_true"); p.add_argument("--limit", type=int, default=0)
    p = sub.add_parser("phrases"); p.add_argument("--voice", required=True); p.add_argument("--model", default=AR_MODEL)
    p.add_argument("--dry", action="store_true"); p.add_argument("--force", action="store_true")
    args = ap.parse_args()
    {"status": cmd_status, "voices": cmd_voices, "library": cmd_library, "add": cmd_add,
     "sample": cmd_sample, "entries": cmd_entries, "phrases": cmd_phrases}[args.cmd](args)


if __name__ == "__main__":
    main()
