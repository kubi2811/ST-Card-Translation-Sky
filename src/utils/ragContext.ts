import type { TranslationField, GlossaryEntry } from '../types/card';

/* ══════════════════════════════════════════════════════════════════
 *  Unified RAG Context Engine v2
 *  ─────────────────────────────
 *  Tổng hợp TẤT CẢ nguồn context thành 1 unified block duy nhất:
 *    1. Custom Schema      → Cấu trúc biến / format  
 *    2. Glossary            → Bảng thuật ngữ bắt buộc (smart fuzzy match)
 *    3. MVU Dictionary      → Biến Strategy B (MVU/Zod)  
 *    4. Cross-field Context → TF-IDF + Tiered retrieval
 *    5. Translation Memory  → Cross-session consistency (optional)
 *
 *  Upgrades over v1:
 *    - TF-IDF weighted cosine similarity (replaces overlap coefficient)
 *    - Tiered structural retrieval (must-include → high-priority → similarity)
 *    - Adaptive char/field budget based on field type
 *    - Smart glossary matching (exact → substring → group)
 *    - Debug info output for transparency
 *
 *  Hoàn toàn client-side, không cần vector DB hay extra API call.
 * ══════════════════════════════════════════════════════════════════ */

/* ─── Types ─── */

export interface RAGDebugInfo {
  selectedFields: { path: string; label: string; score: number; tier: string }[];
  glossaryHits: { term: string; matchType: 'exact' | 'substring' | 'reverse' | 'group' | 'global' }[];
  budgetUsed: { chars: number; maxChars: number; fields: number; maxFields: number };
  computeTimeMs: number;
  tfidfTermCount: number;
}

export interface RAGBuildResult {
  contextString: string;
  debugInfo: RAGDebugInfo;
}

/* ─── Feature extraction ─── */

interface FieldFeatures {
  /** CJK character bigrams */
  cjkBigrams: Map<string, number>;
  /** Latin/Cyrillic words (lowercased) */
  words: Map<string, number>;
  /** {{macro}} placeholders */
  placeholders: Set<string>;
  /** Non-standard HTML/XML tags */
  tags: Set<string>;
  /** Capitalized proper nouns */
  properNouns: Set<string>;
}

const featureCache = new Map<string, FieldFeatures>();

/** Document frequency: term → number of fields containing it */
let dfMap: Map<string, number> | null = null;
/** Total number of documents used to build dfMap */
let dfDocCount = 0;

export function clearRAGCache(): void {
  featureCache.clear();
  dfMap = null;
  dfDocCount = 0;
}

function extractFeatures(text: string): FieldFeatures {
  const cjkBigrams = new Map<string, number>();
  const words = new Map<string, number>();
  const placeholders = new Set<string>();
  const tags = new Set<string>();
  const properNouns = new Set<string>();

  // CJK bigrams with frequency count
  const cjkChars = text.match(/[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g);
  if (cjkChars && cjkChars.length >= 2) {
    for (let i = 0; i < cjkChars.length - 1; i++) {
      const bigram = cjkChars[i] + cjkChars[i + 1];
      cjkBigrams.set(bigram, (cjkBigrams.get(bigram) || 0) + 1);
    }
  }

  // Words with frequency count
  const wordMatches = text.match(/[a-zA-ZÀ-ÿ\u0400-\u04ff]{3,}/g);
  if (wordMatches) {
    for (const w of wordMatches) {
      const lw = w.toLowerCase();
      words.set(lw, (words.get(lw) || 0) + 1);
    }
  }

  // Placeholders
  const phMatches = text.match(/\{\{[^}]+\}\}/g);
  if (phMatches) {
    for (const p of phMatches) placeholders.add(p);
  }

  // Custom tags
  const HTML_STANDARD_TAGS = new Set([
    'div', 'span', 'p', 'br', 'hr', 'style', 'script', 'table', 'tr', 'td', 'th',
    'ul', 'ol', 'li', 'a', 'img', 'b', 'i', 'em', 'strong', 'h1', 'h2', 'h3', 'h4',
    'h5', 'h6', 'html', 'head', 'body', 'meta', 'link', 'input', 'button', 'form',
    'select', 'option', 'label', 'textarea', 'section', 'article', 'nav', 'header',
    'footer', 'main', 'aside',
  ]);
  const tagMatches = text.match(/<\/?([A-Za-z_][\w-]*)/g);
  if (tagMatches) {
    for (const t of tagMatches) {
      const name = t.replace(/^<\/?/, '').toLowerCase();
      if (name.length > 1 && !HTML_STANDARD_TAGS.has(name)) {
        tags.add(name);
      }
    }
  }

  // Proper nouns
  const pnMatches = text.match(/[A-Z][a-zÀ-ÿ]{2,}(?:\s+[A-Z][a-zÀ-ÿ]{2,})*/g);
  if (pnMatches) {
    for (const n of pnMatches) properNouns.add(n);
  }

  return { cjkBigrams, words, placeholders, tags, properNouns };
}

function getFeaturesFor(field: TranslationField): FieldFeatures {
  const cached = featureCache.get(field.path);
  if (cached) return cached;
  const features = extractFeatures(field.original);
  featureCache.set(field.path, features);
  return features;
}

/* ─── TF-IDF Document Frequency ─── */

/** Build document frequency map across all fields (call once per translation session) */
function ensureDFMap(allFields: TranslationField[]): void {
  // Rebuild if field count changed (new card loaded or fields added)
  if (dfMap && dfDocCount === allFields.length) return;

  dfMap = new Map<string, number>();
  dfDocCount = allFields.length;

  for (const field of allFields) {
    const features = getFeaturesFor(field);
    const seen = new Set<string>();

    // Count each unique term once per document
    for (const term of features.cjkBigrams.keys()) {
      if (!seen.has(term)) {
        seen.add(term);
        dfMap.set(term, (dfMap.get(term) || 0) + 1);
      }
    }
    for (const term of features.words.keys()) {
      if (!seen.has(term)) {
        seen.add(term);
        dfMap.set(term, (dfMap.get(term) || 0) + 1);
      }
    }
  }
}

/** Calculate IDF for a term: log(N / df) */
function idf(term: string): number {
  if (!dfMap || dfDocCount === 0) return 1;
  const df = dfMap.get(term) || 0;
  if (df === 0) return 1;
  return Math.log(dfDocCount / df) + 1; // +1 smoothing to avoid log(1)=0
}

/* ─── TF-IDF Cosine Similarity ─── */

function tfidfCosineSimilarity(
  aFeatures: FieldFeatures,
  bFeatures: FieldFeatures,
): number {
  // Merge CJK bigrams and words into unified term vectors
  const aTerms = new Map<string, number>();
  const bTerms = new Map<string, number>();

  // CJK bigrams (weight 1.5x)
  for (const [term, freq] of aFeatures.cjkBigrams) {
    aTerms.set(term, (aTerms.get(term) || 0) + freq * 1.5);
  }
  for (const [term, freq] of bFeatures.cjkBigrams) {
    bTerms.set(term, (bTerms.get(term) || 0) + freq * 1.5);
  }

  // Words
  for (const [term, freq] of aFeatures.words) {
    aTerms.set(term, (aTerms.get(term) || 0) + freq);
  }
  for (const [term, freq] of bFeatures.words) {
    bTerms.set(term, (bTerms.get(term) || 0) + freq);
  }

  if (aTerms.size === 0 || bTerms.size === 0) return 0;

  // Compute TF-IDF weighted dot product and magnitudes
  let dotProduct = 0;
  let aMag = 0;
  let bMag = 0;

  // Iterate over smaller set for efficiency
  const [smaller, larger, isSwapped] = aTerms.size <= bTerms.size
    ? [aTerms, bTerms, false]
    : [bTerms, aTerms, true];

  for (const [term, sFreq] of smaller) {
    const lFreq = larger.get(term);
    const termIdf = idf(term);
    const sWeight = sFreq * termIdf;
    aMag += isSwapped ? 0 : sWeight * sWeight;
    bMag += isSwapped ? sWeight * sWeight : 0;
    if (lFreq !== undefined) {
      const lWeight = lFreq * termIdf;
      dotProduct += sWeight * lWeight;
    }
  }

  // Compute full magnitudes
  for (const [term, freq] of aTerms) {
    const w = freq * idf(term);
    if (isSwapped || !smaller.has(term)) {
      // Already counted in smaller loop if not swapped
    }
    aMag += w * w;
  }
  for (const [term, freq] of bTerms) {
    const w = freq * idf(term);
    bMag += w * w;
  }

  // Recompute magnitudes properly (simpler, correct approach)
  aMag = 0;
  bMag = 0;
  for (const [term, freq] of aTerms) {
    const w = freq * idf(term);
    aMag += w * w;
  }
  for (const [term, freq] of bTerms) {
    const w = freq * idf(term);
    bMag += w * w;
  }

  const denominator = Math.sqrt(aMag) * Math.sqrt(bMag);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

/** Legacy overlap coefficient for placeholders/tags (small sets, no TF-IDF needed) */
function overlapCoefficient(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
  for (const item of smaller) {
    if (larger.has(item)) intersection++;
  }
  return intersection / smaller.size;
}

function calculateSimilarity(currentFeatures: FieldFeatures, candidateFeatures: FieldFeatures): number {
  let score = 0;
  let weightSum = 0;

  // TF-IDF cosine similarity for text content (primary signal)
  const tfidfScore = tfidfCosineSimilarity(currentFeatures, candidateFeatures);
  if (tfidfScore > 0) {
    score += tfidfScore * 6;
    weightSum += 6;
  }

  // Placeholder overlap (high importance — shared macros mean related logic)
  if (currentFeatures.placeholders.size > 0 || candidateFeatures.placeholders.size > 0) {
    score += overlapCoefficient(currentFeatures.placeholders, candidateFeatures.placeholders) * 5;
    weightSum += 5;
  }

  // Custom tag overlap (structural similarity)
  if (currentFeatures.tags.size > 0 || candidateFeatures.tags.size > 0) {
    score += overlapCoefficient(currentFeatures.tags, candidateFeatures.tags) * 4;
    weightSum += 4;
  }

  // Proper noun overlap
  if (currentFeatures.properNouns.size > 0 || candidateFeatures.properNouns.size > 0) {
    score += overlapCoefficient(currentFeatures.properNouns, candidateFeatures.properNouns) * 3;
    weightSum += 3;
  }

  return weightSum > 0 ? score / weightSum : 0;
}

/* ─── Adaptive Budget ─── */

interface AdaptiveBudget {
  maxChars: number;
  maxFields: number;
}

/**
 * Determine optimal RAG budget based on field type.
 * Code-heavy fields get significantly more context because they need
 * variable sync references. Narrative fields need less.
 */
function getAdaptiveBudget(
  field: TranslationField,
  userMaxChars?: number,
  userMaxFields?: number,
): AdaptiveBudget {
  // User override always wins
  if (userMaxChars && userMaxFields) {
    return { maxChars: userMaxChars, maxFields: userMaxFields };
  }

  const group = field.group;
  const entryType = field.entryType;

  // Initvar/controller/mvu_logic: MUST include schema + all related entries
  if (entryType === 'initvar' || entryType === 'controller' || entryType === 'mvu_logic') {
    return {
      maxChars: userMaxChars || 8000,
      maxFields: userMaxFields || 12,
    };
  }

  // Regex & TavernHelper: need lots of context for variable sync
  if (group === 'regex' || group === 'tavern_helper') {
    return {
      maxChars: userMaxChars || 6000,
      maxFields: userMaxFields || 10,
    };
  }

  // Lorebook (non-logic): moderate context
  if (group === 'lorebook') {
    return {
      maxChars: userMaxChars || 4000,
      maxFields: userMaxFields || 7,
    };
  }

  // System/depth prompts: moderate
  if (group === 'system' || group === 'depth_prompt') {
    return {
      maxChars: userMaxChars || 3500,
      maxFields: userMaxFields || 6,
    };
  }

  // Narrative (core, messages, creator): lighter context
  return {
    maxChars: userMaxChars || 3000,
    maxFields: userMaxFields || 5,
  };
}

/* ─── Smart Glossary Matching ─── */

interface GlossaryMatch {
  entry: GlossaryEntry;
  matchType: 'exact' | 'substring' | 'reverse' | 'group' | 'global';
}

function smartGlossaryMatch(
  currentText: string,
  glossary: GlossaryEntry[],
): GlossaryMatch[] {
  const textLower = currentText.toLowerCase();
  const matches: GlossaryMatch[] = [];
  const matchedSources = new Set<string>();

  // Pass 1: Exact match (source term found in current text)
  for (const g of glossary) {
    const sourceLower = g.source.toLowerCase();
    if (textLower.includes(sourceLower)) {
      matches.push({ entry: g, matchType: 'exact' });
      matchedSources.add(sourceLower);
    }
  }

  // Pass 2: Substring match (source is substring of a word in text, or vice versa)
  for (const g of glossary) {
    const sourceLower = g.source.toLowerCase();
    if (matchedSources.has(sourceLower)) continue;

    // Check if any glossary source is a substring of text words (fuzzy)
    // E.g., "金丹" matches text containing "金丹期"
    const hasSubstring = glossary.some(other => {
      const otherLower = other.source.toLowerCase();
      return otherLower !== sourceLower &&
        otherLower.includes(sourceLower) &&
        textLower.includes(otherLower);
    });
    if (hasSubstring) {
      matches.push({ entry: g, matchType: 'substring' });
      matchedSources.add(sourceLower);
      continue;
    }

    // Check if source contains a word that's in the text
    if (sourceLower.length >= 2) {
      // For CJK: check if any 2-char substring of source appears in text
      const hasCjk = /[\u4e00-\u9fff]/.test(sourceLower);
      if (hasCjk && sourceLower.length >= 2) {
        for (let i = 0; i < sourceLower.length - 1; i++) {
          const sub = sourceLower.slice(i, i + 2);
          if (textLower.includes(sub)) {
            matches.push({ entry: g, matchType: 'substring' });
            matchedSources.add(sourceLower);
            break;
          }
        }
      }
    }
  }

  // Pass 3: Reverse match (translated term found in current text — already partially translated)
  for (const g of glossary) {
    const sourceLower = g.source.toLowerCase();
    if (matchedSources.has(sourceLower)) continue;

    const targetLower = g.target.toLowerCase();
    if (targetLower.length >= 2 && textLower.includes(targetLower)) {
      matches.push({ entry: g, matchType: 'reverse' });
      matchedSources.add(sourceLower);
    }
  }

  // Pass 4: Group match — if we matched one term from a semantic group, include siblings
  // Detect groups by shared suffix/prefix (e.g., "练气期", "筑基期", "金丹期" share "期")
  const exactSources = matches
    .filter(m => m.matchType === 'exact')
    .map(m => m.entry.source);

  if (exactSources.length > 0) {
    for (const g of glossary) {
      const sourceLower = g.source.toLowerCase();
      if (matchedSources.has(sourceLower)) continue;

      for (const matched of exactSources) {
        // Share a 2+ char suffix or prefix
        const mLow = matched.toLowerCase();
        if (mLow.length >= 3 && sourceLower.length >= 3) {
          const sharedSuffix = mLow.length >= 2 && sourceLower.length >= 2 &&
            mLow.slice(-2) === sourceLower.slice(-2);
          const sharedPrefix = mLow.length >= 2 && sourceLower.length >= 2 &&
            mLow.slice(0, 2) === sourceLower.slice(0, 2);
          if (sharedSuffix || sharedPrefix) {
            matches.push({ entry: g, matchType: 'group' });
            matchedSources.add(sourceLower);
            break;
          }
        }
      }
    }
  }

  // Pass 5: Remaining as global terms
  for (const g of glossary) {
    const sourceLower = g.source.toLowerCase();
    if (!matchedSources.has(sourceLower)) {
      matches.push({ entry: g, matchType: 'global' });
    }
  }

  return matches;
}

/* ─── Unified RAG Context Engine ─── */

export interface UnifiedRAGInput {
  /** Field đang dịch */
  currentField: TranslationField;
  /** Tất cả field trong card */
  allFields: TranslationField[];
  /** Glossary (bảng thuật ngữ) — từ TranslationConfig */
  glossary?: GlossaryEntry[];
  /** MVU/Zod Dictionary — từ Strategy B */
  mvuDictionary?: Record<string, string>;
  /** Custom Schema text — từ TranslationConfig */
  customSchema?: string;
  /** Entry name dictionary for EJS sync: original entry name → translated name */
  entryNameDictionary?: Record<string, string>;
  /** Cấu hình RAG */
  maxFields?: number;
  maxChars?: number;
  /** Translation Memory entries (from IDB, optional) */
  translationMemory?: TranslationMemoryHit[];
}

/** Translation Memory hit from cross-session lookup */
export interface TranslationMemoryHit {
  sourceExcerpt: string;
  translatedExcerpt: string;
  similarity: number;
  cardName: string;
}

interface ScoredField {
  field: TranslationField;
  score: number;
  tier: 'must-include' | 'high-priority' | 'similarity';
}

/**
 * Tạo unified context block tổng hợp tất cả nguồn context.
 * Backward-compatible: returns string only.
 */
export function buildUnifiedRAGContext(input: UnifiedRAGInput): string {
  return buildUnifiedRAGContextWithDebug(input).contextString;
}

/**
 * Tạo unified context block + debug info.
 * Full version with RAGBuildResult return type.
 */
export function buildUnifiedRAGContextWithDebug(input: UnifiedRAGInput): RAGBuildResult {
  const startTime = performance.now();

  const {
    currentField,
    allFields,
    glossary,
    mvuDictionary,
    customSchema,
    translationMemory,
  } = input;

  // Adaptive budget
  const budget = getAdaptiveBudget(currentField, input.maxChars, input.maxFields);
  const maxFields = budget.maxFields;
  const maxChars = budget.maxChars;

  // Build TF-IDF document frequency map
  ensureDFMap(allFields);

  const sections: string[] = [];
  let totalChars = 0;
  const charBudget = maxChars;

  // Debug collectors
  const debugSelectedFields: RAGDebugInfo['selectedFields'] = [];
  const debugGlossaryHits: RAGDebugInfo['glossaryHits'] = [];

  // Collect all terms already covered by glossary + MVU to avoid duplication
  const coveredTerms = new Set<string>();

  // ══════════════════════════════════════════════════════════
  // SECTION 1: Custom Schema
  // ══════════════════════════════════════════════════════════
  if (customSchema && customSchema.trim()) {
    const schemaTrunc = truncate(customSchema.trim(), Math.min(2000, Math.floor(charBudget * 0.3)));
    const section = `═══ CARD SCHEMA / FORMAT RULES ═══\n${schemaTrunc}`;
    sections.push(section);
    totalChars += section.length;

    // Extract terms from schema to avoid duplication
    const schemaWords = customSchema.match(/[a-zA-ZÀ-ÿ\u4e00-\u9fff]{2,}/g);
    if (schemaWords) schemaWords.forEach(w => coveredTerms.add(w.toLowerCase()));
  }

  // ══════════════════════════════════════════════════════════
  // SECTION 2: Glossary — Smart Fuzzy Matching
  // ══════════════════════════════════════════════════════════
  const validGlossary = (glossary || []).filter(g => g.source.trim() && g.target.trim());
  if (validGlossary.length > 0) {
    const matches = smartGlossaryMatch(currentField.original, validGlossary);

    // Track covered terms
    for (const m of matches) {
      coveredTerms.add(m.entry.source.toLowerCase());
      coveredTerms.add(m.entry.target.toLowerCase());
      debugGlossaryHits.push({ term: m.entry.source, matchType: m.matchType });
    }

    const exact = matches.filter(m => m.matchType === 'exact');
    const related = matches.filter(m => m.matchType === 'substring' || m.matchType === 'reverse' || m.matchType === 'group');
    const global = matches.filter(m => m.matchType === 'global');

    if (exact.length > 0 || related.length > 0 || global.length > 0) {
      let section = '═══ MANDATORY TERMINOLOGY ═══';

      if (exact.length > 0) {
        section += '\n⚡ EXACT match in current text — MUST use:';
        for (const m of exact) {
          section += `\n  "${m.entry.source}" → "${m.entry.target}"`;
        }
      }

      if (related.length > 0) {
        section += '\n📎 Related terms (partial/group match — use when applicable):';
        for (const m of related) {
          section += `\n  "${m.entry.source}" → "${m.entry.target}"`;
        }
      }

      if (global.length > 0) {
        section += '\n📋 Global terms — use when applicable:';
        for (const m of global) {
          section += `\n  "${m.entry.source}" → "${m.entry.target}"`;
        }
      }

      sections.push(section);
      totalChars += section.length;
    }
  }

  // ══════════════════════════════════════════════════════════
  // SECTION 3: MVU/Zod Variable Dictionary (Strategy B)
  // ══════════════════════════════════════════════════════════
  if (mvuDictionary && Object.keys(mvuDictionary).length > 0) {
    const mvuEntries = Object.entries(mvuDictionary).filter(([k, v]) => k && v && k !== v);
    if (mvuEntries.length > 0) {
      for (const [k, v] of mvuEntries) {
        coveredTerms.add(k.toLowerCase());
        coveredTerms.add(v.toLowerCase());
      }

      const isLogicField = ['tavern_helper', 'regex', 'lorebook'].includes(currentField.group);
      const dictList = mvuEntries.map(([k, v]) => `  "${k}" → "${v}"`).join('\n');

      let section: string;
      if (isLogicField) {
        section =
          '═══ MVU/ZOD VARIABLE REPLACEMENT (CRITICAL) ═══\n' +
          'This card uses MVU/Zod variables. REPLACE these variable names EVERYWHERE:\n' +
          dictList + '\n' +
          'Rules:\n' +
          '- Replace ALL occurrences: {{getvar::}}, {{setvar::}}, data-var, YAML keys, z.object fields\n' +
          '- Variable names may use natural spacing. CONSISTENCY is the only rule \u2014 same variable = identical string everywhere\n' +
          '- In JS/Zod code, use QUOTED string keys for multi-word names: { "Tên biến": z.string() }\n' +
          '- Use EXACTLY the mapped translation — do NOT invent your own';
      } else {
        section =
          '═══ MVU/ZOD VARIABLE DICTIONARY (MANDATORY) ═══\n' +
          'This card uses MVU variables. When you encounter ANY of these original variable names, REPLACE them with the translation:\n' +
          dictList + '\n' +
          '- Variable names may use natural spacing. CONSISTENCY is mandatory \u2014 same variable = identical string everywhere\n' +
          '- Apply in macros ({{getvar::NAME}}), data-var attributes, and all contexts\n' +
          '- Use EXACTLY the dictionary translation — do NOT invent alternatives';
      }
      sections.push(section);
      totalChars += section.length;
    }
  }

  // ══════════════════════════════════════════════════════════
  // SECTION 3b: Entry Name Dictionary (EJS Auto-Trigger Sync)
  // ══════════════════════════════════════════════════════════
  if (input.entryNameDictionary) {
    const entryNameEntries = Object.entries(input.entryNameDictionary)
      .filter(([k, v]) => k && v && k !== v);
    if (entryNameEntries.length > 0) {
      for (const [k, v] of entryNameEntries) {
        coveredTerms.add(k.toLowerCase());
        coveredTerms.add(v.toLowerCase());
      }

      const dictList = entryNameEntries.map(([k, v]) => `  "${k}" → "${v}"`).join('\n');
      const section = '═══ ENTRY NAME DICTIONARY (EJS SYNC) ═══\n' +
        'SillyTavern auto-loads lorebook entries when their EXACT NAME appears in text.\n' +
        'When translating, replace original entry names with their translated equivalents:\n' +
        dictList + '\n' +
        'A mismatch = the entry will NEVER be loaded at runtime.';
      sections.push(section);
      totalChars += section.length;
    }
  }

  // ══════════════════════════════════════════════════════════
  // SECTION 4: Cross-field Translation Context (Tiered + TF-IDF)
  // ══════════════════════════════════════════════════════════
  const remainingBudget = Math.max(500, charBudget - totalChars);
  const crossFieldResult = buildCrossFieldSection(
    currentField,
    allFields,
    coveredTerms,
    maxFields,
    remainingBudget,
  );
  if (crossFieldResult) {
    sections.push(crossFieldResult.text);
    debugSelectedFields.push(...crossFieldResult.selectedFields);
  }

  // ══════════════════════════════════════════════════════════
  // SECTION 5: Translation Memory (Cross-session)
  // ══════════════════════════════════════════════════════════
  if (translationMemory && translationMemory.length > 0) {
    const tmBudget = Math.min(1500, Math.max(300, charBudget - totalChars));
    let tmSection = '═══ TRANSLATION MEMORY (CROSS-SESSION REFERENCE) ═══\n' +
      'Previously translated similar content from other cards:\n';
    let tmChars = tmSection.length;

    for (const tm of translationMemory.slice(0, 5)) {
      const line = `• [${tm.cardName}] "${truncate(tm.sourceExcerpt, 100)}" → "${truncate(tm.translatedExcerpt, 150)}" (${Math.round(tm.similarity * 100)}% match)\n`;
      if (tmChars + line.length > tmBudget) break;
      tmSection += line;
      tmChars += line.length;
    }

    if (tmChars > tmSection.indexOf('\n') + 1) {
      sections.push(tmSection.trim());
    }
  }

  // ══════════════════════════════════════════════════════════
  // FINAL ASSEMBLY
  // ══════════════════════════════════════════════════════════
  const computeTimeMs = Math.round(performance.now() - startTime);

  if (sections.length === 0) {
    return {
      contextString: '',
      debugInfo: {
        selectedFields: debugSelectedFields,
        glossaryHits: debugGlossaryHits,
        budgetUsed: { chars: 0, maxChars, fields: 0, maxFields },
        computeTimeMs,
        tfidfTermCount: dfMap?.size || 0,
      },
    };
  }

  const contextString =
    '\n\n' +
    sections.join('\n\n') +
    '\n\n═══ CONSISTENCY RULE ═══\n' +
    'Maintain the SAME translations for character names, place names, special terms, ' +
    'variables, and writing style shown in ALL sections above. Do NOT invent different ' +
    'translations for terms that already have established translations.';

  return {
    contextString,
    debugInfo: {
      selectedFields: debugSelectedFields,
      glossaryHits: debugGlossaryHits,
      budgetUsed: {
        chars: contextString.length,
        maxChars,
        fields: debugSelectedFields.length,
        maxFields,
      },
      computeTimeMs,
      tfidfTermCount: dfMap?.size || 0,
    },
  };
}

/**
 * Build cross-field context section using tiered retrieval + TF-IDF.
 *
 * Tier 1 (Must-include):  Core fields + same-entry fields
 * Tier 2 (High-priority): Schema/controller fields when translating code
 * Tier 3 (Similarity):    TF-IDF ranked candidates
 */
function buildCrossFieldSection(
  currentField: TranslationField,
  allFields: TranslationField[],
  coveredTerms: Set<string>,
  maxFields: number,
  maxChars: number,
): { text: string; selectedFields: RAGDebugInfo['selectedFields'] } | null {
  const translatedFields = allFields.filter(
    (f) => f.path !== currentField.path && f.status === 'done' && f.translated && f.translated.trim()
  );

  if (translatedFields.length === 0) return null;

  const currentFeatures = getFeaturesFor(currentField);
  const selectedFields: RAGDebugInfo['selectedFields'] = [];

  // ─── Tier 1: Must-include ───
  const tier1: ScoredField[] = [];

  // Core fields always included
  const coreFields = translatedFields.filter((f) => f.group === 'core');
  for (const cf of coreFields) {
    tier1.push({ field: cf, score: 1.0, tier: 'must-include' });
  }

  // Same lorebook entry (content ↔ keys, or same entry index)
  const currentEntryIdx = currentField.path.match(/entries\[(\d+)\]/)?.[1];
  if (currentEntryIdx) {
    const sameEntryFields = translatedFields.filter(f => {
      if (f.group !== 'lorebook' && f.group !== 'lorebook_keys') return false;
      const idx = f.path.match(/entries\[(\d+)\]/)?.[1];
      return idx === currentEntryIdx;
    });
    for (const sef of sameEntryFields) {
      if (!tier1.some(t => t.field.path === sef.path)) {
        tier1.push({ field: sef, score: 0.95, tier: 'must-include' });
      }
    }
  }

  // ─── Tier 2: High-priority (structural affinity) ───
  const tier2: ScoredField[] = [];
  const isCodeField = ['regex', 'tavern_helper'].includes(currentField.group) ||
    currentField.entryType === 'initvar' ||
    currentField.entryType === 'controller' ||
    currentField.entryType === 'mvu_logic';

  if (isCodeField) {
    // Include schema/TavernHelper scripts (they define variables)
    const schemaFields = translatedFields.filter(f =>
      f.group === 'tavern_helper' &&
      !tier1.some(t => t.field.path === f.path)
    );
    for (const sf of schemaFields) {
      tier2.push({ field: sf, score: 0.85, tier: 'high-priority' });
    }

    // Include initvar/controller entries (variable definitions)
    const logicFields = translatedFields.filter(f =>
      (f.entryType === 'initvar' || f.entryType === 'controller' || f.entryType === 'mvu_logic') &&
      !tier1.some(t => t.field.path === f.path) &&
      !tier2.some(t => t.field.path === f.path)
    );
    for (const lf of logicFields) {
      tier2.push({ field: lf, score: 0.80, tier: 'high-priority' });
    }

    // Adjacent entries (same entry ±1 index)
    if (currentEntryIdx) {
      const adjIdx = [parseInt(currentEntryIdx) - 1, parseInt(currentEntryIdx) + 1];
      const adjacentFields = translatedFields.filter(f => {
        const idx = f.path.match(/entries\[(\d+)\]/)?.[1];
        return idx && adjIdx.includes(parseInt(idx)) &&
          !tier1.some(t => t.field.path === f.path) &&
          !tier2.some(t => t.field.path === f.path);
      });
      for (const af of adjacentFields) {
        tier2.push({ field: af, score: 0.70, tier: 'high-priority' });
      }
    }
  }

  // ─── Tier 3: TF-IDF similarity ───
  const tier1and2Paths = new Set([
    ...tier1.map(t => t.field.path),
    ...tier2.map(t => t.field.path),
  ]);

  const tier3: ScoredField[] = [];
  for (const candidate of translatedFields) {
    if (tier1and2Paths.has(candidate.path)) continue;

    const candidateFeatures = getFeaturesFor(candidate);
    let score = calculateSimilarity(currentFeatures, candidateFeatures);

    // Group bonuses
    if (candidate.group === currentField.group) score += 0.12;
    if (candidate.group === 'system') score += 0.08;

    // Cross lorebook-keys ↔ lorebook bonus
    if (
      (currentField.group === 'lorebook_keys' && candidate.group === 'lorebook') ||
      (currentField.group === 'lorebook' && candidate.group === 'lorebook_keys')
    ) {
      const candidateIdx = candidate.path.match(/entries\[(\d+)\]/)?.[1];
      if (currentEntryIdx && candidateIdx && currentEntryIdx === candidateIdx) {
        score += 0.4;
      }
    }

    // Entry type affinity
    if (isCodeField && (candidate.entryType === 'initvar' || candidate.entryType === 'controller')) {
      score += 0.15;
    }

    if (score >= 0.03) {
      tier3.push({ field: candidate, score, tier: 'similarity' });
    }
  }

  tier3.sort((a, b) => b.score - a.score);

  // ─── Build entries from all tiers ───
  const entries: string[] = [];
  let totalChars = 0;
  const maxEntries = maxFields;

  const addEntry = (sf: ScoredField, maxOrigLen: number, maxTransLen: number): boolean => {
    if (entries.length >= maxEntries) return false;

    const f = sf.field;
    const origExcerpt = truncate(f.original, maxOrigLen);
    const transExcerpt = truncate(f.translated, maxTransLen);
    const entry = `• [${f.label}]: "${origExcerpt}" → "${transExcerpt}"`;

    if (totalChars + entry.length > maxChars) return false;
    entries.push(entry);
    totalChars += entry.length;
    selectedFields.push({
      path: f.path,
      label: f.label,
      score: Math.round(sf.score * 1000) / 1000,
      tier: sf.tier,
    });
    return true;
  };

  // Tier 1 first (shorter excerpts for supplementary core fields)
  for (const t1 of tier1) {
    if (!addEntry(t1, 150, 250)) break;
  }

  // Tier 2 (medium excerpts)
  for (const t2 of tier2) {
    if (!addEntry(t2, 200, 400)) break;
  }

  // Tier 3 (longer excerpts for similarity matches)
  for (const t3 of tier3) {
    if (!addEntry(t3, 250, 500)) break;
  }

  if (entries.length === 0) return null;

  return {
    text:
      '═══ CROSS-FIELD TRANSLATION REFERENCE ═══\n' +
      'Already-translated parts of this SAME card (use for terminology/style consistency):\n' +
      entries.join('\n'),
    selectedFields,
  };
}

/* ─── Legacy API (backward compat) ─── */

interface RAGConfig {
  maxFields?: number;
  maxChars?: number;
  minScore?: number;
  alwaysIncludeCore?: boolean;
}

/**
 * @deprecated Use buildUnifiedRAGContext instead
 */
export function buildRAGContext(
  currentField: TranslationField,
  allFields: TranslationField[],
  config?: RAGConfig
): string {
  return buildUnifiedRAGContext({
    currentField,
    allFields,
    maxFields: config?.maxFields ?? 5,
    maxChars: config?.maxChars ?? 3000,
  });
}

/* ─── Utilities ─── */

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '…';
}
