import { AIRPORT_ROWS } from './airport-rows';

export interface Airport {
  iata: string;
  icao: string;
  name: string;
  city: string;
  country: string;
  lat: number;
  lon: number;
  /** IANA timezone, e.g. "Pacific/Auckland"; '' when unknown */
  tz: string;
}

export const AIRPORTS: Airport[] = AIRPORT_ROWS.map(
  ([iata, icao, name, city, country, lat, lon, tz]) => ({
    iata,
    icao,
    name,
    city,
    country,
    lat,
    lon,
    tz,
  })
);

const byIata = new Map(AIRPORTS.map((a) => [a.iata, a]));
const byIcao = new Map(AIRPORTS.filter((a) => a.icao).map((a) => [a.icao, a]));

export function getAirport(iata: string | null | undefined): Airport | undefined {
  return iata ? byIata.get(iata.trim().toUpperCase()) : undefined;
}

export function getAirportByIcao(icao: string | null | undefined): Airport | undefined {
  return icao ? byIcao.get(icao.trim().toUpperCase()) : undefined;
}

/** Ranked matches: exact IATA/ICAO, IATA/ICAO prefix, city prefix, name prefix, substring. */
export function searchAirports(query: string, limit = 40): Airport[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const qUpper = q.toUpperCase();

  const scored: Array<[number, Airport]> = [];
  for (const a of AIRPORTS) {
    let score = -1;
    if (a.iata === qUpper) score = 0;
    else if (a.icao && a.icao === qUpper) score = 0.5;
    else if (a.iata.startsWith(qUpper)) score = 1;
    else if (qUpper.length >= 3 && a.icao && a.icao.startsWith(qUpper)) score = 1.5;
    else {
      const city = a.city.toLowerCase();
      const name = a.name.toLowerCase();
      if (city.startsWith(q)) score = 2;
      else if (name.startsWith(q)) score = 3;
      else if (
        q.length >= 3 &&
        (city.includes(q) || name.includes(q) || a.country.toLowerCase().startsWith(q))
      )
        score = 4;
    }
    if (score >= 0) scored.push([score, a]);
  }

  scored.sort((x, y) => x[0] - y[0] || x[1].city.localeCompare(y[1].city));
  return scored.slice(0, limit).map(([, a]) => a);
}
