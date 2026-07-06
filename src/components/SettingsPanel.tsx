import { useRef, useState, type ReactNode } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddRounded from '@mui/icons-material/AddRounded';
import DownloadRounded from '@mui/icons-material/DownloadRounded';
import UploadRounded from '@mui/icons-material/UploadRounded';
import { FLIGHT_CLASSES, type Flight, type FlightClass, type Settings } from '../types';
import { newId } from '../store';
import { getAirport } from '../data/airports';
import { coerceImages } from '../lib/image';
import { haversineKm } from '../lib/geo';
import { MONO, OUTLINE_BTN_SX } from '../theme';

interface Props {
  settings: Settings;
  /** changes apply immediately — no save step */
  onChange: (s: Settings) => void;
  flights: Flight[];
  /** merge imported flights into the log (by id) */
  onImport: (flights: Flight[]) => void;
}

function sanitizeImported(raw: unknown): Flight[] | null {
  if (!Array.isArray(raw)) return null;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const track = (v: unknown): Flight['track'] => {
    if (!Array.isArray(v)) return undefined;
    const pts: NonNullable<Flight['track']> = [];
    for (const p of v) {
      if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
      pts.push(Number.isFinite(p[2]) ? [p[0], p[1], p[2]] : [p[0], p[1]]);
    }
    return pts.length >= 2 ? pts : undefined;
  };
  const custom = (v: unknown): Flight['custom'] => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return undefined;
    const out: Record<string, string> = {};
    for (const [k, val] of Object.entries(v)) if (k && typeof val === 'string') out[k] = val;
    return Object.keys(out).length ? out : undefined;
  };
  const out: Flight[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) return null;
    const r = item as Record<string, unknown>;
    if (!str(r.from) || !str(r.to) || !str(r.date)) return null;
    out.push({
      id: str(r.id) || newId(),
      flightNo: str(r.flightNo),
      operatedAs: str(r.operatedAs) || undefined,
      airline: str(r.airline),
      from: str(r.from).toUpperCase(),
      to: str(r.to).toUpperCase(),
      date: str(r.date),
      depTime: str(r.depTime),
      arrTime: str(r.arrTime),
      aircraft: str(r.aircraft),
      registration: str(r.registration),
      seat: str(r.seat),
      flightClass: (FLIGHT_CLASSES as readonly string[]).includes(str(r.flightClass))
        ? (str(r.flightClass) as FlightClass)
        : '',
      fareClass: str(r.fareClass).toUpperCase(),
      notes: str(r.notes),
      custom: custom(r.custom),
      images: coerceImages(r.images, r.boardingPass),
      fr24Id: str(r.fr24Id) || undefined,
      track: track(r.track),
      altitudeUnits: r.altitudeUnits === 'm' ? 'm' : r.altitudeUnits === 'ft' ? 'ft' : undefined,
    });
  }
  return out;
}

function SourceSection({
  name,
  link,
  children,
}: {
  name: string;
  link?: { href: string };
  children: ReactNode;
}) {
  return (
    <Box sx={{ px: 2 }}>
      <Stack direction="row" spacing={1} alignItems="center">
        <Typography sx={{ fontFamily: MONO, fontWeight: 700, fontSize: 13, letterSpacing: '0.06em' }}>
          {name}
        </Typography>
        <Box sx={{ flex: 1 }} />
        {link && (
          <Button
            component="a"
            href={link.href}
            target="_blank"
            rel="noreferrer"
            startIcon={<AddRounded sx={{ fontSize: 14 }} />}
            sx={{ ...OUTLINE_BTN_SX, minWidth: 0, px: 1, py: 0.25, fontSize: 11, color: 'text.secondary' }}
          >
            Get
          </Button>
        )}
      </Stack>
      <Stack spacing={1.25} sx={{ mt: 1.25 }}>
        {children}
      </Stack>
    </Box>
  );
}

function FeatureToggle({
  label,
  ariaLabel,
  checked,
  onChange,
}: {
  label: string;
  ariaLabel: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Stack direction="row" spacing={1} alignItems="center">
      <Typography sx={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700 }}>
        {label}
      </Typography>
      <Checkbox
        size="small"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        slotProps={{ input: { 'aria-label': ariaLabel } }}
        sx={{ p: 0.25 }}
      />
    </Stack>
  );
}

export default function SettingsPanel({ settings, onChange, flights, onImport }: Props) {
  const [msg, setMsg] = useState<{ severity: 'success' | 'error'; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const set = (patch: Partial<Settings>) => onChange({ ...settings, ...patch });
  const setProvider = (id: keyof Settings['enabledProviders'], v: boolean) =>
    set({ enabledProviders: { ...settings.enabledProviders, [id]: v } });
  const setTrackSource = (id: keyof Settings['trackSources'], v: boolean) =>
    set({ trackSources: { ...settings.trackSources, [id]: v } });

  const download = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportJson = () =>
    download(
      new Blob([JSON.stringify(flights, null, 2)], { type: 'application/json' }),
      'flightmap-flights.json'
    );

  const csvField = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const exportCsv = () => {
    // user-defined fields become one column each, across the whole log
    const customKeys = [...new Set(flights.flatMap((f) => Object.keys(f.custom ?? {})))].sort();
    const header = [
      'date,flight_no,operated_as,airline,from,to,dep_time,arr_time,aircraft,registration,seat,flight_class,fare_class,distance_km,notes,images',
      ...customKeys.map(csvField),
    ].join(',');
    const rows = [...flights]
      .sort((a, b) => `${a.date}T${a.depTime}`.localeCompare(`${b.date}T${b.depTime}`))
      .map((f) => {
        const from = getAirport(f.from);
        const to = getAirport(f.to);
        const km =
          from && to ? Math.round(haversineKm([from.lat, from.lon], [to.lat, to.lon])) : '';
        return [
          f.date,
          f.flightNo,
          f.operatedAs ?? '',
          f.airline,
          f.from,
          f.to,
          f.depTime,
          f.arrTime,
          f.aircraft,
          f.registration,
          f.seat,
          f.flightClass,
          f.fareClass,
          km,
          f.notes,
          f.images?.length ?? 0,
          ...customKeys.map((k) => f.custom?.[k] ?? ''),
        ]
          .map(csvField)
          .join(',');
      });
    // BOM so Excel reads UTF-8 correctly
    download(
      new Blob(['﻿' + [header, ...rows].join('\n')], { type: 'text/csv;charset=utf-8' }),
      'flightmap-flights.csv'
    );
  };

  const importJson = async (file: File) => {
    try {
      const parsed = sanitizeImported(JSON.parse(await file.text()));
      if (!parsed) {
        setMsg({
          severity: 'error',
          text: 'That file isn\'t a Flightmap export — expected a list of flights with "from", "to" and "date".',
        });
        return;
      }
      onImport(parsed);
      setMsg({
        severity: 'success',
        text: `Imported ${parsed.length} flight${parsed.length === 1 ? '' : 's'} (matching ids were updated).`,
      });
    } catch {
      setMsg({ severity: 'error', text: 'That file could not be read as JSON.' });
    }
  };

  return (
    // sections carry their own horizontal padding so dividers run edge to edge
    <Stack spacing={2.5} divider={<Divider />} sx={{ py: 2 }}>
      <SourceSection
        name="FLIGHTRADAR24"
       
        link={{ href: 'https://fr24api.flightradar24.com/' }}
      >
        <TextField
          size="small"
          type="password"
          label="API token"
          value={settings.fr24Key}
          onChange={(e) => set({ fr24Key: e.target.value.trim() })}
          fullWidth
        />
        <FeatureToggle
          label="Flight lookup"
          ariaLabel="Flightradar24 flight lookup"
          checked={settings.enabledProviders.fr24}
          onChange={(v) => setProvider('fr24', v)}
        />
        <FeatureToggle
          label="Real flight paths"
          ariaLabel="Flightradar24 real flight paths"
          checked={settings.trackSources.fr24}
          onChange={(v) => setTrackSource('fr24', v)}
        />
      </SourceSection>

      <SourceSection
        name="OPENSKY NETWORK"
       
        link={{ href: 'https://opensky-network.org/' }}
      >
        <TextField
          size="small"
          label="Client id"
          value={settings.openskyClientId}
          onChange={(e) => set({ openskyClientId: e.target.value.trim() })}
          fullWidth
        />
        <TextField
          size="small"
          type="password"
          label="Client secret"
          value={settings.openskyClientSecret}
          onChange={(e) => set({ openskyClientSecret: e.target.value.trim() })}
          fullWidth
        />
        <FeatureToggle
          label="Real flight paths"
          ariaLabel="OpenSky real flight paths"
          checked={settings.trackSources.opensky}
          onChange={(v) => setTrackSource('opensky', v)}
        />
      </SourceSection>

      <SourceSection name="ADSBDB">
        <FeatureToggle
          label="Flight lookup"
          ariaLabel="adsbdb flight lookup"
          checked={settings.enabledProviders.adsbdb}
          onChange={(v) => setProvider('adsbdb', v)}
        />
      </SourceSection>

      <SourceSection name="ADSB.LOL">
        <FeatureToggle
          label="Flight lookup"
          ariaLabel="adsb.lol flight lookup"
          checked={settings.enabledProviders.adsblol}
          onChange={(v) => setProvider('adsblol', v)}
        />
      </SourceSection>

      <SourceSection
        name="CESIUM ION"
        link={{ href: 'https://ion.cesium.com/signup' }}
      >
        <TextField
          size="small"
          type="password"
          label="Access token"
          value={settings.cesiumIonToken}
          onChange={(e) => set({ cesiumIonToken: e.target.value.trim() })}
          fullWidth
        />
      </SourceSection>

      <SourceSection name="BACKUP">
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Button
            variant="outlined"
            startIcon={<UploadRounded />}
            onClick={() => fileRef.current?.click()}
          >
            Import
          </Button>
          <Button
            variant="outlined"
            startIcon={<DownloadRounded />}
            onClick={exportJson}
            disabled={!flights.length}
          >
            JSON
          </Button>
          <Button
            variant="outlined"
            startIcon={<DownloadRounded />}
            onClick={exportCsv}
            disabled={!flights.length}
          >
            CSV
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importJson(f);
              e.target.value = '';
            }}
          />
        </Stack>
        {msg && (
          <Alert severity={msg.severity} onClose={() => setMsg(null)}>
            {msg.text}
          </Alert>
        )}
      </SourceSection>
    </Stack>
  );
}
