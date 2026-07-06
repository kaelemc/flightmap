import dayjs from 'dayjs';
import type { FlightClass } from '../types';

/*
 * IATA Bar Coded Boarding Pass (BCBP, Resolution 792). Every airline
 * boarding pass barcode — printed PDF417 or mobile Aztec/QR — starts with
 * the same fixed-width mandatory block:
 *
 *   pos len  field
 *   0   1    format code 'M'
 *   1   1    number of legs
 *   2   20   passenger name
 *   22  1    electronic ticket indicator
 *   23  7    booking reference (PNR)
 *   30  3    origin IATA
 *   33  3    destination IATA
 *   36  3    carrier designator
 *   39  5    flight number
 *   44  3    date of flight (day of year — no year!)
 *   47  1    compartment code
 *   48  4    seat
 */

export interface BoardingPass {
  from: string;
  to: string;
  flightNo: string;
  /** best-guess ISO date (the barcode stores only day-of-year) */
  date: string | null;
  seat: string;
  /** raw BCBP compartment/fare letter, e.g. J */
  fareLetter: string;
  /** BCBP compartment letter mapped to a cabin class */
  cabin: FlightClass;
  pnr: string;
  legs: number;
}

/** IATA compartment code → cabin class (airline RBDs vary, but these hold broadly) */
function cabinClass(letter: string): FlightClass {
  if (/^[FA]$/.test(letter)) return 'First';
  if (/^[JCDIZ]$/.test(letter)) return 'Business';
  if (/^[WP]$/.test(letter)) return 'Premium Economy';
  return letter ? 'Economy' : '';
}

export function parseBcbp(raw: string): BoardingPass | null {
  if (!/^M[1-4]/.test(raw) || raw.length < 52) return null;
  const at = (a: number, b: number) => raw.slice(a, b).trim();

  const from = at(30, 33);
  const to = at(33, 36);
  const carrier = at(36, 39);
  const numMatch = at(39, 44).match(/^0*(\d+[A-Z]?)$/);
  const julian = parseInt(at(44, 47), 10);
  if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to) || !numMatch) return null;

  return {
    from,
    to,
    flightNo: carrier + numMatch[1],
    date: julianToDate(julian),
    seat: at(48, 52).replace(/^0+/, ''),
    fareLetter: at(47, 48),
    cabin: cabinClass(at(47, 48)),
    pnr: at(23, 30),
    legs: Number(raw[1]),
  };
}

/** Resolve a day-of-year to the candidate date nearest to today. */
function julianToDate(j: number): string | null {
  if (!Number.isFinite(j) || j < 1 || j > 366) return null;
  const today = dayjs();
  let best: dayjs.Dayjs | null = null;
  for (const y of [today.year() - 1, today.year(), today.year() + 1]) {
    const d = dayjs(new Date(y, 0, 1)).add(j - 1, 'day');
    if (d.year() !== y) continue; // day 366 of a non-leap year
    if (!best || Math.abs(d.diff(today)) < Math.abs(best.diff(today))) best = d;
  }
  return best ? best.format('YYYY-MM-DD') : null;
}

/** Decode the first readable barcode in an image (lazy-loads the WASM decoder). */
export async function decodeBarcodeText(image: Blob): Promise<string> {
  const [{ prepareZXingModule, readBarcodes }, wasm] = await Promise.all([
    import('zxing-wasm/reader'),
    import('zxing-wasm/reader/zxing_reader.wasm?url'),
  ]);
  prepareZXingModule({
    overrides: {
      locateFile: (path: string, prefix: string) =>
        path.endsWith('.wasm') ? wasm.default : prefix + path,
    },
  });
  const results = await readBarcodes(image, {
    formats: ['QRCode', 'Aztec', 'PDF417', 'DataMatrix'],
    tryHarder: true,
  });
  const text = results.find((r) => r.text)?.text;
  if (!text)
    throw new Error(
      'No barcode found in that image — try a sharper, closer shot of the barcode.'
    );
  return text;
}
