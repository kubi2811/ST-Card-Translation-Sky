/**
 * src/lib/mvuzod/schemaInferencer.ts — Deep Lorebook Analysis → MVUZOD Schema
 *
 * Quét SÂU vào mọi entry content, không giới hạn thể loại card.
 * Hỗ trợ: romance, daily-life, adventure, system, combat, cultivation, school, slice-of-life, v.v.
 *
 * Pipeline:
 *   1. analyzeLorebookForSchema() — scan toàn bộ entries
 *      ├── detectPrefixGroups() — nhóm theo prefix comment
 *      ├── deepScanAllContent() — quét sâu content
 *      │   ├── extractKeyValuePairs() — tìm "key: value" patterns
 *      │   ├── extractNumericValues() — tìm số có ý nghĩa
 *      │   ├── extractListItems() — tìm danh sách bullet/numbered
 *      │   └── extractYAMLBlocks() — tìm structured YAML
 *      ├── detectNamedEntities() — tìm nhân vật, địa điểm, tổ chức
 *      ├── detectRelationships() — tìm quan hệ, cảm xúc, thái độ
 *      ├── detectStates() — tìm trạng thái, trang phục, ngoại hình
 *      └── detectSystems() — tìm hệ thống game/mechanic (nếu có)
 *   2. buildMinimalSchemaFromReport() — sinh schema từ report
 *   3. schemaToZodCode() — sinh Zod 4 code (MVU_ZOD spec compliant)
 */

import type { LorebookEntry } from '../../types';
import { normalizeMVUZODSchema } from './normalizeSchema';
import type {
  MVUZODSchema, MVUZODField, InferenceReport, InferenceResult,
} from '../../types/mvuzod.types';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface DetectedEntity {
  name: string;
  type: 'character' | 'location' | 'organization' | 'concept';
  source: string; // entry comment/key that detected it
  attributes: Map<string, { value: string; dataType: 'string' | 'number' | 'boolean' }>;
  relationKeys: string[]; // e.g. ['好感度', '信赖度']
  stateKeys: string[]; // e.g. ['着装', '心情', '状态']
}

interface DetectedKVPair {
  key: string;
  value: string;
  dataType: 'string' | 'number' | 'boolean';
  source: string;
  depth: number; // nesting level
  parentKey?: string;
}

interface DetectedSystem {
  name: string;
  type: 'inventory' | 'quest' | 'combat' | 'cultivation' | 'relationship' |
        'time' | 'location' | 'clothing' | 'emotion' | 'economy' | 'custom';
  fields: Array<{ key: string; dataType: 'string' | 'number' | 'boolean' | 'record' | 'object' }>;
  evidence: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════

export function analyzeLorebookForSchema(entries: LorebookEntry[]): InferenceReport {
  const report: InferenceReport = {
    entryCount: entries.length,
    detectedGroups: [],
    detectedEnums: [],
    detectedNPCPattern: false,
    detectedCultivationSystem: false,
    suggestedFields: [],
    warnings: [],
  };

  if (entries.length < 3) {
    report.warnings.push('Lorebook rất ít entries (<3). Nên tạo thêm lore trước.');
    return report;
  }

  // ─── 1. Prefix groups (structural) ──────────────────────────────────
  const prefixGroups = detectPrefixGroups(entries);
  report.detectedGroups = prefixGroups;
  for (const group of prefixGroups) {
    if (group.count >= 2) {
      report.detectedEnums.push({
        path: `/${group.name}`,
        values: group.sample,
        source: `Prefix: "${group.name}" × ${group.count}`,
      });
    }
  }

  // ─── 2. Deep content scan (ALL entries) ─────────────────────────────
  const allKVPairs: DetectedKVPair[] = [];
  const allEntities: DetectedEntity[] = [];
  const allSystems: DetectedSystem[] = [];

  for (const entry of entries) {
    // Extract key-value pairs from content
    const kvPairs = extractKeyValuePairs(entry.content, entry.comment);
    allKVPairs.push(...kvPairs);

    // Detect named entities from comment + keys
    const entities = detectNamedEntities(entry);
    allEntities.push(...entities);
  }

  // ─── 3. Aggregate: merge entities by name ───────────────────────────
  const entityMap = new Map<string, DetectedEntity>();
  for (const entity of allEntities) {
    const existing = entityMap.get(entity.name);
    if (existing) {
      // Merge attributes
      for (const [k, v] of entity.attributes) {
        existing.attributes.set(k, v);
      }
      existing.relationKeys.push(...entity.relationKeys.filter(r => !existing.relationKeys.includes(r)));
      existing.stateKeys.push(...entity.stateKeys.filter(s => !existing.stateKeys.includes(s)));
    } else {
      entityMap.set(entity.name, { ...entity, attributes: new Map(entity.attributes) });
    }
  }

  // ─── 4. Detect systems from KV pairs ────────────────────────────────
  const systems = detectSystems(entries);
  allSystems.push(...systems);

  // ─── 5. Detect relationship/stat patterns ───────────────────────────
  const relationshipFields = detectRelationshipPatterns(allKVPairs, entries);
  const stateFields = detectStatePatterns(allKVPairs);
  const clothingFields = detectClothingPatterns(allKVPairs, entries);
  const timeLocationFields = detectTimeLocationPatterns(entries);

  // ─── 6. Convert detections → suggestedFields ───────────────────────
  // Characters/entities
  for (const [name, entity] of entityMap) {
    if (entity.type === 'character') {
      report.detectedNPCPattern = true;
      report.suggestedFields.push({
        path: `/${name}`,
        reason: `Nhân vật "${name}" — ${entity.attributes.size} thuộc tính, ${entity.relationKeys.length} quan hệ`,
        confidence: 0.9,
      });
    }
  }

  // Systems
  for (const sys of allSystems) {
    report.suggestedFields.push({
      path: `/${sys.name}`,
      reason: `Hệ thống "${sys.type}" — ${sys.fields.length} fields (${sys.evidence.slice(0, 2).join(', ')})`,
      confidence: 0.7,
    });
  }

  // Relationships
  for (const rf of relationshipFields) {
    report.suggestedFields.push(rf);
  }

  // States
  for (const sf of stateFields) {
    report.suggestedFields.push(sf);
  }

  // Clothing
  for (const cf of clothingFields) {
    report.suggestedFields.push(cf);
  }

  // Time/Location
  for (const tf of timeLocationFields) {
    report.suggestedFields.push(tf);
  }

  // Cultivation
  report.detectedCultivationSystem = allSystems.some(s => s.type === 'cultivation');

  // Enums from KV pairs with limited values
  const enumCandidates = detectEnumCandidates(allKVPairs);
  for (const ec of enumCandidates) {
    report.detectedEnums.push(ec);
  }

  // Store raw data for schema builder
  (report as InferenceReport & { _entities?: Map<string, DetectedEntity>; _systems?: DetectedSystem[]; _kvPairs?: DetectedKVPair[] })._entities = entityMap;
  (report as InferenceReport & { _systems?: DetectedSystem[] })._systems = allSystems;
  (report as InferenceReport & { _kvPairs?: DetectedKVPair[] })._kvPairs = allKVPairs;

  return report;
}

// ═══════════════════════════════════════════════════════════════════════════
// DEEP CONTENT EXTRACTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Extract key-value pairs from entry content.
 * Supports: "key: value", "key：value", "key = value", "key - value",
 *           YAML-like blocks, indented sub-keys, bullet lists.
 */
function extractKeyValuePairs(content: string, source: string): DetectedKVPair[] {
  const pairs: DetectedKVPair[] = [];
  const lines = content.split(/\r?\n/);

  // Track indentation for nesting
  const parentStack: Array<{ key: string; indent: number }> = [];

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim()) continue;

    // Calculate indent level
    const indentMatch = line.match(/^(\s*)/);
    const indent = indentMatch ? indentMatch[1].length : 0;

    // Pattern 1: "key: value" or "key：value"
    const kvMatch = line.match(/^\s*([^\n:：=-]{1,40})\s*[:：]\s*(.+)$/);
    if (kvMatch) {
      const key = kvMatch[1].trim();
      const value = kvMatch[2].trim();

      // Skip if key looks like a URL, time, or code
      if (key.includes('//') || key.includes('http') || /^\d+$/.test(key)) continue;

      // Update parent stack
      while (parentStack.length > 0 && parentStack[parentStack.length - 1].indent >= indent) {
        parentStack.pop();
      }
      const parentKey = parentStack.length > 0 ? parentStack[parentStack.length - 1].key : undefined;

      pairs.push({
        key,
        value,
        dataType: inferDataType(value),
        source,
        depth: parentStack.length,
        parentKey,
      });

      // If value is empty or very short, this might be a parent
      if (!value || value.length < 3) {
        parentStack.push({ key, indent });
      }
      continue;
    }

    // Pattern 2: "key = value"
    const eqMatch = line.match(/^\s*([^\n=]{1,40})\s*=\s*(.+)$/);
    if (eqMatch) {
      const key = eqMatch[1].trim();
      const value = eqMatch[2].trim();
      if (!key.includes('{') && !key.includes('(')) {
        pairs.push({ key, value, dataType: inferDataType(value), source, depth: 0 });
      }
      continue;
    }

    // Pattern 3: Bullet items "- item" or "• item" under a parent
    const bulletMatch = line.match(/^\s*[-•·▸▹]\s+(.+)$/);
    if (bulletMatch && parentStack.length > 0) {
      const value = bulletMatch[1].trim();
      const parentKey = parentStack[parentStack.length - 1].key;
      pairs.push({ key: `_item`, value, dataType: 'string', source, depth: parentStack.length, parentKey });
    }
  }

  return pairs;
}

function inferDataType(value: string): 'string' | 'number' | 'boolean' {
  if (/^-?\d+(\.\d+)?$/.test(value.trim())) return 'number';
  if (/^(true|false|是|否|有|无|開|關|on|off)$/i.test(value.trim())) return 'boolean';
  return 'string';
}

// ═══════════════════════════════════════════════════════════════════════════
// ENTITY DETECTION (Characters, Locations, Organizations)
// ═══════════════════════════════════════════════════════════════════════════

function detectNamedEntities(entry: LorebookEntry): DetectedEntity[] {
  const entities: DetectedEntity[] = [];
  const comment = entry.comment;
  const content = entry.content;

  // Character detection patterns
  const charPatterns = [
    /^(?:\[.*?\]\s*)?(.{1,20}?)(?:\s*[-—]\s*(?:角色|人物|NPC|character|主角|配角|boss))/i,
    /^(?:角色|人物|NPC)\s*[:：]\s*(.{1,20})/i,
    /^\[(?:NPC|角色|人物)\]\s*(.{1,20})/i,
    /^(.{1,15})(?:的(?:信息|资料|设定|描述|简介|背景|性格))/,
  ];

  for (const pattern of charPatterns) {
    const match = comment.match(pattern);
    if (match) {
      const name = match[1].trim();
      if (name.length >= 1 && name.length <= 15) {
        const entity = createEntityFromContent(name, 'character', content, comment);
        entities.push(entity);
      }
    }
  }

  // If comment is a short name (1-6 chars) and content has character-like attributes
  if (comment.length >= 1 && comment.length <= 8 && !comment.includes(' ') && !comment.match(/^[[(#\d]/)) {
    const hasCharAttrs = CHAR_ATTRIBUTE_KEYWORDS.some(kw =>
      content.toLowerCase().includes(kw)
    );
    if (hasCharAttrs) {
      const entity = createEntityFromContent(comment.trim(), 'character', content, comment);
      entities.push(entity);
    }
  }

  // Location detection
  const locPatterns = [
    /^(?:\[.*?\]\s*)?(?:地点|场所|location|区域|地区)\s*[:：]\s*(.{1,30})/i,
    /^(.{1,20})(?:\s*[-—]\s*(?:地点|场所|区域|地图))/i,
  ];
  for (const pattern of locPatterns) {
    const match = comment.match(pattern);
    if (match) {
      entities.push({
        name: match[1].trim(),
        type: 'location',
        source: comment,
        attributes: new Map(),
        relationKeys: [],
        stateKeys: [],
      });
    }
  }

  return entities;
}

const CHAR_ATTRIBUTE_KEYWORDS = [
  // Universal character attributes
  '性格', '年龄', '年齡', '身高', '体重', '外貌', '容貌', '发色', '瞳色',
  '性别', '种族', '职业', '身份', '称号', '爱好', '特长', '弱点',
  // Relationship/emotion
  '好感', '感度', '依存', '信赖', '亲密', '忠诚', '态度', '心情', '情绪',
  '关系', '關係', '感情',
  // Appearance/clothing
  '着装', '服装', '衣服', '穿着', '装扮', '发型', '妆容',
  '上装', '下装', '内衣', '袜子', '鞋子', '饰品',
  // State
  '状态', '状況', '健康', '精神', '体力',
  // Vietnamese equivalents
  'tính cách', 'tuổi', 'chiều cao', 'cân nặng', 'ngoại hình',
  'quan hệ', 'cảm xúc', 'trang phục', 'trạng thái',
  // English
  'personality', 'age', 'height', 'appearance', 'outfit', 'clothing',
  'relationship', 'affection', 'mood', 'status',
];

function createEntityFromContent(name: string, type: DetectedEntity['type'], content: string, source: string): DetectedEntity {
  const entity: DetectedEntity = {
    name,
    type,
    source,
    attributes: new Map(),
    relationKeys: [],
    stateKeys: [],
  };

  // Extract attributes from content
  const kvPairs = extractKeyValuePairs(content, source);
  for (const kv of kvPairs) {
    if (kv.depth <= 1) {
      entity.attributes.set(kv.key, { value: kv.value, dataType: kv.dataType });

      // Classify the attribute
      const keyLower = kv.key.toLowerCase();
      if (RELATION_KEYWORDS.some(rk => keyLower.includes(rk))) {
        entity.relationKeys.push(kv.key);
      }
      if (STATE_KEYWORDS.some(sk => keyLower.includes(sk))) {
        entity.stateKeys.push(kv.key);
      }
    }
  }

  return entity;
}

const RELATION_KEYWORDS = ['好感', '感度', '依存', '信赖', '亲密', '忠诚', '关系', '關係', 'affection', 'trust', 'loyalty', 'quan hệ'];
const STATE_KEYWORDS = ['着装', '服装', '穿着', '装扮', '心情', '情绪', '状态', '状況', 'outfit', 'mood', 'status', 'trang phục', 'cảm xúc', 'trạng thái'];

// ═══════════════════════════════════════════════════════════════════════════
// PATTERN DETECTION
// ═══════════════════════════════════════════════════════════════════════════

function detectRelationshipPatterns(kvPairs: DetectedKVPair[], entries: LorebookEntry[]): InferenceReport['suggestedFields'] {
  const fields: InferenceReport['suggestedFields'] = [];
  const relationKVs = kvPairs.filter(kv =>
    RELATION_KEYWORDS.some(rk => kv.key.toLowerCase().includes(rk))
  );

  if (relationKVs.length > 0) {
    // Deduplicate by key name
    const uniqueKeys = [...new Set(relationKVs.map(kv => kv.key))];
    for (const key of uniqueKeys) {
      const sample = relationKVs.find(kv => kv.key === key);
      fields.push({
        path: `/_関係/${key}`,
        reason: `Phát hiện trường quan hệ "${key}" (${sample?.dataType}) — từ "${sample?.source}"`,
        confidence: 0.85,
      });
    }
  }

  // Also scan full content for relationship patterns
  const fullText = entries.map(e => e.content).join('\n');
  const relPatterns = [
    /好感度\s*[:：=]\s*(\d+)/g,
    /依存度\s*[:：=]\s*(\d+)/g,
    /信赖度\s*[:：=]\s*(\d+)/g,
    /亲密度\s*[:：=]\s*(\d+)/g,
  ];
  for (const pattern of relPatterns) {
    const match = fullText.match(pattern);
    if (match) {
      const name = pattern.source.split(/\s/)[0];
      if (!fields.some(f => f.path.includes(name))) {
        fields.push({
          path: `/_関係/${name}`,
          reason: `Số liệu "${name}" trong content (giá trị mẫu: ${match[0]})`,
          confidence: 0.8,
        });
      }
    }
  }

  return fields;
}

function detectStatePatterns(kvPairs: DetectedKVPair[]): InferenceReport['suggestedFields'] {
  const fields: InferenceReport['suggestedFields'] = [];
  const stateKVs = kvPairs.filter(kv =>
    STATE_KEYWORDS.some(sk => kv.key.toLowerCase().includes(sk))
  );

  const uniqueKeys = [...new Set(stateKVs.map(kv => kv.key))];
  for (const key of uniqueKeys) {
    const sample = stateKVs.find(kv => kv.key === key);
    fields.push({
      path: `/_状態/${key}`,
      reason: `Trạng thái "${key}" (${sample?.dataType}) — từ "${sample?.source}"`,
      confidence: 0.75,
    });
  }

  return fields;
}

function detectClothingPatterns(kvPairs: DetectedKVPair[], entries: LorebookEntry[]): InferenceReport['suggestedFields'] {
  const fields: InferenceReport['suggestedFields'] = [];
  const CLOTHING_SLOTS = ['上装', '下装', '内衣', '袜子', '鞋子', '饰品', '配饰', '头饰'];
  const CLOTHING_KEYWORDS = [...CLOTHING_SLOTS, '着装', '服装', '穿着', '衣服', 'outfit', 'clothing', 'trang phục'];

  const hasClothing = kvPairs.some(kv =>
    CLOTHING_KEYWORDS.some(ck => kv.key.toLowerCase().includes(ck))
  ) || entries.some(e =>
    CLOTHING_KEYWORDS.some(ck => e.content.toLowerCase().includes(ck))
  );

  if (hasClothing) {
    // Detect which specific slots are mentioned
    const foundSlots: string[] = [];
    const allText = entries.map(e => `${e.comment}\n${e.content}`).join('\n');
    for (const slot of CLOTHING_SLOTS) {
      if (allText.includes(slot)) foundSlots.push(slot);
    }

    fields.push({
      path: '/_着装',
      reason: `Hệ thống trang phục — slots: ${foundSlots.length > 0 ? foundSlots.join(', ') : 'generic'}`,
      confidence: 0.8,
    });
  }

  return fields;
}

function detectTimeLocationPatterns(entries: LorebookEntry[]): InferenceReport['suggestedFields'] {
  const fields: InferenceReport['suggestedFields'] = [];
  const TIME_KEYWORDS = ['时间', '時間', '日期', '日期', '时刻', 'time', 'date', 'thời gian', '当前时间'];
  const LOC_KEYWORDS = ['地点', '地點', '场所', '位置', '区域', 'location', 'place', 'area', 'địa điểm', '当前地点'];
  const EVENT_KEYWORDS = ['事务', '事件', '任务', '事項', 'event', 'task', 'quest', 'sự kiện', '近期事务'];

  const allText = entries.map(e => `${e.comment}\n${e.content}`).join('\n').toLowerCase();

  if (TIME_KEYWORDS.some(tk => allText.includes(tk))) {
    fields.push({ path: '/世界/当前时间', reason: 'Phát hiện time tracking trong lorebook', confidence: 0.9 });
  }
  if (LOC_KEYWORDS.some(lk => allText.includes(lk))) {
    fields.push({ path: '/世界/当前地点', reason: 'Phát hiện location tracking trong lorebook', confidence: 0.9 });
  }
  if (EVENT_KEYWORDS.some(ek => allText.includes(ek))) {
    fields.push({ path: '/世界/近期事务', reason: 'Phát hiện event/task tracking → record', confidence: 0.75 });
  }

  return fields;
}

function detectSystems(entries: LorebookEntry[]): DetectedSystem[] {
  const systems: DetectedSystem[] = [];
  const allText = entries.map(e => `${e.comment}\n${e.content}`).join('\n').toLowerCase();

  // Inventory system
  const INV_KEYWORDS = ['物品', '道具', '背包', '行囊', '物品栏', 'inventory', 'item', 'vật phẩm', 'đồ vật', '数量'];
  if (INV_KEYWORDS.filter(k => allText.includes(k)).length >= 2) {
    systems.push({
      name: '物品栏',
      type: 'inventory',
      fields: [
        { key: '描述', dataType: 'string' },
        { key: '数量', dataType: 'number' },
      ],
      evidence: INV_KEYWORDS.filter(k => allText.includes(k)),
    });
  }

  // Quest/mission system
  const QUEST_KEYWORDS = ['任务', '使命', '目标', '委托', 'quest', 'mission', 'task', 'nhiệm vụ'];
  if (QUEST_KEYWORDS.filter(k => allText.includes(k)).length >= 2) {
    systems.push({
      name: '任务',
      type: 'quest',
      fields: [
        { key: '描述', dataType: 'string' },
        { key: '状态', dataType: 'string' },
      ],
      evidence: QUEST_KEYWORDS.filter(k => allText.includes(k)),
    });
  }

  // Cultivation/level system
  const CULT_KEYWORDS = ['修炼', '修練', '境界', '等级', '经验', '灵力', '真气', 'cultivation', 'level', 'rank', 'tu luyện', 'cấp bậc'];
  if (CULT_KEYWORDS.filter(k => allText.includes(k)).length >= 2) {
    systems.push({
      name: '修炼',
      type: 'cultivation',
      fields: [
        { key: '境界', dataType: 'string' },
        { key: '等级', dataType: 'number' },
        { key: '经验', dataType: 'number' },
      ],
      evidence: CULT_KEYWORDS.filter(k => allText.includes(k)),
    });
  }

  // Economy system
  const ECON_KEYWORDS = ['金币', '银币', '货币', '余额', '积分', '灵石', 'gold', 'coin', 'money', 'currency', 'tiền'];
  if (ECON_KEYWORDS.filter(k => allText.includes(k)).length >= 2) {
    systems.push({
      name: '经济',
      type: 'economy',
      fields: [
        { key: '余额', dataType: 'number' },
      ],
      evidence: ECON_KEYWORDS.filter(k => allText.includes(k)),
    });
  }

  // Combat system
  const COMBAT_KEYWORDS = ['战斗', '攻击', '防御', '生命值', 'hp', 'mp', '魔力', '体力', 'combat', 'attack', 'defense', 'chiến đấu'];
  if (COMBAT_KEYWORDS.filter(k => allText.includes(k)).length >= 2) {
    systems.push({
      name: '战斗',
      type: 'combat',
      fields: [
        { key: 'HP', dataType: 'number' },
        { key: 'MP', dataType: 'number' },
        { key: '攻击', dataType: 'number' },
        { key: '防御', dataType: 'number' },
      ],
      evidence: COMBAT_KEYWORDS.filter(k => allText.includes(k)),
    });
  }

  // Emotion/mood system
  const MOOD_KEYWORDS = ['心情', '情绪', '精神状态', '心理', 'mood', 'emotion', 'mental', 'cảm xúc', 'tâm trạng'];
  if (MOOD_KEYWORDS.filter(k => allText.includes(k)).length >= 1) {
    systems.push({
      name: '心情',
      type: 'emotion',
      fields: [
        { key: '心情', dataType: 'string' },
      ],
      evidence: MOOD_KEYWORDS.filter(k => allText.includes(k)),
    });
  }

  return systems;
}

function detectEnumCandidates(kvPairs: DetectedKVPair[]): InferenceReport['detectedEnums'] {
  const enums: InferenceReport['detectedEnums'] = [];

  // Group by key, if multiple distinct values for same key, it might be enum
  const keyValues = new Map<string, Set<string>>();
  for (const kv of kvPairs) {
    if (kv.dataType !== 'string') continue;
    const set = keyValues.get(kv.key) ?? new Set();
    set.add(kv.value);
    keyValues.set(kv.key, set);
  }

  for (const [key, values] of keyValues) {
    if (values.size >= 3 && values.size <= 12) {
      enums.push({
        path: `/${key}`,
        values: [...values],
        source: `${values.size} giá trị khác nhau cho "${key}"`,
      });
    }
  }

  return enums;
}

// ═══════════════════════════════════════════════════════════════════════════
// PREFIX GROUP DETECTION
// ═══════════════════════════════════════════════════════════════════════════

function detectPrefixGroups(entries: LorebookEntry[]): InferenceReport['detectedGroups'] {
  const prefixMap = new Map<string, string[]>();
  const prefixPatterns = [
    /^(.+?)\s*\d+\s*[:：]\s*/,
    /^\[(.+?)\s*\d*\]\s*/,
    /^(.+?)\s*—\s*/,
    /^(.+?)\s*[|｜]\s*/,
  ];

  for (const entry of entries) {
    for (const pattern of prefixPatterns) {
      const match = entry.comment.match(pattern);
      if (match) {
        const prefix = match[1].trim();
        if (prefix.length > 1 && prefix.length < 20) {
          const values = prefixMap.get(prefix) ?? [];
          values.push(entry.comment);
          prefixMap.set(prefix, values);
        }
        break;
      }
    }
  }

  return Array.from(prefixMap.entries())
    .filter(([, vals]) => vals.length >= 2)
    .map(([name, vals]) => ({ name, count: vals.length, sample: vals.slice(0, 5) }))
    .sort((a, b) => b.count - a.count);
}

// ═══════════════════════════════════════════════════════════════════════════
// BUILD SCHEMA FROM REPORT (rich output)
// ═══════════════════════════════════════════════════════════════════════════

export function buildMinimalSchemaFromReport(report: InferenceReport): MVUZODSchema {
  const fields: MVUZODField[] = [];
  const reportExt = report as InferenceReport & { _entities?: Map<string, DetectedEntity>; _systems?: DetectedSystem[] };
  const entities = reportExt._entities ?? new Map();
  const systems = reportExt._systems ?? [];

  // ─── 世界 (World) ──────────────────────────────────────────────────
  const worldChildren: MVUZODField[] = [];

  // Time
  const hasTime = report.suggestedFields.some(f => f.path.includes('时间'));
  if (hasTime) {
    worldChildren.push({
      path: '/世界/当前时间', type: 'string', label: '当前时间',
      defaultValue: '', constraints: { prefault: 'Chưa khởi tạo', updateFormat: 'YYYY年MM月DD日 星期X HH:MM' },
      checkRules: ['Cập nhật thời gian dựa trên diễn biến cốt truyện'],
    } as MVUZODField & { checkRules?: string[] });
  }

  // Location
  const hasLocation = report.suggestedFields.some(f => f.path.includes('地点'));
  if (hasLocation) {
    worldChildren.push({
      path: '/世界/当前地点', type: 'string', label: '当前地点',
      defaultValue: '', constraints: { prefault: 'Chưa khởi tạo' },
    });
  }

  // Events
  const hasEvents = report.suggestedFields.some(f => f.path.includes('事务'));
  if (hasEvents) {
    worldChildren.push({
      path: '/世界/近期事务', type: 'record', label: '近期事务',
      defaultValue: {}, constraints: { prefault: {}, describe: '事务名', transform: 'takeRight' },
      description: 'Record<事务名, 事务描述>',
    });
  }

  // Scene types from enums
  const sceneEnum = report.detectedEnums.find(e =>
    e.values.some(v => ['战斗', '日常', '探索', 'combat', 'daily'].some(k => v.toLowerCase().includes(k)))
  );
  if (sceneEnum) {
    worldChildren.push({
      path: '/世界/场景类型', type: 'string', label: '场景类型',
      defaultValue: sceneEnum.values[0] ?? '日常',
      constraints: { prefault: sceneEnum.values[0] ?? '日常', enumValues: sceneEnum.values },
    });
  }

  // Always add world if any children exist, or add basic world
  if (worldChildren.length === 0) {
    worldChildren.push(
      { path: '/世界/当前时间', type: 'string', label: '当前时间', defaultValue: '', constraints: { prefault: 'Chưa khởi tạo' } },
      { path: '/世界/当前地点', type: 'string', label: '当前地点', defaultValue: '', constraints: { prefault: 'Chưa khởi tạo' } },
    );
  }

  fields.push({
    path: '/世界', type: 'object', label: '世界', defaultValue: {}, constraints: {},
    children: worldChildren,
  });

  // ─── Characters ────────────────────────────────────────────────────
  const CLOTHING_SLOTS_DEFAULT = ['上装', '下装', '内衣', '袜子', '鞋子', '饰品'];

  for (const [name, entity] of entities) {
    if (entity.type !== 'character') continue;

    const charChildren: MVUZODField[] = [];

    // Numeric attributes (好感度, 依存度, HP, etc.)
    for (const [attrKey, attrVal] of entity.attributes) {
      if (attrVal.dataType === 'number') {
        const isRelation = RELATION_KEYWORDS.some(rk => attrKey.toLowerCase().includes(rk));
        charChildren.push({
          path: `/${name}/${attrKey}`, type: 'number', label: attrKey,
          defaultValue: Number(attrVal.value) || 0,
          constraints: {
            coerce: true,
            prefault: Number(attrVal.value) || 0,
            ...(isRelation ? { clamp: [0, 100], transform: 'clamp' } : {}),
          },
          ...(isRelation ? {
            checkRules: [`根据${name}对{{user}}行为的感知和反应调整 ±(3~6)`, `仅在${name}当前察觉到{{user}}的行为时才更新`],
          } as Record<string, unknown> : {}),
        } as MVUZODField);
      }
    }

    // Clothing system for this character
    const hasClothingForChar = entity.stateKeys.some((sk: string) =>
      ['着装', '服装', '穿着', 'outfit', 'clothing'].some(ck => sk.toLowerCase().includes(ck))
    ) || [...entity.attributes.keys()].some(k =>
      CLOTHING_SLOTS_DEFAULT.some(slot => k.includes(slot))
    );

    if (hasClothingForChar) {
      charChildren.push({
        path: `/${name}/着装`, type: 'record', label: '着装',
        defaultValue: {},
        constraints: {
          prefault: {},
          enumValues: CLOTHING_SLOTS_DEFAULT,
          describe: '部位',
        },
        description: 'Record<enum[上装|下装|内衣|袜子|鞋子|饰品], 服装描述>',
      });
    }

    // String attributes (性格, 状态, etc.)
    for (const [attrKey, attrVal] of entity.attributes) {
      if (attrVal.dataType === 'string' && !attrKey.includes('着装') && attrKey.length <= 10) {
        // Skip if already handled
        if (charChildren.some(c => c.label === attrKey)) continue;
        charChildren.push({
          path: `/${name}/${attrKey}`, type: 'string', label: attrKey,
          defaultValue: attrVal.value || '', constraints: { prefault: attrVal.value || 'Chưa khởi tạo' },
        });
      }
    }

    // 称号 system if detected
    const hasTitles = [...entity.attributes.keys()].some(k =>
      ['称号', '头衔', 'title', 'danh hiệu'].some(tk => k.toLowerCase().includes(tk))
    );
    if (hasTitles) {
      charChildren.push({
        path: `/${name}/称号`, type: 'record', label: '称号',
        defaultValue: {},
        constraints: { prefault: {}, describe: '称号名' },
        description: 'Record<称号名, {效果, 自我评价}>',
      });
    }

    if (charChildren.length > 0) {
      fields.push({
        path: `/${name}`, type: 'object', label: name, defaultValue: {},
        constraints: {},
        children: charChildren,
      });
    }
  }

  // ─── 主角 (Player) — always add ────────────────────────────────────
  const playerChildren: MVUZODField[] = [];

  // Inventory
  const hasInventory = systems.some(s => s.type === 'inventory');
  if (hasInventory) {
    playerChildren.push({
      path: '/主角/物品栏', type: 'record', label: '物品栏',
      defaultValue: {},
      constraints: { prefault: {}, describe: '物品名', transform: 'pickBy' },
      description: 'Record<物品名, {描述, 数量}>',
      children: [
        { path: '/主角/物品栏/_child/描述', type: 'string', label: '描述', defaultValue: '', constraints: { prefault: '' } },
        { path: '/主角/物品栏/_child/数量', type: 'number', label: '数量', defaultValue: 1, constraints: { coerce: true, prefault: 1 } },
      ],
    });
  }

  // Economy
  const hasEconomy = systems.some(s => s.type === 'economy');
  if (hasEconomy) {
    const econSys = systems.find(s => s.type === 'economy')!;
    for (const f of econSys.fields) {
      playerChildren.push({
        path: `/主角/${f.key}`, type: f.dataType === 'number' ? 'number' : 'string',
        label: f.key, defaultValue: f.dataType === 'number' ? 0 : '',
        constraints: { coerce: f.dataType === 'number', prefault: f.dataType === 'number' ? 0 : '' },
      });
    }
  }

  // Combat stats
  const hasCombat = systems.some(s => s.type === 'combat');
  if (hasCombat) {
    const combatSys = systems.find(s => s.type === 'combat')!;
    const combatChildren: MVUZODField[] = [];
    for (const f of combatSys.fields) {
      combatChildren.push({
        path: `/主角/战斗/${f.key}`, type: 'number', label: f.key,
        defaultValue: 0, constraints: { coerce: true, prefault: 0, clamp: [0, 9999] },
      });
    }
    playerChildren.push({
      path: '/主角/战斗', type: 'object', label: '战斗属性', defaultValue: {},
      constraints: {}, children: combatChildren,
    });
  }

  // Cultivation
  const hasCultivation = systems.some(s => s.type === 'cultivation');
  if (hasCultivation) {
    const cultSys = systems.find(s => s.type === 'cultivation')!;
    const cultChildren: MVUZODField[] = [];
    for (const f of cultSys.fields) {
      cultChildren.push({
        path: `/主角/修炼/${f.key}`,
        type: f.dataType === 'number' ? 'number' : 'string',
        label: f.key,
        defaultValue: f.dataType === 'number' ? 0 : '',
        constraints: {
          coerce: f.dataType === 'number',
          prefault: f.dataType === 'number' ? 0 : '',
          ...(f.dataType === 'number' ? { clamp: [0, 9999] } : {}),
        },
      });
    }
    playerChildren.push({
      path: '/主角/修炼', type: 'object', label: '修炼', defaultValue: {},
      constraints: {}, children: cultChildren,
    });
  }

  // Quest
  const hasQuest = systems.some(s => s.type === 'quest');
  if (hasQuest) {
    playerChildren.push({
      path: '/主角/任务', type: 'record', label: '任务',
      defaultValue: {}, constraints: { prefault: {}, describe: '任务名' },
      description: 'Record<任务名, {描述, 状态}>',
    });
  }

  // If no specific fields found, add basic structure
  if (playerChildren.length === 0) {
    playerChildren.push(
      { path: '/主角/物品栏', type: 'record', label: '物品栏', defaultValue: {}, constraints: { prefault: {}, describe: '物品名', transform: 'pickBy' }, description: 'Record<物品名, {描述, 数量}>' },
    );
  }

  fields.push({
    path: '/主角', type: 'object', label: '主角', defaultValue: {},
    constraints: {}, children: playerChildren,
  });

  // ─── Enum groups as standalone objects ──────────────────────────────
  for (const group of report.detectedGroups) {
    if (group.count >= 3) {
      // Don't duplicate if already in a character or world
      const alreadyAdded = fields.some(f =>
        f.path === `/${group.name}` || f.children?.some(c => c.label === group.name)
      );
      if (!alreadyAdded) {
        fields.push({
          path: `/${group.name}`, type: 'string', label: `${group.name} hiện tại`,
          defaultValue: group.sample[0] ?? '',
          constraints: { prefault: group.sample[0] ?? '', enumValues: group.sample },
          description: `${group.count} variants detected`,
        });
      }
    }
  }

  return { version: '1.0', fields };
}

// ═══════════════════════════════════════════════════════════════════════════
// SCHEMA TO ZOD CODE (MVU_ZOD spec compliant)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Convert MVUZODSchema to Zod 4 code string.
 * Follows MVU_ZOD spec:
 *   - Variable name: `Schema` (uppercase)
 *   - No .passthrough(), no .strict()
 *   - z.coerce.number() preferred
 *   - .prefault() instead of .default()
 *   - .describe() for record keys
 *   - .transform() for clamp, pickBy, takeRight
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function schemaToZodCode(schema: MVUZODSchema, _cardName: string): string {
  const lines: string[] = [
    `export const Schema = z.object({`,
  ];

  for (const field of schema.fields) {
    lines.push(...fieldToZod(field, 1));
  }

  lines.push(`});`);

  return lines.join('\n');
}

function fieldToZod(field: MVUZODField, indent: number): string[] {
  const pad = '  '.repeat(indent);
  const lines: string[] = [];
  const name = field.path.split('/').pop() ?? field.path;
  const key = JSON.stringify(name);

  if (field.type === 'object' && field.children?.length) {
    // z.object({ ... })
    lines.push(`${pad}${key}: z.object({`);
    for (const child of field.children) {
      lines.push(...fieldToZod(child, indent + 1));
    }

    // Object-level transform
    let transform = '';
    if (field.constraints?.transform === 'custom' && field.constraints?.transformExpr) {
      transform = `.transform(${field.constraints?.transformExpr})`;
    }

    lines.push(`${pad}})${transform},`);

  } else if (field.type === 'record') {
    // z.record(keySchema, valueSchema)
    const keyDesc = field.constraints?.describe;
    const keySchema = keyDesc ? `z.string().describe('${keyDesc}')` : 'z.string()';

    // Build value schema from children or constraints
    let valueSchema: string;
    if (field.children?.length) {
      const childLines: string[] = [];
      for (const child of field.children) {
        if (child.path.includes('/_child/')) {
          const childName = child.path.split('/').pop() ?? '';
          const zodType = buildZodType(child);
          childLines.push(`${pad}    ${JSON.stringify(childName)}: ${zodType},`);
        }
      }
      if (childLines.length > 0) {
        valueSchema = `z.object({\n${childLines.join('\n')}\n${pad}  })`;
      } else {
        valueSchema = 'z.string()';
      }
    } else if (field.constraints?.enumValues) {
      // Record with enum keys: z.record(z.enum([...]), valueType)
      const enumVals = field.constraints?.enumValues.map(v => `'${v}'`).join(', ');
      const enumKeySchema = `z.enum([${enumVals}])`;
      valueSchema = `z.string().describe('描述')`;
      lines.push(`${pad}${key}: z.record(${enumKeySchema}, ${valueSchema}).prefault({}),`);
      return lines;
    } else {
      valueSchema = 'z.string()';
    }

    // Transform
    let transform = '';
    if (field.constraints?.transform === 'pickBy') {
      transform = `\n${pad}  .transform(data => _.pickBy(data, ({ 数量 }) => 数量 > 0))`;
    } else if (field.constraints?.transform === 'takeRight') {
      transform = `\n${pad}  .transform(data => _(data).entries().takeRight(10).fromPairs().value())`;
    }

    lines.push(`${pad}${key}: z.record(${keySchema}, ${valueSchema})${transform}.prefault({}),`);

  } else if (field.type === 'number') {
    lines.push(`${pad}${key}: ${buildZodType(field)},`);

  } else if (field.type === 'boolean') {
    const pf = field.constraints?.prefault !== undefined ? `.prefault(${field.constraints?.prefault})` : '.prefault(false)';
    lines.push(`${pad}${key}: z.boolean()${pf},`);

  } else if (field.type === 'array') {
    // (bug 148) Array có CẤU TRÚC PHẦN TỬ: children mang path "/_child/" mô tả một phần tử
    // (cùng quy ước với record). Trước đây array luôn là z.array(z.string()) nên "Kho Đồ" có
    // tên+số lượng+mô tả đều bị ép thành một chuỗi — mất cấu trúc ngay từ schema.
    const childLines: string[] = [];
    for (const child of field.children ?? []) {
      if (!child.path.includes('/_child/')) continue;
      const childName = child.path.split('/').pop() ?? '';
      childLines.push(`${pad}    ${JSON.stringify(childName)}: ${buildZodType(child)},`);
    }
    const itemSchema = childLines.length > 0
      ? `z.object({\n${childLines.join('\n')}\n${pad}  })`
      : 'z.string()';
    lines.push(`${pad}${key}: z.array(${itemSchema}).prefault([]),`);

  } else {
    // string
    lines.push(`${pad}${key}: ${buildZodType(field)},`);
  }

  return lines;
}

function buildZodType(field: MVUZODField): string {
  if (field.type === 'number') {
    let s = field.constraints?.coerce ? 'z.coerce.number()' : 'z.number()';
    if (field.constraints?.clamp) {
      s += `.transform(v => _.clamp(v, ${field.constraints?.clamp[0]}, ${field.constraints?.clamp[1]}))`;
    }
    const pf = field.constraints?.prefault !== undefined ? field.constraints?.prefault : (field.defaultValue ?? 0);
    s += `.prefault(${pf})`;
    return s;
  }

  if (field.type === 'string') {
    let s = 'z.string()';
    // Enum
    if (field.constraints?.enumValues?.length) {
      const vals = field.constraints?.enumValues.map(v => `'${v}'`).join(', ');
      s = `z.enum([${vals}])`;
    }
    // Describe
    if (field.constraints?.describe) {
      s += `.describe('${field.constraints?.describe}')`;
    }
    // Prefault
    const pf = field.constraints?.prefault !== undefined
      ? JSON.stringify(field.constraints?.prefault)
      : JSON.stringify(field.defaultValue ?? '');
    if (pf !== '""') s += `.prefault(${pf})`;
    return s;
  }

  return 'z.string()';
}

// ═══════════════════════════════════════════════════════════════════════════
// AI INFERENCE PARSING
// ═══════════════════════════════════════════════════════════════════════════

export function buildInferenceResult(entries: LorebookEntry[]): InferenceResult {
  const report = analyzeLorebookForSchema(entries);
  const proposedSchema = buildMinimalSchemaFromReport(report);
  return { proposedSchema, inferenceReport: report };
}

/**
 * Repair truncated JSON from AI response.
 */
function repairJSON(text: string): string {
  let s = text.trim();
  s = s.replace(/\\(?!["\\/bfnrtu])/g, '\\\\');
  s = s.replace(/,\s*$/, '');

  const quoteCount = (s.match(/(?<!\\)"/g) || []).length;
  if (quoteCount % 2 !== 0) s += '"';

  s = s.replace(/,?\s*"[^"]*"\s*:\s*$/, '');
  s = s.replace(/,\s*$/, '');

  let openBraces = 0, openBrackets = 0;
  let inString = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"' && (i === 0 || s[i - 1] !== '\\')) { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') openBraces++;
    else if (ch === '}') openBraces--;
    else if (ch === '[') openBrackets++;
    else if (ch === ']') openBrackets--;
  }

  s = s.replace(/,\s*$/, '');
  while (openBrackets > 0) { s += ']'; openBrackets--; }
  while (openBraces > 0) { s += '}'; openBraces--; }
  return s;
}

export function parseSchemaInferenceResponse(raw: string): {
  analysis: {
    groups: Array<{ name: string; count: number; sample: string[] }>;
    npcPattern: boolean;
    cultivationSystem: boolean;
    sceneTypes: string[];
    inventorySystem: boolean;
    warnings: string[];
  };
  proposedSchema: MVUZODSchema;
} {
  let cleaned = raw.trim();

  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]+?)```/i);
  if (fenceMatch) cleaned = fenceMatch[1].trim();

  const firstBrace = cleaned.indexOf('{');
  if (firstBrace !== -1) {
    let openBraces = 0;
    let inString = false;
    let escape = false;
    let validEndIndex = -1;
    
    for (let i = firstBrace; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (inString) {
        if (escape) {
          escape = false;
        } else if (ch === '\\') {
          escape = true;
        } else if (ch === '"') {
          inString = false;
        }
      } else {
        if (ch === '"') {
          inString = true;
        } else if (ch === '{') {
          openBraces++;
        } else if (ch === '}') {
          openBraces--;
          if (openBraces === 0) {
            validEndIndex = i;
            break;
          }
        }
      }
    }
    
    if (validEndIndex !== -1) {
      cleaned = cleaned.substring(firstBrace, validEndIndex + 1);
    } else {
      const lastBrace = cleaned.lastIndexOf('}');
      if (lastBrace > firstBrace) {
        cleaned = cleaned.substring(firstBrace, lastBrace + 1);
      }
    }
  }

  cleaned = cleaned
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(?:^|[^:])\/\/.*$/gm, '');
  cleaned = cleaned.replace(/,\s*([\]}])/g, '$1');

  let obj: unknown;
  try {
    obj = JSON.parse(cleaned);
  } catch {
    try {
      obj = JSON.parse(repairJSON(cleaned));
      console.warn("JSON was repaired from truncated AI response");
    } catch (err) {
      console.error("JSON parsing failed even after repair. Raw response:", raw);
      const rawPreview = raw.trim() ? `"${raw.slice(0, 200)}${raw.length > 200 ? '...' : ''}"` : "(chuỗi rỗng)";
      throw new Error(
        `Không thể phân tích JSON từ AI. Lỗi: ${err instanceof Error ? err.message : String(err)}. Response: ${rawPreview}`,
        { cause: err }
      );
    }
  }

  if (!obj || typeof obj !== 'object') {
    throw new Error("Dữ liệu trả về từ AI không phải là một JSON Object hợp lệ.");
  }

  // (Bug enumValues 19/07) AI hay bỏ key `constraints` trong field → normalize trước khi trả
  // để SchemaWizard/InitVarEditor/UpdateRulesEditor không crash "reading 'enumValues'".
  const typed = obj as {
    analysis: {
      groups: Array<{ name: string; count: number; sample: string[] }>;
      npcPattern: boolean;
      cultivationSystem: boolean;
      sceneTypes: string[];
      inventorySystem: boolean;
      warnings: string[];
    };
    proposedSchema: MVUZODSchema;
  };
  typed.proposedSchema = normalizeMVUZODSchema(typed.proposedSchema);
  return typed;
}
