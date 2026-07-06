// Bundles app-style airline icons into public/airline-logos/{IATA}.png.
//
// Sources are discovered from each airline's official website:
//   1. web app manifests
//   2. apple-touch-icon links
//   3. Microsoft tile metadata
//   4. large favicons
//
// If a site does not expose a usable PNG tile, the script falls back to
// Google's favicon service using the official airline domain. Runtime remains
// fully local: the app never fetches icons from a CDN.
//
// Usage: node scripts/fetch-airline-icons.cjs [EXTRA_IATA ...]
const fs = require('fs');
const path = require('path');

const AIRLINES_URL = 'https://raw.githubusercontent.com/soaring-symbols/soaring-symbols/main/airlines.json';
const GOOGLE_FAVICON = (website) =>
  `https://www.google.com/s2/favicons?sz=256&domain_url=${encodeURIComponent(website)}`;
const APP_STORE_SEARCH = (name) => {
  const params = new URLSearchParams({
    term: name,
    country: 'us',
    media: 'software',
    entity: 'software',
    limit: '10',
  });
  return `https://itunes.apple.com/search?${params}`;
};

const root = path.join(__dirname, '..');
const logoDir = path.join(root, 'public', 'airline-logos');
const dataPath = path.join(root, 'src', 'data', 'airline-logo-set.ts');
const sourcePath = path.join(logoDir, 'sources.json');

const TIMEOUT_MS = 10000;
const CONCURRENCY = 6;
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const AIRLINE_OVERRIDES = {
  AA: {
    iata: 'AA',
    icao: 'AAL',
    name: 'American Airlines',
    website: 'https://www.aa.com',
  },
};

const ICON_SOURCE_OVERRIDES = {
  QF: {
    url: 'https://www.qantas.com/apple-touch-icon.png',
    kind: 'official-site-override',
    size: 180,
    score: 1600,
  },
  NZ: {
    url: 'https://www.airnewzealand.com/koru-icon-256.png',
    kind: 'official-site-override',
    size: 256,
    score: 1600,
  },
  ZB: {
    url: 'https://www.airalbania.com.al/favicon@2x.png',
    kind: 'official-site-override',
    size: 32,
    score: 1600,
  },
};

const BAD_ICON_URL = /(?:^|[\/_.-])(alert|warning|error|loader|loading|spinner|placeholder)(?:[\/_.-]|$)/i;
const BAD_APP_TITLE =
  /\b(cargo|entertainment|holiday|summer|pay|wallet|money|oryx\s+one|shop|shopping|tour|tourism)\b|360/i;

function parseCurrentAirlines() {
  if (!fs.existsSync(dataPath)) return new Map();

  const source = fs.readFileSync(dataPath, 'utf8');
  const rows = new Map();
  for (const match of source.matchAll(/\[\s*"([^"]+)"\s*,\s*"([^"]*)"\s*,\s*"((?:\\"|[^"])*)"\s*\]/g)) {
    const [, iata, icao, name] = match;
    rows.set(iata, { iata, icao, name: JSON.parse(`"${name}"`) });
  }
  return rows;
}

function currentCodes() {
  const fromData = [...parseCurrentAirlines().keys()];
  if (fromData.length > 0) return fromData;

  if (!fs.existsSync(logoDir)) return [];
  return fs
    .readdirSync(logoDir)
    .map((file) => file.match(/^([A-Z0-9]{2})\.(?:png|jpg|jpeg|webp|svg|ico)$/i)?.[1]?.toUpperCase())
    .filter(Boolean);
}

function normalizeUrl(value, base) {
  try {
    return new URL(value, base).toString();
  } catch {
    return '';
  }
}

function parseAttrs(tag) {
  const attrs = {};
  for (const match of tag.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+)/g)) {
    const key = match[1].toLowerCase();
    const raw = match[2];
    attrs[key] = raw.startsWith('"') || raw.startsWith("'") ? raw.slice(1, -1) : raw;
  }
  return attrs;
}

function parseSize(value) {
  if (!value || value === 'any') return 0;
  let best = 0;
  for (const match of value.matchAll(/(\d+)\s*x\s*(\d+)/gi)) {
    const size = Math.min(Number(match[1]), Number(match[2]));
    if (Number.isFinite(size)) best = Math.max(best, size);
  }
  return best;
}

function dedupeCandidates(candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = candidate.url;
    if (BAD_ICON_URL.test(key)) return false;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizedWords(value) {
  const stopWords = new Set([
    'air',
    'airline',
    'airlines',
    'airways',
    'aviation',
    'fly',
    'the',
    'and',
    'book',
    'flight',
    'flights',
  ]);

  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !stopWords.has(word));
}

function normalizedText(value) {
  return normalizedWords(value).join(' ');
}

function rootDomain(value) {
  try {
    const parts = new URL(value).hostname.replace(/^www\./, '').split('.');
    if (parts.length <= 2) return parts.join('.');
    return parts.slice(-2).join('.');
  } catch {
    return '';
  }
}

function appleArtworkPng(url) {
  return String(url || '').replace(/\/\d+x\d+bb\.[a-z]+$/i, '/512x512bb.png');
}

function appStoreScore(result, airline) {
  const words = normalizedWords(airline.name);
  const title = new Set(normalizedWords(result.trackName));
  const artist = new Set(normalizedWords(`${result.artistName || ''} ${result.sellerName || ''}`));
  const bundle = new Set(normalizedWords(result.bundleId));
  const officialHost = rootDomain(airline.website).split('.')[0];
  const sellerHost = rootDomain(result.sellerUrl || result.artistViewUrl || '');
  const badTitle =
    BAD_APP_TITLE.test(result.trackName || '') ||
    /\b(tracker|radar|status|wallpaper|guide|quiz|schedule|onesmart|topo)\b/i.test(
      result.trackName || ''
    );

  let score = 0;
  let wordMatches = 0;
  for (const word of words) {
    if (title.has(word)) {
      score += 28;
      wordMatches += 1;
    }
    if (artist.has(word)) {
      score += 42;
      wordMatches += 1;
    }
    if (bundle.has(word)) {
      score += 18;
      wordMatches += 1;
    }
  }
  if (result.primaryGenreName === 'Travel') score += 18;
  if (Array.isArray(result.genres) && result.genres.includes('Travel')) score += 12;
  if (officialHost && sellerHost.includes(officialHost)) score += 80;
  if (badTitle && score < 120) score -= 80;
  if (wordMatches === 0 && !(officialHost && sellerHost.includes(officialHost))) return 0;

  return score;
}

async function appStoreCandidate(airline) {
  try {
    const { text } = await fetchText(APP_STORE_SEARCH(airline.name), 'application/json, */*;q=0.8');
    const payload = JSON.parse(text);
    if (!Array.isArray(payload.results)) return null;

    let best = null;
    for (const result of payload.results) {
      if (!result.artworkUrl512) continue;
      if (BAD_APP_TITLE.test(result.trackName || '')) continue;
      const score = appStoreScore(result, airline);
      if (!best || score > best.score) best = { result, score };
    }

    if (!best || best.score < 70) return null;
    return {
      url: appleArtworkPng(best.result.artworkUrl512),
      kind: 'apple-app-store',
      size: 512,
      score: 830 + best.score,
      appName: best.result.trackName,
      appSeller: best.result.sellerName || best.result.artistName,
    };
  } catch {
    return null;
  }
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      redirect: 'follow',
      ...options,
      signal: controller.signal,
      headers: {
        'user-agent': USER_AGENT,
        ...options.headers,
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url, accept) {
  const res = await fetchWithTimeout(url, {
    headers: { accept },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { text: await res.text(), url: res.url };
}

async function manifestCandidates(manifestUrl, kind) {
  try {
    const { text, url } = await fetchText(
      manifestUrl,
      'application/manifest+json, application/json, text/plain, */*;q=0.8'
    );
    const manifest = JSON.parse(text);
    if (!Array.isArray(manifest.icons)) return [];

    return manifest.icons
      .map((icon) => {
        const src = typeof icon.src === 'string' ? normalizeUrl(icon.src, url) : '';
        if (!src) return null;
        const size = parseSize(icon.sizes);
        const purpose = String(icon.purpose || '').toLowerCase();
        const type = String(icon.type || '').toLowerCase();
        const score =
          900 +
          size +
          (purpose.includes('maskable') ? 25 : 0) -
          (purpose.includes('monochrome') ? 300 : 0) +
          (type.includes('png') ? 50 : 0);
        return { url: src, kind, size, score };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function discoverCandidates(website) {
  const candidates = [];
  let pageUrl = website;
  let html = '';

  try {
    const page = await fetchText(website, 'text/html,application/xhtml+xml,*/*;q=0.8');
    pageUrl = page.url;
    html = page.text;
  } catch {
    html = '';
  }

  const manifestUrls = new Set();
  if (html) {
    for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
      const attrs = parseAttrs(tag);
      const rels = String(attrs.rel || '')
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean);
      const href = attrs.href ? normalizeUrl(attrs.href, pageUrl) : '';
      if (!href) continue;

      const size = parseSize(attrs.sizes);
      if (rels.includes('manifest')) {
        manifestUrls.add(href);
      } else if (rels.includes('apple-touch-icon') || rels.includes('apple-touch-icon-precomposed')) {
        candidates.push({
          url: href,
          kind: rels.includes('apple-touch-icon-precomposed')
            ? 'apple-touch-icon-precomposed'
            : 'apple-touch-icon',
          size,
          score: 850 + size,
        });
      } else if (rels.includes('icon') || rels.includes('shortcut')) {
        candidates.push({
          url: href,
          kind: 'favicon-link',
          size,
          score: 500 + size,
        });
      }
    }

    for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
      const attrs = parseAttrs(tag);
      const name = String(attrs.name || attrs.property || '').toLowerCase();
      const content = attrs.content ? normalizeUrl(attrs.content, pageUrl) : '';
      if (content && name === 'msapplication-tileimage') {
        candidates.push({
          url: content,
          kind: 'msapplication-tileimage',
          size: 144,
          score: 760,
        });
      }
    }
  }

  const siteBase = new URL(pageUrl || website);
  for (const manifestPath of ['/site.webmanifest', '/manifest.json', '/manifest.webmanifest']) {
    manifestUrls.add(new URL(manifestPath, siteBase.origin).toString());
  }

  for (const manifestUrl of manifestUrls) {
    candidates.push(...(await manifestCandidates(manifestUrl, 'web-manifest')));
  }

  for (const file of [
    '/apple-touch-icon.png',
    '/apple-touch-icon-precomposed.png',
    '/favicon-196x196.png',
    '/favicon-192x192.png',
    '/favicon.png',
    '/favicon.ico',
  ]) {
    candidates.push({
      url: new URL(file, siteBase.origin).toString(),
      kind: `well-known${file}`,
      size: parseSize(file),
      score: file.includes('apple-touch') ? 650 : 350,
    });
  }

  return dedupeCandidates(candidates).sort((a, b) => b.score - a.score);
}

function isPng(buf, contentType) {
  return (
    contentType.includes('image/png') ||
    (buf.length > 8 &&
      buf[0] === 0x89 &&
      buf[1] === 0x50 &&
      buf[2] === 0x4e &&
      buf[3] === 0x47 &&
      buf[4] === 0x0d &&
      buf[5] === 0x0a &&
      buf[6] === 0x1a &&
      buf[7] === 0x0a)
  );
}

async function fetchPng(candidate) {
  const res = await fetchWithTimeout(candidate.url, {
    headers: {
      accept: 'image/png,image/*;q=0.8,*/*;q=0.5',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const contentType = String(res.headers.get('content-type') || '').toLowerCase();
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 200) throw new Error('image too small');
  if (!isPng(buf, contentType)) throw new Error(`not PNG (${contentType || 'unknown type'})`);

  return { buf, finalUrl: res.url, contentType };
}

async function bundleIcon(airline) {
  const candidates = await discoverCandidates(airline.website);
  if (ICON_SOURCE_OVERRIDES[airline.iata]) candidates.push(ICON_SOURCE_OVERRIDES[airline.iata]);
  const appCandidate = await appStoreCandidate(airline);
  if (appCandidate) candidates.push(appCandidate);
  candidates.sort((a, b) => b.score - a.score);

  for (const candidate of candidates) {
    try {
      const { buf, finalUrl, contentType } = await fetchPng(candidate);
      const filePath = path.join(logoDir, `${airline.iata}.png`);
      fs.writeFileSync(filePath, buf);
      return {
        ...airline,
        path: `/airline-logos/${airline.iata}.png`,
        source: finalUrl,
        sourceKind: candidate.kind,
        sourceName: candidate.appName,
        sourceSeller: candidate.appSeller,
        contentType,
        bytes: buf.length,
      };
    } catch {
      // Try the next candidate.
    }
  }

  const fallbackUrl = GOOGLE_FAVICON(airline.website);
  try {
    const { buf, finalUrl, contentType } = await fetchPng({
      url: fallbackUrl,
      kind: 'google-favicon',
    });
    fs.writeFileSync(path.join(logoDir, `${airline.iata}.png`), buf);
    return {
      ...airline,
      path: `/airline-logos/${airline.iata}.png`,
      source: finalUrl,
      sourceKind: 'google-favicon',
      contentType,
      bytes: buf.length,
    };
  } catch (error) {
    return {
      ...airline,
      path: fs.existsSync(path.join(logoDir, `${airline.iata}.png`))
        ? `/airline-logos/${airline.iata}.png`
        : '',
      source: '',
      sourceKind: 'retained-existing',
      error: error.message,
      bytes: 0,
    };
  }
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}

function buildWantedAirlines(rawAirlines) {
  const current = parseCurrentAirlines();
  const rawByIata = new Map(
    rawAirlines
      .filter((airline) => /^[A-Z0-9]{2}$/.test(String(airline.iata || '').toUpperCase()))
      .map((airline) => [airline.iata.toUpperCase(), airline])
  );
  const wantedCodes = new Set([...currentCodes(), ...process.argv.slice(2).map((code) => code.toUpperCase())]);

  return [...wantedCodes]
    .sort()
    .map((iata) => {
      const override = AIRLINE_OVERRIDES[iata];
      const raw = rawByIata.get(iata);
      const previous = current.get(iata);
      const airline = override || raw || previous;
      if (!airline) return null;

      const website = override?.website || raw?.website || airline.website || '';
      if (!website) return null;

      return {
        iata,
        icao: (override?.icao || raw?.icao || previous?.icao || '').toUpperCase(),
        name: override?.name || raw?.name || previous?.name || iata,
        website,
      };
    })
    .filter(Boolean);
}

(async () => {
  fs.mkdirSync(logoDir, { recursive: true });

  const rawAirlines = await (await fetch(AIRLINES_URL)).json();
  const airlines = buildWantedAirlines(rawAirlines);
  const results = await mapLimit(airlines, CONCURRENCY, async (airline, index) => {
    const result = await bundleIcon(airline);
    const status = result.sourceKind === 'retained-existing' ? 'kept existing' : result.sourceKind;
    console.log(`${String(index + 1).padStart(2, ' ')}/${airlines.length} ${airline.iata} ${status}`);
    return result;
  });

  const mapped = results.filter((airline) => airline.path);
  mapped.sort((a, b) => a.name.localeCompare(b.name));

  const body = mapped
    .map((airline) => JSON.stringify([airline.iata, airline.icao, airline.name]))
    .join(',\n');

  fs.writeFileSync(
    dataPath,
    `// Generated by scripts/fetch-airline-icons.cjs: airline names/codes from\n` +
      `// soaring-symbols' airlines.json plus local overrides; icon PNGs are\n` +
      `// bundled from official website manifests, apple-touch icons, tile images,\n` +
      `// or domain favicons into public/airline-logos.\n` +
      `export const LOGO_AIRLINES: [iata: string, icao: string, name: string][] = [\n${body}\n];\n`
  );

  fs.writeFileSync(
    sourcePath,
    JSON.stringify(
      mapped.map((airline) => ({
        iata: airline.iata,
        icao: airline.icao,
        name: airline.name,
        website: airline.website,
        path: airline.path,
        source: airline.source,
        sourceKind: airline.sourceKind,
        sourceName: airline.sourceName,
        sourceSeller: airline.sourceSeller,
        contentType: airline.contentType,
        bytes: airline.bytes,
        error: airline.error,
      })),
      null,
      2
    ) + '\n'
  );

  const website = mapped.filter(
    (airline) =>
      airline.sourceKind !== 'google-favicon' &&
      airline.sourceKind !== 'retained-existing' &&
      airline.sourceKind !== 'apple-app-store'
  ).length;
  const appStore = mapped.filter((airline) => airline.sourceKind === 'apple-app-store').length;
  const fallback = mapped.filter((airline) => airline.sourceKind === 'google-favicon').length;
  const retained = mapped.filter((airline) => airline.sourceKind === 'retained-existing').length;
  console.log(
    `${mapped.length} airline icons mapped (${website} website PNGs, ${appStore} App Store PNGs, ${fallback} favicon fallbacks, ${retained} retained)`
  );
})();
