# Egypt Guide (personal offline e-Egyptologist)

Progressive Web App: install from Chrome on the phone ("Add to Home screen"), works offline.

## Layout
- `index.html`, `app.js`, `styles.css`, `sw.js`, `manifest.webmanifest`: the app (no build step, vanilla JS)
- `data/`: `sites.json`, `itinerary.json`, `phrases.json` (hand-written); `entries.json`, `assets.json`, `images.json` (generated)
- `content/skeleton/*.json`: master list of entries (ids, names, sources, editor notes)
- `content/lore/*.json`: written texts and narration scripts (one file per batch)
- `content/wiki/`: Wikipedia extracts used as grounding (git-ignored)
- `img/`: one JPEG per entry (max 1000 px); `audio/`: one MP3 per entry; `audio/phrases/`: phrase clips
- `docs/`: PDFs available offline (visa, tickets)
- `tools/fetch_wiki.py`: Wikipedia text + Commons photo fetcher
- `tools/make_audio.py`: ElevenLabs batch TTS (reads `.env`)
- `tools/check_lore.py`: validates lore files
- `tools/build.py`: merges everything into `data/entries.json` + `data/assets.json`, makes icons, stamps `sw.js`
- `claude-project/`: instructions and knowledge file for the Claude app project used for photo identification (online)

## Rebuild
    python -I tools/fetch_wiki.py            # text + images (gentle; Wikipedia rate-limits)
    python -I tools/check_lore.py <site>     # after editing lore
    python -I tools/make_audio.py status
    python -I tools/make_audio.py entries --voice <voice_id>
    python -I tools/make_audio.py phrases --voice <voice_id>
    python -I tools/build.py
    # then commit + push (GitHub Pages) so the phone picks up the new version

## Local preview
    python -m http.server 8765   -> http://localhost:8765
