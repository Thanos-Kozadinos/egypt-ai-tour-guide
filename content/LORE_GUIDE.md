# Lore writing guide (for the entry writers)

You are writing the content of a personal offline "e-Egyptologist" app for two travellers (a Greek couple) visiting Egypt 10-24 October 2026. Each entry is read on a phone while standing in front of the thing, and a narration is spoken by a text-to-speech voice through earphones. Write like a brilliant, warm Egyptologist friend who walks beside them: concrete, vivid, honest, a little funny, never pompous, no travel-brochure clichés ("nestled", "breathtaking", "step back in time"). British or neutral English. Address the reader as "you" when useful. The reader knows nothing and is smart.

## Inputs
- Your skeleton file: `content/skeleton/<site>.json`. Each object has: `id`, `name`, `site`, `area`, `type`, `priority` (1 must-see, 2 good, 3 short), `wiki` (Wikipedia titles used as sources), `aliases`, and `note`: hints from the editor about what the entry should cover and any caveats. Follow the note. If the note says "Short", keep it short. If it says LOCATION UNCERTAIN, say so plainly in the text (one sentence) and never promise which museum room it is in.
- Grounding text: `content/wiki/<id>.txt` (plain-text Wikipedia extract; may be missing for some ids). Read it before writing the entry. Take dates, measurements, names and discovery stories from it. Where it disagrees with the note, trust the Wikipedia text for facts and the note for scope. If the file is missing, write from solid general knowledge, keep numbers conservative, and hedge ("about", "around").
- `content/all_ids.txt`: every entry id in the whole app (id, site, name). Use it only for the `related` field.

## Output
Write JSON files `content/lore/<site>-<n>.json` (n = 1, 2, 3...), each a JSON array with AT MOST 12 entries, in the same order as the skeleton, until every id of your skeleton is covered exactly once. Use the Write tool. Valid JSON only: double quotes, escape inner quotes, no trailing commas, no comments, no markdown fences. After writing all files run:

    python -I tools/check_lore.py <site>

and fix whatever it reports until it prints OK.

Each object:

```json
{
  "id": "same id as the skeleton",
  "period": "short dating line, e.g. New Kingdom, 18th Dynasty, c. 1323 BC  |  Ptolemaic, 237-57 BC  |  Mamluk, 1356-1363  |  empty string if it makes no sense",
  "summary": "ONE sentence hook, max 160 characters. Why this matters or what is surprising.",
  "look": "2-4 sentences. What you are physically looking at, how big, which way to face, where the famous bit is. Practical orientation.",
  "story": "2-4 short paragraphs separated by a blank line (\\n\\n). 150-320 words for priority 1, 120-220 for priority 2, 70-140 for priority 3. The history and the human stories: who made it, why, what happened to it, who found it, what people argue about. Concrete names, dates and numbers. Correct the usual myths when relevant.",
  "details": ["3 to 5 strings, each max 140 characters: specific things to spot right now, with where to find them (left wall, under the window, behind the third pillar)."],
  "fun_fact": "1-2 sentences. Something a good guide would say to make them smile or gasp.",
  "narration": "THE SPOKEN SCRIPT. See rules below.",
  "related": ["0 to 4 ids from content/all_ids.txt that genuinely connect (same king, same story, the object this came from, the place to see next). Never ids that do not exist."]
}
```

## Narration rules (the most important field)
- It is spoken aloud by a TTS voice while the traveller looks at the thing. Natural spoken English, complete sentences, no bullet points, no headings, no markdown, no parentheses, no slashes, no abbreviations that read badly (write "about 1323 BC", "Dynasty 18", "Howard Carter", not "c.", "Dyn.", "H. Carter"). Tomb numbers as "K V 62" and "T T 1" with spaces so the voice spells them. Write "metres" and numbers as digits.
- Start with one orienting sentence that tells them what they are looking at. End with one concrete detail to look for right now.
- It should be self-contained (someone may only listen), but it does not need to repeat the text fields word for word. It is the guide talking, with the best 60-80 percent of the material, told as a story.
- Length by priority: priority 1: 1,100-1,350 characters. Priority 2: 800-1,050 characters. Priority 3: 450-700 characters. Count characters, not words. These limits control the ElevenLabs budget; the checker enforces them.
- Pronunciation help: write names the way they are usually said in English (Hatshepsut, Thutmose, Ramesses, Deir el-Bahari, Khufu). Use "Tutankhamun". Avoid diacritics in the narration (write "Ma'at" as "Maat", "Sa'im" as "Saim").

## Accuracy rules
- No invented quotations, dimensions or dates. If the sources do not give a number, do not give one.
- Say "most Egyptologists think" or "one theory is" for contested points (who the Sphinx is, how the pyramids were built, Akhenaten's body, Nefertiti's fate, the KV62 hidden chamber).
- Museum locations: objects moved between the Egyptian Museum (Tahrir), the Grand Egyptian Museum and NMEC in 2021-2025. Where the note says LOCATION UNCERTAIN, write "You may find this at the Grand Egyptian Museum or still at the Tahrir museum; trust the label." Never state a gallery number.
- Royal mummies are at NMEC (Fustat), not at GEM or Tahrir, since April 2021.
- Keep modern politics out. Keep tipping advice friendly and non-judgmental.
- The travellers are Greek: when a Greek connection is real (Herodotus, Alexander, Ptolemies, Greek mercenaries' graffiti, Alexandria, Greek words), mention it in one line. Do not force it.
- Dates of this trip for cross-references: GEM 11 Oct, Giza 12 Oct, Siwa 13-15, Islamic Cairo 16, Abu Simbel 17, Aswan 18-19, Kom Ombo/Edfu/Esna 20, Luxor West 21, Luxor East 22. You may say "you will see X on the 21st".

## Style rules
- Short sentences. One idea per sentence. Verbs. Concrete nouns.
- No em dashes. Use commas, full stops or colons.
- No lists of adjectives. No "iconic", "stunning", "awe-inspiring", "testament to".
- Tell the human story: the workman who signed the ceiling, the queen's letter, the earl's mosquito, the water boy who found the step.
- Vary openings. Not every entry starts with "This is".
- Do not repeat the entry name in the first sentence of `story` if `look` already said it.
