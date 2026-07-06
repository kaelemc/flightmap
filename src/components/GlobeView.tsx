import { useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import {
  ArcType,
  Cartesian2,
  Cartesian3,
  CesiumTerrainProvider,
  Color,
  ColorMaterialProperty,
  ConstantProperty,
  defined,
  EllipsoidTerrainProvider,
  Entity,
  HeightReference,
  HorizontalOrigin,
  Ion,
  IonImageryProvider,
  LabelStyle,
  PolylineGlowMaterialProperty,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  UrlTemplateImageryProvider,
  VerticalOrigin,
  Viewer,
} from 'cesium';
import type { Flight } from '../types';
import { getAirport, type Airport } from '../data/airports';
import { greatCircleArc, haversineKm, unwrapLons, type LatLon } from '../lib/geo';
import { MAP_COLORS } from '../theme';

/* Cesium replaces the old react-globe.gl stylized globe with a real 3D earth —
 * Google-Earth-grade pan/tilt/zoom, satellite imagery and 3D terrain. Keys:
 *   - Cesium Ion access token (optional, BYOK): enables Bing imagery + world
 *     terrain. Without it we use Esri's free World Imagery raster tiles on a
 *     flat ellipsoid (no key, no quota) — still a proper globe, just no hills.
 * Real cruise altitudes (~11 km) are invisible at planet scale, so the
 * vertical profile of every line is exaggerated 20×; the *shape* stays real.
 */

const NOKIA_BRIGHT = Color.fromCssColorString(MAP_COLORS.routeSelected).withAlpha(0.95);
const ROUTE_DIM = Color.fromCssColorString('rgba(163, 163, 163, 0.55)');
const PATH_DIM = Color.fromCssColorString('rgba(208, 215, 228, 0.75)');
const AIRPORT = Color.fromCssColorString(MAP_COLORS.airport).withAlpha(0.95);

const EXAG = 20; // altitude exaggeration — see header note
const FT_TO_M = 0.3048;
// ground-lift so on-ground ADS-B samples (no altitude) sit just above the
// ellipsoid instead of being defaulted to cruise altitude — the latter
// produced vertical "poles" above each airport where the track started/ended
const GROUND_LIFT_M = 100;

interface Route {
  id: string;
  pts: LatLon[];
  alts: number[];
  real: boolean;
}

/** great-circle + parabolic lift, or the recorded track with exaggerated altitude */
function buildRoutes(flights: Flight[], showRealPaths: boolean): Route[] {
  const out: Route[] = [];
  for (const f of flights) {
    const from = getAirport(f.from);
    const to = getAirport(f.to);
    const track =
      showRealPaths && Array.isArray(f.track) && f.track.length >= 2 ? f.track : null;
    if (track) {
      const unit = f.altitudeUnits === 'm' ? 1 : FT_TO_M;
      const pts: LatLon[] = [];
      const alts: number[] = [];
      for (const p of track) {
        if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
        pts.push([p[0], p[1]]);
        // on-ground samples (no altitude) sit just off the surface; airborne
        // samples lift by their real altitude × exaggeration
        const altM = p.length > 2 && Number.isFinite(p[2]) ? (p[2] as number) * unit * EXAG : GROUND_LIFT_M;
        alts.push(altM);
      }
      unwrapLons(pts);
      if (pts.length >= 2) out.push({ id: f.id, pts, alts, real: true });
      continue;
    }
    if (!from || !to) continue;
    const pts = greatCircleArc([from.lat, from.lon], [to.lat, to.lon], 48);
    const distKm = haversineKm([from.lat, from.lon], [to.lat, to.lon]);
    const maxAlt = Math.max(30_000, Math.min(280_000, distKm * 0.02 * 1000));
    const alts = pts.map((_, i) => Math.sin((i / (pts.length - 1)) * Math.PI) * maxAlt);
    out.push({ id: f.id, pts, alts, real: false });
  }
  return out;
}

function styleOf(id: string, selectedId: string | null, real: boolean) {
  const selected = id === selectedId;
  return {
    material: selected
      ? new PolylineGlowMaterialProperty({ glowPower: 0.2, color: NOKIA_BRIGHT.clone() })
      : new ColorMaterialProperty((real ? PATH_DIM : ROUTE_DIM).clone()),
    width: new ConstantProperty(selected ? 4 : real ? 1.7 : 1.5),
  };
}

interface Props {
  flights: Flight[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  showRealPaths: boolean;
  cesiumIonToken: string;
}

export default function GlobeView({
  flights,
  selectedId,
  onSelect,
  showRealPaths,
  cesiumIonToken,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const entityMapRef = useRef<Map<string, Entity>>(new Map());
  const kindMapRef = useRef<Map<string, boolean>>(new Map()); // id → real?
  const handlerRef = useRef<ScreenSpaceEventHandler | null>(null);
  const watchdogRef = useRef<number | null>(null);
  const onSelectRef = useRef(onSelect);
  const selectedIdRef = useRef(selectedId);
  const prevSelectedRef = useRef<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  /* create the viewer once per token change (re-mounting on a token swap
   * refreshes Ion's default access token cleanly) */
  useEffect(() => {
    if (!containerRef.current) return;
    let disposed = false;
    let viewer: Viewer | undefined;

    void (async () => {
      const container = containerRef.current!;
      if (cesiumIonToken) Ion.defaultAccessToken = cesiumIonToken;

      viewer = new Viewer(container, {
        baseLayer: false, // imagery wired up below (async for Ion)
        terrainProvider: new EllipsoidTerrainProvider(),
        geocoder: false,
        homeButton: false,
        sceneModePicker: false,
        baseLayerPicker: false,
        navigationHelpButton: false,
        animation: false,
        timeline: false,
        fullscreenButton: false,
        selectionIndicator: false,
        infoBox: false,
        scene3DOnly: true,
        shouldAnimate: true,
        // we recover from render-loop errors ourselves (see watchdog below) —
        // don't overlay Cesium's "an error occurred, rendering has stopped" panel
        showRenderLoopErrors: false,
      });

      const v = viewer;
      v.scene.globe.enableLighting = false;
      v.scene.fog.enabled = false;
      v.scene.backgroundColor = Color.BLACK;
      if (v.scene.skyAtmosphere) v.scene.skyAtmosphere.show = true;
      if (v.scene.skyBox) v.scene.skyBox.show = true;
      v.scene.globe.showGroundAtmosphere = false;
      v.screenSpaceEventHandler.removeInputAction(ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

      // Cesium's scroll-zoom can occasionally hit a degenerate camera state and
      // throw a render-loop error ("normalized result is not a number"), which
      // freezes the globe. Bound the zoom so the extremes (where it aligns
      // degenerately) aren't reachable, and run a watchdog: if a render error
      // ever stops the loop, reset the camera to a valid view and resume.
      const cam = v.scene.screenSpaceCameraController;
      cam.minimumZoomDistance = 120; // metres above the surface
      cam.maximumZoomDistance = 5.0e7; // ~8× Earth radius — well past the whole globe
      let recoveries = 0;
      watchdogRef.current = window.setInterval(() => {
        if (v.isDestroyed()) return;
        if (!v.useDefaultRenderLoop) {
          try {
            v.camera.flyHome(0); // clear any NaN/degenerate camera state instantly
          } catch {
            /* ignore — resuming the loop is what matters */
          }
          v.useDefaultRenderLoop = true;
          if (++recoveries <= 3) console.warn('[globe] recovered from a render error');
        }
      }, 250);

      const handler = new ScreenSpaceEventHandler(v.scene.canvas);
      handler.setInputAction((evt: { position: Cartesian2 }) => {
        const picked = v.scene.pick(evt.position);
        if (defined(picked) && picked.id && typeof picked.id.id === 'string') {
          const m = picked.id.id.match(/^flight:(.+)$/);
          if (m) {
            onSelectRef.current(m[1] === selectedIdRef.current ? null : m[1]);
            return;
          }
        }
        onSelectRef.current(null);
      }, ScreenSpaceEventType.LEFT_CLICK);
      handlerRef.current = handler;

      try {
        if (cesiumIonToken) {
          const [imagery, terrain] = await Promise.all([
            IonImageryProvider.fromAssetId(2),
            CesiumTerrainProvider.fromIonAssetId(1),
          ]);
          if (disposed) return;
          v.imageryLayers.addImageryProvider(imagery);
          v.terrainProvider = terrain;
        } else {
          if (disposed) return;
          v.imageryLayers.addImageryProvider(
            new UrlTemplateImageryProvider({
              url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
              maximumLevel: 19,
              credit: 'Esri, Maxar, Earthstar Geographics',
            })
          );
        }
      } catch {
        if (!disposed && v.imageryLayers.length === 0) {
          v.imageryLayers.addImageryProvider(
            new UrlTemplateImageryProvider({
              url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
              maximumLevel: 19,
              credit: 'Esri, Maxar, Earthstar Geographics',
            })
          );
        }
      }

      if (disposed) return;
      viewerRef.current = v;
      // dev-only handle for debugging the globe / exercising the recovery path
      if (import.meta.env.DEV) (window as unknown as { __globe?: Viewer }).__globe = v;
      setReady(true);
    })();

    return () => {
      disposed = true;
      if (watchdogRef.current !== null) {
        clearInterval(watchdogRef.current);
        watchdogRef.current = null;
      }
      handlerRef.current?.destroy();
      handlerRef.current = null;
      try {
        if (viewer && !viewer.isDestroyed()) viewer.destroy();
      } catch {
        /* Cesium occasionally throws during teardown on fast re-mounts */
      }
      viewerRef.current = null;
      entityMapRef.current.clear();
      kindMapRef.current.clear();
      prevSelectedRef.current = null;
      setReady(false);
    };
  }, [cesiumIonToken]);

  const routes = useMemo(() => buildRoutes(flights, showRealPaths), [flights, showRealPaths]);

  /* (re)build entities whenever the set of routes or the viewer changes */
  useEffect(() => {
    const v = viewerRef.current;
    if (!v || v.isDestroyed()) return;

    const remove: string[] = [];
    v.entities.values.forEach((e) => {
      if (typeof e.id === 'string' && (e.id.startsWith('flight:') || e.id.startsWith('airport:'))) {
        remove.push(e.id);
      }
    });
    for (const id of remove) v.entities.removeById(id);
    entityMapRef.current.clear();
    kindMapRef.current.clear();

    for (const r of routes) {
      const positions = r.pts.map((p, i) =>
        Cartesian3.fromDegrees(p[1], p[0], r.alts[i] ?? 0)
      );
      const s = styleOf(r.id, selectedIdRef.current, r.real);
      const ent = v.entities.add({
        id: `flight:${r.id}`,
        polyline: {
          positions,
          width: s.width,
          material: s.material,
          // GEODESIC — Cesium arcs each segment along the ellipsoid surface,
          // so a near-antipodal greatCircleArc that came back as just two
          // endpoints renders as a true surface arc instead of a chord
          // punched straight through the globe (the "vertical line" artefact)
          arcType: ArcType.GEODESIC,
          clampToGround: false,
        },
      });
      entityMapRef.current.set(r.id, ent);
      kindMapRef.current.set(r.id, r.real);
    }

    const seen = new Map<string, Airport>();
    for (const f of flights) {
      for (const code of [f.from, f.to]) {
        const a = getAirport(code);
        if (a) seen.set(a.iata, a);
      }
    }
    for (const a of seen.values()) {
      v.entities.add({
        id: `airport:${a.iata}`,
        position: Cartesian3.fromDegrees(a.lon, a.lat),
        point: {
          pixelSize: 6,
          color: AIRPORT.clone(),
          outlineColor: Color.BLACK.clone(),
          outlineWidth: 1,
          heightReference: HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: a.iata,
          font: '11px "JetBrains Mono", ui-monospace, monospace',
          style: LabelStyle.FILL_AND_OUTLINE,
          fillColor: Color.WHITE.clone(),
          outlineColor: Color.BLACK.clone(),
          outlineWidth: 2,
          horizontalOrigin: HorizontalOrigin.LEFT,
          verticalOrigin: VerticalOrigin.CENTER,
          pixelOffset: new Cartesian2(8, 0),
          heightReference: HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          translucencyByDistance: undefined,
        },
      });
    }

    /* restyle the prev selection if it still exists so a rebuild keeps the
     * glow on the right entity */
    const prev = prevSelectedRef.current;
    if (prev && entityMapRef.current.has(prev)) {
      const e = entityMapRef.current.get(prev)!;
      const real = kindMapRef.current.get(prev) ?? false;
      const s = styleOf(prev, prev, real);
      e.polyline!.width = s.width;
      e.polyline!.material = s.material;
    }

    // keep the selection's "show only this route" state across rebuilds
    const sel = selectedIdRef.current;
    for (const [id, ent] of entityMapRef.current) {
      ent.show = !sel || id === sel;
    }

    // no initial camera command — the viewer opens on Cesium's default view
    // selectedId is read live via selectedIdRef; not a dep here
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routes, flights, ready]);

  /* selection changes — only restyle the highlight; never move the camera */
  useEffect(() => {
    const v = viewerRef.current;
    if (!v || v.isDestroyed()) return;

    const prev = prevSelectedRef.current;
    if (prev && prev !== selectedId && entityMapRef.current.has(prev)) {
      const e = entityMapRef.current.get(prev)!;
      const real = kindMapRef.current.get(prev) ?? false;
      const s = styleOf(prev, null, real);
      e.polyline!.width = s.width;
      e.polyline!.material = s.material;
    }

    if (selectedId && entityMapRef.current.has(selectedId)) {
      const e = entityMapRef.current.get(selectedId)!;
      const real = kindMapRef.current.get(selectedId) ?? false;
      const s = styleOf(selectedId, selectedId, real);
      e.polyline!.width = s.width;
      e.polyline!.material = s.material;
    }
    // when a flight is selected, show only its route; all routes when deselected
    for (const [id, ent] of entityMapRef.current) {
      ent.show = !selectedId || id === selectedId;
    }
    prevSelectedRef.current = selectedId;
  }, [selectedId, ready]);

  /* token changed mid-session — Viewer is recreated above; nothing extra here */

  return (
    <Box
      ref={containerRef}
      tabIndex={0}
      sx={{
        position: 'relative',
        height: '100%',
        width: '100%',
        overflow: 'hidden',
        outline: 'none',
        bgcolor: '#000000',
        /* keep Cesium's chrome consistent with the sharp-cornered dark UI */
        '& .cesium-viewer': { backgroundColor: '#000000' },
        '& .cesium-widget-panel': { margin: 0 },
        /* the credit logo is legally required for the imagery — keep it, theme it */
        '& .cesium-widget-credits': {
          position: 'absolute',
          bottom: 0,
          right: 0,
          'a, .cesium-credit-textContainer': {
            color: '#6b6b6b !important',
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: '9px',
          },
        },
      }}
    />
  );
}