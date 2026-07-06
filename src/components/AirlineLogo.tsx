import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import { LOGO_AIRLINES } from '../data/airline-logo-set';

const CODE_BY_NAME = new Map(LOGO_AIRLINES.map(([code, , name]) => [name.toLowerCase(), code]));

/** exact name match, then prefix-variant match ("Qantas Airways" ≈ "Qantas") */
function codeForAirline(name: string): string {
  const n = name.trim().toLowerCase();
  if (!n) return '';
  const exact = CODE_BY_NAME.get(n);
  if (exact) return exact;
  if (n.length < 4) return '';
  for (const [lower, code] of CODE_BY_NAME) {
    if (lower.length >= 4 && (n.startsWith(lower) || lower.startsWith(n))) return code;
  }
  return '';
}

const iataOf = (flightNo: string) => flightNo.match(/^([A-Z0-9]{2})\d/)?.[1] ?? '';

/**
 * Airline mark from an explicit IATA code, or derived from the flight
 * number's prefix. Icons are bundled from official website app icons,
 * App Store artwork, and favicon fallbacks into public/airline-logos via
 * scripts/fetch-airline-icons.cjs. No CDN at runtime; renders nothing when
 * the airline has no bundled icon. White chip so dark liveries survive the
 * black theme.
 */
export default function AirlineLogo({
  flightNo = '',
  airline = '',
  code: explicitCode,
  size = 18,
}: {
  flightNo?: string;
  /** airline name — wins over the flight-number prefix so edits show through */
  airline?: string;
  code?: string;
  size?: number;
}) {
  const code = explicitCode || codeForAirline(airline) || iataOf(flightNo);
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [code]);

  if (!code || failed) return null;
  return (
    <Box
      component="span"
      sx={{
        width: size,
        height: size,
        bgcolor: '#ffffff',
        borderRadius: '50%',
        overflow: 'hidden',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: 'none',
      }}
    >
      <Box
        component="img"
        src={`/airline-logos/${code}.png`}
        alt=""
        onError={() => setFailed(true)}
        sx={{ width: size, height: size, objectFit: 'contain', display: 'block' }}
      />
    </Box>
  );
}
