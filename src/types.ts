export interface Flight {
  id: string;
  /** ticketed flight number, e.g. "NZ103"; may be empty for old flights the user no longer remembers */
  flightNo: string;
  /** operating carrier's flight number when flightNo is a codeshare ticket
   *  (e.g. EK5040 operated as QF143) — preferred for lookups and real paths */
  operatedAs?: string;
  airline: string;
  /** IATA code of the departure airport */
  from: string;
  /** IATA code of the arrival airport */
  to: string;
  /** local departure date, YYYY-MM-DD */
  date: string;
  /** local time HH:mm, or '' when unknown */
  depTime: string;
  arrTime: string;
  aircraft: string;
  /** airframe registration, e.g. ZK-OAB */
  registration: string;
  /** e.g. 19A */
  seat: string;
  flightClass: FlightClass;
  /** booking/fare class letter from the ticket, e.g. J, Y, W */
  fareClass: string;
  notes: string;
  /** user-defined extra fields (key → value) — included in JSON/CSV exports */
  custom?: Record<string, string>;
  /** attached images (scanned boarding pass, photos…) as compressed data URLs */
  images?: FlightImage[];
  /** Flightradar24 flight id from lookup — allows re-fetching the real path */
  fr24Id?: string;
  /** recorded flown path [lat, lon, altitude?] (downsampled); drawn instead of the great circle */
  track?: Array<[number, number] | [number, number, number]>;
  /** unit of the track's altitude values, as delivered by the source (never converted) */
  altitudeUnits?: 'ft' | 'm';
}

export interface FlightImage {
  id: string;
  /** downscaled + JPEG-compressed data URL */
  data: string;
  /** optional caption, e.g. "Boarding pass" */
  label?: string;
}

export const FLIGHT_CLASSES = ['Economy', 'Premium Economy', 'Business', 'First'] as const;
/** '' = not recorded */
export type FlightClass = (typeof FLIGHT_CLASSES)[number] | '';

export type LookupProviderId = 'fr24' | 'adsbdb' | 'adsblol';

export interface Settings {
  /** Flightradar24 API token (optional, paid FR24 API subscription) */
  fr24Key: string;
  /** which lookup providers the "Find flight" chain may use */
  enabledProviders: Record<LookupProviderId, boolean>;
  /** sources for fetching the real flown path of a logged flight */
  trackSources: { fr24: boolean; opensky: boolean };
  /** optional free OpenSky account API client — lifts anonymous rate limits */
  openskyClientId: string;
  openskyClientSecret: string;
  /** optional Cesium Ion access token — enables 3D terrain + Bing imagery on
   *  the globe view; without it the globe falls back to Esri imagery + a flat
   *  ellipsoid (no key needed). BYOK — never sent to any backend. */
  cesiumIonToken: string;
}
