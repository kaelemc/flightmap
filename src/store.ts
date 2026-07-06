import { useCallback, useEffect, useState } from 'react';
import type { Flight, Settings } from './types';
import { coerceImages } from './lib/image';

const FLIGHTS_KEY = 'flightmap.flights.v1';
const SETTINGS_KEY = 'flightmap.settings.v1';

export function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function loadFlights(): Flight[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(FLIGHTS_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    // backfill fields added after a flight was stored, and migrate the legacy
    // single `boardingPass` string into the images array
    return parsed.map((f) => {
      const { boardingPass, images, ...rest } = f as Record<string, unknown>;
      return {
        registration: '',
        seat: '',
        flightClass: '',
        fareClass: '',
        ...rest,
        images: coerceImages(images, boardingPass),
      } as Flight;
    });
  } catch {
    return [];
  }
}

export function useFlights() {
  const [flights, setFlights] = useState<Flight[]>(loadFlights);

  useEffect(() => {
    try {
      localStorage.setItem(FLIGHTS_KEY, JSON.stringify(flights));
    } catch (e) {
      // quota overflow — most likely a large scanned boarding pass. Keep the
      // in-memory log working; the write just doesn't persist this change.
      console.warn('Could not persist flights (storage full?):', e);
    }
  }, [flights]);

  const add = useCallback((f: Flight) => setFlights((p) => [...p, f]), []);
  const update = useCallback(
    (f: Flight) => setFlights((p) => p.map((x) => (x.id === f.id ? f : x))),
    []
  );
  const remove = useCallback(
    (id: string) => setFlights((p) => p.filter((x) => x.id !== id)),
    []
  );
  const replaceAll = useCallback((next: Flight[]) => setFlights(next), []);

  return { flights, add, update, remove, replaceAll };
}

export const DEFAULT_SETTINGS: Settings = {
  fr24Key: '',
  enabledProviders: { fr24: true, adsbdb: true, adsblol: true },
  trackSources: { fr24: true, opensky: true },
  openskyClientId: '',
  openskyClientSecret: '',
  cesiumIonToken: '',
};

function loadSettings(): Settings {
  try {
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Record<
      string,
      unknown
    >;
    const str = (v: unknown) => (typeof v === 'string' ? v : '');
    const enabled = { ...DEFAULT_SETTINGS.enabledProviders };
    const rawEnabled = parsed?.enabledProviders as Record<string, unknown> | undefined;
    for (const id of Object.keys(enabled) as Array<keyof typeof enabled>) {
      if (typeof rawEnabled?.[id] === 'boolean') enabled[id] = rawEnabled[id] as boolean;
    }
    const rawTracks = parsed?.trackSources as Record<string, unknown> | undefined;
    return {
      fr24Key: str(parsed?.fr24Key),
      enabledProviders: enabled,
      trackSources: {
        fr24: typeof rawTracks?.fr24 === 'boolean' ? rawTracks.fr24 : true,
        opensky: typeof rawTracks?.opensky === 'boolean' ? rawTracks.opensky : true,
      },
      openskyClientId: str(parsed?.openskyClientId),
      openskyClientSecret: str(parsed?.openskyClientSecret),
      cesiumIonToken: str(parsed?.cesiumIonToken),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(loadSettings);

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  return [settings, setSettings] as const;
}
