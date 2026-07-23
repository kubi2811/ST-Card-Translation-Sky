// (User 23/07 — Chiến lược A) Dịch card dùng Mythic (Auto Database).
//
// Test QUAN TRỌNG NHẤT của file này là bộ test tích hợp cuối: tính lại hash cho 660 skill
// trong card THẬT (bugNeedFix/94) và đối chiếu với giá trị script đã ghi sẵn. Nếu công thức
// hash của ta lệch dù một bit, hash sẽ không khớp và card dịch ra sẽ bị script coi là hỏng.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  fnv1a, stableHashHex, normalizeStringList, normalizeEras, stripAllMeta,
  buildSourceHash, buildSkillHash, parseMythicComment, detectMythicCard,
  extractMythicFields, applyMythicTranslation, titleHasEraKeyword, titleTranslationIsSafe,
} from '../mythicSkill';

describe('fnv1a — chép đúng thuật toán trong script Agent', () => {
  it('trùng giá trị tham chiếu của FNV-1a 32-bit', () => {
    // offset basis khi chuỗi rỗng
    expect(fnv1a('')).toBe(0x811c9dc5);
    // 'a' = 0x811c9dc5 ^ 97, rồi × 0x01000193 (imul, 32-bit)
    expect(fnv1a('a')).toBe(0xe40c292c);
    expect(fnv1a('foobar')).toBe(0xbf9cf968);
  });

  it('hex luôn đủ 8 ký tự', () => {
    expect(stableHashHex('')).toHaveLength(8);
    expect(stableHashHex('x')).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('normalizeStringList — thứ tự sắp xếp ảnh hưởng thẳng tới hash', () => {
  it('tách theo dấu phẩy thường và phẩy toàn rộng', () => {
    expect(normalizeStringList('b,a，c')).toEqual(['a', 'b', 'c']);
  });
  it('bỏ trùng và bỏ rỗng', () => {
    expect(normalizeStringList(['a', 'a', '', '  '])).toEqual(['a']);
  });
  it('sắp xếp theo locale zh-CN (đúng như script)', () => {
    const out = normalizeStringList(['乙', '甲']);
    expect(out).toEqual([...out].sort((a, b) => a.localeCompare(b, 'zh-CN')));
  });
  it('normalizeEras giữ đúng thứ tự ERA_IDS, không theo thứ tự đầu vào', () => {
    expect(normalizeEras(['common', 'dou1'])).toEqual(['dou1', 'common']);
    expect(normalizeEras('DOU4')).toEqual(['dou4']);
    expect(normalizeEras(['khong-ton-tai'])).toEqual([]);
  });
});

describe('parseMythicComment — meta nằm trong COMMENT, không phải content', () => {
  const comment = [
    '🧬斗四：斗天者',
    '',
    '<!-- ACU_SKILL_META_START',
    '{"version":1,"description":"mô tả","triggerWhen":"khi nào","tk":234}',
    'ACU_SKILL_META_END -->',
  ].join('\n');

  it('tách được tiêu đề và khối meta', () => {
    const p = parseMythicComment(comment);
    expect(p.title).toBe('🧬斗四：斗天者');
    expect(p.blocks).toHaveLength(1);
    expect(p.blocks[0].name).toBe('ACU_SKILL_META');
    expect(p.blocks[0].data.description).toBe('mô tả');
  });

  it('khối JSON hỏng thì BỎ QUA, không dựng lại kẻo phá dữ liệu', () => {
    const bad = '<!-- ACU_SKILL_META_START\n{khong-phai-json\nACU_SKILL_META_END -->';
    expect(parseMythicComment(bad).blocks).toHaveLength(0);
  });

  it('comment không có meta → 0 khối, tiêu đề nguyên vẹn', () => {
    expect(parseMythicComment('Chỉ là tên').blocks).toHaveLength(0);
    expect(parseMythicComment('Chỉ là tên').title).toBe('Chỉ là tên');
  });

  it('stripAllMeta bóc sạch mọi khối', () => {
    expect(stripAllMeta(comment)).toBe('🧬斗四：斗天者');
  });
});

describe('trích + ghép bản dịch', () => {
  const mkCard = (comment: string) => ({ data: { character_book: { entries: [{ comment, content: 'nội dung' }] } } });

  it('CHỈ trích description và triggerWhen, không đụng field kỹ thuật', () => {
    const card = mkCard('T\n<!-- ACU_SKILL_META_START\n{"version":1,"description":"d","triggerWhen":"t","tk":5,"updatedBy":"agent"}\nACU_SKILL_META_END -->');
    const f = extractMythicFields(card);
    expect(f.map(x => x.field).sort()).toEqual(['description', 'triggerWhen']);
    expect(f.every(x => x.entryIndex === 0)).toBe(true);
  });

  it('ghép bản dịch vào đúng chỗ, GIỮ NGUYÊN field kỹ thuật', () => {
    const comment = 'T\n<!-- DOULUO_AGENT_SKILL_V2_START\n{"version":2,"kind":"douluo_agent_skill","description":"d","triggerWhen":"t","eras":["dou4"],"tk":7,"updatedAt":123}\nDOULUO_AGENT_SKILL_V2_END -->';
    const tr = new Map([
      ['DOULUO_AGENT_SKILL_V2.description', 'mô tả tiếng Việt'],
      ['DOULUO_AGENT_SKILL_V2.triggerWhen', 'kích hoạt khi nói về nhiệm vụ'],
    ]);
    const r = applyMythicTranslation(comment, tr, { comment: 'T', content: 'nội dung' });
    const b = parseMythicComment(r.comment).blocks[0];

    expect(r.metaFieldsApplied).toBe(2);
    expect(b.data.description).toBe('mô tả tiếng Việt');
    expect(b.data.triggerWhen).toBe('kích hoạt khi nói về nhiệm vụ');
    // field kỹ thuật: y nguyên
    expect(b.data.version).toBe(2);
    expect(b.data.kind).toBe('douluo_agent_skill');
    expect(b.data.eras).toEqual(['dou4']);
    expect(b.data.tk).toBe(7);
    expect(b.data.updatedAt).toBe(123);
  });

  it('TÍNH LẠI hash sau khi dịch — giữ hash cũ là script coi entry đã hỏng', () => {
    const comment = 'T\n<!-- DOULUO_AGENT_SKILL_V2_START\n{"version":2,"kind":"douluo_agent_skill","description":"d","triggerWhen":"t","eras":["dou4"],"sourceHash":"fnv1a-v1:00000000","sourceSkillHash":"fnv1a-v1:00000000","tk":7}\nDOULUO_AGENT_SKILL_V2_END -->';
    const tr = new Map([['DOULUO_AGENT_SKILL_V2.description', 'mô tả mới']]);
    const entry = { comment: 'T', content: 'nội dung đã dịch' };
    const r = applyMythicTranslation(comment, tr, entry);
    const b = parseMythicComment(r.comment).blocks[0];

    expect(r.hashesRebuilt).toContain('DOULUO_AGENT_SKILL_V2.sourceSkillHash');
    expect(r.hashesRebuilt).toContain('DOULUO_AGENT_SKILL_V2.sourceHash');
    expect(b.data.sourceSkillHash).toBe(buildSkillHash({ description: 'mô tả mới', triggerWhen: 't', tk: 7 }));
    expect(b.data.sourceHash).toBe(buildSourceHash(entry, ['dou4']));
  });

  it('không có gì đổi → giữ nguyên comment từng byte', () => {
    const comment = 'T\n<!-- ACU_SKILL_META_START\n{"version":1,"description":"d","triggerWhen":"t","tk":1}\nACU_SKILL_META_END -->';
    expect(applyMythicTranslation(comment, new Map(), { comment: 'T' }).comment).toBe(comment);
  });
});

describe('giữ era khi dịch tiêu đề — mất era là skill bị LOẠI HOÀN TOÀN', () => {
  it('nhận diện từ khoá era trong tiêu đề', () => {
    expect(titleHasEraKeyword('🧬斗四：斗天者')).toBe(true);
    expect(titleHasEraKeyword('通用：世界观')).toBe(true);
    expect(titleHasEraKeyword('Nhân vật Đường Tam')).toBe(false);
  });

  it('meta CÓ eras → dịch tiêu đề an toàn (script đọc meta, không dò tiêu đề)', () => {
    const c = '🧬斗四：X\n<!-- DOULUO_AGENT_SKILL_V2_START\n{"version":2,"kind":"douluo_agent_skill","description":"d","triggerWhen":"t","eras":["dou4"]}\nDOULUO_AGENT_SKILL_V2_END -->';
    expect(titleTranslationIsSafe(c)).toBe(true);
  });

  it('meta KHÔNG có eras mà tiêu đề chứa từ khoá era → KHÔNG an toàn', () => {
    const c = '🧬斗四：X\n<!-- ACU_SKILL_META_START\n{"version":1,"description":"d","triggerWhen":"t"}\nACU_SKILL_META_END -->';
    expect(titleTranslationIsSafe(c)).toBe(false);
  });
});

describe('detectMythicCard', () => {
  it('nhận ra card Mythic và đếm đúng số skill', () => {
    const card = { data: { character_book: { entries: [
      { comment: 'A\n<!-- ACU_SKILL_META_START\n{"version":1}\nACU_SKILL_META_END -->' },
      { comment: 'B thường' },
    ] } } };
    const d = detectMythicCard(card);
    expect(d.isMythic).toBe(true);
    expect(d.skillEntries).toBe(1);
    expect(d.totalEntries).toBe(2);
  });

  it('card thường → không phải Mythic', () => {
    expect(detectMythicCard({ data: { character_book: { entries: [{ comment: 'x' }] } } }).isMythic).toBe(false);
    expect(detectMythicCard(null).isMythic).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// TEST TÍCH HỢP TRÊN CARD MYTHIC THẬT — bằng chứng mạnh nhất cho công thức hash.
// Tính lại hash cho TỪNG skill rồi đối chiếu với giá trị script đã ghi sẵn trong thẻ.
// Lệch một bit là card dịch ra bị script coi là hỏng.
// ─────────────────────────────────────────────────────────────────────────────────
const CARD = fileURLToPath(new URL('../../../bugNeedFix/94/reborn_card.json', import.meta.url));
const hasFixture = fs.existsSync(CARD);

describe.skipIf(!hasFixture)('Chiến lược A trên CARD THẬT (Reborn V1.5)', () => {
  const card = hasFixture ? JSON.parse(fs.readFileSync(CARD, 'utf8')) : null;

  it('nhận ra là card Mythic với hàng trăm skill', () => {
    const d = detectMythicCard(card);
    expect(d.isMythic).toBe(true);
    expect(d.skillEntries).toBeGreaterThan(500);
  });

  it('CÔNG THỨC HASH khớp 100% với giá trị script đã ghi trong thẻ', () => {
    const entries = card.data.character_book.entries as { comment?: string; content?: string; keys?: unknown }[];
    let checkedSkill = 0, okSkill = 0, checkedSrc = 0, okSrc = 0;

    for (const e of entries) {
      for (const b of parseMythicComment(String(e.comment ?? '')).blocks) {
        if (typeof b.data.sourceSkillHash === 'string') {
          checkedSkill++;
          if (buildSkillHash(b.data as never) === b.data.sourceSkillHash) okSkill++;
        }
        if (typeof b.data.sourceHash === 'string') {
          checkedSrc++;
          if (buildSourceHash(e, b.data.eras) === b.data.sourceHash) okSrc++;
        }
      }
    }

    expect(checkedSkill).toBeGreaterThan(500);
    expect(okSkill, `sourceSkillHash khop ${okSkill}/${checkedSkill}`).toBe(checkedSkill);
    expect(checkedSrc).toBeGreaterThan(500);
    expect(okSrc, `sourceHash khop ${okSrc}/${checkedSrc}`).toBe(checkedSrc);
  });

  it('trích đúng khối lượng cần dịch (description + triggerWhen)', () => {
    const fields = extractMythicFields(card);
    expect(fields.length).toBeGreaterThan(1000);
    expect(new Set(fields.map(f => f.field))).toEqual(new Set(['description', 'triggerWhen']));
  });
});
