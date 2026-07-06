import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import type { Flight } from '../types';
import { getAirport } from '../data/airports';
import { haversineKm } from './geo';

dayjs.extend(utc);
dayjs.extend(timezone);

export interface FlightDuration {
  minutes: number;
  /** true when derived from distance because times or timezones are missing */
  estimated: boolean;
}

/**
 * Duration of a flight. With both local times and both airport timezones
 * known, this is exact (date-line crossings included — the times are
 * compared as absolute instants). Otherwise a block-time estimate from
 * great-circle distance at ~780 km/h plus taxi allowance.
 */
export function flightDuration(f: Flight): FlightDuration | null {
  const a = getAirport(f.from);
  const b = getAirport(f.to);
  if (!a || !b) return null;

  if (f.depTime && f.arrTime && a.tz && b.tz && f.date) {
    try {
      const dep = dayjs.tz(`${f.date} ${f.depTime}`, a.tz);
      let arr = dayjs.tz(`${f.date} ${f.arrTime}`, b.tz);
      if (arr.isBefore(dep)) arr = arr.add(1, 'day'); // overnight arrival
      const minutes = arr.diff(dep, 'minute');
      // implausible results (bad input) fall through to the estimate
      if (minutes > 0 && minutes < 26 * 60) return { minutes, estimated: false };
    } catch {
      /* unknown timezone id — estimate instead */
    }
  }

  const km = haversineKm([a.lat, a.lon], [b.lat, b.lon]);
  return { minutes: Math.round((km / 780) * 60) + 25, estimated: true };
}
