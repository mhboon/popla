import type { MatchdayFormat } from '../types/graphql';

interface DatedMatchday {
  date: string;
  startTime?: string | null;
}

const FORMAT_LABELS: Record<MatchdayFormat, string> = {
  MEXICANO: 'Mexicano',
  MEXICANO_SPECIAL: 'Mexicano Special',
  AMERICANO: 'Americano',
};

export function formatMatchdayFormat(format: MatchdayFormat): string {
  return FORMAT_LABELS[format];
}

/** Descending by date, then by start time (for same-day matchdays — rare, but not impossible). */
export function compareMatchdayWhenDesc(a: DatedMatchday, b: DatedMatchday): number {
  if (a.date !== b.date) return b.date.localeCompare(a.date);
  return (b.startTime ?? '').localeCompare(a.startTime ?? '');
}

/** e.g. "2026-08-20 · 19:00", or just the date when no start time was set. */
export function formatMatchdayWhen(matchday: DatedMatchday): string {
  return matchday.startTime ? `${matchday.date} · ${matchday.startTime.slice(0, 5)}` : matchday.date;
}
