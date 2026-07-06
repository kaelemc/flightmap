// Regenerates src/data/airport-rows.ts from the OpenFlights airport database.
// Usage: node scripts/gen-airports.cjs
const fs = require('fs');
const path = require('path');

const SOURCE =
  'https://raw.githubusercontent.com/jpatokal/openflights/master/data/airports.dat';
const OUT = path.join(__dirname, '..', 'src', 'data', 'airport-rows.ts');

function parseLine(line) {
  const fields = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '\\' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { fields.push(cur); cur = ''; }
    else cur += c;
  }
  fields.push(cur);
  return fields;
}

(async () => {
  const res = await fetch(SOURCE);
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  const text = await res.text();

  const rows = [];
  const seen = new Set();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const f = parseLine(line.trim());
    if (f.length < 13) continue;
    const [, name, city, country, iata, icaoRaw, latRaw, lonRaw, , , , tzRaw, type] = f;
    if (type !== 'airport') continue;
    if (!/^[A-Z0-9]{3}$/.test(iata)) continue;
    if (seen.has(iata)) continue;
    const lat = +(+latRaw).toFixed(4);
    const lon = +(+lonRaw).toFixed(4);
    if (!isFinite(lat) || !isFinite(lon)) continue;
    const icao = /^[A-Z0-9]{4}$/.test(icaoRaw) ? icaoRaw : '';
    const tz = tzRaw && tzRaw !== '\\N' ? tzRaw : '';
    seen.add(iata);
    rows.push([iata, icao, name, city, country, lat, lon, tz]);
  }
  rows.sort((a, b) => (a[0] < b[0] ? -1 : 1));

  const out = `// Generated from the OpenFlights airport database (https://openflights.org/data),
// licensed under the Open Database License (ODbL). Do not edit by hand;
// regenerate with scripts/gen-airports if the source data updates.
export type AirportRow = [iata: string, icao: string, name: string, city: string, country: string, lat: number, lon: number, tz: string];

export const AIRPORT_ROWS: AirportRow[] = [
${rows.map((r) => JSON.stringify(r)).join(',\n')}
];
`;
  fs.writeFileSync(OUT, out);
  console.log(`wrote ${rows.length} airports to ${OUT}`);
})();
