import type { Flight } from '../types';

/*
 * Share links encode ONLY route data — flight number, date/time, airline,
 * aircraft, registration, the airports and the real flown path. No photos,
 * seats, fares, class, notes or custom fields ever leave the browser. The
 * viewer (`#/share/v1/<data>`) reads this and never touches localStorage, so a
 * shared link can't affect the owner's saved log.
 *
 * Format v1 is built for short URLs (chat apps like Discord). The token rides
 * in the URL *hash*, never sent to the server, so a big log can't 431. Inside,
 * a COLUMNAR layout keeps it tiny: repeated strings (airlines, aircraft, regs,
 * airports) are dictionary-encoded to indices; dates become day-offsets and
 * times become minutes; real paths are downsampled, rounded, then delta +
 * zigzag encoded so consecutive points become small repetitive integers that
 * gzip flattens. Net: a log that was ~33 KB as naive JSON is ~1.6 KB here.
 *
 * The version lives in the URL path segment (`/v1/`) so a future `/v2/` can use
 * a different decoder without breaking old links.
 */

export const SHARE_VERSION = 'v1';

const PRECISION = 4; // coordinate decimals kept in a share (~11 m)
const MAX_TRACK_PTS = 48; // downsample real paths for sharing (owner keeps full res)
const ALT_STEP = 10; // altitude quantum in metres — track altitude is stored in metres/ALT_STEP
const FT_TO_M = 0.3048;
const DAY_MS = 86_400_000;

// ---- integer helpers ----
const zigzag = (n: number) => (n << 1) ^ (n >> 31);
const unzigzag = (z: number) => (z >>> 1) ^ -(z & 1);
const dayNumber = (d: string) => Math.round(Date.parse(`${d}T00:00:00Z`) / DAY_MS);
const toMinutes = (t: string) => (/^\d\d:\d\d$/.test(t) ? +t.slice(0, 2) * 60 + +t.slice(3) : -1);
const fromMinutes = (m: number) =>
  m < 0 ? '' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** map a column of strings to a dedup table + per-row indices */
function dictionary(values: string[]) {
  const table: string[] = [];
  const seen = new Map<string, number>();
  const ids = values.map((v) => {
    const key = v || '';
    let id = seen.get(key);
    if (id === undefined) {
      id = table.length;
      table.push(key);
      seen.set(key, id);
    }
    return id;
  });
  return { table, ids };
}

/** uniformly thin an array down to at most `max` items, keeping the endpoints */
function downsample<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr;
  const out: T[] = [];
  const step = (arr.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(arr[Math.round(i * step)]);
  return out;
}

/** the v1 columnar payload — every array is parallel to the flight list */
interface Columns {
  /** base date for the day-offset column */
  b: string;
  /** coordinate precision (decimals) */
  p: number;
  /** dictionaries */
  al: string[];
  ac: string[];
  rg: string[];
  ap: string[];
  /** columns */
  D: number[]; // date, as offset in days from b
  N: string[]; // flight number
  A: number[]; // airline index
  C: number[]; // aircraft index
  F: number[]; // from-airport index
  T: number[]; // to-airport index
  P: number[]; // departure time in minutes, or -1
  Q: number[]; // arrival time in minutes, or -1
  R: number[]; // registration index
  /** track per flight: [len, zig(ΔlatN), zig(ΔlonN), zig(ΔaltU), …] or 0 for none
   *  (lat/lon are integers at PRECISION dp; alt is metres/ALT_STEP) */
  K: Array<number[] | 0>;
}

function toColumns(flights: Flight[]): Columns {
  const base =
    flights.reduce((m, f) => (f.date && (!m || f.date < m) ? f.date : m), '') || '1970-01-01';
  const baseDay = dayNumber(base);
  const airline = dictionary(flights.map((f) => f.airline));
  const aircraft = dictionary(flights.map((f) => f.aircraft));
  const reg = dictionary(flights.map((f) => f.registration));
  // from + to share one table — airports repeat heavily across both roles
  const airports = dictionary(flights.flatMap((f) => [f.from, f.to]));

  const scale = 10 ** PRECISION;
  const F: number[] = [];
  const T: number[] = [];
  const K: Array<number[] | 0> = [];
  for (let i = 0; i < flights.length; i++) {
    F.push(airports.ids[i * 2]);
    T.push(airports.ids[i * 2 + 1]);
    const track = flights[i].track;
    if (!track || track.length < 2) {
      K.push(0);
      continue;
    }
    const pts = downsample(track, MAX_TRACK_PTS);
    const toMetres = flights[i].altitudeUnits === 'm' ? 1 : FT_TO_M;
    const enc: number[] = [pts.length];
    let plat = 0;
    let plon = 0;
    let palt = 0;
    for (const q of pts) {
      const lat = Math.round(q[0] * scale);
      const lon = Math.round(q[1] * scale);
      // altitude → metres → quantised; missing/on-ground samples store 0
      const alt =
        q.length > 2 && Number.isFinite(q[2])
          ? Math.round(((q[2] as number) * toMetres) / ALT_STEP)
          : 0;
      enc.push(zigzag(lat - plat), zigzag(lon - plon), zigzag(alt - palt));
      plat = lat;
      plon = lon;
      palt = alt;
    }
    K.push(enc);
  }

  return {
    b: base,
    p: PRECISION,
    al: airline.table,
    ac: aircraft.table,
    rg: reg.table,
    ap: airports.table,
    D: flights.map((f) => (f.date ? dayNumber(f.date) - baseDay : 0)),
    N: flights.map((f) => f.flightNo || ''),
    A: airline.ids,
    C: aircraft.ids,
    F,
    T,
    P: flights.map((f) => toMinutes(f.depTime || '')),
    Q: flights.map((f) => toMinutes(f.arrTime || '')),
    R: reg.ids,
    K,
  };
}

function fromColumns(c: Columns): Flight[] {
  const baseDay = dayNumber(c.b);
  const scale = 10 ** (c.p || PRECISION);
  const dateOf = (off: number) =>
    new Date((baseDay + off) * DAY_MS).toISOString().slice(0, 10);

  const out: Flight[] = [];
  for (let i = 0; i < c.N.length; i++) {
    const kc = c.K[i];
    let track: Flight['track'];
    if (Array.isArray(kc)) {
      const len = kc[0];
      const pts: Array<[number, number, number]> = [];
      let lat = 0;
      let lon = 0;
      let alt = 0;
      let j = 1;
      for (let p = 0; p < len; p++) {
        lat += unzigzag(kc[j++]);
        lon += unzigzag(kc[j++]);
        alt += unzigzag(kc[j++]);
        pts.push([lat / scale, lon / scale, alt * ALT_STEP]);
      }
      track = pts;
    }
    // ids are index-based — the originals aren't shared and aren't needed
    out.push({
      id: `s${i}`,
      flightNo: c.N[i] || '',
      airline: c.al[c.A[i]] || '',
      from: c.ap[c.F[i]] || '',
      to: c.ap[c.T[i]] || '',
      date: dateOf(c.D[i] || 0),
      depTime: fromMinutes(c.P[i]),
      arrTime: fromMinutes(c.Q[i]),
      aircraft: c.ac[c.C[i]] || '',
      registration: c.rg[c.R[i]] || '',
      seat: '',
      flightClass: '',
      fareClass: '',
      notes: '',
      track,
      // decoded track altitudes are always in metres (normalised at encode)
      altitudeUnits: track ? 'm' : undefined,
    });
  }
  return out;
}

// ---- gzip + base64url (native, zero-dep) ----
function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

/** encode a flight log into the opaque token that goes after `#/share/v1/` */
export async function encodeShare(flights: Flight[]): Promise<string> {
  return bytesToBase64Url(await gzip(JSON.stringify(toColumns(flights))));
}

/** decode a share token back into viewer flights; throws on bad input */
export async function decodeShare(version: string, token: string): Promise<Flight[]> {
  if (version !== SHARE_VERSION) throw new Error(`Unsupported share format: ${version}`);
  const c = JSON.parse(await gunzip(base64UrlToBytes(token))) as Columns;
  if (!c || !Array.isArray(c.N)) throw new Error('Not a valid share link.');
  return fromColumns(c);
}

/** absolute share URL — version in the path, token in the hash (never sent to the server) */
export function shareUrl(token: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${window.location.origin}${base}/#/share/${SHARE_VERSION}/${token}`;
}

/** the { version, token } in the current URL hash, or null when this isn't a share URL */
export function parseShareLocation(): { version: string; token: string } | null {
  const m = window.location.hash.match(/^#\/share\/([^/]+)\/(.+)$/);
  return m ? { version: m[1], token: m[2] } : null;
}
