/* Egypt Guide: offline-first PWA. Vanilla JS, no build step. */
(() => {
'use strict';

const MEDIA_CACHE = 'egypt-media-v1';
const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');
const titleEl = $('#title');
const backBtn = $('#backBtn');

const state = {
  entries: [], byId: {}, sites: [], siteById: {}, itinerary: [], phrases: null, assets: null,
  speaker: localStorage.getItem('speaker') || 'm',
  favs: new Set(JSON.parse(localStorage.getItem('favs') || '[]')),
  textSize: localStorage.getItem('textSize') || 'normal',
  queue: [], qi: -1, history: [], lastSearch: '', phraseCat: localStorage.getItem('phraseCat') || 'all', phraseQ: '',
  dayOffset: 0,
};

// ---------- utils
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/['’`ʿʾ]/g, '').replace(/[^a-z0-9؀-ۿ]+/g, ' ').trim();
const fmtTime = (t) => { if (!isFinite(t)) return '0:00'; t = Math.floor(t); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
const fmtMB = (b) => (b / 1e6).toFixed(b > 1e8 ? 0 : 1) + ' MB';
const todayISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const niceDate = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
function toast(msg, ms = 2600) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), ms); }
function lev(a, b) { // small Levenshtein for typo tolerance
  if (Math.abs(a.length - b.length) > 2) return 9;
  const m = a.length, n = b.length; let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
  return prev[n];
}
function paragraphs(text) { return String(text || '').split(/\n\s*\n/).filter(Boolean).map((p) => `<p>${esc(p)}</p>`).join(''); }
function imgTag(e, cls = 'thumb') {
  if (e.image) return `<img class="${cls}" src="${esc(e.image)}" alt="" loading="lazy" onerror="this.outerHTML='<div class=&quot;${cls} ph&quot;>&#128444;</div>'">`;
  return `<div class="${cls} ph">${typeIcon(e.type)}</div>`;
}
function typeIcon(t) { return { tomb: '&#9904;', temple: '&#127963;', mosque: '&#128332;', museum: '&#127963;', object: '&#127941;', statue: '&#128511;', god: '&#9775;', person: '&#128100;', area: '&#128506;', background: '&#128214;', practical: '&#128161;', monument: '&#127963;', relief: '&#128444;', gallery: '&#128444;', experience: '&#9973;', viewpoint: '&#128247;', site: '&#128205;', palace: '&#127984;', house: '&#127968;' }[t] || '&#128205;'; }
function siteName(id) { return state.siteById[id]?.short || state.siteById[id]?.name || id; }

// ---------- data
async function loadData() {
  const get = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error(u); return r.json(); });
  const [entries, sites, itinerary, phrases] = await Promise.all([get('data/entries.json'), get('data/sites.json'), get('data/itinerary.json'), get('data/phrases.json')]);
  state.entries = entries; state.sites = sites; state.itinerary = itinerary; state.phrases = phrases;
  entries.forEach((e) => { state.byId[e.id] = e; e._n = norm(e.name); e._a = (e.aliases || []).map(norm); e._area = norm(e.area); e._site = norm(siteName(e.site)); });
  sites.forEach((s) => (state.siteById[s.id] = s));
  entries.forEach((e) => { e._site = norm(state.siteById[e.site]?.name || e.site); });
  try { state.assets = await get('data/assets.json'); } catch (e) { state.assets = null; }
}

// ---------- router
function route() {
  const h = location.hash.replace(/^#\/?/, '') || 'today';
  const [path, qs] = h.split('?');
  const parts = path.split('/').filter(Boolean);
  const params = Object.fromEntries(new URLSearchParams(qs || ''));
  const tab = parts[0] || 'today';
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === ({ entry: 'browse', site: 'browse', docs: 'more', download: 'more', identify: 'more', settings: 'more', about: 'more' }[tab] || tab)));
  const deep = ['entry', 'site', 'docs', 'download', 'identify', 'settings', 'about'].includes(tab);
  backBtn.hidden = !deep;
  window.scrollTo(0, 0);
  try {
    switch (tab) {
      case 'today': return renderToday(params);
      case 'search': return renderSearch(params);
      case 'browse': return renderBrowse();
      case 'site': return renderSite(parts[1], params);
      case 'entry': return renderEntry(parts[1]);
      case 'phrases': return renderPhrases();
      case 'more': return renderMore();
      case 'download': return renderDownload();
      case 'docs': return renderDocs();
      case 'identify': return renderIdentify();
      case 'settings': return renderSettings();
      case 'about': return renderAbout();
      default: return renderToday(params);
    }
  } catch (err) { view.innerHTML = `<div class="card">Something went wrong: ${esc(err.message)}</div>`; console.error(err); }
}
function setTitle(t) { titleEl.textContent = t; }
function entryItem(e, sub) {
  const audio = e.audio ? '<span class="badge audio">&#9654; audio</span>' : '';
  const star = e.priority === 1 ? '<span class="star">&#9733;</span> ' : '';
  return `<a class="item" href="#/entry/${e.id}">${imgTag(e)}<div class="item-main"><div class="item-title">${star}${esc(e.name)}${audio}</div><div class="item-sub">${esc(sub ?? `${siteName(e.site)} · ${e.area || ''}`)}</div></div></a>`;
}

// ---------- Today
function renderToday(params) {
  setTitle('Egypt Guide');
  const today = todayISO();
  const days = state.itinerary;
  let idx = days.findIndex((d) => d.date === today);
  if (idx < 0) idx = today < days[0].date ? 0 : days.length - 1;
  if (params.d) { const i = days.findIndex((d) => d.date === params.d); if (i >= 0) idx = i; }
  const chips = days.map((d, i) => `<a class="chip ${i === idx ? 'on' : ''}" href="#/today?d=${d.date}">${d.date === today ? 'Today' : niceDate(d.date).replace(/,.*$/, '') + ' ' + d.date.slice(8)}</a>`).join('');
  const d = days[idx];
  const items = d.items.map((it) => {
    let link = '';
    if (it.entry && state.byId[it.entry]) link = `<a href="#/entry/${it.entry}">${esc(it.text)}</a>`;
    else if (it.site && state.siteById[it.site]) link = `<a href="#/site/${it.site}">${esc(it.text)}</a>`;
    else link = `<span>${esc(it.text)}</span>`;
    const site = it.site && state.siteById[it.site] ? `<a class="chip" href="#/site/${it.site}">${esc(siteName(it.site))} &#8250;</a>` : '';
    return `<li>${link}${site}</li>`;
  }).join('');
  const siteIds = [...new Set(d.items.map((it) => it.site || (it.entry && state.byId[it.entry]?.site)).filter(Boolean))];
  const top = siteIds.flatMap((sid) => state.entries.filter((e) => e.site === sid && e.priority === 1)).slice(0, 8);
  const cached = state._cachedInfo ? '' : '';
  view.innerHTML = `
    <div class="chips">${chips}</div>
    <div class="card day"><div class="date">${niceDate(d.date)} ${d.date === today ? '<span class="badge">today</span>' : ''}</div><div class="city">${esc(d.city)}${d.hotel ? ' · ' + esc(d.hotel) : ''}</div><ul>${items}</ul></div>
    ${top.length ? `<h3>Must-see today</h3><div class="list">${top.map((e) => entryItem(e)).join('')}</div>` : ''}
    ${siteIds.length ? `<div class="row" style="margin-top:14px">${siteIds.map((s) => `<a class="btn" href="#/site/${s}">All of ${esc(siteName(s))}</a>`).join('')}<button class="btn" id="playDay">&#9654; Play must-sees</button></div>` : ''}
    ${cached}
    <h3>Quick</h3>
    <div class="grid2">
      <a class="site-card" href="#/phrases"><div class="n">&#128483; Phrasebook</div><div class="d">Egyptian Arabic with audio</div></a>
      <a class="site-card" href="#/site/basics"><div class="n">&#128214; Basics</div><div class="d">Gods, pharaohs, symbols, how to read a temple</div></a>
      <a class="site-card" href="#/identify"><div class="n">&#128247; Identify a photo</div><div class="d">Online, via the Claude app</div></a>
      <a class="site-card" href="#/download"><div class="n">&#11015; Offline packs</div><div class="d">Download photos and audio</div></a>
    </div>`;
  $('#playDay')?.addEventListener('click', () => playQueue(top.filter((e) => e.audio), 0));
}

// ---------- Search
function scoreEntry(e, tokens, q) {
  let s = 0;
  if (e._n.includes(q)) s += 10 + (e._n.startsWith(q) ? 4 : 0);
  if (e._a.some((a) => a === q)) s += 12;
  for (const t of tokens) {
    let best = 0;
    const fields = [e._n, ...e._a];
    for (const f of fields) {
      if (f.includes(t)) { best = Math.max(best, f.split(' ').some((w) => w.startsWith(t)) ? 3 : 2); }
      else if (t.length >= 5) { for (const w of f.split(' ')) if (w.length >= 4 && lev(w, t) <= 1) { best = Math.max(best, 1.5); break; } }
    }
    if (!best && (e._area.includes(t) || e._site.includes(t))) best = 1;
    if (!best) return 0; // every token must match somewhere
    s += best;
  }
  if (e.priority === 1) s += 0.5;
  return s;
}
function search(q) {
  q = norm(q); if (!q) return [];
  const tokens = q.split(' ').filter((t) => t.length > 1 || /\d/.test(t));
  return state.entries.map((e) => [scoreEntry(e, tokens, q), e]).filter((x) => x[0] > 0).sort((a, b) => b[0] - a[0]).slice(0, 40).map((x) => x[1]);
}
function renderSearch(params) {
  setTitle('Search');
  const q = params.q ?? state.lastSearch;
  view.innerHTML = `<div class="search"><input id="q" type="search" placeholder="Name, nickname, KV number, god, king..." value="${esc(q)}" autocomplete="off"></div>
    <div id="results"></div>
    <div class="muted small" id="hint">Try: "Tut mask", "KV9", "Hatshepsut", "scarab", "hypostyle", "Sekhmet", "Narmer", "obelisk". Fuzzy: small typos are fine.</div>`;
  const input = $('#q'), results = $('#results'), hint = $('#hint');
  const run = () => {
    const v = input.value; state.lastSearch = v;
    const r = search(v);
    hint.hidden = !!v;
    results.innerHTML = v && !r.length ? '<div class="card muted">Nothing found. Try another word, or browse by place.</div>' : `<div class="list">${r.map((e) => entryItem(e)).join('')}</div>`;
  };
  input.addEventListener('input', run);
  input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') input.blur(); });
  run();
  if (!q) setTimeout(() => input.focus(), 50);
}

// ---------- Browse
function renderBrowse() {
  setTitle('Places');
  const today = todayISO();
  view.innerHTML = `<div class="grid2">${state.sites.map((s) => {
    const n = state.entries.filter((e) => e.site === s.id).length;
    const days = s.days?.length ? s.days.map((d) => d.slice(8)).join(', ') + ' Oct' : '';
    const isToday = s.days?.includes(today);
    return `<a class="site-card" href="#/site/${s.id}"><div class="n">${esc(s.name)}</div><div class="d">${n} entries${days ? ' · ' + days : ''}${isToday ? ' · <b>today</b>' : ''}</div></a>`;
  }).join('')}</div>`;
}
function renderSite(id, params) {
  const s = state.siteById[id]; if (!s) { location.hash = '#/browse'; return; }
  setTitle(s.name);
  const own = state.entries.filter((e) => e.site === id);
  const extra = state.entries.filter((e) => e.site !== id && (e.also_in || []).includes(id));
  const areas = [...(s.areas || []), ...own.map((e) => e.area).filter((a) => a && !(s.areas || []).includes(a))];
  const sections = areas.map((a) => { const list = own.filter((e) => e.area === a); return list.length ? `<h3 id="a-${esc(norm(a)).replace(/\s/g, '-')}">${esc(a)}</h3><div class="list">${list.map((e) => entryItem(e, e.period || e.type)).join('')}</div>` : ''; }).join('');
  const other = own.filter((e) => !areas.includes(e.area));
  const withAudio = own.filter((e) => e.audio);
  view.innerHTML = `
    <div class="row" style="margin-bottom:6px"><span class="muted small">${own.length} entries · ${withAudio.length} with audio · &#9733; = must-see</span></div>
    <div class="row">${withAudio.length ? `<button class="btn small" id="playAll">&#9654; Play all (${withAudio.length})</button>` : ''}<button class="btn small" id="playTop">&#9654; Play must-sees</button><a class="btn small" href="#/search">&#128269; Search</a></div>
    <div class="chips" style="margin-top:8px">${areas.filter((a) => own.some((e) => e.area === a)).map((a) => `<a class="chip" href="#a-${esc(norm(a)).replace(/\s/g, '-')}" onclick="event.preventDefault();document.getElementById('a-${esc(norm(a)).replace(/\s/g, '-')}')?.scrollIntoView({behavior:'smooth',block:'start'})">${esc(a)}</a>`).join('')}</div>
    ${sections}
    ${other.length ? `<h3>Other</h3><div class="list">${other.map((e) => entryItem(e)).join('')}</div>` : ''}
    ${extra.length ? `<h3>Background that fits here</h3><div class="list">${extra.map((e) => entryItem(e)).join('')}</div>` : ''}`;
  $('#playAll')?.addEventListener('click', () => playQueue(withAudio, 0));
  $('#playTop')?.addEventListener('click', () => { const l = withAudio.filter((e) => e.priority === 1); if (l.length) playQueue(l, 0); else toast('No audio yet for this place'); });
}

// ---------- Entry
function renderEntry(id) {
  const e = state.byId[id]; if (!e) { view.innerHTML = '<div class="card">Entry not found.</div>'; return; }
  setTitle(siteName(e.site));
  const credit = e.image_credit ? `<span class="credit">${esc(e.image_credit)}</span>` : '';
  const hero = e.image ? `<div class="hero"><img src="${esc(e.image)}" alt="" onerror="this.parentElement.style.display='none'">${credit}</div>` : '';
  const uncertain = /LOCATION UNCERTAIN/i.test(e.note || '') || /check label/i.test(e.area || '');
  const related = [...(e.related || []).map((r) => state.byId[r]).filter(Boolean)];
  const sameArea = state.entries.filter((x) => x.site === e.site && x.area === e.area && x.id !== e.id).slice(0, 6);
  const sources = (e.sources || []).map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u.replace(/^https?:\/\/(en\.)?/, '').slice(0, 60))}</a>`).join('<br>');
  view.innerHTML = `
    <article class="entry">
      ${hero}
      <h2>${esc(e.name)}</h2>
      <div class="row small muted" style="margin-bottom:8px"><a class="chip" href="#/site/${e.site}">${esc(siteName(e.site))}</a>${e.area ? `<span class="chip">${esc(e.area)}</span>` : ''}${e.period ? `<span class="chip">${esc(e.period)}</span>` : ''}</div>
      ${uncertain ? '<div class="warn">This object may be displayed either at the Grand Egyptian Museum or at the Egyptian Museum in Tahrir. Many pieces moved in 2025. Trust the label in front of you.</div>' : ''}
      <div class="listen">${e.audio ? `<button class="btn primary" id="listen">&#9654; Listen${e.audio_secs ? ' · ' + fmtTime(e.audio_secs) : ''}</button>` : `<button class="btn" id="tts">&#9654; Read aloud (phone voice)</button>`}<button class="btn" id="share" title="Copy link">&#128279;</button></div>
      ${e.summary ? `<p class="lead"><b>${esc(e.summary)}</b></p>` : ''}
      ${e.look ? `<h3>What you are looking at</h3>${paragraphs(e.look)}` : ''}
      ${e.story ? `<h3>The story</h3>${paragraphs(e.story)}` : ''}
      ${e.details?.length ? `<h3>Look for</h3><ul>${e.details.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : ''}
      ${e.fun_fact ? `<div class="fact"><b>Did you know?</b> ${esc(e.fun_fact)}</div>` : ''}
      ${!e.story && !e.look ? `<div class="card muted">Full text not written yet for this entry.${e.note ? '<br><br><i>Notes: ' + esc(e.note) + '</i>' : ''}</div>` : ''}
      ${related.length ? `<h3>Related</h3><div class="list">${related.map((r) => entryItem(r)).join('')}</div>` : ''}
      ${sameArea.length ? `<h3>Nearby in ${esc(e.area || siteName(e.site))}</h3><div class="list">${sameArea.map((r) => entryItem(r)).join('')}</div>` : ''}
      ${sources ? `<h3>Sources (online)</h3><p class="small">${sources}<br><span class="muted">Text written with help from Wikipedia (CC BY-SA). Photo: Wikimedia Commons, see credit on the image.</span></p>` : ''}
    </article>`;
  $('#listen')?.addEventListener('click', () => { const list = state.entries.filter((x) => x.site === e.site && x.audio); playQueue(list, Math.max(0, list.findIndex((x) => x.id === e.id))); });
  $('#tts')?.addEventListener('click', () => speak(e));
  $('#share')?.addEventListener('click', async () => { try { await navigator.clipboard.writeText(location.href); toast('Link copied'); } catch (err) { toast(location.href); } });
}

// ---------- Narration player
const audio = $('#narration');
const player = $('#player');
const pPlay = $('#pPlay'), pTitle = $('#pTitle'), pSeek = $('#pSeek'), pTime = $('#pTime'), pArt = $('#pArt'), pQueue = $('#pQueue'), pSpeed = $('#pSpeed');
let speed = parseFloat(localStorage.getItem('speed') || '1');
audio.playbackRate = speed; pSpeed.textContent = speed + 'x';
function playQueue(list, i) {
  if (!list.length) return toast('No audio available');
  state.queue = list; state.qi = i; loadCurrent(true);
}
function loadCurrent(autoplay) {
  const e = state.queue[state.qi]; if (!e) return;
  audio.src = e.audio; audio.playbackRate = speed;
  pTitle.textContent = e.name; pArt.src = e.image || 'icons/icon-192.png';
  pQueue.textContent = state.queue.length > 1 ? `${state.qi + 1} / ${state.queue.length}` : '';
  player.hidden = false;
  if (autoplay) audio.play().catch(() => toast('Tap play to start'));
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: e.name, artist: siteName(e.site), album: 'Egypt Guide', artwork: e.image ? [{ src: new URL(e.image, location.href).href, sizes: '512x512', type: 'image/jpeg' }] : [] });
    navigator.mediaSession.setActionHandler('play', () => audio.play());
    navigator.mediaSession.setActionHandler('pause', () => audio.pause());
    navigator.mediaSession.setActionHandler('nexttrack', next);
    navigator.mediaSession.setActionHandler('previoustrack', prev);
    navigator.mediaSession.setActionHandler('seekbackward', () => (audio.currentTime -= 10));
    navigator.mediaSession.setActionHandler('seekforward', () => (audio.currentTime += 10));
  }
}
function next() { if (state.qi < state.queue.length - 1) { state.qi++; loadCurrent(true); } else { audio.pause(); toast('End of list'); } }
function prev() { if (audio.currentTime > 5 || state.qi === 0) audio.currentTime = 0; else { state.qi--; loadCurrent(true); } }
pPlay.addEventListener('click', () => (audio.paused ? audio.play() : audio.pause()));
$('#pNext').addEventListener('click', next);
$('#pClose').addEventListener('click', () => { audio.pause(); audio.removeAttribute('src'); audio.load(); player.hidden = true; });
pSpeed.addEventListener('click', () => { speed = { 1: 1.25, 1.25: 1.5, 1.5: 0.9, 0.9: 1 }[speed] || 1; audio.playbackRate = speed; pSpeed.textContent = speed + 'x'; localStorage.setItem('speed', speed); });
pSeek.addEventListener('input', () => { if (audio.duration) audio.currentTime = (pSeek.value / 1000) * audio.duration; });
pTitle.addEventListener('click', () => { const e = state.queue[state.qi]; if (e) location.hash = '#/entry/' + e.id; });
audio.addEventListener('timeupdate', () => { if (audio.duration) { pSeek.value = Math.round((audio.currentTime / audio.duration) * 1000); pTime.textContent = `${fmtTime(audio.currentTime)} / ${fmtTime(audio.duration)}`; } });
audio.addEventListener('play', () => (pPlay.innerHTML = '&#10074;&#10074;'));
audio.addEventListener('pause', () => (pPlay.innerHTML = '&#9654;'));
audio.addEventListener('ended', () => { if (state.queue.length > 1 && state.qi < state.queue.length - 1) next(); });
audio.addEventListener('error', () => { if (audio.getAttribute('src')) toast('Audio not available offline. Download the pack in More.'); });

// phone TTS fallback
function speak(e) {
  if (!('speechSynthesis' in window)) return toast('No speech on this phone');
  speechSynthesis.cancel();
  const text = e.narration || [e.summary, e.look, e.story, ...(e.details || []), e.fun_fact].filter(Boolean).join('. ');
  const u = new SpeechSynthesisUtterance(text); u.lang = 'en-GB'; u.rate = 1;
  const v = speechSynthesis.getVoices().find((v) => /en-(GB|US)/i.test(v.lang) && /Google|Natural|Neural/i.test(v.name)) || speechSynthesis.getVoices().find((v) => /^en/i.test(v.lang));
  if (v) u.voice = v;
  speechSynthesis.speak(u); toast('Reading with the phone voice. Tap again to stop.', 2000);
  $('#tts').onclick = () => { speechSynthesis.cancel(); renderEntry(e.id); };
}

// ---------- Phrases
const phraseAudio = $('#phraseAudio');
function phraseFile(p, f) { return `audio/phrases/${p.id}__${f.who}${f.to}.mp3`; }
function playPhrase(p, f, btn) {
  if (!audio.paused) audio.pause();
  const src = phraseFile(p, f);
  phraseAudio.src = src; phraseAudio.play().catch(() => {});
  if (btn) { btn.classList.add('on'); phraseAudio.onended = () => btn.classList.remove('on'); }
  phraseAudio.onerror = () => { btn?.classList.remove('on'); if ('speechSynthesis' in window) { const u = new SpeechSynthesisUtterance(f.ar); u.lang = 'ar-EG'; speechSynthesis.cancel(); speechSynthesis.speak(u); toast('Audio not downloaded; using phone voice'); } else toast('Audio not available offline'); };
}
function renderPhrases() {
  setTitle('Phrasebook');
  const ph = state.phrases; const cats = ['all', 'favs', ...ph.categories];
  const chips = cats.map((c) => `<button class="chip ${state.phraseCat === c ? 'on' : ''}" data-cat="${esc(c)}">${c === 'all' ? 'All' : c === 'favs' ? '&#9733; Favourites' : esc(c)}</button>`).join('');
  view.innerHTML = `
    <div class="row" style="justify-content:space-between;margin-bottom:8px">
      <div class="seg" id="speaker"><button data-s="m" class="${state.speaker === 'm' ? 'on' : ''}">I'm a man</button><button data-s="f" class="${state.speaker === 'f' ? 'on' : ''}">I'm a woman</button></div>
      <span class="muted small">tap Arabic to show it big</span>
    </div>
    <div class="search"><input id="pq" type="search" placeholder="Search phrases (English or sound)" value="${esc(state.phraseQ)}"></div>
    <div class="chips" id="cats">${chips}</div>
    <div id="plist"></div>
    <details class="card small"><summary><b>How to read the transliteration</b></summary><p>${esc(ph.legend.transliteration)}</p><p>${esc(ph.legend.speaker)} ${esc(ph.legend.listener)}</p></details>`;
  const list = $('#plist');
  const draw = () => {
    const q = norm(state.phraseQ);
    const items = ph.phrases.filter((p) => (state.phraseCat === 'all' || (state.phraseCat === 'favs' ? state.favs.has(p.id) : p.cat === state.phraseCat)) && (!q || norm(p.en + ' ' + p.note + ' ' + p.forms.map((f) => f.tr).join(' ')).includes(q)));
    list.innerHTML = items.map((p) => {
      const forms = p.forms.filter((f) => f.who === 'any' || f.who === state.speaker);
      const main = forms[0] || p.forms[0];
      const byTo = forms.length > 1 && forms.some((f) => f.to !== 'any');
      const btns = byTo
        ? forms.map((f, i) => `<button class="btn small play" data-i="${p.forms.indexOf(f)}">&#9654; ${f.to === 'm' ? 'to a man' : f.to === 'f' ? 'to a woman' : 'play'}</button>`).join('')
        : `<button class="btn small play" data-i="${p.forms.indexOf(main)}">&#9654; Play</button>`;
      const trs = byTo ? forms.map((f) => `<span class="tr">${esc(f.tr)}</span> <span class="muted small">${f.to === 'm' ? '(to a man)' : f.to === 'f' ? '(to a woman)' : ''}</span>`).join('<br>') : `<span class="tr">${esc(main.tr)}</span>`;
      return `<div class="phrase" data-id="${p.id}"><div class="en">${esc(p.en)}</div><div class="ar" data-show="${esc(main.ar)}|${esc(p.en)}">${esc(main.ar)}</div><div>${trs}</div>${p.note ? `<div class="note">${esc(p.note)}</div>` : ''}<div class="ctl">${btns}<button class="fav ${state.favs.has(p.id) ? 'on' : ''}" title="Favourite">&#9733;</button></div></div>`;
    }).join('') || '<div class="card muted">No phrases here yet.</div>';
  };
  draw();
  list.addEventListener('click', (ev) => {
    const card = ev.target.closest('.phrase'); if (!card) return;
    const p = ph.phrases.find((x) => x.id === card.dataset.id);
    const play = ev.target.closest('.play');
    if (play) return playPhrase(p, p.forms[+play.dataset.i], play);
    if (ev.target.closest('.fav')) { state.favs.has(p.id) ? state.favs.delete(p.id) : state.favs.add(p.id); localStorage.setItem('favs', JSON.stringify([...state.favs])); ev.target.classList.toggle('on'); return; }
    const ar = ev.target.closest('.ar'); if (ar) { const [a, en] = ar.dataset.show.split('|'); showCard(a, en); }
  });
  $('#cats').addEventListener('click', (ev) => { const b = ev.target.closest('[data-cat]'); if (!b) return; state.phraseCat = b.dataset.cat; localStorage.setItem('phraseCat', state.phraseCat); $('#cats').querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === b)); draw(); });
  $('#speaker').addEventListener('click', (ev) => { const b = ev.target.closest('[data-s]'); if (!b) return; state.speaker = b.dataset.s; localStorage.setItem('speaker', state.speaker); $('#speaker').querySelectorAll('button').forEach((c) => c.classList.toggle('on', c === b)); draw(); });
  $('#pq').addEventListener('input', (ev) => { state.phraseQ = ev.target.value; draw(); });
}
function showCard(ar, en) { const s = $('#showcard'); s.innerHTML = `<div class="ar">${esc(ar)}</div><div class="en">${esc(en)}</div><div class="hint">tap anywhere to close</div>`; s.hidden = false; s.onclick = () => (s.hidden = true); }

// ---------- More
function renderMore() {
  setTitle('More');
  view.innerHTML = `<div class="list">
    <a class="item" href="#/download"><div class="thumb ph">&#11015;</div><div class="item-main"><div class="item-title">Offline packs</div><div class="item-sub">Download photos and audio for each place</div></div></a>
    <a class="item" href="#/identify"><div class="thumb ph">&#128247;</div><div class="item-main"><div class="item-title">Identify something from a photo</div><div class="item-sub">Online: hand the photo to the Claude app</div></div></a>
    <a class="item" href="#/docs"><div class="thumb ph">&#128196;</div><div class="item-main"><div class="item-title">Documents</div><div class="item-sub">e-Visa, museum tickets (offline)</div></div></a>
    <a class="item" href="#/site/basics"><div class="thumb ph">&#128214;</div><div class="item-main"><div class="item-title">Basics</div><div class="item-sub">Gods, pharaohs, symbols, temples and tombs 101</div></div></a>
    <a class="item" href="#/settings"><div class="thumb ph">&#9881;</div><div class="item-main"><div class="item-title">Settings</div><div class="item-sub">Text size, speaker, theme, updates</div></div></a>
    <a class="item" href="#/about"><div class="thumb ph">&#8505;</div><div class="item-main"><div class="item-title">About and credits</div><div class="item-sub">Sources, licences, version</div></div></a>
  </div>`;
}
function renderDocs() {
  setTitle('Documents');
  const docs = state.assets?.docs || [];
  view.innerHTML = docs.length
    ? `<div class="list">${docs.map((d) => `<a class="item" href="${esc(d.file)}" target="_blank" rel="noopener"><div class="thumb ph">&#128196;</div><div class="item-main"><div class="item-title">${esc(d.name)}</div><div class="item-sub">${esc(d.file)}${d.bytes ? ' · ' + fmtMB(d.bytes) : ''}</div></div></a>`).join('')}</div>`
    : `<div class="card"><p><b>Your travel documents are not stored in this app</b> (the app is published on a public page, so visa and tickets stay private).</p><p>Keep the e-Visa and the museum tickets as PDFs in the phone's <b>Files</b> app and as screenshots in the photo gallery, both of which work offline. On the Xiaomi: open the PDF once from WhatsApp, Gmail or Drive and tap "Save to Files".</p></div>`;
}
function renderIdentify() {
  setTitle('Identify a photo');
  const prompt = `You are my Egyptologist. I will send a photo from a museum or monument in Egypt. 1) Read any label text in the photo first; it is the best clue. 2) Tell me what the object or monument is, when it dates from, and where it comes from. 3) Give me the story behind it in about 150 words, like a great guide would, with one surprising detail. 4) Tell me two details to look for right now. 5) If you are unsure, say what it most likely is and what else it could be. Keep it short; I am standing in front of it.`;
  view.innerHTML = `<div class="card">
    <p><b>Needs internet.</b> The offline part of this app is text and audio. For "what is this?" from a photo, use the Claude app:</p>
    <ol>
      <li>Open <b>Claude</b> on the phone, pick the project <b>Egypt Guide</b> (you set it up once at home).</li>
      <li>Tap the camera, photograph the <b>object together with its label</b>, send.</li>
      <li>Tap the speaker icon on the answer, or use voice mode, to hear it in your earphones.</li>
      <li>Then search the name here to get the full entry and the narrated audio.</li>
    </ol>
    <p class="small muted">If you have not created the project, paste this as the project instructions (or at the start of a chat):</p>
    <div class="code" id="prompt">${esc(prompt)}</div>
    <div class="row" style="margin-top:10px"><button class="btn primary" id="copy">Copy prompt</button><a class="btn" href="https://claude.ai/new" target="_blank" rel="noopener">Open Claude</a></div>
  </div>
  <div class="card small muted">Tip: when signal is weak, photos upload faster if you first shrink them. In the camera, choose a lower resolution, or crop to the object and the label.</div>`;
  $('#copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText(prompt); toast('Prompt copied'); } catch (e) { toast('Select the text and copy'); } });
}
function renderSettings() {
  setTitle('Settings');
  view.innerHTML = `<div class="card">
    <div class="kv"><span>Text size</span><div class="seg" id="ts"><button data-v="small">A</button><button data-v="normal">A</button><button data-v="large" style="font-size:1.2rem">A</button></div></div>
    <div class="kv"><span>Phrasebook speaker</span><div class="seg" id="sp"><button data-s="m">man</button><button data-s="f">woman</button></div></div>
    <div class="kv"><span>Theme</span><div class="seg" id="th"><button data-t="auto">auto</button><button data-t="light">light</button><button data-t="dark">dark</button></div></div>
    <div class="kv"><span>Narration speed</span><span>${speed}x (tap the speed button on the player)</span></div>
    <div class="kv"><span>App version</span><span id="ver">${esc(state.assets?.version || 'dev')}</span></div>
    <div class="kv"><span>Check for updates</span><button class="btn small" id="upd">Check now</button></div>
  </div>`;
  const mark = (sel, attr, val) => $(sel).querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset[attr] === val));
  mark('#ts', 'v', state.textSize); mark('#sp', 's', state.speaker); mark('#th', 't', localStorage.getItem('theme') || 'auto');
  $('#ts').addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (!b) return; state.textSize = b.dataset.v; localStorage.setItem('textSize', state.textSize); applyTextSize(); mark('#ts', 'v', state.textSize); });
  $('#sp').addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (!b) return; state.speaker = b.dataset.s; localStorage.setItem('speaker', state.speaker); mark('#sp', 's', state.speaker); });
  $('#th').addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (!b) return; localStorage.setItem('theme', b.dataset.t); applyTheme(); mark('#th', 't', b.dataset.t); });
  $('#upd').addEventListener('click', async () => { if (!navigator.onLine) return toast('You are offline'); const reg = await navigator.serviceWorker?.getRegistration(); if (!reg) return toast('No service worker'); toast('Checking...'); await reg.update(); setTimeout(() => toast(reg.waiting ? 'Update ready: reloading' : 'You have the latest version'), 1500); if (reg.waiting) { reg.waiting.postMessage('SKIP_WAITING'); } });
}
function renderAbout() {
  setTitle('About');
  const n = state.entries.length, a = state.entries.filter((e) => e.audio).length, i = state.entries.filter((e) => e.image).length;
  view.innerHTML = `<div class="card">
    <p><b>Egypt Guide</b>, a personal offline e-Egyptologist built for one trip, 10 to 24 October 2026.</p>
    <p>${n} entries, ${i} with photos, ${a} with narration. Phrasebook: ${state.phrases.phrases.length} phrases.</p>
    <p class="small muted">Texts were written with the help of Claude, grounded on Wikipedia articles (CC BY-SA 4.0); each entry links its sources. Photos come from Wikimedia Commons under their individual licences; the photographer and licence are shown on each image. Narration voices by ElevenLabs. Dates, attributions and museum locations can change; when a label disagrees with this app, the label wins.</p>
    <p class="small muted">Version ${esc(state.assets?.version || 'dev')}</p>
  </div>`;
}

// ---------- Offline download manager
async function cachedSet() {
  try {
    if (!('caches' in window)) return new Set();
    const c = await caches.open(MEDIA_CACHE); const keys = await c.keys();
    return new Set(keys.map((r) => decodeURIComponent(new URL(r.url).pathname.replace(/^.*?\/(img|audio|docs)\//, '$1/'))));
  } catch (e) { return new Set(); }
}
let dl = { running: false, cancel: false };
function renderDownload() {
  setTitle('Offline packs');
  const a = state.assets;
  if (!a) { view.innerHTML = '<div class="card">No asset list yet (data/assets.json missing). Run the build.</div>'; return; }
  const secure = 'caches' in window;
  const packs = Object.entries(a.packs);
  const allFiles = [...new Set(packs.flatMap(([, p]) => p.files))];
  const allBytes = packs.reduce((s, [, p]) => s + p.bytes, 0);
  const row = (id, name, files, bytes) => `<div class="card" data-pack="${id}"><div class="row" style="justify-content:space-between"><b>${esc(name)}</b><span class="small muted">${fmtMB(bytes)}</span></div><div class="progress"><div style="width:0%"></div></div><div class="row" style="justify-content:space-between"><span class="small muted st">checking...</span><span class="act"></span></div></div>`;
  view.innerHTML = `
    <div class="card"><b>How it works.</b> The app, all texts and the phrasebook already work offline. Photos and audio are extra: download them once on Wi-Fi. <span class="small muted" id="storage"></span></div>
    ${secure ? '' : '<div class="warn">Offline storage is only available when the app is opened from its https address (or installed). This preview cannot download packs.</div>'}
    <div class="row"><button class="btn primary block" id="dlAll" ${dl.running || !secure ? 'disabled' : ''}>&#11015; Download everything (${fmtMB(allBytes)}, ${allFiles.length} files)</button></div>
    <div class="row" style="margin:8px 0"><button class="btn small" id="cancel" ${dl.running ? '' : 'hidden'}>Cancel</button><span class="small muted" id="overall"></span></div>
    ${packs.map(([id, p]) => row(id, p.name, p.files, p.bytes)).join('')}
    <div class="card small muted">If a download stops, just press again: it continues where it left off. On Android, do not use "Clear site data" or the Cleaner app on Chrome, it would delete the packs.</div>`;
  const paint = (have) => {
    for (const [id, p] of packs) {
      const card = view.querySelector(`[data-pack="${id}"]`); if (!card) continue;
      const got = p.files.filter((f) => have.has(f)).length; const pct = p.files.length ? Math.round((got / p.files.length) * 100) : 100;
      card.querySelector('.progress>div').style.width = pct + '%';
      card.querySelector('.st').textContent = `${got} / ${p.files.length} files`;
      card.querySelector('.act').innerHTML = pct < 100 ? (secure ? `<button class="btn small primary dl" data-pack="${id}">Download</button>` : '') : '<span class="small">&#10003; ready offline</span>';
    }
  };
  (async () => {
    paint(await cachedSet());
    try {
      if (navigator.storage?.estimate) { const est = await navigator.storage.estimate(); const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : null; $('#storage').innerHTML = `<br>Storage used ${fmtMB(est.usage || 0)} of ${fmtMB(est.quota || 0)} available${persisted ? ' · persistent &#10003;' : ''}`; }
    } catch (e) { /* ignore */ }
  })();
  const start = async (ids) => {
    if (dl.running || !secure) return; dl = { running: true, cancel: false };
    try { if (navigator.storage?.persist) await navigator.storage.persist(); } catch (e) { /* ignore */ }
    $('#cancel').hidden = false; $('#dlAll').disabled = true;
    const have2 = await cachedSet();
    const files = [...new Set(ids.flatMap((id) => a.packs[id].files))].filter((f) => !have2.has(f));
    const cache = await caches.open(MEDIA_CACHE);
    let done = 0, failed = 0; const total = files.length; const overall = $('#overall');
    const perPack = Object.fromEntries(ids.map((id) => [id, { got: a.packs[id].files.filter((f) => have2.has(f)).length, total: a.packs[id].files.length, set: new Set(a.packs[id].files) }]));
    const bump = (f) => { for (const id of ids) if (perPack[id].set.has(f)) { perPack[id].got++; const card = view.querySelector(`[data-pack="${id}"]`); if (card) { card.querySelector('.progress>div').style.width = Math.round((perPack[id].got / perPack[id].total) * 100) + '%'; card.querySelector('.st').textContent = `${perPack[id].got} / ${perPack[id].total} files`; } } };
    const worker = async () => { while (files.length && !dl.cancel) { const f = files.shift(); try { const res = await fetch(f, { cache: 'no-store' }); if (!res.ok) throw new Error(res.status); await cache.put(f, res); done++; bump(f); } catch (e) { failed++; } overall.textContent = `${done} / ${total} downloaded${failed ? `, ${failed} failed` : ''}`; } };
    await Promise.all([worker(), worker(), worker(), worker()]);
    dl.running = false;
    toast(dl.cancel ? 'Download paused' : failed ? `Done with ${failed} failures. Press again to retry.` : 'All downloaded. Ready for offline.');
    renderDownload();
  };
  view.addEventListener('click', (ev) => { const b = ev.target.closest('.dl'); if (b) start([b.dataset.pack]); });
  $('#dlAll').addEventListener('click', () => start(packs.map(([id]) => id)));
  $('#cancel').addEventListener('click', () => { dl.cancel = true; });
}

// ---------- theme / text size / nav
function applyTheme() { const t = localStorage.getItem('theme') || 'auto'; const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches); document.documentElement.dataset.theme = dark ? 'dark' : 'light'; $('#themeBtn').innerHTML = dark ? '&#9788;' : '&#9790;'; document.querySelector('meta[name=theme-color]').content = dark ? '#161311' : '#fffdf8'; }
function applyTextSize() { document.documentElement.style.setProperty('--fs', { small: '15px', normal: '17px', large: '19px' }[state.textSize] || '17px'); }
$('#themeBtn').addEventListener('click', () => { const cur = document.documentElement.dataset.theme; localStorage.setItem('theme', cur === 'dark' ? 'light' : 'dark'); applyTheme(); });
backBtn.addEventListener('click', () => { if (history.length > 1) history.back(); else location.hash = '#/browse'; });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
window.addEventListener('hashchange', route);

// ---------- boot
(async function boot() {
  applyTheme(); applyTextSize();
  view.innerHTML = '<div class="card muted">Loading...</div>';
  try { await loadData(); } catch (e) { view.innerHTML = `<div class="card">Could not load data (${esc(e.message)}). If you are offline, open the app once online first.</div>`; return; }
  route();
  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.register('sw.js');
      reg.addEventListener('updatefound', () => { const nw = reg.installing; nw?.addEventListener('statechange', () => { if (nw.state === 'installed' && navigator.serviceWorker.controller) toast('App updated. Reopen to get the new version.', 4000); }); });
      let refreshed = false; navigator.serviceWorker.addEventListener('controllerchange', () => { if (!refreshed) { refreshed = true; location.reload(); } });
    } catch (e) { console.warn('sw', e); }
  }
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); window._install = e; });
})();
})();
