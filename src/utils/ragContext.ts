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

/**
 * (User 2026 — bugNeedFix/39) TERM-VECTOR CACHE cho TF-IDF cosine.
 * Trước đây tfidfCosineSimilarity XÂY LẠI 2 Map term→weight cho MỖI CẶP field (rồi còn tính
 * magnitude 3 lần): field script 171K ký tự có ~hàng chục nghìn bigram → so với 418 field done
 * (luồng "So sánh → Gộp thông minh") = hàng chục triệu phép copy MỖI field dịch ⇒ đo thật 1.43s
 * block/field lớn, ~34s tổng cho 187 field → "Trang không phản hồi".
 * Nay: vector (đã nhân IDF, đã CAP top-N term đại diện) + magnitude tính 1 LẦN mỗi field và cache;
 * cosine mỗi cặp chỉ còn dot-product trên vector ≤ VECTOR_TOP_TERMS phần tử, 0 allocation.
 */
interface TermVector {
  /** term → weight (freq × idf), đã cap top-N theo weight */
  terms: Map<string, number>;
  /** magnitude của vector (sqrt Σw²) */
  mag: number;
}
const vectorCache = new Map<string, TermVector>();
/** Trần số term đại diện mỗi vector — đủ cho similarity ranking, chặn O(bigram) nổ với script lớn. */
const VECTOR_TOP_TERMS = 400;

/** Document frequency: term → number of fields containing it */
let dfMap: Map<string, number> | null = null;
/** Total number of documents used to build dfMap */
let dfDocCount = 0;

export function clearRAGCache(): void {
  featureCache.clear();
  vectorCache.clear();
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

/** Key cache an toàn: path + độ dài original — đổi card cùng path (import bản mới) không dính stale. */
const cacheKeyOf = (field: TranslationField) => `${field.path}:${field.original.length}`;

function getFeaturesFor(field: TranslationField): FieldFeatures {
  const key = cacheKeyOf(field);
  const cached = featureCache.get(key);
  if (cached) return cached;
  const features = extractFeatures(field.original);
  featureCache.set(key, features);
  return features;
}

/** (bug 39) Lấy term-vector TF-IDF (đã cap + cache) cho field — tính đúng 1 lần mỗi field. */
function getVectorFor(field: TranslationField): TermVector {
  const key = cacheKeyOf(field);
  const cached = vectorCache.get(key);
  if (cached) return cached;

  const f = getFeaturesFor(field);
  // Merge: CJK bigram (trọng số 1.5) + words — như logic cũ.
  const merged = new Map<string, number>();
  for (const [term, freq] of f.cjkBigrams) merged.set(term, (merged.get(term) || 0) + freq * 1.5);
  for (const [term, freq] of f.words) merged.set(term, (merged.get(term) || 0) + freq);

  // Nhân IDF thành weight.
  let weighted: Array<[string, number]> = [];
  for (const [term, freq] of merged) weighted.push([term, freq * idf(term)]);

  // CAP top-N term theo weight — script 171K ký tự có hàng chục nghìn bigram, giữ N term đại diện
  // là đủ cho việc XẾP HẠNG similarity (không cần cosine chính xác tuyệt đối).
  if (weighted.length > VECTOR_TOP_TERMS) {
    weighted.sort((a, b) => b[1] - a[1]);
    weighted = weighted.slice(0, VECTOR_TOP_TERMS);
  }

  let magSq = 0;
  const terms = new Map<string, number>();
  for (const [term, w] of weighted) {
    terms.set(term, w);
    magSq += w * w;
  }
  const vec: TermVector = { terms, mag: Math.sqrt(magSq) };
  vectorCache.set(key, vec);
  return vec;
}

/* ─── TF-IDF Document Frequency ─── */

/** Build document frequency map across all fields (call once per translation session) */
function ensureDFMap(allFields: TranslationField[]): void {
  // Rebuild if field count changed (new card loaded or fields added)
  if (dfMap && dfDocCount === allFields.length) return;

  dfMap = new Map<string, number>();
  dfDocCount = allFields.length;
  vectorCache.clear(); // (bug 39) IDF đổi → vector weight cũ hết hiệu lực

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

/**
 * (bug 39) Cosine trên 2 vector ĐÃ CACHE (weight có sẵn IDF, magnitude tính sẵn).
 * Chỉ còn dot-product duyệt vector NHỎ hơn (≤ VECTOR_TOP_TERMS) — 0 allocation, 0 tính lại.
 * (Bản cũ xây lại 2 Map + tính magnitude 3 lần cho MỖI CẶP field — thủ phạm treo 34s luồng So sánh.)
 */
function tfidfCosineSimilarity(aVec: TermVector, bVec: TermVector): number {
  if (aVec.terms.size === 0 || bVec.terms.size === 0 || aVec.mag === 0 || bVec.mag === 0) return 0;
  const [smaller, larger] = aVec.terms.size <= bVec.terms.size ? [aVec.terms, bVec.terms] : [bVec.terms, aVec.terms];
  let dotProduct = 0;
  for (const [term, sWeight] of smaller) {
    const lWeight = larger.get(term);
    if (lWeight !== undefined) dotProduct += sWeight * lWeight;
  }
  return dotProduct / (aVec.mag * bVec.mag);
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

function calculateSimilarity(
  currentFeatures: FieldFeatures,
  candidateFeatures: FieldFeatures,
  currentVec: TermVector,
  candidateVec: TermVector,
): number {
  let score = 0;
  let weightSum = 0;

  // TF-IDF cosine similarity for text content (primary signal) — dùng vector cache (bug 39)
  const tfidfScore = tfidfCosineSimilarity(currentVec, candidateVec);
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

  // Lorebook (non-logic): moderate context — nới thêm để chứa entry trigger theo keyword.
  if (group === 'lorebook') {
    return {
      maxChars: userMaxChars || 5000,
      maxFields: userMaxFields || 9,
    };
  }

  // System/depth prompts: moderate
  if (group === 'system' || group === 'depth_prompt') {
    return {
      maxChars: userMaxChars || 4200,
      maxFields: userMaxFields || 7,
    };
  }

  // Narrative (core, messages, creator): nới nhẹ để có chỗ cho lore liên quan (keyword-trigger).
  return {
    maxChars: userMaxChars || 3800,
    maxFields: userMaxFields || 7,
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

  if (input.entryNameDictionary) {
    const entryNameEntries = Object.entries(input.entryNameDictionary)
      .filter(([k, v]) => k && v && k !== v);
    if (entryNameEntries.length > 0) {
      // Scan currentField.original to see which entries are actually referenced
      const matchedEntries = entryNameEntries.filter(([k]) => currentField.original.includes(k));

      // If nothing matches directly but it's a logic/code field, we show all entries (if total entries < 50)
      // to ensure full context for variables/keys.
      const finalEntriesToShow = matchedEntries.length > 0 ? matchedEntries : (
        (['tavern_helper', 'regex'].includes(currentField.group) && entryNameEntries.length < 50) ? entryNameEntries : []
      );

      if (finalEntriesToShow.length > 0) {
        for (const [k, v] of finalEntriesToShow) {
          coveredTerms.add(k.toLowerCase());
          coveredTerms.add(v.toLowerCase());
        }

        const isLogicField = ['tavern_helper', 'regex', 'lorebook'].includes(currentField.group);
        const dictList = finalEntriesToShow.map(([k, v]) => `  "${k}" → "${v}"`).join('\n');
        
        let section: string;
        if (isLogicField) {
          section = '═══ ENTRY NAME DICTIONARY (EJS SYNC - CRITICAL FOR REGEX/CODE) ═══\n' +
            'This card uses Lorebook entries that are dynamically loaded. In JavaScript, regex blocks, or keys, you MUST translate these terms EXACTLY as mapped:\n' +
            dictList + '\n' +
            'Rules:\n' +
            '- You MUST use EXACTLY the mapped translation (e.g., if "前秦" maps to "Tiền Tần", do NOT translate it to "Tiền Yên").\n' +
            '- This is critical for matching keys in arrays/objects (e.g., specificClassLists, raw lists).\n' +
            '- Failure to match will break the game logic!';
        } else {
          section = '═══ ENTRY NAME DICTIONARY (EJS SYNC - MANDATORY) ═══\n' +
            'SillyTavern auto-loads lorebook entries when their EXACT NAME appears in text.\n' +
            'When translating, replace original entry names with their translated equivalents:\n' +
            dictList + '\n' +
            '- You MUST use EXACTLY the mapped translation. A mismatch = the entry will NEVER be loaded at runtime.';
        }
        sections.push(section);
        totalChars += section.length;
      }
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
 * Tìm các entry Lorebook (đã dịch) mà KEYWORD của nó XUẤT HIỆN trong `text` — giống cách
 * SillyTavern kích hoạt lorebook theo từ khoá. Dùng để kéo NỘI DUNG entry liên quan vào context,
 * giúp dịch bám đúng định nghĩa lore (vd đoạn văn nhắc "李明" → kéo entry định nghĩa 李明 vào).
 *
 * Khớp keyword lấy từ field nhóm `lorebook_keys` (bản GỐC — không cần đã dịch); chỉ trả về entry
 * content ĐÃ dịch xong. Bỏ qua entry `excludeEntryIdx` (thường là entry của chính field hiện tại).
 */
export function findKeywordTriggeredEntries(
  text: string,
  allFields: TranslationField[],
  excludeEntryIdx?: string | null,
): TranslationField[] {
  if (!text || text.trim().length < 2) return [];

  const entryKeywords = new Map<string, string[]>();       // entryIdx → [keyword gốc]
  const entryContent = new Map<string, TranslationField>(); // entryIdx → content field (đã dịch)
  for (const f of allFields) {
    const idx = f.path.match(/entries\[(\d+)\]/)?.[1];
    if (!idx) continue;
    if (f.group === 'lorebook_keys' && f.original?.trim()) {
      const arr = entryKeywords.get(idx) || [];
      // 1 field key có thể gộp nhiều keyword ngăn bởi dấu phẩy; keyword ≥2 ký tự để tránh nhiễu.
      for (const kw of f.original.split(',').map((s) => s.trim()).filter((s) => s.length >= 2)) arr.push(kw);
      entryKeywords.set(idx, arr);
    } else if (f.group === 'lorebook' && f.status === 'done' && f.translated?.trim()) {
      entryContent.set(idx, f);
    }
  }

  const out: TranslationField[] = [];
  for (const [idx, kws] of entryKeywords) {
    if (idx === excludeEntryIdx) continue;
    const cf = entryContent.get(idx);
    if (!cf) continue;
    if (kws.some((kw) => text.includes(kw))) out.push(cf);
  }
  return out;
}

/**
 * Build cross-field context section using tiered retrieval + TF-IDF.
 *
 * Tier 1 (Must-include):  Core fields + same-entry fields + lorebook keyword-triggered entries
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

  // ─── Tier 1b: Lorebook entry KÍCH HOẠT theo KEYWORD ───
  // Nếu text field hiện tại chứa keyword của 1 entry lorebook KHÁC (đã dịch) → kéo nội dung entry
  // đó vào (giống ST kích hoạt lorebook) → dịch bám đúng định nghĩa lore, tên/thuật ngữ nhất quán.
  for (const kf of findKeywordTriggeredEntries(currentField.original, allFields, currentEntryIdx)) {
    if (!tier1.some(t => t.field.path === kf.path)) {
      tier1.push({ field: kf, score: 0.9, tier: 'must-include' });
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
  const currentVec = getVectorFor(currentField); // (bug 39) vector của field hiện tại: lấy 1 lần
  for (const candidate of translatedFields) {
    if (tier1and2Paths.has(candidate.path)) continue;

    const candidateFeatures = getFeaturesFor(candidate);
    let score = calculateSimilarity(currentFeatures, candidateFeatures, currentVec, getVectorFor(candidate));

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
