/**
 * Standard competition ranking ("1224"): entries tied under `tiedWithPrevious`
 * share the same rank instead of being split across consecutive numbers by
 * array position, and the next distinct rank accounts for the tied group's
 * size (two entries tied for rank 2 pushes the next entry to rank 4, not 3).
 * `items` must already be sorted so ties are adjacent — same convention as
 * infra/lambda/close-matchday's identical (but separate — different TS
 * project, no shared module boundary) implementation.
 */
export function assignCompetitionRank<T>(
  items: T[],
  tiedWithPrevious: (current: T, previous: T) => boolean
): (T & { rank: number })[] {
  let previousRank = 0;
  let previous: T | null = null;
  return items.map((item, index) => {
    const rank = previous !== null && tiedWithPrevious(item, previous) ? previousRank : index + 1;
    previousRank = rank;
    previous = item;
    return { ...item, rank };
  });
}
