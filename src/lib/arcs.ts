import type { Flight } from '../types';
import { getAirport } from '../data/airports';
import { greatCircleArc, unwrapLons, type LatLon } from './geo';

export interface RouteArc {
  flight: Flight;
  points: LatLon[];
  /** true when points are the recorded flown track, not a great circle */
  real: boolean;
}

function sanitizeTrack(track: Flight['track']): LatLon[] | null {
  if (!Array.isArray(track)) return null;
  const pts: LatLon[] = [];
  for (const p of track) {
    if (Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) {
      pts.push([p[0], p[1]]);
    }
  }
  return pts.length >= 2 ? pts : null;
}

export function buildArcs(flights: Flight[], useTracks = true): RouteArc[] {
  const out: RouteArc[] = [];
  for (const f of flights) {
    const track = useTracks ? sanitizeTrack(f.track) : null;
    if (track) {
      out.push({ flight: f, points: unwrapLons(track), real: true });
      continue;
    }
    const from = getAirport(f.from);
    const to = getAirport(f.to);
    if (!from || !to) continue;
    out.push({
      flight: f,
      points: greatCircleArc([from.lat, from.lon], [to.lat, to.lon]),
      real: false,
    });
  }
  return out;
}
