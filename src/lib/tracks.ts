import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import type { Flight, Settings } from '../types';
import { getAirport } from '../data/airports';
import { downsamplePath } from './geo';
import { lookupFr24 } from './fetchFlight';

dayjs.extend(utc);
dayjs.extend(timezone);

/*
 * Historical ("old") flight paths for logged flights.
 *  - Flightradar24: any age within your API plan's history window.
 *  - OpenSky Network: free, no key, roughly the last 30 days. Its API
 *    only allows CORS from its own site, so requests go through the
 *    vite dev/preview proxy at /opensky (see vite.config.ts).
 */

export interface RealPath {
  track: NonNullable<Flight['track']>;
  /** unit of track altitudes, as delivered by the source (FR24 feet, OpenSky metres) */
  altitudeUnits: 'ft' | 'm';
  source: 'Flightradar24' | 'OpenSky';
  fr24Id?: string;
}

const OPENSKY_MAX_AGE_DAYS = 30;

/**
 * Callsign candidates for a flight number: aircraft usually transmit the
 * ICAO form (ANZ103, not NZ103), which adsbdb can resolve for free.
 */
async function resolveCallsigns(flightNo: string): Promise<string[]> {
  const fn = flightNo.toUpperCase().replace(/\s+/g, '');
  const out = [fn];
  try {
    const res = await fetch(`https://api.adsbdb.com/v0/callsign/${encodeURIComponent(fn)}`);
    if (res.ok) {
      const data: unknown = await res.json();
      const icao = (
        data as { response?: { flightroute?: { callsign_icao?: unknown } } }
      )?.response?.flightroute?.callsign_icao;
      if (typeof icao === 'string' && icao && !out.includes(icao)) out.unshift(icao);
    }
  } catch {
    /* offline or unknown — try the raw flight number */
  }
  return out;
}

/* OAuth token for an (optional) free OpenSky account API client. */
let openskyToken: { value: string; expires: number } | null = null;

async function openskyHeaders(settings: Settings): Promise<Record<string, string>> {
  const { openskyClientId: id, openskyClientSecret: secret } = settings;
  if (!id || !secret) return {};
  if (openskyToken && openskyToken.expires > Date.now() + 30_000) {
    return { Authorization: `Bearer ${openskyToken.value}` };
  }
  const res = await fetch(
    '/opensky-auth/auth/realms/opensky-network/protocol/openid-connect/token',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: id,
        client_secret: secret,
      }),
    }
  );
  if (!res.ok) throw new Error('OpenSky rejected the API client credentials.');
  const body = (await res.json().catch(() => null)) as {
    access_token?: string;
    expires_in?: number;
  } | null;
  if (!body?.access_token) throw new Error('OpenSky token response was malformed.');
  openskyToken = {
    value: body.access_token,
    expires: Date.now() + (body.expires_in ?? 1800) * 1000,
  };
  return { Authorization: `Bearer ${openskyToken.value}` };
}

export async function fetchRealPath(flight: Flight, settings: Settings): Promise<RealPath> {
  const failures: string[] = [];
  // codeshares fly under the operating carrier's number — that's what FR24
  // and ADS-B receivers index, so it wins over the ticketed flightNo
  const fn = flight.operatedAs || flight.flightNo;

  if (settings.trackSources.fr24 && settings.fr24Key) {
    if (!fn) {
      failures.push('Flightradar24: needs a flight number.');
    } else {
      try {
        const r = await lookupFr24(fn, flight.date, settings.fr24Key);
        if (r.track)
          return { track: r.track, altitudeUnits: 'ft', source: 'Flightradar24', fr24Id: r.fr24Id };
        failures.push('Flightradar24: no recorded path for this flight.');
      } catch (e) {
        failures.push(`Flightradar24: ${e instanceof Error ? e.message : 'lookup failed.'}`);
      }
    }
  }

  if (settings.trackSources.opensky) {
    if (dayjs().diff(dayjs(flight.date), 'day') > OPENSKY_MAX_AGE_DAYS) {
      failures.push(`OpenSky: only keeps about ${OPENSKY_MAX_AGE_DAYS} days of tracks.`);
    } else if (!fn) {
      failures.push('OpenSky: needs a flight number.');
    } else {
      try {
        return {
          track: await openskyTrack(flight, settings),
          altitudeUnits: 'm',
          source: 'OpenSky',
        };
      } catch (e) {
        failures.push(`OpenSky: ${e instanceof Error ? e.message : 'lookup failed.'}`);
      }
    }
  }

  throw new Error(
    failures.length
      ? failures.join(' ')
      : 'No real-path sources are enabled — turn one on in Settings.'
  );
}

async function openskyTrack(
  flight: Flight,
  settings: Settings
): Promise<NonNullable<Flight['track']>> {
  const origin = getAirport(flight.from);
  if (!origin?.icao) throw new Error('departure airport has no known ICAO code.');

  const base = origin.tz ? dayjs.tz(flight.date, origin.tz) : dayjs.utc(flight.date);
  const begin = base.subtract(3, 'hour').unix();
  const end = Math.min(base.add(30, 'hour').unix(), dayjs().unix());

  let [headers, candidates] = await Promise.all([
    openskyHeaders(settings),
    resolveCallsigns(flight.operatedAs || flight.flightNo),
  ]);

  const depUrl = `/opensky/flights/departure?airport=${origin.icao}&begin=${begin}&end=${end}`;
  let depRes = await fetch(depUrl, { headers });
  // per OpenSky docs a 401 means the token expired — mint a new one and retry once
  if (depRes.status === 401 && headers.Authorization) {
    openskyToken = null;
    headers = await openskyHeaders(settings);
    depRes = await fetch(depUrl, { headers });
  }
  if (depRes.status === 429) throw new Error('daily request limit reached — try again later.');
  if (depRes.status === 403 && !headers.Authorization)
    throw new Error(
      'refused anonymous access (HTTP 403) — add free OpenSky API credentials in Settings, or try again later.'
    );
  if (depRes.status === 404)
    throw new Error(`no recorded departures from ${origin.icao} that day.`);
  if (!depRes.ok) throw new Error(`departures query failed (HTTP ${depRes.status}).`);

  const departures: unknown = await depRes.json().catch(() => null);
  const list = Array.isArray(departures) ? (departures as Record<string, unknown>[]) : [];
  const matches = list.filter((f) =>
    candidates.includes(String(f.callsign ?? '').trim().toUpperCase())
  );
  if (!matches.length)
    throw new Error(`couldn't find ${candidates[0]} departing ${origin.icao} that day.`);

  // prefer the departure closest to the logged departure time
  let pick = matches[0];
  if (flight.depTime && origin.tz && matches.length > 1) {
    try {
      const sched = dayjs.tz(`${flight.date} ${flight.depTime}`, origin.tz).unix();
      pick = [...matches].sort(
        (a, b) => Math.abs(Number(a.firstSeen) - sched) - Math.abs(Number(b.firstSeen) - sched)
      )[0];
    } catch {
      /* keep first match */
    }
  }

  const trackRes = await fetch(
    `/opensky/tracks/all?icao24=${String(pick.icao24)}&time=${Number(pick.firstSeen)}`,
    { headers }
  );
  if (trackRes.status === 429)
    throw new Error('daily request limit reached — try again later.');
  if (!trackRes.ok) throw new Error(`track query failed (HTTP ${trackRes.status}).`);

  const data = (await trackRes.json().catch(() => null)) as { path?: unknown[] } | null;
  const raw = Array.isArray(data?.path) ? data.path : [];
  const pts: NonNullable<Flight['track']> = [];
  for (const p of raw) {
    if (!Array.isArray(p)) continue;
    const lat = Number(p[1]);
    const lon = Number(p[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const la = +lat.toFixed(3);
    const lo = +lon.toFixed(3);
    // barometric altitude, kept in OpenSky's native metres (see altitudeUnits)
    const altM = Number(p[3]);
    pts.push(Number.isFinite(altM) && altM > 0 ? [la, lo, Math.round(altM)] : [la, lo]);
  }
  if (pts.length < 2) throw new Error('the recorded track is empty.');
  return downsamplePath(pts, 200);
}
