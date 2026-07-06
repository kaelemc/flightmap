import { matchSorter, rankings } from 'match-sorter';
import type { Flight } from '../types';
import { getAirport } from '../data/airports';

// fields the filter box searches — codes, names, cities, countries, dates,
// aircraft, notes and custom fields, so queries like "Australia" or
// "Qantas 2025" work. Shared/viewer flights simply leave the private fields
// (seat/class/fare/notes/custom) empty, so those keys are harmless there.
export const SEARCH_KEYS = [
  'flightNo',
  (f: Flight) => f.operatedAs ?? '',
  'airline',
  'from',
  'to',
  (f: Flight) => getAirport(f.from)?.city ?? '',
  (f: Flight) => getAirport(f.to)?.city ?? '',
  (f: Flight) => getAirport(f.from)?.country ?? '',
  (f: Flight) => getAirport(f.to)?.country ?? '',
  (f: Flight) => getAirport(f.from)?.name ?? '',
  (f: Flight) => getAirport(f.to)?.name ?? '',
  'date',
  'aircraft',
  'registration',
  'seat',
  'flightClass',
  'fareClass',
  'notes',
  (f: Flight) => Object.values(f.custom ?? {}).join(' '),
];

/**
 * Filter a pre-sorted flight list by a free-text query. Every whitespace-
 * separated word must match some field (AND) — "Qantas 2025" needs both.
 * match-sorter ranks, but the log is grouped by year downstream, so we keep
 * the incoming order rather than the relevance order.
 */
export function filterFlights(sorted: Flight[], query: string): Flight[] {
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return sorted;
  const matched = new Set(
    words
      .reduceRight(
        (res, word) => matchSorter(res, word, { keys: SEARCH_KEYS, threshold: rankings.CONTAINS }),
        sorted
      )
      .map((f) => f.id)
  );
  return sorted.filter((f) => matched.has(f.id));
}
