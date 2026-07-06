import { memo, useMemo } from 'react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import MuiTooltip from '@mui/material/Tooltip';
import DeleteOutline from '@mui/icons-material/DeleteOutline';
import EastRounded from '@mui/icons-material/EastRounded';
import EditOutlined from '@mui/icons-material/EditOutlined';
import RouteOutlined from '@mui/icons-material/RouteOutlined';
import WarningAmberRounded from '@mui/icons-material/WarningAmberRounded';
import dayjs from 'dayjs';
import AirlineLogo from './AirlineLogo';
import type { Flight } from '../types';
import { getAirport } from '../data/airports';
import { haversineKm } from '../lib/geo';
import { useShiftKey } from '../lib/useShiftKey';
import { MONO, PIXEL } from '../theme';

interface Props {
  /** sorted newest-first */
  flights: Flight[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onEdit?: (f: Flight) => void;
  onDelete?: (f: Flight) => void;
  /** fetch the real flown path for a flight */
  onFetchPath?: (f: Flight) => void;
  /** id of the flight whose path is currently being fetched */
  pathBusyId?: string | null;
  /** viewer mode — hide edit/delete/fetch, keep a static real-path indicator */
  readOnly?: boolean;
}

function IataCode({ code }: { code: string }) {
  const known = !!getAirport(code);
  return (
    <Stack direction="row" spacing={0.5} alignItems="center">
      <Typography sx={{ fontFamily: PIXEL, fontWeight: 600, fontSize: 22, lineHeight: 1.1 }}>
        {code || '???'}
      </Typography>
      {!known && (
        <MuiTooltip title="Unknown airport code — this flight can't be drawn on the map">
          <WarningAmberRounded sx={{ fontSize: 14, color: 'warning.main' }} />
        </MuiTooltip>
      )}
    </Stack>
  );
}

// memoized: selection changes re-render only the two affected rows
const FlightRow = memo(function FlightRow({
  flight,
  selected,
  pathBusy,
  shift,
  readOnly,
  onSelect,
  onEdit,
  onDelete,
  onFetchPath,
}: {
  flight: Flight;
  selected: boolean;
  pathBusy: boolean;
  shift: boolean;
  readOnly?: boolean;
  onSelect: (id: string | null) => void;
  onEdit?: (f: Flight) => void;
  onDelete?: (f: Flight) => void;
  onFetchPath?: (f: Flight) => void;
}) {
  const from = getAirport(flight.from);
  const to = getAirport(flight.to);
  const km =
    from && to ? Math.round(haversineKm([from.lat, from.lon], [to.lat, to.lon])) : null;

  return (
    <ListItemButton
      selected={selected}
      onClick={() => onSelect(selected ? null : flight.id)}
      sx={{
        alignItems: 'flex-start',
        gap: 1,
        py: 1,
        borderLeft: 3,
        borderLeftColor: selected ? 'primary.main' : 'transparent',
        // rows are uniform — let the browser skip offscreen ones in long logs
        contentVisibility: 'auto',
        containIntrinsicSize: 'auto 78px',
      }}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
          <Typography sx={{ fontFamily: MONO, fontSize: 11, color: 'text.secondary' }}>
            {dayjs(flight.date).format('DD MMM').toUpperCase()}
          </Typography>
          <Stack direction="row" spacing={0.5} alignItems="center" sx={{ minWidth: 0 }}>
            <AirlineLogo flightNo={flight.flightNo} airline={flight.airline} size={15} />
            {flight.flightNo && (
              <Typography sx={{ fontFamily: MONO, fontSize: 11, color: 'text.secondary' }}>
                {flight.flightNo}
              </Typography>
            )}
            {flight.operatedAs && (
              <MuiTooltip title={`Codeshare — operated as ${flight.operatedAs}`}>
                <Typography noWrap sx={{ fontFamily: MONO, fontSize: 10, color: 'text.secondary' }}>
                  op {flight.operatedAs}
                </Typography>
              </MuiTooltip>
            )}
          </Stack>
        </Stack>

        <Stack direction="row" spacing={0.75} alignItems="center">
          <IataCode code={flight.from} />
          <EastRounded
            sx={{ fontSize: 15, color: selected ? 'primary.main' : 'text.disabled' }}
          />
          <IataCode code={flight.to} />
        </Stack>

        <Typography noWrap sx={{ fontSize: 11.5, color: 'text.secondary' }}>
          {(from?.city || flight.from) + ' to ' + (to?.city || flight.to)}
        </Typography>
      </Box>

      <Stack alignItems="flex-end" spacing={0.25}>
        <Typography sx={{ fontFamily: MONO, fontSize: 11, color: 'text.secondary' }}>
          {km !== null ? `${km.toLocaleString()} km` : '—'}
        </Typography>
        {readOnly ? (
          flight.track ? (
            <MuiTooltip title="Real flown path is on the map">
              <RouteOutlined sx={{ fontSize: 16, color: 'primary.main', mt: 0.25 }} />
            </MuiTooltip>
          ) : null
        ) : (
        <Stack direction="row" alignItems="center">
          {pathBusy ? (
            // spinner inside a same-size (disabled) button so the row doesn't
            // shift when the fetch icon becomes a spinner
            <IconButton size="small" disabled aria-label="Fetching real path">
              <CircularProgress size={16} />
            </IconButton>
          ) : flight.track ? (
            <MuiTooltip title={shift ? 'Re-fetch real path' : 'Real flown path is on the map'}>
              <IconButton
                size="small"
                aria-label={`Re-fetch real path for ${flight.flightNo || flight.from + '–' + flight.to}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (e.shiftKey) onFetchPath?.(flight);
                }}
                sx={{ color: 'primary.main' }}
              >
                <RouteOutlined sx={{ fontSize: 16 }} />
              </IconButton>
            </MuiTooltip>
          ) : (
            <MuiTooltip title="Fetch the real flown path">
              <IconButton
                size="small"
                aria-label={`Fetch real path for ${flight.flightNo || flight.from + '–' + flight.to}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onFetchPath?.(flight);
                }}
              >
                <RouteOutlined sx={{ fontSize: 16 }} />
              </IconButton>
            </MuiTooltip>
          )}
          <IconButton
            size="small"
            aria-label={`Edit flight ${flight.flightNo || flight.from + '–' + flight.to}`}
            onClick={(e) => {
              e.stopPropagation();
              onEdit?.(flight);
            }}
          >
            <EditOutlined sx={{ fontSize: 16 }} />
          </IconButton>
          <IconButton
            size="small"
            aria-label={`Delete flight ${flight.flightNo || flight.from + '–' + flight.to}`}
            onClick={(e) => {
              e.stopPropagation();
              onDelete?.(flight);
            }}
          >
            <DeleteOutline sx={{ fontSize: 16 }} />
          </IconButton>
        </Stack>
        )}
      </Stack>
    </ListItemButton>
  );
});

export default function FlightList({
  flights,
  selectedId,
  onSelect,
  onEdit,
  onDelete,
  onFetchPath,
  pathBusyId,
  readOnly,
}: Props) {
  const shift = useShiftKey();
  const rows = useMemo(() => {
    const out: Array<{ kind: 'year'; year: string } | { kind: 'flight'; flight: Flight }> = [];
    let year = '';
    for (const f of flights) {
      const y = f.date.slice(0, 4);
      if (y !== year) {
        year = y;
        out.push({ kind: 'year', year: y });
      }
      out.push({ kind: 'flight', flight: f });
    }
    return out;
  }, [flights]);

  return (
    <List disablePadding>
      {rows.map((row) =>
        row.kind === 'year' ? (
          <Typography
            key={`y${row.year}`}
            sx={{
              px: 2,
              pt: 1.5,
              pb: 0.5,
              fontFamily: MONO,
              fontSize: 11,
              letterSpacing: '0.14em',
              color: 'text.secondary',
              position: 'sticky',
              top: 0,
              zIndex: 1,
              bgcolor: 'background.paper',
            }}
          >
            {row.year}
          </Typography>
        ) : (
          <FlightRow
            key={row.flight.id}
            flight={row.flight}
            selected={row.flight.id === selectedId}
            pathBusy={row.flight.id === pathBusyId}
            shift={shift}
            readOnly={readOnly}
            onSelect={onSelect}
            onEdit={onEdit}
            onDelete={onDelete}
            onFetchPath={onFetchPath}
          />
        )
      )}
    </List>
  );
}
