/* GeoHistory Fun! prototype. Plain JavaScript, no framework.
   Content comes from window.GHF (built from data/*.json by scripts/build-app.mjs).
   Progress is stored only in this browser (localStorage). */
(() => {
  'use strict';
  const D = window.GHF;
  const T = D.taxonomy;
  const LAUNCH = D.config.launchDate;           // first Place of the Day
  const INTERVALS = [1, 2, 4, 8, 16];           // review gaps in days for boxes 1-5
  const DAILY_SIZE = 5;
  const BAND_RANK = { k5: 0, '6-12': 1, adult: 2 };
  const STORE_KEY = 'ghf-progress-v1';
  const $ = (s, el = document) => el.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- Dates (local calendar days, counted from launch) ---------- */
  const utc = key => { const [y, m, d] = key.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  const todayKey = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`; };
  const dayIndex = key => Math.round((utc(key) - utc(LAUNCH)) / 864e5);
  const keyOf = idx => new Date(utc(LAUNCH) + idx * 864e5).toISOString().slice(0, 10);
  const TODAY = () => dayIndex(todayKey());
  const fmtDate = (idx, opts = { weekday: 'long', month: 'long', day: 'numeric' }) =>
    new Date(utc(LAUNCH) + idx * 864e5).toLocaleDateString(undefined, { ...opts, timeZone: 'UTC' });

  /* ---------- Seeded randomness so a day's picks are stable ---------- */
  function hash(str) { let h = 1779033703 ^ str.length; for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); } return h >>> 0; }
  function rng(seed) { let a = hash(String(seed)); return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function shuffle(arr, r = Math.random) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  function weightedPick(items, weightFn, r = Math.random) {
    const w = items.map(weightFn); const total = w.reduce((s, x) => s + x, 0);
    if (!total) return items[0]; let x = r() * total;
    for (let i = 0; i < items.length; i++) { x -= w[i]; if (x <= 0) return items[i]; } return items[items.length - 1];
  }

  /* ---------- Storage ---------- */
  const DEFAULTS = () => ({
    v: 1, onboarded: false,
    settings: { band: '6-12', lean: 'default', scale: 1, theme: 'system', reduceMotion: false, timeBonus: false, readAloud: true },
    points: 0, quizzesDone: 0,
    streak: { count: 0, best: 0, lastDay: null, freezeDay: null },
    cards: {},       // questionId -> { box, due, seen, correct, misses }
    tags: {},        // tag -> { seen, correct }
    viewed: {},      // eventId -> day first read
    bookmarks: [],
    daily: null,     // { day, band, items:[{qid, kind, order:[choiceIds]}], answers:[{choice, ok, pts}] }
    badges: {},      // badgeId -> day earned
    history: []      // last answers: { q, ok, day, mode }
  });
  let storageOK = true;
  function load() {
    try { const raw = localStorage.getItem(STORE_KEY); if (!raw) return DEFAULTS(); const s = JSON.parse(raw); const d = DEFAULTS(); return { ...d, ...s, settings: { ...d.settings, ...s.settings }, streak: { ...d.streak, ...s.streak } }; }
    catch (e) { storageOK = false; return DEFAULTS(); }
  }
  let S = load();
  function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); storageOK = true; } catch (e) { storageOK = false; } }

  /* ---------- Content helpers ---------- */
  const placeById = Object.fromEntries(D.places.map(p => [p.id, p]));
  const eventById = Object.fromEntries(D.events.map(e => [e.id, e]));
  const qById = Object.fromEntries(D.questions.map(q => [q.id, q]));
  const eraLabel = id => (T.eras.find(e => e.id === id) || {}).label || id;
  const regionLabel = id => (T.regions.find(r => r.id === id) || {}).label || id;
  const bandLabel = b => (T.bands.find(x => x.id === b) || {}).label || b;
  const placeOf = e => placeById[e.placeId];
  const isUS = p => p.country === 'United States';
  const whereText = p => `${p.name}, ${isUS(p) ? p.admin : p.country}`;
  const band = () => S.settings.band;
  const eventOK = e => BAND_RANK[e.minBand] <= BAND_RANK[band()] && !(e.sensitivity === 'high' && band() !== 'adult');
  const events = () => D.events.filter(eventOK);
  const questions = () => D.questions.filter(q => q.bands.includes(band()) && eventOK(eventById[q.eventId]));
  const promptOf = q => q.prompt[band()] || q.prompt['6-12'] || q.prompt.adult;
  const summaryOf = e => e.summary[band()] || e.summary['6-12'] || e.summary.adult;
  const tagsOf = q => { const e = eventById[q.eventId], p = placeOf(e); return [`region:${p.region}`, `era:${e.era}`, `type:${q.type}`, ...e.topics.map(t => `topic:${t}`)]; };
  const tagLabel = t => { const [k, v] = t.split(':'); if (k === 'region') return regionLabel(v); if (k === 'era') return eraLabel(v); if (k === 'type') return v === 'event-to-place' ? 'Event to place questions' : 'Place to event questions'; return v.replace(/-/g, ' ').replace(/^./, c => c.toUpperCase()); };

  /* ---------- Local lean: boost Nebraska and Plains content by N percentage points ---------- */
  function leanMultiplier(pool, getEvent) {
    const extra = ((T.localLean.levels.find(l => l.id === S.settings.lean) || {}).extraPoints || 0) / 100;
    const n = pool.length; if (!n || !extra) return 1;
    const b = pool.filter(x => placeOf(getEvent(x)).plains).length / n;
    if (b === 0 || b >= 1) return 1;
    const target = Math.min(0.95, b + extra);
    return (target * (1 - b)) / (b * (1 - target));
  }

  /* ---------- Place of the Day: same for everyone in a band ---------- */
  const potdCache = {};
  function potdEvent(idx) {
    const pool = events().map(e => e.id).sort(); const key = band() + pool.join();
    const seq = potdCache[key] || (potdCache[key] = []);
    while (seq.length <= idx) {
      const c = Math.floor(seq.length / pool.length);
      let cycle = shuffle(pool, rng(`potd-${band()}-${c}`));
      if (seq.length && cycle[0] === seq[seq.length - 1] && cycle.length > 1) [cycle[0], cycle[1]] = [cycle[1], cycle[0]];
      seq.push(...cycle);
    }
    return eventById[seq[Math.max(0, idx)]];
  }

  /* ---------- Weak spots ---------- */
  const acc = t => { const s = S.tags[t]; return s ? (s.correct + 1) / (s.seen + 2) : 0.5; };
  const weakness = q => { const ts = tagsOf(q); return ts.reduce((sum, t) => sum + (1 - acc(t)), 0) / ts.length; };
  function weakTags(limit = 3) {
    return Object.entries(S.tags).filter(([t, s]) => s.seen >= 2 && !t.startsWith('topic:'))
      .map(([t, s]) => ({ t, rate: s.correct / s.seen, seen: s.seen })).filter(x => x.rate < 0.75)
      .sort((a, b) => a.rate - b.rate || b.seen - a.seen).slice(0, limit);
  }

  /* ---------- Daily quiz builder: 1 today, 2 review, 2 new ---------- */
  function buildDaily(day) {
    const r = rng(`daily-${day}-${band()}`);
    const pool = questions(); const used = new Set(), usedEvents = new Set(); const items = [];
    const add = (q, kind) => { used.add(q.id); usedEvents.add(q.eventId); items.push({ qid: q.id, kind, order: shuffle(q.choices.map(c => c.id), r) }); };
    const boxOf = q => (S.cards[q.id] || { box: 0 }).box;
    const potd = potdEvent(day);
    const todays = shuffle(pool.filter(q => q.eventId === potd.id), r).sort((a, b) => boxOf(a) - boxOf(b));
    if (todays[0]) add(todays[0], 'today');
    const due = pool.filter(q => S.cards[q.id] && S.cards[q.id].due <= day && !used.has(q.id))
      .sort((a, b) => (weakness(b) - weakness(a)) || (S.cards[a.id].due - S.cards[b.id].due));
    for (const q of due) { if (items.length >= 3) break; if (!usedEvents.has(q.eventId) || due.length < 3) add(q, 'review'); }
    const mult = leanMultiplier(pool, q => eventById[q.eventId]);
    const weight = q => (placeOf(eventById[q.eventId]).plains ? mult : 1) * (0.5 + weakness(q)) * (usedEvents.has(q.eventId) ? 0.15 : 1);
    let fresh = pool.filter(q => !S.cards[q.id] && !used.has(q.id));
    while (items.length < DAILY_SIZE && fresh.length) { const q = weightedPick(fresh, weight, r); add(q, 'new'); fresh = fresh.filter(x => x.id !== q.id); }
    let rest = pool.filter(q => !used.has(q.id)).sort((a, b) => boxOf(a) - boxOf(b));
    while (items.length < DAILY_SIZE && rest.length) { const q = weightedPick(rest.slice(0, 6), weight, r); add(q, 'review'); rest = rest.filter(x => x.id !== q.id); }
    return { day, band: band(), items, answers: [] };
  }
  function getDaily() {
    const day = TODAY();
    if (!S.daily || S.daily.day !== day || S.daily.band !== band()) {
      if (S.daily && S.daily.day === day && S.daily.answers.length) return S.daily; // keep a started quiz if band changed mid-day
      S.daily = buildDaily(day); save();
    }
    return S.daily;
  }

  /* ---------- Recording answers ---------- */
  function record(q, ok, mode, secs) {
    const day = TODAY();
    const c = S.cards[q.id] || { box: 0, due: day, seen: 0, correct: 0, misses: 0 };
    const wasMissed = c.misses > 0 && c.box <= 1;
    c.seen++; if (ok) { c.correct++; c.box = Math.min(5, Math.max(1, c.box + 1)); } else { c.misses++; c.box = 1; }
    c.due = day + (ok ? INTERVALS[c.box - 1] : 1);
    S.cards[q.id] = c;
    for (const t of tagsOf(q)) { const s = S.tags[t] || (S.tags[t] = { seen: 0, correct: 0 }); s.seen++; if (ok) s.correct++; }
    let pts = 0;
    if (ok) { pts = 10 + (q.difficulty >= 3 ? 5 : 0) + (S.settings.timeBonus && secs != null && secs <= 15 ? 3 : 0); S.points += pts; }
    S.history.push({ q: q.id, ok, day, mode }); if (S.history.length > 500) S.history.splice(0, S.history.length - 500);
    if (ok && wasMissed) award('comeback');
    if (S.points >= 100) award('century');
    save();
    return pts;
  }
  function finishDaily() {
    const day = TODAY(), st = S.streak; let msg = null;
    if (st.lastDay !== day) {
      if (st.lastDay === day - 1) st.count++;
      else if (st.lastDay === day - 2 && freezeReady(day)) { st.count++; st.freezeDay = day - 1; msg = 'Your weekly streak freeze covered yesterday.'; }
      else st.count = 1;
      st.lastDay = day; st.best = Math.max(st.best, st.count); S.quizzesDone++;
    }
    award('first-quiz');
    if (S.daily.answers.filter(a => a.ok).length === S.daily.items.length) award('perfect-day');
    if (st.count >= 3) award('streak-3');
    if (st.count >= 7) award('streak-7');
    save(); return msg;
  }
  const freezeReady = day => S.streak.freezeDay == null || day - S.streak.freezeDay >= 7;
  function currentStreak() {
    const day = TODAY(), st = S.streak;
    if (st.lastDay == null) return 0;
    if (st.lastDay >= day - 1) return st.count;
    if (st.lastDay === day - 2 && freezeReady(day)) return st.count;
    return 0;
  }

  /* ---------- Badges ---------- */
  const BADGES = [
    { id: 'first-quiz', name: 'First Steps', desc: 'Finish your first daily quiz', icon: 'flag' },
    { id: 'perfect-day', name: 'Perfect Day', desc: 'Get all 5 right on a daily quiz', icon: 'star' },
    { id: 'streak-3', name: 'On a Roll', desc: 'Reach a 3-day streak', icon: 'flame' },
    { id: 'streak-7', name: 'Week Strong', desc: 'Reach a 7-day streak', icon: 'flame' },
    { id: 'century', name: 'Century', desc: 'Earn 100 points', icon: 'medal' },
    { id: 'comeback', name: 'Comeback', desc: 'Get right a question you missed before', icon: 'loop' },
    { id: 'plains', name: 'Plains Explorer', desc: 'Read every Nebraska and Plains story', icon: 'pin' },
    { id: 'globe', name: 'Globe Trotter', desc: 'Read stories from 5 different regions', icon: 'globe' }
  ];
  let newBadges = [];
  function award(id) { if (!S.badges[id]) { S.badges[id] = TODAY(); newBadges.push(id); } }
  function checkExploreBadges() {
    const ev = events(), read = ev.filter(e => S.viewed[e.id]);
    const plains = ev.filter(e => placeOf(e).plains);
    if (plains.length && plains.every(e => S.viewed[e.id])) award('plains');
    if (new Set(read.map(e => placeOf(e).region)).size >= 5) award('globe');
  }

  /* ---------- Icons ---------- */
  const I = {
    today: '<path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/><circle cx="12" cy="12" r="4"/>',
    explore: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z"/><path d="M9 4v14M15 6v14"/>',
    quiz: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6"/><circle cx="12" cy="17" r=".6" fill="currentColor"/>',
    progress: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
    speak: '<path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>',
    bookmark: '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2Z"/>',
    flag: '<path d="M4 22V4M4 4h12l-2 4 2 4H4"/>', star: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1Z"/>',
    flame: '<path d="M12 22c4 0 7-3 7-7 0-5-5-7-5-12-3 2-4 5-4 7-1-1-2-2-2-4-2 2-3 5-3 9 0 4 3 7 7 7Z"/>',
    medal: '<circle cx="12" cy="15" r="6"/><path d="M8.5 10 6 2h4l2 5 2-5h4l-2.5 8"/>',
    loop: '<path d="M17 2l4 4-4 4"/><path d="M3 12V10a4 4 0 0 1 4-4h14M7 22l-4-4 4-4"/><path d="M21 12v2a4 4 0 0 1-4 4H3"/>',
    pin: '<path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12Z"/><circle cx="12" cy="10" r="2.5"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'
  };
  const icon = (n, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[n]}</svg>`;
  const LOGO = `<svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="#F4B400"/><circle cx="32" cy="34" r="20" fill="#14213D"/><path d="M12 34h40M32 14c-8 6-8 34 0 40M32 14c8 6 8 34 0 40" stroke="#F4B400" stroke-width="3" fill="none"/><path d="M44 8c-5 0-9 4-9 9 0 7 9 15 9 15s9-8 9-15c0-5-4-9-9-9Z" fill="#C23B25" stroke="#fff" stroke-width="2.5"/><circle cx="44" cy="17" r="3.2" fill="#fff"/></svg>`;

  /* ---------- Read aloud ---------- */
  const canSpeak = 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
  function speakBtn(text) {
    if (!canSpeak || !S.settings.readAloud) return '';
    return `<button type="button" class="iconbtn" data-speak="${esc(text)}" aria-pressed="false">${icon('speak')}<span>Read aloud</span></button>`;
  }
  function toggleSpeak(btn) {
    const on = btn.getAttribute('aria-pressed') === 'true';
    speechSynthesis.cancel(); document.querySelectorAll('[data-speak]').forEach(b => b.setAttribute('aria-pressed', 'false'));
    if (on) return;
    const u = new SpeechSynthesisUtterance(btn.dataset.speak); u.rate = 0.95;
    u.onend = u.onerror = () => btn.setAttribute('aria-pressed', 'false');
    btn.setAttribute('aria-pressed', 'true'); speechSynthesis.speak(u);
  }

  /* ---------- Maps ---------- */
  function worldMap({ highlight = null, mini = false } = {}) {
    const M = D.maps.overview; const today = potdEvent(TODAY());
    let pins = '';
    for (const e of events()) {
      const p = placeOf(e); const [x, y] = M.pins[p.id]; const isToday = e.id === (highlight || today.id);
      if (mini && !isToday) continue;
      const cls = `wpin ${isUS(p) ? 'us' : 'world'} ${S.viewed[e.id] ? 'seen' : 'unseen'} ${isToday ? 'today' : ''}`;
      const dot = `${isToday ? `<circle class="halo" cx="${x}" cy="${y}" r="${mini ? 22 : 15}"/>` : ''}<circle cx="${x}" cy="${y}" r="${mini ? 14 : 9}"/>`;
      pins += mini ? `<g class="${cls}">${dot}</g>` : `<a href="#place-${e.id}" class="${cls}" aria-label="${esc(e.title)}, ${esc(whereText(p))}">${dot}</a>`;
    }
    return `<svg class="${mini ? 'worldmini' : 'worldmap'}" viewBox="0 0 ${M.W} ${M.H}" ${mini ? 'aria-hidden="true"' : 'role="group" aria-label="World map of places. Each pin links to its story. The same places are listed below."'}>
      <path class="sea" d="${M.sphere}"/><path class="grat" d="${M.grat}"/><path class="land" d="${M.land}"/>${pins}</svg>`;
  }
  function locator(p) {
    const L = D.maps.locators[p.id]; if (!L) return '';
    const [x, y] = L.pin; const lat = Math.abs(p.lat).toFixed(1) + (p.lat >= 0 ? '° N' : '° S'), lng = Math.abs(p.lng).toFixed(1) + (p.lng >= 0 ? '° E' : '° W');
    const caption = `${whereText(p)}${L.highlightName ? `. ${L.highlightName} is shaded.` : ''} ${lat}, ${lng}.`;
    return `<figure class="locator"><svg viewBox="0 0 ${L.W} ${L.H}" role="img" aria-label="Map: ${esc(caption)}">
      <rect class="sea" width="${L.W}" height="${L.H}"/><path class="grat" d="${L.grat}"/><path class="land" d="${L.land}"/>
      <path class="hl" d="${L.highlight}"/><path class="borders" d="${L.borders}"/>
      <circle class="pinring" cx="${x}" cy="${y}" r="16"/><circle class="pin" cx="${x}" cy="${y}" r="7"/></svg>
      <figcaption>${esc(caption)}</figcaption></figure>`;
  }

  /* ---------- Shell ---------- */
  const NAV = [['today', 'Today'], ['explore', 'Explore'], ['quiz', 'Quiz'], ['progress', 'Progress'], ['settings', 'Settings']];
  function shell(active) {
    const navLinks = NAV.map(([id, label]) => `<a href="#${id}" ${active === id ? 'aria-current="page"' : ''}>${label}</a>`).join('');
    $('#top').innerHTML = `<div class="wrap"><a class="brand" href="#today">${LOGO}<span class="sr">GeoHistory Fun! home</span><span aria-hidden="true" style="color:inherit">GeoHistory</span><span aria-hidden="true">Fun!</span></a>
      <nav class="topnav" aria-label="Main">${navLinks}</nav>
      <div class="top-stats" aria-label="Your stats"><span title="Points">${icon('star')}<span class="sr">Points:</span>${S.points}</span><span title="Streak">${icon('flame')}<span class="sr">Day streak:</span>${currentStreak()}</span></div></div>`;
    $('#tabbar').innerHTML = NAV.map(([id, label]) => `<a href="#${id}" ${active === id ? 'aria-current="page"' : ''}>${icon(id)}<span>${label}</span></a>`).join('');
    $('#top').hidden = $('#tabbar').hidden = active === 'welcome';
  }
  function applySettings() {
    const r = document.documentElement;
    r.style.setProperty('--scale', S.settings.scale);
    if (S.settings.theme === 'system') r.removeAttribute('data-theme'); else r.setAttribute('data-theme', S.settings.theme);
    r.classList.toggle('reduce-motion', !!S.settings.reduceMotion);
  }

  /* ---------- Views ---------- */
  function viewWelcome(step = 1) {
    const steps = `<div class="steps" aria-label="Step ${step} of 2"><span class="on"></span><span class="${step >= 2 ? 'on' : ''}"></span></div>`;
    if (step === 1) return `<section class="welcome">
      ${steps}
      <h1 class="hero">Explore the world, one place a day. <span>GeoHistory Fun!</span></h1>
      <p class="muted">Each day you get a new place and the history that happened there, plus a 5-question quiz that adapts to what you're still learning.</p>
      <form id="f-band" class="stack"><fieldset><legend>Who's exploring?</legend><div class="bandpick">
        <label class="opt"><input type="radio" name="band" value="6-12" ${band() === '6-12' ? 'checked' : ''}><span><b>Grades 6-12</b><small>Topics from the Nebraska Social Studies Standards, written for middle and high school readers.</small></span></label>
        <label class="opt"><input type="radio" name="band" value="adult" ${band() === 'adult' ? 'checked' : ''}><span><b>Adult Learner</b><small>Every topic, with more detail, context, and multiple perspectives.</small></span></label>
      </div></fieldset><div><button class="btn primary" type="submit">Next</button></div></form>
      <p class="muted" style="font-size:.9rem">Your progress stays on this device. Nothing about you is collected or sent anywhere.</p></section>`;
    return `<section class="welcome">${steps}
      <h1>How much local history?</h1>
      <p class="muted">GeoHistory Fun! mixes about 60% United States and 40% world places. You can add a little extra Nebraska and Great Plains history to your quizzes.</p>
      <form id="f-lean" class="stack">${leanFieldset()}<div class="row"><button class="btn ghost" type="button" data-go="welcome-1">Back</button><button class="btn primary" type="submit">Start exploring</button></div></form>
      <p class="muted" style="font-size:.9rem">You can change this any time in Settings.</p></section>`;
  }
  function leanFieldset() {
    const d = { off: 'The standard mix, no extra lean.', default: 'A couple of extra points for Nebraska and the Plains.', strong: 'About 10 extra points. Great for Nebraska history fans.' };
    return `<fieldset><legend>Nebraska and Plains lean</legend><div class="options">${T.localLean.levels.map(l => `<label class="opt"><input type="radio" name="lean" value="${l.id}" ${S.settings.lean === l.id ? 'checked' : ''}><span><b>${esc(l.label)}</b><small>${d[l.id] || ''}</small></span></label>`).join('')}</div></fieldset>`;
  }

  function viewToday() {
    const day = TODAY(), e = potdEvent(day), p = placeOf(e), daily = getDaily();
    const done = daily.answers.length >= daily.items.length, started = daily.answers.length > 0;
    const right = daily.answers.filter(a => a.ok).length;
    const quizCard = done
      ? `<div class="card stack"><div class="eyebrow">Daily quiz</div><h2>Done for today: ${right} of ${daily.items.length}</h2><p class="muted">Come back tomorrow for a new place and quiz. Want more now?</p><div class="row"><a class="btn primary" href="#practice">Practice mode</a><a class="btn" href="#quiz">See results</a></div></div>`
      : `<div class="card stack"><div class="eyebrow">Daily quiz</div><h2>${started ? `Keep going: question ${daily.answers.length + 1} of ${daily.items.length}` : '5 questions are ready'}</h2>
         <p class="muted">One about today's place, plus a mix of new questions and review from places you've seen.</p><div class="row"><a class="btn primary" href="#quiz">${started ? 'Resume quiz' : 'Start quiz'}</a><a class="btn" href="#practice">Practice mode</a></div></div>`;
    const weak = weakTags(1)[0];
    return `<div class="stack">
      <p class="muted"><b style="color:var(--ink)">${esc(fmtDate(day))}</b> &middot; ${esc(bandLabel(band()))}</p>
      <section class="poster" aria-labelledby="potd-title">${worldMap({ mini: true })}
        <div class="eyebrow" style="color:var(--sun)">Place of the Day</div>
        <div class="year" aria-hidden="true">${esc(e.year)}</div>
        <div><h2 id="potd-title">${esc(e.title)}</h2><p class="where">${esc(whereText(p))} &middot; ${esc(e.dateLabel)}</p></div>
        <div class="row"><a class="btn sun" href="#place-${e.id}">Read the story</a>${S.viewed[e.id] ? '<span class="chip plains">Read</span>' : ''}</div>
      </section>
      ${quizCard}
      <div class="statgrid three">
        <div class="stat"><b>${S.points}</b><small>Points</small></div>
        <div class="stat"><b>${currentStreak()}</b><small>Day streak${freezeReady(day) ? ' &middot; freeze ready' : ''}</small></div>
        <div class="stat"><b>${events().filter(x => S.viewed[x.id]).length} / ${events().length}</b><small>Places explored</small></div>
      </div>
      ${weak ? `<div class="card row" style="justify-content:space-between"><p><b>Weak spot:</b> ${esc(tagLabel(weak.t))} (${Math.round(weak.rate * 100)}% correct)</p><a class="btn small" href="#practice" data-weak="1">Practice weak spots</a></div>` : ''}
    </div>`;
  }

  let exploreFilter = { region: 'all', era: 'all', saved: false };
  function viewExplore() {
    const today = TODAY(); const start = Math.max(0, Math.min(today, 0));
    const rows = [];
    for (let d = today; d >= start; d--) {
      const e = potdEvent(d), p = placeOf(e);
      if (exploreFilter.region !== 'all' && p.region !== exploreFilter.region) continue;
      if (exploreFilter.era !== 'all' && e.era !== exploreFilter.era) continue;
      if (exploreFilter.saved && !S.bookmarks.includes(e.id)) continue;
      const dt = new Date(utc(LAUNCH) + d * 864e5);
      rows.push(`<li><a class="item" href="#place-${e.id}"><span class="date" aria-hidden="true">${dt.toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' })}<b>${dt.getUTCDate()}</b></span>
        <span><span class="t">${esc(e.title)}</span><br><span class="s"><span class="sr">${esc(fmtDate(d))}. </span>${esc(whereText(p))} &middot; ${esc(e.dateLabel)}</span></span>
        <span class="tick">${d === today ? 'Today' : S.viewed[e.id] ? 'Read' : ''}</span></a></li>`);
    }
    const usedRegions = [...new Set(events().map(e => placeOf(e).region))], usedEras = [...new Set(events().map(e => e.era))];
    return `<div class="stack">
      <div><div class="eyebrow">Explore</div><h1 tabindex="-1">Places of the Day</h1></div>
      <div class="card" style="padding:12px">${worldMap()}</div>
      <p class="muted" style="font-size:.9rem">Bright pins are places you've read. Today's place has a yellow ring.</p>
      <div class="filters" role="group" aria-label="Filter the list">
        <label class="inline" for="f-region">Region <select id="f-region"><option value="all">All</option>${T.regions.filter(r => usedRegions.includes(r.id)).map(r => `<option value="${r.id}" ${exploreFilter.region === r.id ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}</select></label>
        <label class="inline" for="f-era">Era <select id="f-era"><option value="all">All</option>${T.eras.filter(r => usedEras.includes(r.id)).map(r => `<option value="${r.id}" ${exploreFilter.era === r.id ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}</select></label>
        <label class="inline" for="f-saved"><input type="checkbox" id="f-saved" ${exploreFilter.saved ? 'checked' : ''}> Saved only</label>
      </div>
      <h2>Archive</h2>
      ${rows.length ? `<ul class="list">${rows.join('')}</ul>` : '<p class="muted">No places match these filters yet.</p>'}
    </div>`;
  }

  function viewPlace(id) {
    const e = eventById[id]; if (!e || !eventOK(e)) return `<div class="stack"><h1 tabindex="-1">Place not found</h1><p><a href="#explore">Back to Explore</a></p></div>`;
    const p = placeOf(e);
    if (!S.viewed[e.id]) { S.viewed[e.id] = TODAY(); checkExploreBadges(); save(); }
    const saved = S.bookmarks.includes(e.id);
    const nq = questions().filter(q => q.eventId === e.id).length;
    const speech = `${e.title}. ${whereText(p)}, ${e.dateLabel}. ${summaryOf(e)} Fun fact: ${e.funFact}`;
    return `<article class="stack">
      <div class="stack" style="gap:8px"><div class="eyebrow">${esc(e.dateLabel)}</div><h1 tabindex="-1">${esc(e.title)}</h1><p class="muted" style="font-weight:700">${esc(whereText(p))}</p>
        <div class="chips"><span class="chip">${esc(eraLabel(e.era))}</span><span class="chip">${esc(regionLabel(p.region))}</span>${p.plains ? '<span class="chip plains">Nebraska and Plains</span>' : ''}</div>
        <div class="row">${speakBtn(speech)}<button type="button" class="iconbtn" id="bm" aria-pressed="${saved}">${icon('bookmark')}<span>${saved ? 'Saved' : 'Save'}</span></button></div></div>
      ${badgeToasts()}
      <div class="story">
        <div class="stack"><p class="story-text">${esc(summaryOf(e))}</p>
          ${e.localConnection && !p.plains ? `<p class="local">Nebraska connection: ${esc(e.localConnection)}</p>` : ''}
          <div class="facts"><div class="fact"><h3>Fun fact</h3><p>${esc(e.funFact)}</p></div><div class="fact"><h3>Then and now</h3><p>${esc(e.thenAndNow)}</p></div></div>
          ${nq ? `<div class="row"><a class="btn primary" href="#practice" data-event="${e.id}">Quiz me on this (${nq})</a><a class="btn" href="#explore">Back to Explore</a></div>` : ''}
        </div>
        <div class="stack">${locator(p)}
          <div><h2 style="font-size:1rem;margin-bottom:6px">Sources</h2><ul class="sources">${e.sources.map(s => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.publisher)}: ${esc(s.title)}</a></li>`).join('')}</ul></div>
        </div>
      </div></article>`;
  }

  /* ---------- Quiz views ---------- */
  let quiz = null; // { mode:'daily'|'practice', q, order, answered, choice, ok, pts, started, eventFilter, weakOnly, recent:[] }
  let practiceOpts = { eventId: null, weakOnly: false };
  let tick = null;

  function nextPractice() {
    let pool = questions();
    if (practiceOpts.eventId) pool = pool.filter(q => q.eventId === practiceOpts.eventId);
    if (practiceOpts.weakOnly) pool = pool.filter(q => (S.cards[q.id] && S.cards[q.id].box <= 2) || weakness(q) > 0.45);
    if (!pool.length) return null;
    const recent = (quiz && quiz.recent) || [];
    const cand = pool.filter(q => !recent.includes(q.id)); const list = cand.length ? cand : pool;
    const mult = leanMultiplier(list, q => eventById[q.eventId]);
    const boxW = [1.5, 3, 2, 1.2, 0.7, 0.4];
    const q = weightedPick(list, x => (placeOf(eventById[x.eventId]).plains ? mult : 1) * (0.3 + weakness(x)) * boxW[(S.cards[x.id] || { box: 0 }).box]);
    return { q, order: shuffle(q.choices.map(c => c.id)), recent: [...recent, q.id].slice(-Math.min(3, pool.length - 1)) };
  }

  function questionBlock({ q, order, label, labelCls, answered, choice, pts, head }) {
    const keys = 'ABCD';
    const items = order.map((cid, i) => {
      const c = q.choices.find(x => x.id === cid);
      let cls = '', extra = '';
      if (answered) { if (c.correct) cls = 'correct'; else if (cid === choice) { cls = 'wrong'; extra = `<span class="why">${esc(c.why)}</span>`; } }
      const state = answered ? (c.correct ? '<span class="sr"> (correct answer)</span>' : cid === choice ? '<span class="sr"> (your answer)</span>' : '') : '';
      return `<li><button type="button" class="choice ${cls}" data-choice="${cid}" ${answered ? 'disabled' : ''}><span class="key" aria-hidden="true">${keys[i]}</span><span>${esc(c.text)}${state}${extra}</span></button></li>`;
    }).join('');
    const correct = q.choices.find(c => c.correct);
    const e = eventById[q.eventId];
    const fb = answered ? `<div class="feedback ${choice === correct.id ? 'ok' : 'no'} pop" role="status" id="fb">
        <div class="verdict">${choice === correct.id ? `Correct! +${pts} points` : 'Not quite.'}</div>
        ${choice !== correct.id ? `<p><b>Answer:</b> ${esc(correct.text)}</p>` : ''}
        <p>${esc(q.explanation)}</p>
        <p><a href="#place-${e.id}">Read the story: ${esc(e.title)}</a></p></div>` : '';
    return `<div class="stack">
      ${head}
      <div class="row"><span class="qlabel ${labelCls || ''}">${esc(label)}</span><span class="qlabel">${q.type === 'event-to-place' ? 'Where did it happen?' : 'What happened here?'}</span>${S.settings.timeBonus && !answered ? '<span class="timer" id="timer" aria-hidden="true"></span>' : ''}</div>
      <h1 class="qprompt" tabindex="-1" id="qp">${esc(promptOf(q))}</h1>
      <div class="row">${speakBtn(promptOf(q) + ' ' + order.map((cid, i) => `${keys[i]}: ${q.choices.find(x => x.id === cid).text}.`).join(' '))}</div>
      <ul class="choices" aria-label="Answer choices">${items}</ul>
      <p class="muted" style="font-size:.85rem">${answered ? '' : 'Tip: press A, B, C, or D to answer.'}</p>
      ${fb}
    </div>`;
  }

  function viewDaily() {
    const daily = getDaily();
    if (!daily.items.length) return `<div class="stack"><h1 tabindex="-1">No questions yet</h1><p>There are no quiz questions for this level yet.</p></div>`;
    const i = daily.answers.length;
    const bar = `<div class="progressbar" aria-hidden="true">${daily.items.map((_, k) => `<span class="${k < i ? (daily.answers[k].ok ? 'ok' : 'no') : k === i ? 'cur' : ''}"></span>`).join('')}</div>`;
    if (quiz && quiz.mode === 'daily' && quiz.answered) {
      const it = daily.items[quiz.index], q = qById[it.qid];
      const last = quiz.index === daily.items.length - 1;
      return questionBlock({ q, order: it.order, label: kindLabel(it.kind), labelCls: it.kind, answered: true, choice: quiz.choice, pts: quiz.pts,
        head: `<div class="qhead"><div class="eyebrow">Daily quiz &middot; question ${quiz.index + 1} of ${daily.items.length}</div>${bar}</div>` })
        + `<div class="row" style="margin-top:16px"><button class="btn primary" id="next">${last ? 'See results' : 'Next question'}</button></div>`;
    }
    if (i >= daily.items.length) return viewResults(daily);
    const it = daily.items[i], q = qById[it.qid];
    quiz = { mode: 'daily', index: i, answered: false, started: Date.now() };
    return questionBlock({ q, order: it.order, label: kindLabel(it.kind), labelCls: it.kind, answered: false,
      head: `<div class="qhead"><div class="eyebrow">Daily quiz &middot; question ${i + 1} of ${daily.items.length}</div>${bar}</div>` });
  }
  const kindLabel = k => ({ today: "Today's place", review: 'Review', new: 'New' }[k] || 'Question');

  let resultMsg = null;
  function viewResults(daily) {
    const right = daily.answers.filter(a => a.ok).length, pts = daily.answers.reduce((s, a) => s + a.pts, 0);
    const missed = daily.items.filter((_, k) => !daily.answers[k].ok).map(it => qById[it.qid]);
    return `<div class="stack">
      <div class="eyebrow">Daily quiz complete</div><h1 tabindex="-1">${right === daily.items.length ? 'Perfect day!' : right >= 3 ? 'Nice work!' : 'Good effort!'}</h1>
      <div class="bigscore">${right}<span> / ${daily.items.length}</span></div>
      <p><b>+${pts} points</b> today &middot; ${S.points} total &middot; ${currentStreak()} day streak</p>
      ${resultMsg ? `<p class="toast">${esc(resultMsg)}</p>` : ''}
      ${badgeToasts()}
      ${missed.length ? `<div class="card stack"><h2>Worth another look</h2><p class="muted">These will come back in your review questions soon.</p><ul class="list">${missed.map(q => { const e = eventById[q.eventId]; return `<li><a class="item" href="#place-${e.id}"><span class="date" aria-hidden="true">${icon('pin')}</span><span><span class="t">${esc(e.title)}</span><br><span class="s">${esc(whereText(placeOf(e)))}</span></span><span></span></a></li>`; }).join('')}</ul></div>` : ''}
      <div class="row"><a class="btn primary" href="#practice">Keep practicing</a><a class="btn" href="#today">Back to Today</a></div>
    </div>`;
  }

  function viewPractice() {
    if (!quiz || quiz.mode !== 'practice') {
      const n = nextPractice();
      if (!n) return practiceEmpty();
      quiz = { mode: 'practice', ...n, answered: false, started: Date.now(), streak: 0, count: 0 };
    }
    const filterNote = practiceOpts.eventId ? `Questions about ${esc(eventById[practiceOpts.eventId].title)}` : practiceOpts.weakOnly ? 'Weak spots only' : 'All places';
    const head = `<div class="qhead"><div class="eyebrow">Practice mode &middot; ${filterNote}</div><div class="row">
      <label class="inline" for="weak"><input type="checkbox" id="weak" ${practiceOpts.weakOnly ? 'checked' : ''} ${practiceOpts.eventId ? 'disabled' : ''}> Weak spots only</label>
      ${practiceOpts.eventId ? '<button class="btn small" id="allplaces">All places</button>' : ''}</div></div>`;
    return questionBlock({ q: quiz.q, order: quiz.order, label: S.cards[quiz.q.id] ? 'Review' : 'New', labelCls: S.cards[quiz.q.id] ? 'review' : '', answered: quiz.answered, choice: quiz.choice, pts: quiz.pts, head })
      + (quiz.answered ? `<div class="row" style="margin-top:16px"><button class="btn primary" id="next">Next question</button><a class="btn" href="#today">Done</a></div>${badgeToasts()}` : '');
  }
  function practiceEmpty() {
    return `<div class="stack"><div class="eyebrow">Practice mode</div><h1 tabindex="-1">${practiceOpts.weakOnly ? 'No weak spots right now' : 'No questions here yet'}</h1>
      <p class="muted">${practiceOpts.weakOnly ? "You haven't missed enough questions to have weak spots. Nice! Try the full set instead." : 'Try a different filter.'}</p>
      <div class="row"><button class="btn primary" id="allplaces">Practice all places</button></div></div>`;
  }

  function viewProgress() {
    const answered = Object.values(S.cards).reduce((s, c) => s + c.seen, 0), correct = Object.values(S.cards).reduce((s, c) => s + c.correct, 0);
    const bars = prefix => {
      const rows = Object.entries(S.tags).filter(([t]) => t.startsWith(prefix)).map(([t, s]) => ({ t, s, r: s.correct / s.seen })).sort((a, b) => a.r - b.r);
      if (!rows.length) return '<p class="muted">Answer a few questions to see this.</p>';
      return `<div class="bars">${rows.map(({ t, s, r }) => `<div class="bar"><span>${esc(tagLabel(t))}</span><span class="track" aria-hidden="true"><span class="fill ${r < 0.6 ? 'low' : ''}" style="width:${Math.round(r * 100)}%"></span></span><span class="v">${Math.round(r * 100)}%<span class="sr"> correct, ${s.correct} of ${s.seen}</span></span></div>`).join('')}</div>`;
    };
    const boxes = [1, 2, 3, 4, 5].map(b => Object.values(S.cards).filter(c => c.box === b).length);
    const weak = weakTags(3);
    return `<div class="stack">
      <div><div class="eyebrow">Progress</div><h1 tabindex="-1">How you're doing</h1></div>
      <div class="statgrid">
        <div class="stat"><b>${S.points}</b><small>Total points</small></div>
        <div class="stat"><b>${currentStreak()}</b><small>Day streak (best ${S.streak.best})</small></div>
        <div class="stat"><b>${S.quizzesDone}</b><small>Daily quizzes finished</small></div>
        <div class="stat"><b>${answered ? Math.round(correct / answered * 100) + '%' : 'None yet'}</b><small>Correct overall (${correct} of ${answered})</small></div>
      </div>
      <div class="card stack"><h2>Weak spots</h2>${weak.length ? `<p>${weak.map(w => `<b>${esc(tagLabel(w.t))}</b> (${Math.round(w.rate * 100)}%)`).join(', ')}</p><div><a class="btn small" href="#practice" data-weak="1">Practice weak spots</a></div>` : '<p class="muted">No weak spots yet. Missed questions show up here and come back in your daily review.</p>'}</div>
      <div class="card stack"><h2>By region</h2>${bars('region:')}</div>
      <div class="card stack"><h2>By era</h2>${bars('era:')}</div>
      <div class="card stack"><h2>By question type</h2>${bars('type:')}</div>
      <div class="card stack"><h2>Review boxes</h2><p class="muted">Questions move up a box each time you get them right and back to box 1 when you miss. Higher boxes come back less often.</p>
        <div class="bars">${boxes.map((n, i) => `<div class="bar"><span>Box ${i + 1} (every ${INTERVALS[i]} day${INTERVALS[i] > 1 ? 's' : ''})</span><span class="track" aria-hidden="true"><span class="fill" style="width:${Math.min(100, n / Math.max(1, questions().length) * 100)}%"></span></span><span class="v">${n}</span></div>`).join('')}</div></div>
      <section class="stack"><h2>Badges</h2><div class="badges">${BADGES.map(b => `<div class="badge ${S.badges[b.id] != null ? 'on' : ''}"><span class="ico">${icon(b.icon)}</span><b>${esc(b.name)}</b><small>${esc(b.desc)}</small><small>${S.badges[b.id] != null ? 'Earned ' + esc(fmtDate(S.badges[b.id], { month: 'short', day: 'numeric' })) : 'Not yet'}</small></div>`).join('')}</div></section>
    </div>`;
  }

  let confirmReset = false, ioMsg = '';
  function viewSettings() {
    const radio = (name, val, cur, label, small = '') => `<label class="opt"><input type="radio" name="${name}" value="${val}" ${String(cur) === String(val) ? 'checked' : ''}><span><b>${label}</b>${small ? `<small>${small}</small>` : ''}</span></label>`;
    const sw = (id, on, label, small) => `<label class="switch" for="${id}"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><span>${label}<small>${small}</small></span></label>`;
    const inFrame = (() => { try { return window.self !== window.top; } catch (e) { return true; } })();
    return `<div class="stack">
      <div><div class="eyebrow">Settings</div><h1 tabindex="-1">Make it yours</h1></div>
      ${storageOK ? '' : '<p class="notice">This browser is blocking storage, so progress will be lost when you close the page.</p>'}
      <form id="f-settings" class="stack">
        <div class="card stack"><fieldset><legend>Reading level</legend><div class="options">
          ${radio('band', '6-12', band(), 'Grades 6-12', 'Nebraska standards topics')}${radio('band', 'adult', band(), 'Adult Learner', 'All topics, more depth')}</div>
          <p class="muted" style="font-size:.86rem">A K-5 level is planned for a future version.</p></fieldset></div>
        <div class="card stack">${leanFieldset()}</div>
        <div class="card stack"><fieldset><legend>Text size</legend><div class="options">
          ${radio('scale', 0.9, S.settings.scale, 'Small')}${radio('scale', 1, S.settings.scale, 'Medium')}${radio('scale', 1.15, S.settings.scale, 'Large')}${radio('scale', 1.3, S.settings.scale, 'Extra large')}</div></fieldset></div>
        <div class="card stack"><fieldset><legend>Theme</legend><div class="options">
          ${radio('theme', 'system', S.settings.theme, 'Match device')}${radio('theme', 'light', S.settings.theme, 'Light')}${radio('theme', 'dark', S.settings.theme, 'Dark')}</div></fieldset></div>
        <div class="card stack"><fieldset><legend>Options</legend>
          ${sw('s-time', S.settings.timeBonus, 'Time bonus', 'Earn 3 extra points for answering within 15 seconds. Off by default; there is never a penalty for taking your time.')}
          ${sw('s-speak', S.settings.readAloud, 'Read-aloud buttons', canSpeak ? "Uses your device's built-in voice." : 'Not supported in this browser.')}
          ${sw('s-motion', S.settings.reduceMotion, 'Reduce motion', 'Turns off animations.')}
        </fieldset></div>
      </form>
      <div class="card stack"><h2>Your data</h2>
        <p class="muted">Everything is saved only in this browser. Back it up or move it to another device with a progress code.</p>
        <div class="row"><button class="btn small" id="exp">Copy progress code</button>${inFrame ? '' : '<button class="btn small" id="dl">Download backup file</button>'}</div>
        <label for="imp-text" class="muted" style="font-size:.9rem">Restore: paste a progress code or choose a backup file</label>
        <textarea id="imp-text" placeholder="Paste a progress code here"></textarea>
        <div class="row"><button class="btn small" id="imp">Restore from code</button><label class="btn small" for="imp-file">Choose file</label><input type="file" id="imp-file" accept="application/json,.json" class="sr"></div>
        ${ioMsg ? `<p role="status" class="toast">${esc(ioMsg)}</p>` : ''}
        ${confirmReset ? `<div class="confirm" role="alert"><p><b>Erase all progress?</b> Points, streaks, badges, and review history will be deleted from this browser. This can't be undone.</p><div class="row"><button class="btn danger" id="reset-yes">Erase everything</button><button class="btn" id="reset-no">Keep my progress</button></div></div>` : '<div><button class="btn small danger" id="reset">Reset progress</button></div>'}
      </div>
      <div class="card stack"><h2>About</h2>
        <p>GeoHistory Fun! is a prototype. It doesn't use accounts, ads, analytics, or tracking, and it doesn't load anything from outside companies.</p>
        <p class="muted" style="font-size:.9rem">Maps: Natural Earth and US Census boundaries (public domain). Fonts: Atkinson Hyperlegible and Bricolage Grotesque (SIL Open Font License). Content: ${D.events.length} places, ${D.questions.length} questions. Version ${esc(D.config.version)}.</p>
      </div>
    </div>`;
  }

  function badgeToasts() {
    if (!newBadges.length) return '';
    const html = newBadges.map(id => { const b = BADGES.find(x => x.id === id); return `<p class="toast pop" role="status">Badge earned: ${esc(b.name)}. ${esc(b.desc)}.</p>`; }).join('');
    newBadges = []; return html;
  }

  /* ---------- Router ---------- */
  let current = null;
  function route() {
    if (tick) { clearInterval(tick); tick = null; }
    if (canSpeak) speechSynthesis.cancel();
    let h = location.hash.slice(1) || 'today';
    if (!S.onboarded && !h.startsWith('welcome')) h = 'welcome-1';
    const changed = h !== current;
    if (changed && !(h === 'practice' && current && current.startsWith('place-') && quiz && quiz.mode === 'practice')) { if (h === 'practice' || h === 'quiz') quiz = null; }
    current = h;
    let html, active = h;
    if (h.startsWith('welcome')) { html = viewWelcome(h === 'welcome-2' ? 2 : 1); active = 'welcome'; }
    else if (h === 'today') html = viewToday();
    else if (h === 'explore') html = viewExplore();
    else if (h.startsWith('place-')) { html = viewPlace(h.slice(6)); active = 'explore'; }
    else if (h === 'quiz') html = viewDaily();
    else if (h === 'practice') { html = viewPractice(); active = 'quiz'; }
    else if (h === 'progress') html = viewProgress();
    else if (h === 'settings') html = viewSettings();
    else { html = viewToday(); active = 'today'; }
    shell(active);
    const main = $('#main'); main.innerHTML = `<div class="wrap">${html}</div>`;
    document.title = ({ today: 'Today', explore: 'Explore', quiz: 'Daily Quiz', practice: 'Practice', progress: 'Progress', settings: 'Settings' }[h] || (h.startsWith('place-') ? (eventById[h.slice(6)] || {}).title : 'Welcome')) + ' | GeoHistory Fun!';
    if (changed) { const f = main.querySelector('h1[tabindex], h1'); if (f) { f.setAttribute('tabindex', '-1'); f.focus({ preventScroll: true }); } window.scrollTo(0, 0); }
    startTimer();
  }
  function rerender(focusSel) {
    const keep = current; current = keep; // same route
    const y = window.scrollY; route(); current = keep;
    if (focusSel) { const el = $(focusSel); if (el) el.focus(); } else window.scrollTo(0, y);
  }
  function startTimer() {
    const el = $('#timer'); if (!el || !quiz || quiz.answered) return;
    const upd = () => { const s = Math.floor((Date.now() - quiz.started) / 1000); el.textContent = s <= 15 ? `${15 - s}s left for +3 bonus` : 'Take your time'; if (s > 15 && tick) { clearInterval(tick); tick = null; } };
    upd(); tick = setInterval(upd, 1000);
  }

  /* ---------- Events ---------- */
  function answer(cid) {
    if (!quiz || quiz.answered) return;
    const secs = (Date.now() - quiz.started) / 1000;
    if (quiz.mode === 'daily') {
      const daily = getDaily(); const it = daily.items[quiz.index]; const q = qById[it.qid];
      const ok = q.choices.find(c => c.id === cid).correct; const pts = record(q, ok, 'daily', secs);
      daily.answers.push({ choice: cid, ok, pts }); save();
      quiz = { ...quiz, answered: true, choice: cid, ok, pts };
      if (daily.answers.length === daily.items.length) resultMsg = finishDaily();
    } else {
      const q = quiz.q; const ok = q.choices.find(c => c.id === cid).correct; const pts = record(q, ok, 'practice', secs);
      quiz = { ...quiz, answered: true, choice: cid, ok, pts };
    }
    rerender('#fb');
  }

  document.addEventListener('click', ev => {
    const t = ev.target.closest('button, a'); if (!t) return;
    if (t.dataset.choice) return answer(t.dataset.choice);
    if (t.dataset.speak !== undefined) return toggleSpeak(t);
    if (t.dataset.go === 'welcome-1') { location.hash = 'welcome-1'; return; }
    if (t.matches('a[href="#practice"]')) { practiceOpts = { eventId: t.dataset.event || null, weakOnly: !!t.dataset.weak }; quiz = null; if (location.hash === '#practice') { ev.preventDefault(); current = null; route(); } return; }
    if (t.id === 'next') {
      if (quiz.mode === 'daily') { quiz = null; current = null; route(); }
      else { const n = nextPractice(); quiz = n ? { mode: 'practice', ...n, answered: false, started: Date.now() } : null; current = null; route(); }
      return;
    }
    if (t.id === 'allplaces') { practiceOpts = { eventId: null, weakOnly: false }; quiz = null; current = null; route(); return; }
    if (t.id === 'bm') { const id = current.slice(6); S.bookmarks = S.bookmarks.includes(id) ? S.bookmarks.filter(x => x !== id) : [...S.bookmarks, id]; save(); rerender('#bm'); return; }
    if (t.id === 'exp' || t.id === 'dl') {
      const code = JSON.stringify(S);
      if (t.id === 'dl') { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([code], { type: 'application/json' })); a.download = `geohistory-fun-progress-${todayKey()}.json`; a.click(); ioMsg = 'Backup file downloaded.'; rerender(); return; }
      const ta = $('#imp-text');
      const done = () => { ioMsg = 'Progress code copied. Paste it somewhere safe.'; rerender(); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code).then(done, () => { ta.value = code; ta.select(); ioMsg = 'Copy the selected code above.'; });
      else { ta.value = code; ta.select(); }
      return;
    }
    if (t.id === 'imp') { importCode($('#imp-text').value); return; }
    if (t.id === 'reset') { confirmReset = true; rerender('#reset-no'); return; }
    if (t.id === 'reset-no') { confirmReset = false; rerender('#reset'); return; }
    if (t.id === 'reset-yes') { const keep = S.settings; S = DEFAULTS(); S.settings = keep; S.onboarded = true; save(); confirmReset = false; ioMsg = 'Progress erased.'; quiz = null; rerender(); return; }
  });
  function importCode(text) {
    try { const s = JSON.parse(text); if (!s || s.v !== 1 || !s.settings) throw new Error('bad'); S = { ...DEFAULTS(), ...s }; save(); applySettings(); ioMsg = 'Progress restored.'; }
    catch (e) { ioMsg = "That code didn't work. Make sure you pasted the whole thing."; }
    rerender();
  }
  document.addEventListener('change', ev => {
    const t = ev.target;
    if (t.id === 'imp-file' && t.files[0]) { const r = new FileReader(); r.onload = () => importCode(r.result); r.readAsText(t.files[0]); return; }
    if (t.id === 'weak') { practiceOpts.weakOnly = t.checked; quiz = null; current = null; route(); return; }
    if (t.id === 'f-region') { exploreFilter.region = t.value; rerender('#f-region'); return; }
    if (t.id === 'f-era') { exploreFilter.era = t.value; rerender('#f-era'); return; }
    if (t.id === 'f-saved') { exploreFilter.saved = t.checked; rerender('#f-saved'); return; }
    if (t.closest('#f-settings')) {
      if (t.name === 'band') { S.settings.band = t.value; }
      else if (t.name === 'lean') S.settings.lean = t.value;
      else if (t.name === 'scale') S.settings.scale = Number(t.value);
      else if (t.name === 'theme') S.settings.theme = t.value;
      else if (t.id === 's-time') S.settings.timeBonus = t.checked;
      else if (t.id === 's-speak') S.settings.readAloud = t.checked;
      else if (t.id === 's-motion') S.settings.reduceMotion = t.checked;
      save(); applySettings(); const sel = t.id ? `#${t.id}` : `input[name="${t.name}"][value="${t.value}"]`; rerender(sel);
    }
  });
  document.addEventListener('submit', ev => {
    ev.preventDefault();
    if (ev.target.id === 'f-band') { const v = new FormData(ev.target).get('band'); if (v) S.settings.band = v; save(); location.hash = 'welcome-2'; }
    if (ev.target.id === 'f-lean') { const v = new FormData(ev.target).get('lean'); if (v) S.settings.lean = v; S.onboarded = true; save(); location.hash = 'today'; }
  });
  document.addEventListener('keydown', ev => {
    if (ev.altKey || ev.ctrlKey || ev.metaKey || /input|textarea|select/i.test(ev.target.tagName)) return;
    if (!quiz || quiz.answered || !(current === 'quiz' || current === 'practice')) return;
    const i = 'abcd1234'.indexOf(ev.key.toLowerCase()); if (i < 0) return;
    const btns = document.querySelectorAll('.choice'); const b = btns[i % 4]; if (b) { ev.preventDefault(); b.click(); }
  });
  window.addEventListener('hashchange', route);

  applySettings();
  route();

  if ('serviceWorker' in navigator && location.protocol === 'https:' && D.config.offline) {
    try { navigator.serviceWorker.register('sw.js').catch(() => {}); } catch (e) {}
  }
})();
