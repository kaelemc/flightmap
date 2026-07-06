// Converts a myFlightradar24 / flightdiary.net CSV export into Flightmap's
// JSON import format. Usage: node scripts/flightdiary-to-json.cjs <export.csv> [out.json]
const fs = require('fs');

const src = process.argv[2];
const out = process.argv[3] || 'flightmap-import.json';
if (!src) {
  console.error('usage: node scripts/flightdiary-to-json.cjs <flightdiary-export.csv> [out.json]');
  process.exit(1);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else cur += c;
  }
  row.push(cur);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

const iataOf = (s) => (s.match(/\(([A-Z0-9]{3})\//) || [])[1] || '';
const stripParens = (s) => s.replace(/\s*\([^)]*\)\s*$/, '').trim();
const hhmm = (s) => (/^\d{2}:\d{2}/.test(s) ? s.slice(0, 5) : '');
const CLASS = { 1: 'Economy', 2: 'Business', 3: 'First', 4: 'Premium Economy' };

const rows = parseCsv(fs.readFileSync(src, 'utf8'));
const header = rows[0].map((h) => h.trim().toLowerCase());
const col = (name) => header.indexOf(name);
const iDate = col('date'), iNo = col('flight number'), iFrom = col('from'), iTo = col('to');
const iDep = col('dep time'), iArr = col('arr time'), iAirline = col('airline');
const iAc = col('aircraft'), iReg = col('registration'), iSeat = col('seat number');
const iClass = col('flight class'), iNote = col('note');

const flights = [];
for (let i = 1; i < rows.length; i++) {
  const r = rows[i];
  const from = iataOf(r[iFrom] ?? '');
  const to = iataOf(r[iTo] ?? '');
  const date = (r[iDate] ?? '').trim();
  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.warn(`skipping row ${i + 1}: missing route or date`);
    continue;
  }
  const flightNo = (r[iNo] ?? '').trim().toUpperCase();
  flights.push({
    id: `fd-${date}-${flightNo || 'x'}-${i}`,
    flightNo,
    airline: stripParens(r[iAirline] ?? ''),
    from,
    to,
    date,
    depTime: hhmm(r[iDep] ?? ''),
    arrTime: hhmm(r[iArr] ?? ''),
    aircraft: stripParens(r[iAc] ?? ''),
    registration: (r[iReg] ?? '').trim().toUpperCase(),
    seat: (r[iSeat] ?? '').trim().toUpperCase(),
    flightClass: CLASS[(r[iClass] ?? '').trim()] || '',
    fareClass: '',
    notes: (r[iNote] ?? '').trim(),
  });
}

fs.writeFileSync(out, JSON.stringify(flights, null, 2));
console.log(`wrote ${flights.length} flights to ${out}`);
