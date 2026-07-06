import { memo, useEffect, useMemo } from 'react';
import L from 'leaflet';
import {
  CircleMarker,
  MapContainer,
  Polyline,
  TileLayer,
  Tooltip,
  ZoomControl,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import Box from '@mui/material/Box';
import type { Flight } from '../types';
import { getAirport, type Airport } from '../data/airports';
import { buildArcs, type RouteArc } from '../lib/arcs';
import { MAP_COLORS } from '../theme';

/*
 * Layers are drawn at -360/0/+360° so routes and markers stay visible
 * however far the user pans across the antimeridian — essential for
 * Pacific routes.
 */
const WORLD_OFFSETS = [-360, 0, 360];

interface Props {
  flights: Flight[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** draw fetched real tracks (true) or great circles for everything */
  showRealPaths: boolean;
}

function shift(points: [number, number][], dx: number): [number, number][] {
  return dx === 0 ? points : points.map(([lat, lon]) => [lat, lon + dx] as [number, number]);
}

function FitController({ arcs, selectedId }: { arcs: RouteArc[]; selectedId: string | null }) {
  const map = useMap();
  const routesKey = useMemo(
    () => arcs.map((a) => `${a.flight.from}-${a.flight.to}`).sort().join('|'),
    [arcs]
  );

  useEffect(() => {
    if (!arcs.length) return;
    map.fitBounds(L.latLngBounds(arcs.flatMap((a) => a.points)), {
      padding: [48, 48],
      maxZoom: 7,
    });
    // refit only when the set of routes changes, not on every edit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routesKey, map]);

  useEffect(() => {
    const arc = arcs.find((a) => a.flight.id === selectedId);
    if (!arc) return;
    map.flyToBounds(L.latLngBounds(arc.points), {
      padding: [64, 64],
      maxZoom: 6,
      duration: 0.8,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, map]);

  return null;
}

function DeselectOnMapClick({ onSelect }: { onSelect: (id: string | null) => void }) {
  useMapEvents({ click: () => onSelect(null) });
  return null;
}

/**
 * Memoized: App re-renders (filter typing, snackbars, bulk progress) never
 * touch the Leaflet tree. Dim route lines are position- and style-stable;
 * selection renders as a separate overlay so nothing remounts on click.
 */
export default memo(function MapView({ flights, selectedId, onSelect, showRealPaths }: Props) {
  const arcs = useMemo(() => buildArcs(flights, showRealPaths), [flights, showRealPaths]);

  // positions computed once per data change, not per render/selection
  const renderArcs = useMemo(
    () =>
      arcs.flatMap((arc) =>
        WORLD_OFFSETS.map((dx) => ({
          arc,
          dx,
          positions: shift(arc.points, dx),
        }))
      ),
    [arcs]
  );

  const selectedRenderArcs = useMemo(
    () => renderArcs.filter((r) => r.arc.flight.id === selectedId),
    [renderArcs, selectedId]
  );

  const airports = useMemo<Airport[]>(() => {
    const seen = new Map<string, Airport>();
    for (const f of flights) {
      for (const code of [f.from, f.to]) {
        const a = getAirport(code);
        if (a) seen.set(a.iata, a);
      }
    }
    return [...seen.values()];
  }, [flights]);

  // in great-circle view, badge each route flown more than once with how many
  // times it's been flown. routes are undirected (AKL–SYD counts both
  // directions), matching Stats; the badge sits at the arc midpoint. Skipped in
  // real-path view (tracks differ per flight).
  const routeCounts = useMemo(() => {
    if (showRealPaths) return [];
    const groups = new Map<string, { count: number; mid: [number, number] }>();
    for (const arc of arcs) {
      const key = [arc.flight.from, arc.flight.to].sort().join('|');
      const g = groups.get(key);
      if (g) {
        g.count += 1;
      } else {
        const pts = arc.points;
        groups.set(key, { count: 1, mid: pts[Math.floor(pts.length / 2)] as [number, number] });
      }
    }
    return [...groups.entries()]
      .map(([key, g]) => ({ key, ...g }))
      .filter((r) => r.count > 1);
  }, [arcs, showRealPaths]);

  return (
    <Box sx={{ position: 'relative', height: '100%' }}>
      <MapContainer
        center={[15, 0]}
        zoom={2}
        minZoom={2}
        worldCopyJump
        zoomControl={false}
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          subdomains="abcd"
          // keep a wide ring of tiles loaded around the viewport so panning
          // reveals already-loaded tiles instead of flashing blank while they
          // re-fetch — the "full rerender" felt on movement (esp. slow networks)
          keepBuffer={6}
        />
        <ZoomControl position="bottomright" />
        <DeselectOnMapClick onSelect={onSelect} />
        <FitController arcs={arcs} selectedId={selectedId} />

        {/* stable dim layer — never restyled, never remounted */}
        {renderArcs.map(({ arc, dx, positions }) => (
          <Polyline
            key={`${arc.flight.id}:${dx}`}
            positions={positions}
            pathOptions={{ color: MAP_COLORS.routeDim, weight: 1.5, opacity: 0.55 }}
            eventHandlers={{
              click: (e) => {
                L.DomEvent.stopPropagation(e.originalEvent);
                onSelect(arc.flight.id === selectedId ? null : arc.flight.id);
              },
            }}
          />
        ))}

        {/* selection overlay — keyed by flight so the dash class applies cleanly */}
        {selectedRenderArcs.map(({ arc, dx, positions }) => (
          <Polyline
            key={`sel:${arc.flight.id}:${dx}`}
            positions={positions}
            pathOptions={{
              color: MAP_COLORS.routeSelected,
              weight: 2.5,
              opacity: 0.95,
              className: 'active-route',
            }}
            eventHandlers={{
              click: (e) => {
                L.DomEvent.stopPropagation(e.originalEvent);
                onSelect(null);
              },
            }}
          />
        ))}

        {routeCounts.flatMap((r) =>
          WORLD_OFFSETS.map((dx) => (
            <CircleMarker
              key={`count:${r.key}:${dx}`}
              center={[r.mid[0], r.mid[1] + dx]}
              radius={0}
              pathOptions={{ opacity: 0, fillOpacity: 0 }}
              interactive={false}
            >
              <Tooltip permanent direction="center" className="fm-count-tip">
                {r.count}
              </Tooltip>
            </CircleMarker>
          ))
        )}

        {airports.map((a) =>
          WORLD_OFFSETS.map((dx) => (
            <CircleMarker
              key={`${a.iata}:${dx}`}
              center={[a.lat, a.lon + dx]}
              radius={4.5}
              pathOptions={{
                color: MAP_COLORS.airport,
                weight: 2,
                fillColor: MAP_COLORS.surface,
                fillOpacity: 1,
              }}
            >
              <Tooltip className="fm-tip" direction="top" offset={[0, -6]}>
                <b>{a.iata}</b> {a.city || a.name}
              </Tooltip>
            </CircleMarker>
          ))
        )}
      </MapContainer>
    </Box>
  );
});
