import { Suspense, lazy, useCallback, useMemo, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Snackbar from '@mui/material/Snackbar';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import AddRounded from '@mui/icons-material/AddRounded';
import CheckRounded from '@mui/icons-material/CheckRounded';
import CircularProgress from '@mui/material/CircularProgress';
import CloseRounded from '@mui/icons-material/CloseRounded';
import ContentCopyRounded from '@mui/icons-material/ContentCopyRounded';
import FlightTakeoffRounded from '@mui/icons-material/FlightTakeoffRounded';
import InfoOutlined from '@mui/icons-material/InfoOutlined';
import InputAdornment from '@mui/material/InputAdornment';
import IosShareRounded from '@mui/icons-material/IosShareRounded';
import MapRounded from '@mui/icons-material/MapRounded';
import PublicRounded from '@mui/icons-material/PublicRounded';
import RouteOutlined from '@mui/icons-material/RouteOutlined';
import SearchRounded from '@mui/icons-material/SearchRounded';
import SettingsOutlined from '@mui/icons-material/SettingsOutlined';
import TextField from '@mui/material/TextField';
import Stack from '@mui/material/Stack';
import SwapCallsRounded from '@mui/icons-material/SwapCallsRounded';
import Tooltip from '@mui/material/Tooltip';
import type { Flight } from './types';
import { useFlights, useSettings } from './store';
import { fetchRealPath } from './lib/tracks';
import { filterFlights } from './lib/filter';
import { encodeShare, shareUrl } from './lib/share';
import { goHome } from './lib/nav';
import { useShiftKey } from './lib/useShiftKey';
import { BRAND, MONO, OUTLINE_BTN_SX } from './theme';
import AboutDialog from './components/AboutDialog';
import FlightEditorPanel from './components/FlightEditorPanel';
import FlightList from './components/FlightList';
import MapView from './components/MapView';
import SettingsPanel from './components/SettingsPanel';
import StatsPanel from './components/StatsPanel';

// Cesium is heavy — load the 3D globe only when the user switches to it
const GlobeView = lazy(() => import('./components/GlobeView'));

export default function App() {
  const { flights, add, update, remove, replaceAll } = useFlights();
  const [settings, setSettings] = useSettings();
  const shift = useShiftKey();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Flight | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Flight | null>(null);
  const [tab, setTab] = useState(0);
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'map' | 'globe'>('map');
  const [showRealPaths, setShowRealPaths] = useState(true);
  const [pathBusyId, setPathBusyId] = useState<string | null>(null);
  const [snack, setSnack] = useState<{ severity: 'success' | 'error'; text: string } | null>(
    null
  );
  const [shareOpen, setShareOpen] = useState(false);
  const [shareLink, setShareLink] = useState('');
  const [shareBusy, setShareBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

  const sorted = useMemo(
    () =>
      [...flights].sort((a, b) =>
        `${b.date}T${b.depTime}`.localeCompare(`${a.date}T${a.depTime}`)
      ),
    [flights]
  );

  const filtered = useMemo(() => filterFlights(sorted, query), [sorted, query]);

  const openAdd = () => {
    setEditing(null);
    setEditorOpen(true);
  };

  // stable identity so memoized flight rows skip re-rendering
  const openEdit = useCallback((f: Flight) => {
    setEditing(f);
    setEditorOpen(true);
  }, []);

  // stable identity so the panel's Escape-key listener isn't rebound every render
  const closeEditor = useCallback(() => setEditorOpen(false), []);

  const handleSave = (f: Flight) => {
    if (editing) update(f);
    else add(f);
    setSelectedId(f.id);
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    remove(deleteTarget.id);
    if (selectedId === deleteTarget.id) setSelectedId(null);
    setDeleteTarget(null);
  };

  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);
  const bulkCancel = useRef(false);

  const missingPaths = useMemo(
    () => flights.filter((f) => !f.track && (f.flightNo || f.operatedAs)).length,
    [flights]
  );
  const fetchableCount = useMemo(
    () => flights.filter((f) => f.flightNo || f.operatedAs).length,
    [flights]
  );

  const fetchPath = useCallback(
    async (f: Flight): Promise<void> => {
      setPathBusyId(f.id);
      try {
        const r = await fetchRealPath(f, settings);
        update({ ...f, track: r.track, altitudeUnits: r.altitudeUnits, fr24Id: r.fr24Id ?? f.fr24Id });
        setSelectedId(f.id);
        setSnack({
          severity: 'success',
          text: `Real path attached from ${r.source} (${r.track.length} points).`,
        });
      } catch (e) {
        setSnack({
          severity: 'error',
          text: e instanceof Error ? e.message : 'Could not fetch the real path.',
        });
      } finally {
        setPathBusyId(null);
      }
    },
    [settings, update]
  );

  /** sequential bulk fetch — kind to rate limits and API credits; force re-fetches everything */
  const fetchAllPaths = useCallback(async (force = false) => {
    const targets = flights.filter(
      (f) => (f.flightNo || f.operatedAs) && (force || !f.track)
    );
    if (!targets.length) return;
    bulkCancel.current = false;
    setBulk({ done: 0, total: targets.length });
    let ok = 0;
    let attempted = 0;
    for (const f of targets) {
      if (bulkCancel.current) break;
      attempted++;
      setPathBusyId(f.id);
      try {
        const r = await fetchRealPath(f, settings);
        update({ ...f, track: r.track, altitudeUnits: r.altitudeUnits, fr24Id: r.fr24Id ?? f.fr24Id });
        ok++;
      } catch {
        /* counted in the summary */
      }
      setBulk({ done: attempted, total: targets.length });
      await new Promise((res) => setTimeout(res, 300));
    }
    setPathBusyId(null);
    setBulk(null);
    setSnack({
      severity: ok ? 'success' : 'error',
      text:
        `Attached ${ok} of ${attempted} paths.` +
        (ok < attempted
          ? ' Misses are usually flights older than OpenSky keeps (~30 days) without an FR24 token.'
          : ''),
    });
  }, [flights, settings, update]);

  // build a read-only /share/ link that encodes ONLY route data (no photos,
  // seats, fares, class, notes or custom fields) — see lib/share.ts
  const openShare = async () => {
    setShareOpen(true);
    setShareBusy(true);
    setCopied(false);
    setShareLink('');
    try {
      setShareLink(shareUrl(await encodeShare(flights)));
    } catch {
      setShareOpen(false);
      setSnack({ severity: 'error', text: 'Could not build the share link.' });
    } finally {
      setShareBusy(false);
    }
  };

  const copyShareLink = async () => {
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
    } catch {
      setSnack({ severity: 'error', text: 'Copy failed — select the link and copy it manually.' });
    }
  };

  const importFlights = (incoming: Flight[]) => {
    const byId = new Map(flights.map((f) => [f.id, f]));
    for (const f of incoming) byId.set(f.id, f);
    replaceAll([...byId.values()]);
  };

  return (
    <Box sx={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <AppBar
        position="static"
        elevation={0}
        sx={{ borderBottom: 1, borderColor: 'divider' }}
      >
        <Toolbar sx={{ gap: 1.5, minHeight: 60 }}>
          <Stack
            component="a"
            href="/"
            onClick={goHome}
            aria-label="Home"
            direction="row"
            alignItems="center"
            spacing={1}
            sx={{ textDecoration: 'none', color: 'inherit', cursor: 'pointer', '&:hover': { opacity: 0.85 } }}
          >
            <Box
              component="img"
              src="/branding/flightmap-mark-white.svg"
              alt=""
              sx={{ height: 24, width: 'auto', display: 'block' }}
            />
            <Typography
              sx={{ fontFamily: BRAND, fontWeight: 600, fontSize: 23, lineHeight: 1, letterSpacing: '-0.01em' }}
            >
              flightmap
            </Typography>
          </Stack>
          <Box sx={{ flex: 1 }} />
          <Stack direction="row" alignItems="center" spacing={1}>
            <Tooltip title={flights.length ? 'Share a read-only link to your log' : 'Log a flight to share it'}>
              <Box component="span" sx={{ display: 'flex' }}>
                <IconButton
                  size="small"
                  aria-label="Share flight log"
                  onClick={openShare}
                  disabled={!flights.length}
                  sx={OUTLINE_BTN_SX}
                >
                  <IosShareRounded fontSize="small" />
                </IconButton>
              </Box>
            </Tooltip>
            <Tooltip
              title={showRealPaths ? 'Show great-circle paths' : 'Show real flown paths'}
            >
              <IconButton
                size="small"
                aria-label={showRealPaths ? 'Show great-circle paths' : 'Show real flown paths'}
                onClick={() => setShowRealPaths((v) => !v)}
                sx={OUTLINE_BTN_SX}
              >
                {showRealPaths ? (
                  <SwapCallsRounded fontSize="small" />
                ) : (
                  <RouteOutlined fontSize="small" />
                )}
              </IconButton>
            </Tooltip>
            <Tooltip title={view === 'map' ? 'Globe view' : 'Map view'}>
              <IconButton
                size="small"
                aria-label={view === 'map' ? 'Switch to globe view' : 'Switch to map view'}
                onClick={() => setView((v) => (v === 'map' ? 'globe' : 'map'))}
                sx={OUTLINE_BTN_SX}
              >
                {view === 'map' ? (
                  <PublicRounded fontSize="small" />
                ) : (
                  <MapRounded fontSize="small" />
                )}
              </IconButton>
            </Tooltip>
            <Tooltip title="About">
              <IconButton
                size="small"
                aria-label="About Flightmap"
                onClick={() => setInfoOpen(true)}
                sx={OUTLINE_BTN_SX}
              >
                <InfoOutlined fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        </Toolbar>
      </AppBar>

      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          position: 'relative',
          display: 'flex',
          flexDirection: { xs: 'column-reverse', md: 'row' },
        }}
      >
        <Box
          sx={{
            flex: { xs: 1, md: '0 0 400px' },
            width: { md: 400 },
            minWidth: { md: 400 },
            maxWidth: { md: 400 },
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            bgcolor: 'background.paper',
            borderRight: { xs: 0, md: 1 },
            borderTop: { xs: 1, md: 0 },
            borderColor: { xs: 'divider', md: 'divider' },
          }}
        >
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: '1fr auto auto',
              gap: 0.75,
              alignItems: 'stretch',
              px: 1.5,
              py: 1,
            }}
          >
            <TextField
              size="small"
              fullWidth
              placeholder="Filter"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              // trim the field height so the square buttons beside it stay compact
              sx={{ '& .MuiOutlinedInput-input': { py: 0.75 } }}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchRounded sx={{ fontSize: 16, color: 'text.secondary' }} />
                    </InputAdornment>
                  ),
                },
              }}
            />
            <Tooltip
              title={
                bulk
                  ? `Fetching ${bulk.done}/${bulk.total} — click to stop`
                  : shift && fetchableCount
                    ? `Re-fetch real paths for all ${fetchableCount} flight${fetchableCount === 1 ? '' : 's'}`
                    : missingPaths
                      ? `Fetch real paths for ${missingPaths} flight${missingPaths === 1 ? '' : 's'}`
                      : 'All flights have real paths'
              }
            >
              <Box component="span" sx={{ display: 'flex' }}>
                <IconButton
                  size="small"
                  aria-label={bulk ? 'Stop bulk fetch' : 'Fetch all real paths'}
                  onClick={(e) => {
                    if (bulk) bulkCancel.current = true;
                    else void fetchAllPaths(e.shiftKey);
                  }}
                  disabled={!bulk && fetchableCount === 0}
                  sx={{ ...OUTLINE_BTN_SX, height: '100%', aspectRatio: '1 / 1' }}
                >
                  {bulk ? (
                    // match RouteOutlined fontSize="small" (20px) so the button
                    // doesn't visibly shrink when the icon becomes a spinner
                    <CircularProgress size={20} />
                  ) : (
                    <RouteOutlined fontSize="small" />
                  )}
                </IconButton>
              </Box>
            </Tooltip>
            <Tooltip title="Log flight">
              <IconButton
                size="small"
                aria-label="Log flight"
                onClick={openAdd}
                sx={{
                  ...OUTLINE_BTN_SX,
                  height: '100%',
                  aspectRatio: '1 / 1',
                  // keep the 1px box so the width matches the fetch button
                  border: '1px solid transparent',
                  bgcolor: 'primary.main',
                  color: '#ffffff',
                  // the blog's accent hover: the one blue, tinted toward white
                  '&:hover': { bgcolor: '#4d8cff' },
                }}
              >
                <AddRounded fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
          <Divider />
          <Tabs
            value={tab}
            onChange={(_, v) => setTab(v)}
            sx={{ minHeight: 38, borderBottom: 1, borderColor: 'divider' }}
          >
            <Tab
              label="Flight log"
              sx={{ flex: 1, minHeight: 38, fontFamily: MONO, fontSize: 11, letterSpacing: '0.1em' }}
            />
            <Tab
              label="Stats"
              sx={{ flex: 1, minHeight: 38, fontFamily: MONO, fontSize: 11, letterSpacing: '0.1em' }}
            />
            <Tab
              icon={<SettingsOutlined sx={{ fontSize: 17 }} />}
              aria-label="Settings"
              sx={{ minWidth: 52, minHeight: 38, p: 0 }}
            />
          </Tabs>
          <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            {tab === 2 ? (
              <SettingsPanel
                settings={settings}
                onChange={setSettings}
                flights={flights}
                onImport={importFlights}
              />
            ) : tab === 1 ? (
              <StatsPanel flights={filtered} />
            ) : filtered.length ? (
              <FlightList
                flights={filtered}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onEdit={openEdit}
                onDelete={setDeleteTarget}
                onFetchPath={fetchPath}
                pathBusyId={pathBusyId}
              />
            ) : flights.length ? (
              <Box sx={{ p: 3, textAlign: 'center' }}>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  No flights match “{query.trim()}”.
                </Typography>
              </Box>
            ) : (
              <Box
                sx={{
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 1.5,
                  p: 4,
                  textAlign: 'center',
                }}
              >
                <FlightTakeoffRounded sx={{ fontSize: 44, color: 'text.disabled' }} />
                <Typography sx={{ fontWeight: 700 }}>No flights logged yet</Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary', maxWidth: 300 }}>
                  Enter a flight number and date — Flightmap finds the route and draws it on
                  the map.
                </Typography>
                <Button
                  variant="contained"
                  color="primary"
                  startIcon={<AddRounded />}
                  onClick={openAdd}
                >
                  Log your first flight
                </Button>
              </Box>
            )}
          </Box>
        </Box>

        <Box sx={{ flex: { xs: '0 0 44%', md: 1 }, minHeight: 0, bgcolor: 'background.default' }}>
          {view === 'map' ? (
            <MapView
              flights={filtered}
              selectedId={selectedId}
              onSelect={setSelectedId}
              showRealPaths={showRealPaths}
            />
          ) : (
            <Suspense
              fallback={
                <Box
                  sx={{
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <CircularProgress size={28} />
                </Box>
              }
            >
              <GlobeView
                flights={filtered}
                selectedId={selectedId}
                onSelect={setSelectedId}
                showRealPaths={showRealPaths}
                cesiumIonToken={settings.cesiumIonToken}
              />
            </Suspense>
          )}
        </Box>

        {/* flyout editor — flush against the sidebar, over the top-left of the map;
            left 399 overlaps the sidebar's 1px border so the edges don't double up */}
        <Box
          sx={{
            position: 'absolute',
            top: 0,
            left: { xs: 0, md: 399 },
            right: { xs: 0, md: 'auto' },
            width: { md: 600 },
            maxWidth: { md: 'calc(100% - 399px)' },
            maxHeight: '100%',
            display: 'flex',
            // above leaflet's controls (z-index 1000)
            zIndex: 1100,
            pointerEvents: 'none',
          }}
        >
          <FlightEditorPanel
            open={editorOpen}
            initial={editing}
            settings={settings}
            flights={flights}
            onClose={closeEditor}
            onSave={handleSave}
          />
        </Box>
      </Box>

      <Snackbar
        open={!!snack}
        autoHideDuration={6000}
        onClose={() => setSnack(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        <Alert
          severity={snack?.severity ?? 'success'}
          variant="filled"
          onClose={() => setSnack(null)}
          sx={{ maxWidth: 420 }}
        >
          {snack?.text}
        </Alert>
      </Snackbar>

      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)}>
        <DialogTitle>Remove this flight?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {deleteTarget &&
              `${deleteTarget.flightNo || 'Flight'} ${deleteTarget.from} → ${deleteTarget.to} on ${deleteTarget.date} will be removed from your log.`}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleDelete}>
            Remove
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={shareOpen} onClose={() => setShareOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pr: 1 }}>
          Share your flight log
          <IconButton aria-label="Close" onClick={() => setShareOpen(false)} size="small">
            <CloseRounded fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            Anyone with this link can view your routes on a read-only map and view flight
            number, date, airline, aircraft, registration and fetched paths.
          </DialogContentText>
          {shareBusy ? (
            <Stack direction="row" spacing={1.5} alignItems="center" sx={{ py: 1 }}>
              <CircularProgress size={18} />
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                Building link…
              </Typography>
            </Stack>
          ) : (
            <>
              <TextField
                fullWidth
                multiline
                minRows={2}
                maxRows={4}
                value={shareLink}
                onFocus={(e) => e.target.select()}
                slotProps={{
                  input: {
                    readOnly: true,
                    sx: { fontFamily: MONO, fontSize: 12, alignItems: 'flex-start' },
                    endAdornment: (
                      <InputAdornment position="end" sx={{ mt: 1 }}>
                        <Tooltip title={copied ? 'Copied' : 'Copy link'}>
                          <IconButton
                            aria-label="Copy link"
                            size="small"
                            edge="end"
                            onClick={copyShareLink}
                          >
                            {copied ? (
                              <CheckRounded fontSize="small" sx={{ color: 'success.main' }} />
                            ) : (
                              <ContentCopyRounded fontSize="small" />
                            )}
                          </IconButton>
                        </Tooltip>
                      </InputAdornment>
                    ),
                  },
                }}
              />
              <Typography variant="caption" sx={{ color: 'text.secondary', mt: 1, display: 'block' }}>
                {shareLink.length.toLocaleString()} characters
              </Typography>
            </>
          )}
        </DialogContent>
      </Dialog>

      <AboutDialog open={infoOpen} onClose={() => setInfoOpen(false)} />
    </Box>
  );
}
