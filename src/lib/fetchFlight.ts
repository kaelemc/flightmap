import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { getAirportByIcao } from '../data/airports';
import { LOGO_AIRLINES } from '../data/airline-logo-set';
import { downsamplePath } from './geo';
import type { Settings } from '../types';

dayjs.extend(utc);
dayjs.extend(timezone);

export interface LookupResult {
  airline?: string;
  from?: string;
  to?: string;
  depTime?: string;
  arrTime?: string;
  aircraft?: string;
  registration?: string;
  fr24Id?: string;
  /** recorded flown path from Flightradar24, downsampled */
  track?: Array<[number, number] | [number, number, number]>;
  /** unit of track altitudes, as delivered by the source */
  altitudeUnits?: 'ft' | 'm';
  source: 'Flightradar24' | 'adsbdb' | 'adsb.lol';
  note?: string;
}

export function normalizeFlightNo(v: string): string {
  return v.toUpperCase().replace(/\s+/g, '');
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const errMsg = (e: unknown): string =>
  e instanceof Error ? e.message : 'lookup failed.';

/**
 * Look up a flight by number, trying the user's enabled providers in
 * order of data quality: Flightradar24 → adsbdb → adsb.lol.
 * Provider failures are reported in the note of whichever fallback
 * succeeds.
 */
export async function lookupFlight(
  flightNo: string,
  date: string,
  settings: Settings
): Promise<LookupResult> {
  const fn = normalizeFlightNo(flightNo);
  if (!fn) throw new Error('Enter a flight number first.');

  const on = settings.enabledProviders;
  const chain: Array<{ name: string; run: () => Promise<LookupResult> }> = [];
  if (on.fr24 && settings.fr24Key)
    chain.push({
      name: 'Flightradar24',
      run: async () => {
        // FR24's light summary carries airline ICAO codes, not names —
        // fetch the readable name from adsbdb in parallel, not afterwards
        const airline = on.adsbdb ? lookupAdsbdb(fn).catch(() => null) : null;
        const r = await lookupFr24(fn, date, settings.fr24Key);
        if (!r.airline && airline) r.airline = (await airline)?.airline;
        return r;
      },
    });
  if (on.adsbdb) chain.push({ name: 'adsbdb', run: () => lookupAdsbdb(fn) });
  if (on.adsblol) chain.push({ name: 'adsb.lol', run: () => lookupAdsbLol(fn) });

  if (!chain.length)
    throw new Error(
      'No lookup providers available — enable one (or add its key) in Settings.'
    );

  const failures: string[] = [];
  for (const provider of chain) {
    try {
      const r = await provider.run();
      r.note = [...failures, r.note].filter(Boolean).join(' ');
      return r;
    } catch (e) {
      failures.push(`${provider.name}: ${errMsg(e)}`);
    }
  }
  throw new Error(failures.join(' '));
}

/* ---------------- Flightradar24 (official API, paid subscription) ---------------- */

interface LocalTime {
  date: string;
  time: string;
  isUtc: boolean;
}

function toLocal(iso: string, tz: string | undefined): LocalTime | null {
  if (!iso) return null;
  const d = dayjs.utc(iso);
  if (!d.isValid()) return null;
  if (tz) {
    try {
      const loc = d.tz(tz);
      return { date: loc.format('YYYY-MM-DD'), time: loc.format('HH:mm'), isUtc: false };
    } catch {
      /* unknown zone — fall through to UTC */
    }
  }
  return { date: d.format('YYYY-MM-DD'), time: d.format('HH:mm'), isUtc: true };
}

const fr24Headers = (token: string) => ({
  Authorization: `Bearer ${token}`,
  'Accept-Version': 'v1',
});

/** The recorded ADS-B track for a flight; undefined when unavailable. */
async function fetchFr24Track(
  fr24Id: string,
  token: string
): Promise<Array<[number, number] | [number, number, number]> | undefined> {
  try {
    const res = await fetch(
      `https://fr24api.flightradar24.com/api/flight-tracks?flight_id=${encodeURIComponent(fr24Id)}`,
      { headers: fr24Headers(token) }
    );
    if (!res.ok) return undefined;
    const body: unknown = await res.json().catch(() => null);
    const container = Array.isArray(body) ? body[0] : body;
    const raw = (container as { tracks?: unknown[] } | null)?.tracks;
    if (!Array.isArray(raw)) return undefined;
    const pts: Array<[number, number] | [number, number, number]> = [];
    for (const p of raw) {
      const { lat, lon, alt } = (p ?? {}) as { lat?: unknown; lon?: unknown; alt?: unknown };
      if (Number.isFinite(Number(lat)) && Number.isFinite(Number(lon))) {
        const la = +Number(lat).toFixed(3);
        const lo = +Number(lon).toFixed(3);
        const altFt = Number(alt);
        pts.push(Number.isFinite(altFt) && altFt > 0 ? [la, lo, Math.round(altFt)] : [la, lo]);
      }
    }
    return pts.length >= 2 ? downsamplePath(pts, 200) : undefined;
  } catch {
    return undefined;
  }
}

/** exported for lib/tracks.ts — fetching a real path reuses the full FR24 lookup */
export async function lookupFr24(
  fn: string,
  date: string,
  token: string
): Promise<LookupResult> {
  if (!date) throw new Error('needs a date to search.');

  // widen the UTC window by ±14 h so late-evening/early-morning local
  // departures in any timezone still fall inside the searched day
  const fromIso = dayjs.utc(date).subtract(14, 'hour').toISOString().slice(0, 19) + 'Z';
  const toIso =
    dayjs.utc(date).endOf('day').add(14, 'hour').toISOString().slice(0, 19) + 'Z';
  const url =
    'https://fr24api.flightradar24.com/api/flight-summary/light' +
    `?flights=${encodeURIComponent(fn)}` +
    `&flight_datetime_from=${encodeURIComponent(fromIso)}` +
    `&flight_datetime_to=${encodeURIComponent(toIso)}`;

  let res: Response;
  try {
    res = await fetch(url, { headers: fr24Headers(token) });
  } catch {
    throw new Error('request failed — check your internet connection.');
  }
  if (res.status === 401 || res.status === 403)
    throw new Error('rejected the API token (check it in Settings).');
  if (res.status === 402 || res.status === 429)
    throw new Error('credit or rate limit reached.');
  if (!res.ok) {
    // FR24 explains validation failures (e.g. a date outside the plan's
    // history window) in the body — surface that instead of a bare status
    const err = (await res.json().catch(() => null)) as {
      details?: string;
      message?: string;
    } | null;
    throw new Error(err?.details || err?.message || `returned HTTP ${res.status}.`);
  }

  const body = (await res.json().catch(() => null)) as { data?: unknown } | null;
  const legs = Array.isArray(body?.data)
    ? (body.data as Record<string, unknown>[])
    : [];
  if (!legs.length) throw new Error(`found no ${fn} on ${date}.`);

  const candidates = legs.map((leg) => {
    const orig = getAirportByIcao(str(leg.orig_icao));
    const destIcao = str(leg.dest_icao_actual) || str(leg.dest_icao);
    const dest = getAirportByIcao(destIcao);
    return {
      leg,
      orig,
      dest,
      destIcao,
      dep: toLocal(str(leg.datetime_takeoff), orig?.tz),
      arr: toLocal(str(leg.datetime_landed), dest?.tz),
    };
  });
  // several calendar days can fall in the widened window — prefer the leg
  // that actually departed on the requested local date
  const exact = candidates.find((c) => c.dep?.date === date);
  const pick = exact ?? candidates[0];

  const notes = ['Flightradar24 flight found — times are actual takeoff/landing'];
  notes.push(pick.dep?.isUtc || pick.arr?.isUtc ? 'in UTC (airport timezone unknown).' : 'in airport local time.');
  if (!exact) notes.push(`Nearest match departed ${pick.dep?.date ?? 'on an unknown date'} — double-check.`);

  const fr24Id = str(pick.leg.fr24_id);
  const track = fr24Id ? await fetchFr24Track(fr24Id, token) : undefined;
  notes.push(
    track
      ? 'Real flown path attached — the map will draw the actual track.'
      : 'No recorded path available; the map draws the great circle.'
  );

  return {
    from: pick.orig?.iata ?? str(pick.leg.orig_icao),
    to: pick.dest?.iata ?? pick.destIcao,
    depTime: pick.dep?.time ?? '',
    arrTime: pick.arr?.time ?? '',
    aircraft: str(pick.leg.type),
    registration: str(pick.leg.reg),
    fr24Id: fr24Id || undefined,
    track,
    altitudeUnits: track ? 'ft' : undefined,
    source: 'Flightradar24',
    note: notes.join(' '),
  };
}

/* ---------------- adsb.lol (free, no key, route only) ---------------- */

const ICAO_BY_IATA = new Map(LOGO_AIRLINES.map(([iata, icao]) => [iata, icao]));

/** callsign forms worth trying: transmitted ICAO style first (ANZ103), then as typed */
function callsignCandidates(fn: string): string[] {
  if (/^[A-Z]{3}\d/.test(fn)) return [fn];
  const m = fn.match(/^([A-Z0-9]{2})(\d.*)$/);
  const icao = m ? ICAO_BY_IATA.get(m[1]) : undefined;
  return icao ? [`${icao}${m![2]}`, fn] : [fn];
}

async function lookupAdsbLol(fn: string): Promise<LookupResult> {
  for (const cs of callsignCandidates(fn)) {
    let res: Response;
    try {
      // adsb.lol's route API redirects here, but the 302 itself lacks CORS
      // headers — browsers must hit the standing-data mirror directly
      res = await fetch(
        `https://vrs-standing-data.adsb.lol/routes/${cs.slice(0, 2)}/${encodeURIComponent(cs)}.json`
      );
    } catch {
      throw new Error('Lookup failed — check your internet connection.');
    }
    if (!res.ok || !res.headers.get('content-type')?.includes('json')) continue;
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    const codes = str(data?._airport_codes_iata);
    const parts = codes.split('-').filter((p) => /^[A-Z0-9]{3,4}$/.test(p));
    if (parts.length < 2) continue;
    return {
      from: parts[0],
      to: parts[parts.length - 1],
      source: 'adsb.lol',
      note:
        'Route found. adsb.lol has no timetable, so add the times yourself.' +
        (parts.length > 2 ? ` (multi-stop route: ${codes})` : ''),
    };
  }
  throw new Error(noRouteMessage(fn));
}

/* ---------------- adsbdb (free, no key, route only) ---------------- */

async function lookupAdsbdb(fn: string): Promise<LookupResult> {
  let res: Response;
  try {
    res = await fetch(`https://api.adsbdb.com/v0/callsign/${encodeURIComponent(fn)}`);
  } catch {
    throw new Error('Lookup failed — check your internet connection.');
  }
  if (!res.ok) throw new Error(noRouteMessage(fn));

  const data = await res.json().catch(() => null);
  const fr = (data as { response?: { flightroute?: Record<string, unknown> } } | null)
    ?.response?.flightroute;
  if (!fr || typeof fr !== 'object') throw new Error(noRouteMessage(fn));

  const airline = fr.airline as { name?: string } | undefined;
  const origin = fr.origin as { iata_code?: string } | undefined;
  const destination = fr.destination as { iata_code?: string } | undefined;
  return {
    airline: airline?.name ?? '',
    from: origin?.iata_code ?? '',
    to: destination?.iata_code ?? '',
    source: 'adsbdb',
    note: 'Route found. adsbdb has no timetable, so add the times yourself.',
  };
}

function noRouteMessage(fn: string): string {
  return `No route found for ${fn}. Try the ICAO form of the callsign (e.g. ANZ103 instead of NZ103), enter the operating carrier's flight number if this is a codeshare ticket, or fill the airports in below.`;
}
