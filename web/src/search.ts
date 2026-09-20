/** Player search for the lineup editor. Runs against the local directory; nothing is sent anywhere. */

import { normName } from "./core.ts";
import type { Directory, DirectoryEntry } from "./lineup.ts";

export interface SearchIndexEntry {
  id: string;
  entry: DirectoryEntry;
  words: string[];
}

export function buildIndex(directory: Directory): SearchIndexEntry[] {
  return Object.entries(directory)
    .filter(([, entry]) => entry.team && entry.active !== false)
    .map(([id, entry]) => ({ id, entry, words: entry.name.split(/\s+/).map(normName).filter(Boolean) }));
}

/** Each typed word must start a different word of the name; longer typed words claim theirs first. */
function matches(words: string[], typed: string[]): boolean {
  const unused = [...words];
  for (const part of [...typed].sort((a, b) => b.length - a.length)) {
    const at = unused.findIndex((w) => w.startsWith(part));
    if (at < 0) return false;
    unused.splice(at, 1);
  }
  return true;
}

/**
 * Match every typed word against the start of a name word, so "jef" and
 * "justin j" both find Justin Jefferson. Whole-name prefixes rank first.
 */
export function searchPlayers(index: SearchIndexEntry[], query: string, limit = 8): SearchIndexEntry[] {
  const typed = query.split(/\s+/).map(normName).filter(Boolean);
  if (!typed.length) return [];
  const joined = typed.join("");
  const scored: { item: SearchIndexEntry; score: number }[] = [];
  for (const item of index) {
    if (!matches(item.words, typed)) continue;
    scored.push({ item, score: item.words.join("").startsWith(joined) ? 0 : 1 });
  }
  return scored
    .sort((a, b) => a.score - b.score || a.item.entry.name.localeCompare(b.item.entry.name))
    .slice(0, limit)
    .map((s) => s.item);
}
