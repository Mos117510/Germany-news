// ======================================================
// TEIL 1 — Utilities, Scraper, Tagesupdate (FREE PLAN)
// ======================================================
// ---------- CONSTANTS ----------
const TAGESSCHAU_FEED = 'https://www.tagesschau.de/index~rss2.xml';
const SPIEGEL_FEED = 'https://www.spiegel.de/index.rss';
const ALLOWED = ['tagesschau.de', 'spiegel.de'];

const UA = 'Deutschland-News-Update/1.0';
const MAX_FEED_BYTES = 600_000;
const MAX_TAGESSCHAU_ITEMS = 6;
const MAX_SPIEGEL_ITEMS = 6;

// ---------- HELPERS ----------
function todayBerlin() {
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })
    .format(new Date())
    .split('.')
    .reverse()
    .join('-');
}

function clean(s = '') {
  return s.replace(/\s+/g, ' ').replace(/\u00a0/g, ' ').trim();
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function allowedUrl(u) {
  try {
    const x = new URL(u);
    return (
      x.protocol === 'https:' &&
      !x.username &&
      !x.password &&
      ALLOWED.some(d => x.hostname === d || x.hostname.endsWith('.' + d))
    );
  } catch {
    return false;
  }
}

function absUrl(base, href) {
  try {
    const u = new URL(href, base);
    return allowedUrl(u) ? u.href : null;
  } catch {
    return null;
  }
}

function unique(items) {
  const s = new Set();
  return items.filter(x => {
    if (s.has(x.link)) return false;
    s.add(x.link);
    return true;
  });
}

// ---------- SAFE FETCH ----------
async function readTextLimited(response, maxBytes) {
  const len = Number(response.headers.get('content-length') || 0);
  if (len && len > maxBytes) throw new Error('Quelle zu groß');

  if (!response.body) return '';

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    total += value.byteLength;
    if (total > maxBytes) throw new Error('Quelle zu groß');

    chunks.push(value);
  }

  const all = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) {
    all.set(c, pos);
    pos += c.byteLength;
  }

  return new TextDecoder().decode(all);
}

async function safeFetch(url, maxBytes) {
  if (!allowedUrl(url)) throw new Error('Nicht erlaubte URL');

  let current = url;

  for (let i = 0; i < 3; i++) {
    const r = await fetch(current, {
      redirect: 'manual',
      headers: {
        'User-Agent': UA,
        'Accept':
          'text/html,application/rss+xml,application/xml;q=0.9,text/plain;q=0.8'
      }
    });

    if (r.status >= 300 && r.status < 400) {
      const location = r.headers.get('location');
      const next = location ? absUrl(current, location) : null;
      if (!next) throw new Error('Unsicherer Redirect blockiert');
      current = next;
      continue;
    }

    return r;
  }

  throw new Error('Zu viele Redirects');
}

// ---------- SHARED RSS PARSER (works for any well-formed RSS 2.0 feed) ----------
function parseRssFeed(xml, feedUrl, sourceName) {
  const out = [];
  const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];

  for (const item of items) {
    const stripCdata = s => clean(s.replace(/<!\[CDATA\[|\]\]>/g, ''));
    const title = stripCdata(item.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
    const link = stripCdata(item.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1] || '');
    const description = stripCdata(item.match(/<description[^>]*>([\s\S]*?)<\/description>/i)?.[1] || '');
    const published = stripCdata(item.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i)?.[1] || '');

    const url = absUrl(feedUrl, link);
    // Skip video-only entries and anything with too little description text to summarize
    // meaningfully - these are what produced thin, uninformative summaries before.
    const isVideo = url && /\/video[-/]/i.test(url);
    if (title && url && !isVideo && description.length >= 40) {
      out.push({ source: sourceName, title, link: url, description, published });
    }
  }

  return unique(out);
}

// ---------- SCRAPER: TAGESSCHAU ----------
async function rssItems() {
  const r = await safeFetch(TAGESSCHAU_FEED, MAX_FEED_BYTES);
  if (!r.ok) throw new Error(`tagesschau.de nicht erreichbar: HTTP ${r.status}`);
  const xml = await readTextLimited(r, MAX_FEED_BYTES);
  return parseRssFeed(xml, TAGESSCHAU_FEED, 'tagesschau.de').slice(0, MAX_TAGESSCHAU_ITEMS);
}

// ---------- SCRAPER: SPIEGEL ----------
async function spiegelItems() {
  const r = await safeFetch(SPIEGEL_FEED, MAX_FEED_BYTES);
  if (!r.ok) throw new Error(`spiegel.de nicht erreichbar: HTTP ${r.status}`);
  const xml = await readTextLimited(r, MAX_FEED_BYTES);
  return parseRssFeed(xml, SPIEGEL_FEED, 'spiegel.de').slice(0, MAX_SPIEGEL_ITEMS);
}

// ---------- AI CLEANING ----------
function cleanAiData(data, allowedLinks) {
  const safeSections = Array.isArray(data?.sections) ? data.sections : [];

  return {
    overview: clean(String(data?.overview || '')).slice(0, 6000),
    sections: safeSections.slice(0, 8).map(s => ({
      name: clean(String(s?.name || '')).slice(0, 80),
            items: Array.isArray(s?.items)
        ? s.items.slice(0, 20).map(it => {
            const title = clean(String(it?.title || '')).slice(0, 240);
            const rawText = clean(String(it?.text || '')).slice(0, 1200);
            return {
              title,
              text: rawText || title, // AI sometimes leaves text empty - fall back to the title rather than dropping the item
              urls: Array.isArray(it?.urls)
                ? it.urls.filter(u => typeof u === 'string' && allowedLinks.has(u)).slice(0, 3)
                : []
            };
          }).filter(it => it.title)
        : []
    })).filter(s => s.name && s.items.length)
  };
}

// ---------- AI PROMPT ----------
function promptFor(raw, day) {
  const limited = raw.slice(0, 10); // Maximal 10 Artikel

  return `
Gib NUR ein gültiges JSON zurück.
KEINE Erklärungen.
KEINE Einleitung.
KEINE Codeblöcke.
KEIN Text außerhalb des JSON.

JSON-Struktur:

{
  "overview": "",
  "sections": [
    {
      "name": "",
      "items": [
        {
          "title": "",
          "text": "",
          "urls": []
        }
      ]
    }
  ]
}

Hier sind die Artikel für ${day}:

${limited.map(a => `- ${a.title} (${a.link})`).join("\n")}
`;
}

// ---------- BUILD DAILY UPDATE ----------
async function buildUpdate(env, day, previous) {
  const totalStart = Date.now();

  let ts = [];
  let spiegel = [];
  const failures = [];

  // Load sources
  const sourceResults = await Promise.allSettled([rssItems(), spiegelItems()]);

  if (sourceResults[0].status === 'fulfilled') ts = sourceResults[0].value;
  else failures.push('tagesschau.de');

  if (sourceResults[1].status === 'fulfilled') spiegel = sourceResults[1].value;
  else failures.push('spiegel.de');

  // If both failed → no news
  if (failures.length === 2) {
    return {
      noNews: true,
      message: previous ? 'No New News yet' : 'No News',
      failures
    };
  }

  const raw = unique([...ts, ...spiegel].map(a => ({ ...a, content: a.description })));

  if (!raw.length) {
    return {
      noNews: true,
      message: previous ? 'No New News yet' : 'No News',
      failures
    };
  }

  // ---------- AI ----------
  const ai = await env.AI.run('@cf/meta/llama-3.1-8b-instruct-fast', {
    messages: [{ role: 'user', content: promptFor(raw, day) }],
    max_tokens: 2048
  });

  let text = typeof ai?.response === 'string'
  ? ai.response.trim()
  : JSON.stringify(ai?.response || '').trim();

  // KI liefert nichts
  if (!text) {
    return {
      noNews: true,
      message: 'KI lieferte keine Antwort.',
      failures
    };
  }

  // Codeblock entfernen
  text = text.replace(/^```json\s*|\s*```$/g, '').trim();

    let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    return {
      noNews: true,
      message: 'KI-Antwort war kein gültiges JSON.',
      failures,
      rawAiResponse: text
    };
  }

  const allArticles = raw.map(a => ({
    source: a.source,
    title: a.title,
    link: a.link
  }));

  const allowedLinks = new Set(allArticles.map(a => a.link));

  const rawParsed = data;
  data = cleanAiData(data, allowedLinks);

  // TEMPORARY DEBUG - cleaning wiped out every section; show what the AI actually sent
  if (!data.sections.length) {
    return {
      noNews: true,
      message: 'cleanAiData hat alle sections entfernt.',
      failures,
      rawParsedBeforeClean: JSON.stringify(rawParsed).slice(0, 3000)
    };
  }
  const oldLinks = new Set((previous?.articles || []).map(x => x.link));

  const marked = data.sections.map(section => ({
    ...section,
    items: section.items.map(item => ({
      ...item,
      new: item.urls.some(url => !oldLinks.has(url))
    }))
  }));

  return {
    overview: data.overview || '',
    sections: marked,
    articles: allArticles,
    failures
  };
}

// ======================================================
// TEIL 2 — Perioden-Logik & Übersetzungen (FREE PLAN)
// ======================================================

// ---------- PERIOD KEY ----------
function periodKey(type, day) {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));

  if (type === 'weekly') {
    const weekday = dt.getUTCDay() || 7;
    dt.setUTCDate(dt.getUTCDate() - weekday + 1);
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
  }

  // monthly
  return `${y}-${String(m).padStart(2, '0')}`;
}

// ---------- PERIOD DATES ----------
function periodDates(type, day) {
  const [y, m, d] = day.split('-').map(Number);
  const end = new Date(Date.UTC(y, m - 1, d));
  let start;

  if (type === 'weekly') {
    const weekday = end.getUTCDay() || 7;
    start = new Date(Date.UTC(y, m - 1, d - weekday + 1));
  } else {
    start = new Date(Date.UTC(y, m - 1, 1));
  }

  const dates = [];
  for (let cur = new Date(start); cur <= end; cur.setUTCDate(cur.getUTCDate() + 1)) {
    dates.push(cur.toISOString().slice(0, 10));
  }
  return dates;
}

// ---------- PERIOD PROMPT ----------
function periodPrompt(type, key, dailyRows) {
  const weekly = type === 'weekly';
  const target = weekly ? '1200-2200' : '4500-8000';
  const label = weekly ? 'Wochenrückblick' : 'Monatsrückblick';

  const dedupe = `WICHTIG: Fasse dieselben Ereignisse über mehrere Tage zu EINEM Thema zusammen. Wiederhole keine Meldung nur weil sie in mehreren Tagesupdates vorkommt.`;

  return `Du erstellst einen ${label} für ${key}. Verwende AUSSCHLIESSLICH die unten gespeicherten Tagesupdates. Keine Außenkenntnis.

${dedupe}

Zielumfang: ${target} Wörter.

Ausgabe als JSON:
{"overview":"...","sections":[{"name":"...","items":[{"title":"...","text":"mehrere Sätze","days":["YYYY-MM-DD"]}]}]}

TAGESUPDATES:
${dailyRows.map(r =>
  `--- ${r.day} ---
Übersicht: ${r.overview}
${JSON.parse(r.sections_json).map(s =>
  `[${s.name}] ${s.items.map(i => `${i.title}: ${i.text}`).join(' | ')}`
).join('\n')}`
).join('\n\n')}`;
}

// ---------- CLEAN PERIOD DATA ----------
function cleanPeriodData(data, type) {
  const maxSections = 8;
  const maxItems = type === 'weekly' ? 40 : 100;

  const sections = Array.isArray(data?.sections) ? data.sections : [];

  return {
    overview: clean(String(data?.overview || '')).slice(0, 14000),
    sections: sections.slice(0, maxSections).map(s => ({
      name: clean(String(s?.name || '')).slice(0, 80),
      items: Array.isArray(s?.items)
        ? s.items.slice(0, maxItems).map(it => ({
            title: clean(String(it?.title || '')).slice(0, 260),
            text: clean(String(it?.text || '')).slice(0, 3000),
            days: Array.isArray(it?.days)
              ? it.days.filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).slice(0, 15)
              : []
          })).filter(it => it.title && it.text)
        : []
    })).filter(s => s.name && s.items.length)
  };
}
// ---------- BUILD PERIOD ----------
async function buildPeriod(env, type, day) {
  const dates = periodDates(type, day);

  const rows = await env.DB
    .prepare(`SELECT day,overview,sections_json FROM daily_updates WHERE day IN (${dates.map(() => '?').join(',')}) ORDER BY day ASC`)
    .bind(...dates)
    .all();

  if (!rows.results.length) {
    return { noNews: true, message: 'No News' };
  }

  const key = periodKey(type, day);

  const ai = await env.AI.run('@cf/meta/llama-3.1-8b-instruct-fast', {
  messages: [
    {
      role: 'user',
      content: periodPrompt(type, key, rows.results)
    }
  ],
  max_tokens: 4096
});

  let text = (ai?.response || '').replace(/^```json\s*|\s*```$/g, '').trim();

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Die KI-Antwort war kein gültiges JSON.');
  }

  data = cleanPeriodData(data, type);

  return {
    type,
    key,
    overview: data.overview,
    sections: data.sections,
    days: dates.filter(d => rows.results.some(r => r.day === d))
  };
}

// ======================================================
// TRANSLATIONS
// ======================================================

const LANGS = new Set(['de', 'en', 'ar']);

function parseTranslations(raw) {
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return {};
  }
}

// ---------- TRANSLATION PROMPT ----------
function translationPrompt(language, source) {
  const names = {
    de: 'Deutsch',
    en: 'English',
    ar: 'العربية'
  };

  return `Übersetze den folgenden geprüften Deutschland-News-Text vollständig ins ${names[language]}.

Keine neuen Fakten. Keine Kürzungen. Struktur exakt beibehalten.

Ausgabe als JSON:
{"overview":"...","sections":[{"name":"...","items":[{"title":"...","text":"...","urls":["..."]}]}]}

TEXT:
${JSON.stringify(source)}`;
}

// ---------- CLEAN TRANSLATED ----------
function cleanTranslated(data, source, allowedLinks) {
  const srcSections = Array.isArray(source.sections) ? source.sections : [];
  const sections = Array.isArray(data?.sections) ? data.sections : [];

  return {
    overview: clean(String(data?.overview || '')).slice(0, 14000),
    sections: sections.slice(0, 8).map((s, si) => ({
      name: clean(String(s?.name || srcSections[si]?.name || '')).slice(0, 80),
      items: Array.isArray(s?.items)
        ? s.items.slice(0, 100).map((it, ii) => ({
            title: clean(String(it?.title || srcSections[si]?.items?.[ii]?.title || '')).slice(0, 260),
            text: clean(String(it?.text || srcSections[si]?.items?.[ii]?.text || '')).slice(0, 3000),
            urls: Array.isArray(it?.urls)
              ? it.urls.filter(u => typeof u === 'string' && allowedLinks.has(u)).slice(0, 3)
              : [],
            new: Boolean(srcSections[si]?.items?.[ii]?.new)
          })).filter(it => it.title && it.text)
        : []
    })).filter(s => s.name && s.items.length)
  };
}

// ---------- TRANSLATE SAVED ----------
async function translateSaved(env, type, key, language) {
  if (!LANGS.has(language)) {
    throw new Error('Nicht unterstützte Sprache');
  }

  if (type === 'daily') {
    const row = await env.DB
      .prepare('SELECT * FROM daily_updates WHERE day=?')
      .bind(key)
      .first();

    if (!row) return { noNews: true, message: 'No News' };

    const translations = parseTranslations(row.translations_json);

    if (language === 'de') {
      return {
        language,
        day: row.day,
        overview: row.overview,
        sections: JSON.parse(row.sections_json),
        failures: []
      };
    }

    if (translations[language]) {
      return {
        language,
        day: row.day,
        ...translations[language],
        failures: []
      };
    }

    const source = {
      overview: row.overview,
      sections: JSON.parse(row.sections_json)
    };

    const allowedLinks = new Set(JSON.parse(row.articles_json).map(a => a.link));

    const ai = await env.AI.run('@cf/meta/llama-3.1-8b-instruct-fast', {
  messages: [{ role: 'user', content: translationPrompt(language, source) }],
  max_tokens: 4096,
  temperature: 0.2
    });

    let text = (ai?.response || '').replace(/^```json\s*|\s*```$/g, '').trim();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('Die Übersetzung war kein gültiges JSON.');
    }

    data = cleanTranslated(data, source, allowedLinks);
    translations[language] = data;

    await env.DB
      .prepare('UPDATE daily_updates SET translations_json=? WHERE day=?')
      .bind(JSON.stringify(translations), key)
      .run();

    return {
      language,
      day: row.day,
      ...data,
      failures: []
    };
  }

  // ---------- WEEKLY / MONTHLY ----------
  const row = await env.DB
    .prepare('SELECT * FROM period_updates WHERE type=? AND period_key=?')
    .bind(type, key)
    .first();

  if (!row) return { noNews: true, message: 'No News' };

  const translations = parseTranslations(row.translations_json);

  if (language === 'de') {
    return {
      language,
      overview: row.overview,
      sections: JSON.parse(row.sections_json),
      days: JSON.parse(row.days_json)
    };
  }

  if (translations[language]) {
    return {
      language,
      ...translations[language],
      days: JSON.parse(row.days_json)
    };
  }

  const source = {
    overview: row.overview,
    sections: JSON.parse(row.sections_json)
  };

  const allowedLinks = new Set(); // Perioden haben keine URLs

  const ai = await env.AI.run('@cf/meta/llama-3.1-8b-instruct-fast', {
  messages: [{ role: 'user', content: translationPrompt(language, source) }],
  max_tokens: 4096,
  temperature: 0.2
});

  let text = (ai?.response || '').replace(/^```json\s*|\s*```$/g, '').trim();

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Die Übersetzung war kein gültiges JSON.');
  }

  data = cleanTranslated(data, source, allowedLinks);
  translations[language] = data;

  await env.DB
    .prepare('UPDATE period_updates SET translations_json=? WHERE type=? AND period_key=?')
    .bind(JSON.stringify(translations), type, key)
    .run();

  return {
    language,
    ...data,
    days: JSON.parse(row.days_json)
  };
    }
      // ======================================================
// TEIL 3 — API, Rate-Limits, Security, Worker Export
// ======================================================

// ---------- RATE LIMITS ----------
const refreshTimes = new Map();
const translateTimes = new Map();

function refreshAllowed(request) {
  const key = request.headers.get('CF-Connecting-IP') || 'global';
  const now = Date.now();
  const last = refreshTimes.get(key) || 0;

  if (now - last < 30_000) return false;

  refreshTimes.set(key, now);

  if (refreshTimes.size > 5000) {
    for (const [k, v] of refreshTimes) {
      if (now - v > 300_000) refreshTimes.delete(k);
    }
  }

  return true;
}
// ---------- API ROUTER ----------
async function api(request, env) {
  const url = new URL(request.url);
  const day = todayBerlin();
// DAILY REFRESH
  
  // DAILY REFRESH
  if ((request.method === 'POST' || request.method === 'GET') && url.pathname === '/api/refresh')
 {
  if (!refreshAllowed(request)) {
    return json(
      { error: 'Bitte kurz warten und dann erneut aktualisieren.' },
      429
    );
  }

  const prev = await env.DB
    .prepare('SELECT * FROM daily_updates WHERE day=?')
    .bind(day)
    .first();

  const old = prev ? { articles: JSON.parse(prev.articles_json) } : null;

  const data = await buildUpdate(env, day, old);

  if (data.noNews) return json({ day, ...data });

  const now = new Date().toISOString();

  await env.DB
    .prepare(
      `INSERT INTO daily_updates(day,overview,sections_json,articles_json,updated_at)
       VALUES(?,?,?,?,?)
       ON CONFLICT(day)
       DO UPDATE SET overview=excluded.overview,
                     sections_json=excluded.sections_json,
                     articles_json=excluded.articles_json,
                     updated_at=excluded.updated_at`
    )
    .bind(day, data.overview, JSON.stringify(data.sections), JSON.stringify(data.articles), now)
    .run();

  return json({ day, ...data, updated_at: now });
 }
  // HISTORY
  if (request.method === 'GET' && url.pathname === '/api/history') {
    const rows = await env.DB
      .prepare('SELECT day,overview,sections_json,articles_json,updated_at FROM daily_updates ORDER BY day DESC LIMIT 60')
      .all();

    return json(
      rows.results.map(r => ({
        ...r,
        sections: JSON.parse(r.sections_json),
        articles: JSON.parse(r.articles_json)
      }))
    );
  }

  // TODAY
  // TODAY
if (request.method === 'GET' && url.pathname === '/api/today') {
  const r = await env.DB
    .prepare('SELECT * FROM daily_updates WHERE day=?')
    .bind(day)
    .first();

  return json(
    r
      ? {
          ...r,
          sections: JSON.parse(r.sections_json),
          articles: JSON.parse(r.articles_json)
        }
      : null
  );
}


  // WEEKLY / MONTHLY GET
  if (request.method === 'GET' && (url.pathname === '/api/weekly' || url.pathname === '/api/monthly')) {
    const type = url.pathname === '/api/weekly' ? 'weekly' : 'monthly';
    const key = periodKey(type, day);

    const r = await env.DB
      .prepare('SELECT * FROM period_updates WHERE type=? AND period_key=?')
      .bind(type, key)
      .first();

    return json(
      r
        ? {
            ...r,
            sections: JSON.parse(r.sections_json),
            days: JSON.parse(r.days_json)
          }
        : null
    );
  }

  // WEEKLY / MONTHLY REFRESH
  if (request.method === 'POST' && (url.pathname === '/api/weekly' || url.pathname === '/api/monthly')) {
    if (!refreshAllowed(request)) {
      return json(
        { error: 'Bitte kurz warten und dann erneut aktualisieren.' },
        429
      );
    }

    const type = url.pathname === '/api/weekly' ? 'weekly' : 'monthly';
    const data = await buildPeriod(env, type, day);

    if (data.noNews) return json(data);

    const now = new Date().toISOString();

    await env.DB
      .prepare(
        `INSERT INTO period_updates(type,period_key,overview,sections_json,days_json,updated_at)
         VALUES(?,?,?,?,?,?)
         ON CONFLICT(type,period_key)
         DO UPDATE SET overview=excluded.overview,
                       sections_json=excluded.sections_json,
                       days_json=excluded.days_json,
                       updated_at=excluded.updated_at`
      )
      .bind(type, data.key, data.overview, JSON.stringify(data.sections), JSON.stringify(data.days), now)
      .run();

    return json({ ...data, updated_at: now });
  }

  // TRANSLATE
  if (request.method === 'POST' && url.pathname === '/api/translate') {
    const ipKey = request.headers.get('CF-Connecting-IP') || 'global';
    const now = Date.now();
    const last = translateTimes.get(ipKey) || 0;

    if (now - last < 3000) {
      return json({ error: 'Bitte kurz warten.' }, 429);
    }

    translateTimes.set(ipKey, now);

    if (translateTimes.size > 5000) {
      for (const [k, v] of translateTimes) {
        if (now - v > 300000) translateTimes.delete(k);
      }
    }

    let body = {};
    try {
      body = await request.json();
    } catch {}

    const language = String(body.language || '');
    const type = String(body.type || 'daily');
    const key = String(body.key || day);

    if (!LANGS.has(language) || !['daily', 'weekly', 'monthly'].includes(type)) {
      return json({ error: 'Ungültige Sprache oder Ansicht.' }, 400);
    }

    return json(await translateSaved(env, type, key, language));
  }

  // DAILY REFRESH
  if (request.method === 'POST' && url.pathname === '/api/refresh') {
    if (!refreshAllowed(request)) {
      return json(
        { error: 'Bitte kurz warten und dann erneut aktualisieren.' },
        429
      );
    }

    const prev = await env.DB
      .prepare('SELECT * FROM daily_updates WHERE day=?')
      .bind(day)
      .first();

    const old = prev ? { articles: JSON.parse(prev.articles_json) } : null;

    const data = await buildUpdate(env, day, old);

    if (data.noNews) return json({ day, ...data });

    const now = new Date().toISOString();

    await env.DB
      .prepare(
        `INSERT INTO daily_updates(day,overview,sections_json,articles_json,updated_at)
         VALUES(?,?,?,?,?)
         ON CONFLICT(day)
         DO UPDATE SET overview=excluded.overview,
                       sections_json=excluded.sections_json,
                       articles_json=excluded.articles_json,
                       updated_at=excluded.updated_at`
      )
      .bind(day, data.overview, JSON.stringify(data.sections), JSON.stringify(data.articles), now)
      .run();

    return json({ day, ...data, updated_at: now });
  }

  return null;
}

// ---------- SECURITY HEADERS ----------
function secureHeaders(headers = new Headers()) {
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
  );
  return headers;
}

function withSecurity(response) {
  const headers = secureHeaders(new Headers(response.headers));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

// ---------- WORKER EXPORT ----------
export default {
  async fetch(request, env) {
    try {
      const r = await api(request, env);
      if (r) return withSecurity(r);

      return withSecurity(await env.ASSETS.fetch(request));
    } catch (e) {
      // TEMPORARY - shows us the real error so we can finally fix the actual cause.
      // Remove the "debug" field once this is solved.
      return withSecurity(
        json({ error: 'Interner Fehler. Bitte später erneut versuchen.', debug: String((e && e.stack) || e) }, 500)
      );
    }
  }
};
