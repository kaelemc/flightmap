import { useEffect, useMemo, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Collapse from '@mui/material/Collapse';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import Grow from '@mui/material/Grow';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddPhotoAlternateOutlined from '@mui/icons-material/AddPhotoAlternateOutlined';
import AddRounded from '@mui/icons-material/AddRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import ConnectingAirportsRounded from '@mui/icons-material/ConnectingAirportsRounded';
import DeleteOutline from '@mui/icons-material/DeleteOutline';
import OpenInNewRounded from '@mui/icons-material/OpenInNewRounded';
import QrCodeScannerRounded from '@mui/icons-material/QrCodeScannerRounded';
import CloudDownloadOutlined from '@mui/icons-material/CloudDownloadOutlined';
import SwapHorizRounded from '@mui/icons-material/SwapHorizRounded';
import MuiTooltip from '@mui/material/Tooltip';
import MenuItem from '@mui/material/MenuItem';
import dayjs from 'dayjs';
import { FLIGHT_CLASSES, type Flight, type FlightImage, type FlightClass, type Settings } from '../types';
import { getAirport, searchAirports, type Airport } from '../data/airports';
import { AIRCRAFT_TYPES } from '../data/aircraft-types';
import { LOGO_AIRLINES } from '../data/airline-logo-set';
import AirlineLogo from './AirlineLogo';
import { lookupFlight, normalizeFlightNo, type LookupResult } from '../lib/fetchFlight';
import { decodeBarcodeText, parseBcbp } from '../lib/bcbp';
import { compressImageFile } from '../lib/image';
import { newId } from '../store';
import { MONO, OUTLINE_BTN_SX } from '../theme';

interface Props {
  open: boolean;
  /** when set, the panel edits this flight instead of creating one */
  initial: Flight | null;
  settings: Settings;
  /** existing log — its airlines/aircraft rank first in suggestions */
  flights: Flight[];
  onClose: () => void;
  onSave: (f: Flight) => void;
}

interface AirlineOption {
  name: string;
  /** IATA code that keys the logo; '' when unknown */
  code: string;
}

// no cap on the empty-query list — capping it made the dropdown look like it
// "stopped" partway through the alphabet with nothing left to scroll to
const containsFilter = (options: string[], state: { inputValue: string }) => {
  const q = state.inputValue.trim().toLowerCase();
  if (!q) return options;
  return options.filter((o) => o.toLowerCase().includes(q));
};

const airlineFilter = (options: AirlineOption[], state: { inputValue: string }) => {
  const q = state.inputValue.trim().toLowerCase();
  if (!q) return options;
  return options.filter((o) => o.name.toLowerCase().includes(q) || o.code.toLowerCase() === q);
};

type Message = { severity: 'success' | 'info' | 'error'; text: string };

// each form row is a CSS grid with alignItems:stretch, so the fields define
// the row height. Buttons fill that height (height:100%) rather than sizing to
// their own content — that's what keeps the fetch button from shrinking when
// its icon swaps to a loading spinner.
const rowGridSx = (columns: string) =>
  ({ display: 'grid', gridTemplateColumns: columns, gap: 1, alignItems: 'stretch' }) as const;
const ROW_BTN_SX = { ...OUTLINE_BTN_SX, height: '100%' } as const;

function AirportField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Airport | null;
  onChange: (a: Airport | null) => void;
}) {
  const [input, setInput] = useState('');

  const options = useMemo(() => {
    const opts = searchAirports(input);
    if (value && !opts.some((o) => o.iata === value.iata)) opts.unshift(value);
    return opts;
  }, [input, value]);

  return (
    <Autocomplete
      fullWidth
      options={options}
      value={value}
      onChange={(_, v) => onChange(v)}
      inputValue={input}
      onInputChange={(_, v) => setInput(v)}
      filterOptions={(x) => x}
      getOptionLabel={(o) => `${o.iata} (${o.city || o.name})`}
      isOptionEqualToValue={(a, b) => a.iata === b.iata}
      noOptionsText={input ? 'No matching airport' : 'Type a code or city'}
      renderOption={(props, o) => (
        <Box component="li" {...props} key={o.iata} sx={{ gap: 1 }}>
          <Typography sx={{ fontFamily: MONO, fontWeight: 700 }}>{o.iata}</Typography>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" noWrap>
              {o.city || o.name}
            </Typography>
            <Typography variant="caption" noWrap sx={{ color: 'text.secondary', display: 'block' }}>
              {o.name} · {o.country}
            </Typography>
          </Box>
        </Box>
      )}
      renderInput={(params) => <TextField {...params} label={label} required />}
    />
  );
}

export default function FlightEditorPanel({
  open,
  initial,
  settings,
  flights,
  onClose,
  onSave,
}: Props) {
  const [flightNo, setFlightNo] = useState('');
  const [operatedAs, setOperatedAs] = useState('');
  const [codeshare, setCodeshare] = useState(false);
  const [date, setDate] = useState('');
  const [fromAp, setFromAp] = useState<Airport | null>(null);
  const [toAp, setToAp] = useState<Airport | null>(null);
  const [depTime, setDepTime] = useState('');
  const [arrTime, setArrTime] = useState('');
  const [airline, setAirline] = useState('');
  const [aircraft, setAircraft] = useState('');
  const [registration, setRegistration] = useState('');
  const [seat, setSeat] = useState('');
  const [flightClass, setFlightClass] = useState<FlightClass>('');
  const [fareClass, setFareClass] = useState('');
  const [notes, setNotes] = useState('');
  // user-defined key/value fields, edited as ordered rows; saved as a Record
  const [custom, setCustom] = useState<Array<{ k: string; v: string }>>([]);
  const [images, setImages] = useState<FlightImage[]>([]);
  const [confirmDeleteImg, setConfirmDeleteImg] = useState<string | null>(null);
  const [tab, setTab] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Message | null>(null);

  // airlines you've flown first (logo from their flight-number prefix),
  // then every airline in the bundled logo set
  const airlineOptions = useMemo<AirlineOption[]>(() => {
    const byName = new Map<string, string>();
    for (const f of flights) {
      if (f.airline && !byName.has(f.airline)) {
        byName.set(f.airline, f.flightNo.match(/^([A-Z0-9]{2})\d/)?.[1] ?? '');
      }
    }
    for (const [code, , name] of LOGO_AIRLINES) {
      if (!byName.has(name)) byName.set(name, code);
    }
    return [...byName.entries()].map(([name, code]) => ({ name, code }));
  }, [flights]);

  const aircraftOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const v of [...flights.map((f) => f.aircraft), ...AIRCRAFT_TYPES]) {
      if (v && !seen.has(v)) {
        seen.add(v);
        out.push(v);
      }
    }
    return out;
  }, [flights]);
  const [fr24Id, setFr24Id] = useState<string | undefined>(undefined);
  const [track, setTrack] = useState<Flight['track']>(undefined);
  const [altitudeUnits, setAltitudeUnits] = useState<Flight['altitudeUnits']>(undefined);
  const scanRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setTab(0);
    setFlightNo(initial?.flightNo ?? '');
    setOperatedAs(initial?.operatedAs ?? '');
    setCodeshare(!!initial?.operatedAs);
    setDate(initial?.date ?? dayjs().format('YYYY-MM-DD'));
    setFromAp(getAirport(initial?.from) ?? null);
    setToAp(getAirport(initial?.to) ?? null);
    setDepTime(initial?.depTime ?? '');
    setArrTime(initial?.arrTime ?? '');
    setAirline(initial?.airline ?? '');
    setAircraft(initial?.aircraft ?? '');
    setRegistration(initial?.registration ?? '');
    setSeat(initial?.seat ?? '');
    setFlightClass(initial?.flightClass ?? '');
    setFareClass(initial?.fareClass ?? '');
    setNotes(initial?.notes ?? '');
    setCustom(Object.entries(initial?.custom ?? {}).map(([k, v]) => ({ k, v })));
    setImages(initial?.images ? [...initial.images] : []);
    setConfirmDeleteImg(null);
    setFr24Id(initial?.fr24Id);
    setTrack(initial?.track);
    setAltitudeUnits(initial?.altitudeUnits);
    setBusy(false);
    setMsg(null);
  }, [open, initial]);

  // not a modal, so Escape is wired by hand; Autocomplete stops propagation
  // when its popup is open, so Escape closes the dropdown before the panel
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // when the delete-image confirm is up, Escape dismisses it, not the panel
      if (e.key === 'Escape' && !confirmDeleteImg) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose, confirmDeleteImg]);

  /** apply non-empty lookup fields to the form; returns airport codes we couldn't resolve */
  const applyLookup = (r: LookupResult): string[] => {
    if (r.airline) setAirline(r.airline);
    if (r.aircraft) setAircraft(r.aircraft);
    if (r.registration) setRegistration(r.registration);
    if (r.depTime) setDepTime(r.depTime);
    if (r.arrTime) setArrTime(r.arrTime);
    if (r.fr24Id) setFr24Id(r.fr24Id);
    if (r.track) {
      setTrack(r.track);
      setAltitudeUnits(r.altitudeUnits);
    }
    const unknown: string[] = [];
    for (const [code, set] of [
      [r.from, setFromAp],
      [r.to, setToAp],
    ] as const) {
      if (!code) continue;
      const ap = getAirport(code);
      if (ap) set(ap);
      else unknown.push(code);
    }
    return unknown;
  };

  const lookupMessage = (r: LookupResult, unknown: string[]): Message => ({
    severity: r.source === 'adsbdb' ? 'info' : 'success',
    text:
      (r.note ?? 'Found.') +
      (unknown.length
        ? ` (${unknown.join(', ')} isn't in the airport database — pick the airport manually.)`
        : ''),
  });

  // codeshare tickets fly under the operating carrier's number — when the
  // user gave one, search with it instead of the (often unresolvable) ticketed number
  const doLookup = async (
    fn: string = normalizeFlightNo(operatedAs) || flightNo,
    d: string = date
  ) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await lookupFlight(fn, d, settings);
      const m = lookupMessage(r, applyLookup(r));
      if (fn === normalizeFlightNo(operatedAs) && fn !== normalizeFlightNo(flightNo)) {
        m.text = `Searched as ${fn} (operating flight). ${m.text}`;
      }
      setMsg(m);
    } catch (err) {
      setMsg({
        severity: 'error',
        text: err instanceof Error ? err.message : 'Lookup failed.',
      });
    } finally {
      setBusy(false);
    }
  };

  const scanBoardingPass = async (file: File) => {
    setBusy(true);
    setMsg(null);
    // keep the image whatever the barcode turns out to be — worst case it's a
    // memento the user fills in by hand
    let imageSaved = false;
    try {
      const data = await compressImageFile(file);
      setImages((prev) => [...prev, { id: newId(), data, label: 'Boarding pass' }]);
      imageSaved = true;
    } catch {
      /* not a decodable image — the barcode read below will report the problem */
    }
    try {
      const bp = parseBcbp(await decodeBarcodeText(file));
      if (!bp) {
        setMsg({
          severity: 'info',
          text: "Image saved, but its barcode isn't an IATA boarding pass — enter the flight details by hand.",
        });
        return;
      }
      setFlightNo(bp.flightNo);
      if (bp.date) setDate(bp.date);
      const fromAp2 = getAirport(bp.from);
      const toAp2 = getAirport(bp.to);
      if (fromAp2) setFromAp(fromAp2);
      if (toAp2) setToAp(toAp2);
      if (bp.seat) setSeat(bp.seat);
      if (bp.fareLetter) setFareClass(bp.fareLetter);
      if (bp.cabin) setFlightClass(bp.cabin);

      const summary =
        `Boarding pass read: ${bp.flightNo} ${bp.from} → ${bp.to}` +
        (bp.seat ? `, seat ${bp.seat}` : '') +
        `. Barcodes store no year — date guessed as ${bp.date ?? 'unknown'}, check it.`;

      try {
        const r = await lookupFlight(bp.flightNo, bp.date ?? date, settings);
        applyLookup(r);
        setMsg({ severity: 'success', text: `${summary} ${r.note ?? ''}` });
      } catch {
        setMsg({ severity: 'info', text: summary });
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'Could not read that image.';
      setMsg({
        severity: imageSaved ? 'info' : 'error',
        text: imageSaved ? `${reason} The image was still saved to this flight.` : reason,
      });
    } finally {
      setBusy(false);
    }
  };

  const addImageFiles = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    try {
      const added: FlightImage[] = [];
      for (const file of files) {
        try {
          added.push({ id: newId(), data: await compressImageFile(file) });
        } catch {
          /* skip anything that isn't a decodable image */
        }
      }
      if (added.length) setImages((prev) => [...prev, ...added]);
      else setMsg({ severity: 'error', text: "Those files couldn't be read as images." });
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    if (!fromAp || !toAp || !date) {
      setMsg({
        severity: 'error',
        text: 'The date and both airports are required — everything else is optional.',
      });
      return;
    }
    onSave({
      id: initial?.id ?? newId(),
      flightNo: normalizeFlightNo(flightNo),
      operatedAs: normalizeFlightNo(operatedAs) || undefined,
      airline: airline.trim(),
      from: fromAp.iata,
      to: toAp.iata,
      date,
      depTime,
      arrTime,
      aircraft: aircraft.trim(),
      registration: registration.trim().toUpperCase(),
      seat: seat.trim().toUpperCase(),
      flightClass,
      fareClass: fareClass.trim().toUpperCase(),
      notes: notes.trim(),
      custom: (() => {
        const obj: Record<string, string> = {};
        for (const { k, v } of custom) if (k.trim()) obj[k.trim()] = v.trim();
        return Object.keys(obj).length ? obj : undefined;
      })(),
      images: images.length
        ? images.map((im) => ({ ...im, label: im.label?.trim() || undefined }))
        : undefined,
      fr24Id,
      track,
      altitudeUnits,
    });
    onClose();
  };

  // a recorded path belongs to the looked-up route; manual route edits invalidate it
  const dropTrack = () => {
    setTrack(undefined);
    setAltitudeUnits(undefined);
    setFr24Id(undefined);
  };

  const changeFrom = (a: Airport | null) => {
    setFromAp(a);
    dropTrack();
  };

  const changeTo = (a: Airport | null) => {
    setToAp(a);
    dropTrack();
  };

  const swap = () => {
    setFromAp(toAp);
    setToAp(fromAp);
    dropTrack();
  };

  return (
    <>
    <Grow in={open} mountOnEnter unmountOnExit style={{ transformOrigin: 'top left' }}>
      <Paper
        elevation={0}
        role="dialog"
        aria-label={initial ? 'Edit flight' : 'Log a flight'}
        sx={{
          width: '100%',
          maxHeight: '100%',
          display: 'flex',
          flexDirection: 'column',
          border: '1px solid #3f3f3f',
          pointerEvents: 'auto',
        }}
      >
        <Stack
          direction="row"
          alignItems="center"
          spacing={0.5}
          sx={{ pl: 2, pr: 1, py: 1, borderBottom: 1, borderColor: 'divider' }}
        >
          <Typography
            sx={{
              fontFamily: MONO,
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
            }}
          >
            {initial ? 'Edit flight' : 'Log a flight'}
          </Typography>
          <Box sx={{ flex: 1 }} />
          <MuiTooltip title="Scan a boarding pass — photo or screenshot of the barcode">
            <span>
              <IconButton
                aria-label="Scan boarding pass"
                onClick={() => scanRef.current?.click()}
                disabled={busy}
                size="small"
              >
                <QrCodeScannerRounded fontSize="small" />
              </IconButton>
            </span>
          </MuiTooltip>
          <input
            ref={scanRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void scanBoardingPass(f);
              e.target.value = '';
            }}
          />
          <IconButton aria-label="Close" onClick={onClose} size="small">
            <CloseRounded fontSize="small" />
          </IconButton>
        </Stack>
        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          variant="fullWidth"
          sx={{ minHeight: 42, borderBottom: 1, borderColor: 'divider' }}
        >
          <Tab
            label="Details"
            sx={{ minHeight: 42, fontFamily: MONO, fontSize: 11, letterSpacing: '0.1em' }}
          />
          <Tab
            label={images.length ? `Attachments · ${images.length}` : 'Attachments'}
            sx={{ minHeight: 42, fontFamily: MONO, fontSize: 11, letterSpacing: '0.1em' }}
          />
        </Tabs>
        {/* lookup/scan feedback lives above the tabs so it shows on either one */}
        <Collapse in={!!msg}>
          <Box sx={{ px: 2, pt: 2 }}>
            {msg && (
              <Alert severity={msg.severity} onClose={() => setMsg(null)}>
                {msg.text}
              </Alert>
            )}
          </Box>
        </Collapse>
        {/* horizontal padding lives on the inner content, not here, so the
            Attachments divider can span the full width without overflowing */}
        <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', py: 2 }}>
          {tab === 0 ? (
          <Stack spacing={2} sx={{ px: 2 }}>
          {/* flight row + its codeshare collapse are one Stack child, so a
              collapsed codeshare field doesn't leave the Stack's gap behind */}
          <Box>
          <Box sx={rowGridSx('1.2fr 1fr auto auto')}>
            <TextField
              label="Flight number"
              placeholder="NZ103"
              value={flightNo}
              onChange={(e) => setFlightNo(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && flightNo.trim() && !busy) {
                  e.preventDefault();
                  void doLookup();
                }
              }}
              sx={{ '& input': { fontFamily: MONO } }}
              autoFocus={!initial}
            />
            <TextField
              label="Date"
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <MuiTooltip title="Codeshare — add the flight number the operating carrier flies under">
              <IconButton
                aria-label="Codeshare flight"
                onClick={() => {
                  if (codeshare) setOperatedAs('');
                  setCodeshare(!codeshare);
                }}
                sx={{
                  ...ROW_BTN_SX,
                  color: codeshare ? 'primary.main' : 'text.secondary',
                  borderColor: codeshare ? 'primary.main' : '#3f3f3f',
                }}
              >
                <ConnectingAirportsRounded />
              </IconButton>
            </MuiTooltip>
            <MuiTooltip title="Fetch flight details">
              <Box component="span" sx={{ display: 'flex' }}>
                <IconButton
                  aria-label="Fetch flight details"
                  onClick={() => void doLookup()}
                  disabled={busy || !(flightNo.trim() || operatedAs.trim())}
                  sx={ROW_BTN_SX}
                >
                  {busy ? (
                    <CircularProgress size={24} color="inherit" />
                  ) : (
                    <CloudDownloadOutlined />
                  )}
                </IconButton>
              </Box>
            </MuiTooltip>
          </Box>

          <Collapse in={codeshare}>
            <Box sx={{ pt: 2 }}>
              <TextField
                label="Operated as"
                placeholder="QF143"
                fullWidth
                value={operatedAs}
                onChange={(e) => setOperatedAs(e.target.value.toUpperCase())}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && operatedAs.trim() && !busy) {
                    e.preventDefault();
                    void doLookup();
                  }
                }}
                sx={{ '& input': { fontFamily: MONO } }}
              />
            </Box>
          </Collapse>
          </Box>

          <Box sx={rowGridSx('1fr 1fr auto')}>
            <AirportField label="From" value={fromAp} onChange={changeFrom} />
            <AirportField label="To" value={toAp} onChange={changeTo} />
            <IconButton onClick={swap} aria-label="Swap airports" sx={ROW_BTN_SX}>
              <SwapHorizRounded />
            </IconButton>
          </Box>

          <Box sx={rowGridSx('1fr 1fr')}>
            <TextField
              label="Departure time"
              type="time"
              value={depTime}
              onChange={(e) => setDepTime(e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              label="Arrival time"
              type="time"
              value={arrTime}
              onChange={(e) => setArrTime(e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
            />
          </Box>

          <Box sx={rowGridSx('1.5fr 1fr 0.8fr')}>
            <Autocomplete
              fullWidth
              freeSolo
              options={airlineOptions}
              filterOptions={airlineFilter}
              getOptionLabel={(o) => (typeof o === 'string' ? o : o.name)}
              inputValue={airline}
              onInputChange={(_, v) => setAirline(v)}
              renderOption={(props, o) => (
                <Box component="li" {...props} key={`${o.code}:${o.name}`} sx={{ gap: 1 }}>
                  <AirlineLogo code={o.code} size={18} />
                  <Typography variant="body2" noWrap>
                    {o.name}
                  </Typography>
                </Box>
              )}
              renderInput={(params) => <TextField {...params} label="Airline" />}
            />
            <Autocomplete
              fullWidth
              freeSolo
              options={aircraftOptions}
              filterOptions={containsFilter}
              inputValue={aircraft}
              onInputChange={(_, v) => setAircraft(v)}
              renderInput={(params) => (
                <TextField {...params} label="Aircraft" placeholder="Boeing 787-9" />
              )}
            />
            <TextField
              label="Registration"
              placeholder="ZK-OAB"
              value={registration}
              onChange={(e) => setRegistration(e.target.value.toUpperCase())}
              sx={{ '& input': { fontFamily: MONO } }}
            />
          </Box>

          <Box sx={rowGridSx('1fr 1fr 1.4fr')}>
            <TextField
              label="Seat"
              placeholder="19A"
              value={seat}
              onChange={(e) => setSeat(e.target.value.toUpperCase())}
              sx={{ '& input': { fontFamily: MONO } }}
            />
            <TextField
              label="Fare"
              placeholder="J"
              value={fareClass}
              onChange={(e) => setFareClass(e.target.value.toUpperCase())}
              slotProps={{ htmlInput: { maxLength: 2 } }}
              sx={{ '& input': { fontFamily: MONO } }}
            />
            <TextField
              select
              label="Class"
              value={flightClass}
              onChange={(e) => setFlightClass(e.target.value as FlightClass)}
            >
              <MenuItem value="">—</MenuItem>
              {FLIGHT_CLASSES.map((c) => (
                <MenuItem key={c} value={c}>
                  {c}
                </MenuItem>
              ))}
            </TextField>
          </Box>

          <TextField
            label="Notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            multiline
            minRows={2}
          />

          </Stack>
          ) : (
          <Stack spacing={2.5} divider={<Divider />}>
            <Box sx={{ px: 2 }}>
              <Stack
                direction="row"
                alignItems="center"
                justifyContent="space-between"
                sx={{ mb: 1.5 }}
              >
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  Images
                </Typography>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<AddPhotoAlternateOutlined />}
                  onClick={() => imageRef.current?.click()}
                  disabled={busy}
                  sx={{
                    color: 'text.secondary',
                    borderColor: '#3f3f3f',
                    '&:hover': { borderColor: 'text.secondary', bgcolor: 'transparent' },
                  }}
                >
                  Add image
                </Button>
              </Stack>
              {images.length > 0 && (
                <Box
                  sx={{
                    display: 'flex',
                    gap: 1,
                    overflowX: 'auto',
                    pb: 0.5,
                    overscrollBehavior: 'contain',
                  }}
                >
                  {images.map((img) => (
                    <Box
                      key={img.id}
                      sx={{
                        position: 'relative',
                        flexShrink: 0,
                        width: 88,
                        height: 88,
                        border: '1px solid #3f3f3f',
                        '&:hover .img-open': { opacity: 1 },
                      }}
                    >
                      <Box
                        component="a"
                        href={img.data}
                        target="_blank"
                        rel="noopener"
                        sx={{ display: 'block', width: '100%', height: '100%', lineHeight: 0 }}
                      >
                        <Box
                          component="img"
                          src={img.data}
                          alt={img.label || 'Attached image'}
                          sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                        />
                        <Box
                          className="img-open"
                          sx={{
                            position: 'absolute',
                            inset: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            bgcolor: 'rgba(0,0,0,0.45)',
                            color: '#fff',
                            opacity: 0,
                            transition: 'opacity 120ms',
                          }}
                        >
                          <OpenInNewRounded fontSize="small" />
                        </Box>
                      </Box>
                      <IconButton
                        size="small"
                        aria-label={`Remove image ${img.label || ''}`.trim()}
                        onClick={() => setConfirmDeleteImg(img.id)}
                        sx={{
                          position: 'absolute',
                          top: 2,
                          right: 2,
                          zIndex: 1,
                          p: '2px',
                          bgcolor: 'rgba(0,0,0,0.6)',
                          color: '#fff',
                          borderRadius: 0,
                          '&:hover': { bgcolor: 'rgba(0,0,0,0.85)' },
                        }}
                      >
                        <CloseRounded sx={{ fontSize: 14 }} />
                      </IconButton>
                    </Box>
                  ))}
                </Box>
              )}
              <input
                ref={imageRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => {
                  void addImageFiles(Array.from(e.target.files ?? []));
                  e.target.value = '';
                }}
              />
            </Box>

            <Box sx={{ px: 2 }}>
              <Stack
                direction="row"
                alignItems="center"
                justifyContent="space-between"
                sx={{ mb: 1.5 }}
              >
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  Extra fields
                </Typography>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<AddRounded />}
                  onClick={() => setCustom([...custom, { k: '', v: '' }])}
                  sx={{
                    color: 'text.secondary',
                    borderColor: '#3f3f3f',
                    '&:hover': { borderColor: 'text.secondary', bgcolor: 'transparent' },
                  }}
                >
                  Add field
                </Button>
              </Stack>
              {custom.length > 0 && (
              <Stack spacing={2}>
          {custom.map((row, i) => (
            <Box sx={rowGridSx('1fr 1.5fr auto')} key={i}>
              <TextField
                label="Field"
                placeholder="Booking ref"
                value={row.k}
                onChange={(e) =>
                  setCustom(custom.map((r, j) => (j === i ? { ...r, k: e.target.value } : r)))
                }
              />
              <TextField
                label="Value"
                placeholder="ABC123"
                value={row.v}
                onChange={(e) =>
                  setCustom(custom.map((r, j) => (j === i ? { ...r, v: e.target.value } : r)))
                }
              />
              <IconButton
                aria-label={`Remove field ${row.k || i + 1}`}
                onClick={() => setCustom(custom.filter((_, j) => j !== i))}
                sx={ROW_BTN_SX}
              >
                <DeleteOutline sx={{ fontSize: 18 }} />
              </IconButton>
            </Box>
          ))}
              </Stack>
              )}
            </Box>
          </Stack>
          )}
        </Box>
        <Stack
          direction="row"
          justifyContent="flex-end"
          spacing={1}
          sx={{ px: 2, py: 1.25, borderTop: 1, borderColor: 'divider' }}
        >
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="contained" color="primary" onClick={save}>
            Save flight
          </Button>
        </Stack>
      </Paper>
    </Grow>

    <Dialog open={!!confirmDeleteImg} onClose={() => setConfirmDeleteImg(null)}>
      <DialogTitle>Remove this image?</DialogTitle>
      <DialogActions>
        <Button onClick={() => setConfirmDeleteImg(null)}>Cancel</Button>
        <Button
          color="error"
          variant="contained"
          onClick={() => {
            setImages((prev) => prev.filter((im) => im.id !== confirmDeleteImg));
            setConfirmDeleteImg(null);
          }}
        >
          Remove
        </Button>
      </DialogActions>
    </Dialog>
    </>
  );
}
