/**
 * Translation Memory — Persistent Cross-Session Storage
 *
 * Stores translation pairs in IndexedDB for cross-session consistency.
 * Auto-prunes oldest entries when a new card is loaded.
 *
 * Uses the existing IDB utility from idb.ts.
 */

import { IDB } from './idb';
import type { TranslationField } from '../types/card';

/* ─── Types ─── */

export interface TranslationMemoryEntry {
  /** Hash of first 200 chars of source text (for exact lookup) */
  sourceHash: string;
  /** First 120 chars of source for display */
  sourceExcerpt: string;
  /** Full translated text */
  translated: string;
  /** Field group: core, lorebook, regex, etc. */
  fieldGroup: string;
  /** Card file name this came from */
  cardName: string;
  /** Unix timestamp */
  timestamp: number;
}

export interface TranslationMemoryHit {
  sourceExcerpt: string;
  translatedExcerpt: string;
  similarity: number;
  cardName: string;
}

/* ─── Constants ─── */

const TM_IDB_KEY = 'st-translator-tm-store';
const TM_MAX_ENTRIES = 5000;
const TM_PRUNE_TARGET = 4000; // After pruning, keep this many

/* ─── Hash utility ─── */

function simpleHash(text: string): string {
  // DJB2 hash — fast, good distribution for short strings
  let hash = 5381;
  const sample = text.slice(0, 200);
  for (let i = 0; i < sample.length; i++) {
    hash = ((hash << 5) + hash + sample.charCodeAt(i)) & 0xFFFFFFFF;
  }
  return hash.toString(36);
}

/* ─── Core API ─── */

let memoryCache: TranslationMemoryEntry[] | null = null;

/** Load TM from IDB into memory cache */
async function ensureLoaded(): Promise<TranslationMemoryEntry[]> {
  if (memoryCache !== null) return memoryCache;
  const stored = await IDB.get<TranslationMemoryEntry[] | null>(TM_IDB_KEY, null);
  memoryCache = stored || [];
  return memoryCache;
}

/** Persist memory cache back to IDB */
async function persist(): Promise<void> {
  if (memoryCache !== null) {
    await IDB.set(TM_IDB_KEY, memoryCache);
  }
}

/**
 * Store a translated field in Translation Memory.
 * Called automatically when a field finishes translation (status === 'done').
 */
export async function storeTranslation(
  field: TranslationField,
  cardName: string,
): Promise<void> {
  if (!field.original?.trim() || !field.translated?.trim()) return;
  // Skip very short content (not useful for TM)
  if (field.original.length < 20) return;

  const entries = await ensureLoaded();
  const hash = simpleHash(field.original);

  // Update existing entry if same hash exists
  const existingIdx = entries.findIndex(e => e.sourceHash === hash);
  const entry: TranslationMemoryEntry = {
    sourceHash: hash,
    sourceExcerpt: field.original.slice(0, 120),
    translated: field.translated,
    fieldGroup: field.group,
    cardName,
    timestamp: Date.now(),
  };

  if (existingIdx !== -1) {
    entries[existingIdx] = entry;
  } else {
    entries.push(entry);
  }

  memoryCache = entries;
  // Debounced persist — don't block the translation loop
  IDB.setDebounced(TM_IDB_KEY, entries, 5000);
}

/**
 * Batch store multiple fields at once (call after translation completes).
 */
export async function storeTranslationBatch(
  fields: TranslationField[],
  cardName: string,
): Promise<void> {
  const doneFields = fields.filter(f =>
    f.status === 'done' && f.original?.trim() && f.translated?.trim() && f.original.length >= 20
  );
  if (doneFields.length === 0) return;

  const entries = await ensureLoaded();

  for (const field of doneFields) {
    const hash = simpleHash(field.original);
    const existingIdx = entries.findIndex(e => e.sourceHash === hash);
    const entry: TranslationMemoryEntry = {
      sourceHash: hash,
      sourceExcerpt: field.original.slice(0, 120),
      translated: field.translated,
      fieldGroup: field.group,
      cardName,
      timestamp: Date.now(),
    };

    if (existingIdx !== -1) {
      entries[existingIdx] = entry;
    } else {
      entries.push(entry);
    }
  }

  memoryCache = entries;
  await persist();
}

/**
 * Look up Translation Memory for a field being translated.
 * Returns hits sorted by similarity (highest first).
 */
export async function lookupTranslationMemory(
  field: TranslationField,
  maxHits: number = 5,
): Promise<TranslationMemoryHit[]> {
  if (!field.original?.trim() || field.original.length < 20) return [];

  const entries = await ensureLoaded();
  if (entries.length === 0) return [];

  const hash = simpleHash(field.original);
  const hits: TranslationMemoryHit[] = [];

  // 1. Exact hash match
  const exactMatch = entries.find(e => e.sourceHash === hash);
  if (exactMatch) {
    hits.push({
      sourceExcerpt: exactMatch.sourceExcerpt,
      translatedExcerpt: exactMatch.translated.slice(0, 200),
      similarity: 1.0,
      cardName: exactMatch.cardName,
    });
  }

  // 2. Near-match via CJK bigram overlap on excerpts
  if (hits.length < maxHits) {
    const currentBigrams = extractCjkBigrams(field.original.slice(0, 300));
    if (currentBigrams.size > 0) {
      const scored: { entry: TranslationMemoryEntry; sim: number }[] = [];

      for (const entry of entries) {
        if (entry.sourceHash === hash) continue; // Already added
        if (entry.fieldGroup !== field.group) continue; // Same group only

        const entryBigrams = extractCjkBigrams(entry.sourceExcerpt);
        if (entryBigrams.size === 0) continue;

        const sim = bigramOverlap(currentBigrams, entryBigrams);
        if (sim >= 0.4) {
          scored.push({ entry, sim });
        }
      }

      scored.sort((a, b) => b.sim - a.sim);
      for (const s of scored.slice(0, maxHits - hits.length)) {
        hits.push({
          sourceExcerpt: s.entry.sourceExcerpt,
          translatedExcerpt: s.entry.translated.slice(0, 200),
          similarity: Math.round(s.sim * 100) / 100,
          cardName: s.entry.cardName,
        });
      }
    }
  }

  return hits;
}

/**
 * Auto-prune Translation Memory.
 * Called when a new card is loaded.
 * Removes oldest entries to stay under TM_MAX_ENTRIES.
 */
export async function autoPruneTranslationMemory(): Promise<number> {
  const entries = await ensureLoaded();
  if (entries.length <= TM_MAX_ENTRIES) return 0;

  // Sort by timestamp descending (newest first) and keep TM_PRUNE_TARGET
  entries.sort((a, b) => b.timestamp - a.timestamp);
  const pruned = entries.length - TM_PRUNE_TARGET;
  memoryCache = entries.slice(0, TM_PRUNE_TARGET);
  await persist();
  return pruned;
}

/**
 * Clear all Translation Memory entries.
 */
export async function clearTranslationMemory(): Promise<void> {
  memoryCache = [];
  await IDB.remove(TM_IDB_KEY);
}

/**
 * Get Translation Memory stats.
 */
export async function getTranslationMemoryStats(): Promise<{
  totalEntries: number;
  uniqueCards: number;
  oldestTimestamp: number | null;
}> {
  const entries = await ensureLoaded();
  const uniqueCards = new Set(entries.map(e => e.cardName)).size;
  const oldest = entries.length > 0
    ? Math.min(...entries.map(e => e.timestamp))
    : null;
  return { totalEntries: entries.length, uniqueCards, oldestTimestamp: oldest };
}

/* ─── Internal helpers ─── */

function extractCjkBigrams(text: string): Set<string> {
  const bigrams = new Set<string>();
  const cjkChars = text.match(/[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g);
  if (cjkChars && cjkChars.length >= 2) {
    for (let i = 0; i < cjkChars.length - 1; i++) {
      bigrams.add(cjkChars[i] + cjkChars[i + 1]);
    }
  }
  return bigrams;
}

function bigramOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
  for (const item of smaller) {
    if (larger.has(item)) intersection++;
  }
  // Dice coefficient: 2*|A∩B| / (|A|+|B|)
  return (2 * intersection) / (a.size + b.size);
}
