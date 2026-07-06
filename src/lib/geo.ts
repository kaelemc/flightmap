export type LatLon = [number, number];

const EARTH_RADIUS_KM = 6371;

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export function haversineKm(a: LatLon, b: LatLon): number {
  const dLat = rad(b[0] - a[0]);
  const dLon = rad(b[1] - a[1]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(s));
}

/**
 * Points along the great circle from a to b. Longitudes are unwrapped
 * (may exceed ±180°) so the polyline stays continuous across the
 * antimeridian instead of snapping around the whole map.
 */
export function greatCircleArc(a: LatLon, b: LatLon, segments = 64): LatLon[] {
  const lat1 = rad(a[0]), lon1 = rad(a[1]);
  const lat2 = rad(b[0]), lon2 = rad(b[1]);
  const x1 = Math.cos(lat1) * Math.cos(lon1);
  const y1 = Math.cos(lat1) * Math.sin(lon1);
  const z1 = Math.sin(lat1);
  const x2 = Math.cos(lat2) * Math.cos(lon2);
  const y2 = Math.cos(lat2) * Math.sin(lon2);
  const z2 = Math.sin(lat2);

  const d = Math.acos(Math.min(1, Math.max(-1, x1 * x2 + y1 * y2 + z1 * z2)));
  const pts: LatLon[] = [];

  // coincident or antipodal points: the great circle is degenerate/ambiguous
  if (d < 1e-6 || Math.PI - d < 1e-6) {
    pts.push([a[0], a[1]], [b[0], b[1]]);
  } else {
    const sd = Math.sin(d);
    for (let i = 0; i <= segments; i++) {
      const f = i / segments;
      const A = Math.sin((1 - f) * d) / sd;
      const B = Math.sin(f * d) / sd;
      const x = A * x1 + B * x2;
      const y = A * y1 + B * y2;
      const z = A * z1 + B * z2;
      pts.push([deg(Math.atan2(z, Math.hypot(x, y))), deg(Math.atan2(y, x))]);
    }
  }

  return unwrapLons(pts);
}

/** keep every Nth point plus the endpoints */
export function downsamplePath<T>(pts: T[], max: number): T[] {
  if (pts.length <= max) return pts;
  const step = (pts.length - 1) / (max - 1);
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(pts[Math.round(i * step)]);
  return out;
}

/**
 * Adjust longitudes so consecutive points never jump more than 180°,
 * keeping a polyline continuous across the antimeridian (values may
 * leave ±180). Mutates and returns the given array.
 */
export function unwrapLons(pts: LatLon[]): LatLon[] {
  for (let i = 1; i < pts.length; i++) {
    let lon = pts[i][1];
    const prev = pts[i - 1][1];
    while (lon - prev > 180) lon -= 360;
    while (lon - prev < -180) lon += 360;
    pts[i] = [pts[i][0], lon];
  }
  return pts;
}
