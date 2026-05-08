import type { TranslationField, GlossaryEntry } from '../types/card';

/* ══════════════════════════════════════════════════════════════════
 *  Unified RAG Context Engine
 *  ───────────────────────────
 *  Tổng hợp TẤT CẢ nguồn context thành 1 unified block duy nhất:
 *    1. Custom Schema      → Cấu trúc biến / format  
 *    2. Glossary            → Bảng thuật ngữ bắt buộc
 *    3. MVU Dictionary      → Biến Strategy B (MVU/Zod)  
 *    4. Cross-field Context → Bản dịch đã hoàn thành liên quan
 *
 *  Loại bỏ trùng lặp giữa các nguồn, ưu tiên đúng, format rõ ràng.
 *  Hoàn toàn client-side, không cần vector DB hay extra API call.
 * ══════════════════════════════════════════════════════════════════ */

/* ─── Feature extraction ─── */

interface FieldFeatures {
  cjkBigrams: Set<string>;
  words: Set<string>;
  placeholders: Set<string>;
  tags: Set<string>;
  properNouns: Set<string>;
}

const featureCache = new Map<string, FieldFeatures>();

export function clearRAGCache(): void {
  featureCache.clear();
}

function extractFeatures(text: string): FieldFeatures {
  const cjkBigrams = new Set<string>();
  const words = new Set<string>();
  const placeholders = new Set<string>();
  const tags = new Set<string>();
  const properNouns = new Set<string>();

  const cjkChars = text.match(/[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g);
  if (cjkChars && cjkChars.length >= 2) {
    for (let i = 0; i < cjkChars.length - 1; i++) {
      cjkBigrams.add(cjkChars[i] + cjkChars[i + 1]);
    }
  }

  const wordMatches = text.match(/[a-zA-ZÀ-ÿ\u0400-\u04ff]{3,}/g);
  if (wordMatches) {
    for (const w of wordMatches) words.add(w.toLowerCase());
  }

  const phMatches = text.match(/\{\{[^}]+\}\}/g);
  if (phMatches) {
    for (const p of phMatches) placeholders.add(p);
  }

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

/* ─── Similarity scoring ─── */

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

  if (currentFeatures.cjkBigrams.size > 0 || candidateFeatures.cjkBigrams.size > 0) {
    score += overlapCoefficient(currentFeatures.cjkBigrams, candidateFeatures.cjkBigrams) * 4;
    weightSum += 4;
  }
  if (currentFeatures.words.size > 0 || candidateFeatures.words.size > 0) {
    score += overlapCoefficient(currentFeatures.words, candidateFeatures.words) * 3;
    weightSum += 3;
  }
  if (currentFeatures.placeholders.size > 0 || candidateFeatures.placeholders.size > 0) {
    score += overlapCoefficient(currentFeatures.placeholders, candidateFeatures.placeholders) * 5;
    weightSum += 5;
  }
  if (currentFeatures.tags.size > 0 || candidateFeatures.tags.size > 0) {
    score += overlapCoefficient(currentFeatures.tags, candidateFeatures.tags) * 4;
    weightSum += 4;
  }
  if (currentFeatures.properNouns.size > 0 || candidateFeatures.properNouns.size > 0) {
    score += overlapCoefficient(currentFeatures.properNouns, candidateFeatures.properNouns) * 3;
    weightSum += 3;
  }

  return weightSum > 0 ? score / weightSum : 0;
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
  /** Cấu hình RAG */
  maxFields?: number;
  maxChars?: number;
}

interface ScoredField {
  field: TranslationField;
  score: number;
}

/**
 * Tạo unified context block tổng hợp tất cả nguồn context.
 * Được inject vào system prompt để AI có toàn bộ context cần thiết.
 *
 * Thứ tự ưu tiên (quan trọng → ít quan trọng):
 *   1. Schema (cấu trúc bắt buộc)
 *   2. Glossary (thuật ngữ bắt buộc)
 *   3. MVU Dictionary (biến phải đổi tên)
 *   4. Cross-field excerpts (tham chiếu bản dịch đã xong)
 *
 * Loại bỏ trùng lặp: nếu term đã có trong glossary/MVU dict,
 * không hiển thị lại trong cross-field context.
 */
export function buildUnifiedRAGContext(input: UnifiedRAGInput): string {
  const {
    currentField,
    allFields,
    glossary,
    mvuDictionary,
    customSchema,
    maxFields = 5,
    maxChars = 3000,
  } = input;

  const sections: string[] = [];
  let totalChars = 0;
  const charBudget = maxChars;

  // Collect all terms already covered by glossary + MVU to avoid duplication
  const coveredTerms = new Set<string>();

  // ══════════════════════════════════════════════════════════
  // SECTION 1: Custom Schema
  // ══════════════════════════════════════════════════════════
  if (customSchema && customSchema.trim()) {
    const schemaTrunc = truncate(customSchema.trim(), Math.min(1500, Math.floor(charBudget * 0.3)));
    const section = `═══ CARD SCHEMA / FORMAT RULES ═══\n${schemaTrunc}`;
    sections.push(section);
    totalChars += section.length;

    // Extract terms from schema to avoid duplication
    const schemaWords = customSchema.match(/[a-zA-ZÀ-ÿ\u4e00-\u9fff]{2,}/g);
    if (schemaWords) schemaWords.forEach(w => coveredTerms.add(w.toLowerCase()));
  }

  // ══════════════════════════════════════════════════════════
  // SECTION 2: Glossary (Bảng thuật ngữ bắt buộc)
  // ══════════════════════════════════════════════════════════
  const validGlossary = (glossary || []).filter(g => g.source.trim() && g.target.trim());
  if (validGlossary.length > 0) {
    // Filter glossary: only include terms RELEVANT to current field
    const currentText = currentField.original.toLowerCase();
    const relevantTerms: GlossaryEntry[] = [];
    const otherTerms: GlossaryEntry[] = [];

    for (const g of validGlossary) {
      coveredTerms.add(g.source.toLowerCase());
      coveredTerms.add(g.target.toLowerCase());

      if (currentText.includes(g.source.toLowerCase())) {
        relevantTerms.push(g);
      } else {
        otherTerms.push(g);
      }
    }

    if (relevantTerms.length > 0 || otherTerms.length > 0) {
      let section = '═══ MANDATORY TERMINOLOGY ═══';
      if (relevantTerms.length > 0) {
        section += '\n⚡ Found in current text — MUST use:';
        for (const g of relevantTerms) {
          section += `\n  "${g.source}" → "${g.target}"`;
        }
      }
      if (otherTerms.length > 0) {
        section += '\n📋 Global terms — use when applicable:';
        for (const g of otherTerms) {
          section += `\n  "${g.source}" → "${g.target}"`;
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
      // Track covered
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
  // SECTION 4: Cross-field Translation Context
  // ══════════════════════════════════════════════════════════
  const remainingBudget = Math.max(500, charBudget - totalChars);
  const crossFieldContext = buildCrossFieldSection(
    currentField,
    allFields,
    coveredTerms,
    maxFields,
    remainingBudget
  );
  if (crossFieldContext) {
    sections.push(crossFieldContext);
  }

  // ══════════════════════════════════════════════════════════
  // FINAL ASSEMBLY
  // ══════════════════════════════════════════════════════════
  if (sections.length === 0) return '';

  return (
    '\n\n' +
    sections.join('\n\n') +
    '\n\n═══ CONSISTENCY RULE ═══\n' +
    'Maintain the SAME translations for character names, place names, special terms, ' +
    'variables, and writing style shown in ALL sections above. Do NOT invent different ' +
    'translations for terms that already have established translations.'
  );
}

/**
 * Build cross-field context section — finds relevant already-translated fields
 * and formats them as reference excerpts, excluding terms already covered by
 * glossary/MVU to avoid redundancy.
 */
function buildCrossFieldSection(
  currentField: TranslationField,
  allFields: TranslationField[],
  coveredTerms: Set<string>,
  maxFields: number,
  maxChars: number
): string | null {
  const translatedFields = allFields.filter(
    (f) => f.path !== currentField.path && f.status === 'done' && f.translated && f.translated.trim()
  );

  if (translatedFields.length === 0) return null;

  const currentFeatures = getFeaturesFor(currentField);

  // 1. Always-include: core fields
  const coreContext: ScoredField[] = [];
  const coreFields = translatedFields.filter((f) => f.group === 'core');
  for (const cf of coreFields) {
    coreContext.push({ field: cf, score: 1.0 });
  }

  // 2. Score remaining fields
  const corePaths = new Set(coreContext.map((c) => c.field.path));
  const scoredCandidates: ScoredField[] = [];

  for (const candidate of translatedFields) {
    if (corePaths.has(candidate.path)) continue;

    const candidateFeatures = getFeaturesFor(candidate);
    let score = calculateSimilarity(currentFeatures, candidateFeatures);

    // Group bonuses
    if (candidate.group === currentField.group) score += 0.15;
    if (candidate.group === 'system') score += 0.1;

    // Same lorebook entry bonus
    if (
      (currentField.group === 'lorebook_keys' && candidate.group === 'lorebook') ||
      (currentField.group === 'lorebook' && candidate.group === 'lorebook_keys')
    ) {
      const currentIdx = currentField.path.match(/entries\[(\d+)\]/)?.[1];
      const candidateIdx = candidate.path.match(/entries\[(\d+)\]/)?.[1];
      if (currentIdx && candidateIdx && currentIdx === candidateIdx) {
        score += 0.5;
      }
    }

    if (score >= 0.05) {
      scoredCandidates.push({ field: candidate, score });
    }
  }

  scoredCandidates.sort((a, b) => b.score - a.score);

  // 3. Build entries — skip terms already in glossary/MVU
  const entries: string[] = [];
  let totalChars = 0;
  const maxEntries = maxFields;

  const addEntry = (f: TranslationField, maxOrigLen: number, maxTransLen: number): boolean => {
    if (entries.length >= maxEntries) return false;

    // Extract key name/term pairs from this field, skip if all already covered
    const origExcerpt = truncate(f.original, maxOrigLen);
    const transExcerpt = truncate(f.translated, maxTransLen);
    const entry = `• [${f.label}]: "${origExcerpt}" → "${transExcerpt}"`;

    if (totalChars + entry.length > maxChars) return false;
    entries.push(entry);
    totalChars += entry.length;
    return true;
  };

  // Core fields first (truncated shorter since they're supplementary)
  for (const core of coreContext) {
    if (!addEntry(core.field, 150, 200)) break;
  }

  // Scored candidates
  for (const scored of scoredCandidates) {
    if (!addEntry(scored.field, 200, 400)) break;
  }

  if (entries.length === 0) return null;

  return (
    '═══ CROSS-FIELD TRANSLATION REFERENCE ═══\n' +
    'Already-translated parts of this SAME card (use for terminology/style consistency):\n' +
    entries.join('\n')
  );
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
