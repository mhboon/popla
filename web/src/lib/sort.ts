export function sortByName<T extends { displayName: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.displayName.localeCompare(b.displayName));
}
