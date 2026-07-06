import { useMemo } from 'react';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { Flight } from '../types';
import { getAirport } from '../data/airports';
import { haversineKm } from '../lib/geo';
import { flightDuration } from '../lib/duration';
import { MONO, PIXEL } from '../theme';

interface BarItem {
  label: string;
  value: string;
  frac: number;
}

function BarList({ title, items }: { title: string; items: BarItem[] }) {
  if (!items.length) return null;
  return (
    <Box>
      <Typography
        sx={{
          // same treatment as the Settings source headers (FLIGHTRADAR24, ADSB.LOL…)
          fontFamily: MONO,
          fontWeight: 700,
          fontSize: 13,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          mb: 0.75,
        }}
      >
        {title}
      </Typography>
      <Stack spacing={1}>
        {items.map((it) => (
          <Box key={it.label}>
            <Stack direction="row" justifyContent="space-between" spacing={1}>
              <Typography noWrap sx={{ fontSize: 11.5 }}>
                {it.label}
              </Typography>
              <Typography sx={{ fontFamily: MONO, fontSize: 11.5, color: 'text.secondary' }}>
                {it.value}
              </Typography>
            </Stack>
            <Box sx={{ height: 3, bgcolor: 'rgba(0, 90, 255, 0.16)', mt: 0.4 }}>
              <Box
                sx={{
                  height: 1,
                  width: `${Math.max(2, it.frac * 100)}%`,
                  bgcolor: 'primary.main',
                  opacity: 0.9,
                }}
              />
            </Box>
          </Box>
        ))}
      </Stack>
    </Box>
  );
}

function top(map: Map<string, number>, n = 5): Array<[string, number]> {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

export default function StatsPanel({ flights }: { flights: Flight[] }) {
  const stats = useMemo(() => {
    let totalMin = 0;
    let totalKm = 0;
    let anyEstimated = false;
    let longest: { label: string; km: number } | null = null;
    let shortest: { label: string; km: number } | null = null;
    const kmPerYear = new Map<string, number>();
    const routes = new Map<string, number>();
    const airlines = new Map<string, number>();
    const aircraft = new Map<string, number>();

    for (const f of flights) {
      const dur = flightDuration(f);
      if (dur) {
        totalMin += dur.minutes;
        anyEstimated ||= dur.estimated;
      }
      const a = getAirport(f.from);
      const b = getAirport(f.to);
      if (a && b) {
        const km = Math.round(haversineKm([a.lat, a.lon], [b.lat, b.lon]));
        totalKm += km;
        const year = f.date.slice(0, 4);
        kmPerYear.set(year, (kmPerYear.get(year) ?? 0) + km);
        const label = `${f.from} ⇄ ${f.to}`.split(' ⇄ ').sort().join(' ⇄ ');
        routes.set(label, (routes.get(label) ?? 0) + 1);
        if (!longest || km > longest.km) longest = { label: `${f.from}–${f.to}`, km };
        if (!shortest || km < shortest.km) shortest = { label: `${f.from}–${f.to}`, km };
      }
      if (f.airline) airlines.set(f.airline, (airlines.get(f.airline) ?? 0) + 1);
      if (f.aircraft) aircraft.set(f.aircraft, (aircraft.get(f.aircraft) ?? 0) + 1);
    }

    const years = [...kmPerYear.entries()].sort((x, y) => x[0].localeCompare(y[0]));
    const maxYearKm = Math.max(1, ...years.map(([, km]) => km));
    return {
      totalMin,
      totalKm,
      anyEstimated,
      longest,
      shortest,
      years,
      maxYearKm,
      routes: top(routes),
      airlines: top(airlines),
      aircraft: top(aircraft),
    };
  }, [flights]);

  if (!flights.length) {
    return (
      <Box sx={{ p: 3, textAlign: 'center' }}>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          Stats appear once you log flights.
        </Typography>
      </Box>
    );
  }

  const maxRoute = Math.max(1, ...stats.routes.map(([, n]) => n));
  const maxAirline = Math.max(1, ...stats.airlines.map(([, n]) => n));
  const maxAircraft = Math.max(1, ...stats.aircraft.map(([, n]) => n));

  return (
    <Stack spacing={2.5} sx={{ p: 2 }}>
      {/* the three totals, evenly spaced on one line */}
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1.5, alignItems: 'start' }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontFamily: PIXEL, fontWeight: 600, fontSize: 26, lineHeight: 1.05 }}>
            {stats.totalKm >= 100_000
              ? `${Math.round(stats.totalKm / 1000).toLocaleString()}k`
              : stats.totalKm.toLocaleString()}
          </Typography>
          <Typography sx={{ color: 'text.secondary', fontSize: 10, letterSpacing: '0.09em', textTransform: 'uppercase' }}>
            km
          </Typography>
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontFamily: PIXEL, fontWeight: 600, fontSize: 26, lineHeight: 1.05 }}>
            {stats.anyEstimated ? '~' : ''}
            {Math.round(stats.totalMin / 60)}
          </Typography>
          <Typography sx={{ color: 'text.secondary', fontSize: 10, letterSpacing: '0.09em', textTransform: 'uppercase' }}>
            hours
          </Typography>
        </Box>
        {stats.longest && (
          <Box sx={{ minWidth: 0 }}>
            <Typography noWrap sx={{ fontFamily: PIXEL, fontWeight: 600, fontSize: 26, lineHeight: 1.05 }}>
              {stats.longest.label}
            </Typography>
            <Typography sx={{ color: 'text.secondary', fontSize: 10, letterSpacing: '0.09em', textTransform: 'uppercase' }}>
              Longest route · {stats.longest.km.toLocaleString()} km
            </Typography>
          </Box>
        )}
      </Box>

      <BarList
        title="Km per year"
        items={stats.years.map(([year, km]) => ({
          label: year,
          value: `${Math.round(km).toLocaleString()} km`,
          frac: km / stats.maxYearKm,
        }))}
      />

      <BarList
        title="Top routes"
        items={stats.routes.map(([label, n]) => ({
          label,
          value: `${n}`,
          frac: n / maxRoute,
        }))}
      />

      <BarList
        title="Airlines"
        items={stats.airlines.map(([label, n]) => ({
          label,
          value: `${n}`,
          frac: n / maxAirline,
        }))}
      />

      <BarList
        title="Aircraft"
        items={stats.aircraft.map(([label, n]) => ({
          label,
          value: `${n}`,
          frac: n / maxAircraft,
        }))}
      />
    </Stack>
  );
}
