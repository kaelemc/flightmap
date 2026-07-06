// Generates airline-name and aircraft-type suggestion lists from OpenFlights.
// Usage: node scripts/gen-airlines-aircraft.cjs
const fs = require('fs');
const path = require('path');

const AIRLINES_URL =
  'https://raw.githubusercontent.com/jpatokal/openflights/master/data/airlines.dat';
const PLANES_URL =
  'https://raw.githubusercontent.com/jpatokal/openflights/master/data/planes.dat';

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

const write = (file, name, values, source) => {
  const body = values.map((v) => JSON.stringify(v)).join(',\n');
  fs.writeFileSync(
    path.join(__dirname, '..', 'src', 'data', file),
    `// Generated from the OpenFlights ${source} (ODbL). Do not edit by hand;\n// regenerate with scripts/gen-airlines-aircraft.cjs.\nexport const ${name}: string[] = [\n${body}\n];\n`
  );
};

(async () => {
  // airline icons + the airline mapping (airline-logo-set.ts) come from
  // scripts/fetch-soaring-symbols.cjs — this script only owns aircraft types

  const planesRaw = await (await fetch(PLANES_URL)).text();
  const planes = new Set();
  for (const line of planesRaw.split('\n')) {
    if (!line.trim()) continue;
    const f = parseLine(line.trim());
    const name = f[0]?.trim();
    if (name) planes.add(name);
  }
  const planeList = [...planes].sort((a, b) => a.localeCompare(b));
  write('aircraft-types.ts', 'AIRCRAFT_TYPES', planeList, 'aircraft type list');

  console.log(`${planeList.length} aircraft types`);
})();
