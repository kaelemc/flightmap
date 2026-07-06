import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Toolbar from '@mui/material/Toolbar';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import FlightTakeoffRounded from '@mui/icons-material/FlightTakeoffRounded';
import MapRounded from '@mui/icons-material/MapRounded';
import PublicRounded from '@mui/icons-material/PublicRounded';
import RouteOutlined from '@mui/icons-material/RouteOutlined';
import SearchRounded from '@mui/icons-material/SearchRounded';
import SwapCallsRounded from '@mui/icons-material/SwapCallsRounded';
import type { Flight } from './types';
import { decodeShare } from './lib/share';
import { filterFlights } from './lib/filter';
import { BRAND, MONO, OUTLINE_BTN_SX } from './theme';
import FlightList from './components/FlightList';
import MapView from './components/MapView';
import StatsPanel from './components/StatsPanel';

const GlobeView = lazy(() => import('./components/GlobeView'));

/**
 * Read-only viewer for a shared flight log (`/share/<token>`). Decodes the
 * token into flights held only in memory — it never reads or writes the
 * owner's localStorage, so opening a share link can't disturb your own log.
 */
export default function ShareView({ version, token }: { version: string; token: string }) {
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'error' } | { status: 'ok'; flights: Flight[] }
  >({ status: 'loading' });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState(0);
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'map' | 'globe'>('map');
  const [showRealPaths, setShowRealPaths] = useState(true);

  useEffect(() => {
    let live = true;
    decodeShare(version, token)
      .then((flights) => live && setState({ status: 'ok', flights }))
      .catch(() => live && setState({ status: 'error' }));
    return () => {
      live = false;
    };
  }, [version, token]);

  const sorted = useMemo(() => {
    if (state.status !== 'ok') return [];
    return [...state.flights].sort((a, b) =>
      `${b.date}T${b.depTime}`.localeCompare(`${a.date}T${a.depTime}`)
    );
  }, [state]);

  const filtered = useMemo(() => filterFlights(sorted, query), [sorted, query]);

  if (state.status === 'loading') {
    return (
      <Box sx={{ height: '100dvh', display: 'grid', placeItems: 'center' }}>
        <CircularProgress size={28} />
      </Box>
    );
  }

  if (state.status === 'error') {
    return (
      <Box
        sx={{
          height: '100dvh',
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
        <Typography sx={{ fontWeight: 700 }}>This share link is invalid</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', maxWidth: 340 }}>
          The link may be incomplete or corrupted. Ask for a fresh one.
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <AppBar position="static" elevation={0} sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Toolbar sx={{ gap: 1.5, minHeight: 60 }}>
          <Stack direction="row" alignItems="center" spacing={1}>
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
            <Tooltip title={showRealPaths ? 'Show great-circle paths' : 'Show real flown paths'}>
              <IconButton
                size="small"
                aria-label={showRealPaths ? 'Show great-circle paths' : 'Show real flown paths'}
                onClick={() => setShowRealPaths((v) => !v)}
                sx={OUTLINE_BTN_SX}
              >
                {showRealPaths ? <SwapCallsRounded fontSize="small" /> : <RouteOutlined fontSize="small" />}
              </IconButton>
            </Tooltip>
            <Tooltip title={view === 'map' ? 'Globe view' : 'Map view'}>
              <IconButton
                size="small"
                aria-label={view === 'map' ? 'Switch to globe view' : 'Switch to map view'}
                onClick={() => setView((v) => (v === 'map' ? 'globe' : 'map'))}
                sx={OUTLINE_BTN_SX}
              >
                {view === 'map' ? <PublicRounded fontSize="small" /> : <MapRounded fontSize="small" />}
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
            borderColor: 'divider',
          }}
        >
          <Box sx={{ px: 1.5, py: 1 }}>
            <TextField
              size="small"
              fullWidth
              placeholder="Filter"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
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
          </Tabs>
          <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            {tab === 1 ? (
              <StatsPanel flights={filtered} />
            ) : filtered.length ? (
              <FlightList
                flights={filtered}
                selectedId={selectedId}
                onSelect={setSelectedId}
                readOnly
              />
            ) : sorted.length ? (
              <Box sx={{ p: 3, textAlign: 'center' }}>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  No flights match “{query.trim()}”.
                </Typography>
              </Box>
            ) : (
              <Box sx={{ p: 3, textAlign: 'center' }}>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  This shared log has no flights.
                </Typography>
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
                <Box sx={{ height: '100%', display: 'grid', placeItems: 'center' }}>
                  <CircularProgress size={28} />
                </Box>
              }
            >
              <GlobeView
                flights={filtered}
                selectedId={selectedId}
                onSelect={setSelectedId}
                showRealPaths={showRealPaths}
                cesiumIonToken=""
              />
            </Suspense>
          )}
        </Box>
      </Box>
    </Box>
  );
}
