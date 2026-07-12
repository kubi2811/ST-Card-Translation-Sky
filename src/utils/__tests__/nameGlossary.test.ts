import { describe, it, expect } from 'vitest';
import {
  extractNameCandidates,
  buildNameGlossaryPrompt,
  parseNameGlossaryResponse,
  mergeGlossary,
  filterGlossaryForText,
  type NameCandidate,
} from '../nameGlossary';
import type { TranslationField } from '../../types/card';

function mkField(partial: Partial<TranslationField>): TranslationField {
  return {
    path: 'data.description',
    label: 'Description',
    group: 'core',
    original: '',
    translated: '',
    status: 'pending',
    retries: 0,
    ...partial,
  } as TranslationField;
}

describe('extractNameCandidates', () => {
  it('tìm tên lặp lại đủ tần suất trong thân văn bản', () => {
    const text = '叶凡走进大殿。叶凡看着长老。众人都在议论叶凡。叶凡笑了。';
    const fields = [mkField({ original: text })];
    const terms = extractNameCandidates(fields).map(c => c.term);
    expect(terms).toContain('叶凡');
  });

  it('cụm dưới ngưỡng minCount không được nhận', () => {
    const fields = [mkField({ original: '叶凡走了。叶凡回来了。' })]; // chỉ 2 lần
    const terms = extractNameCandidates(fields, { minCount: 3 }).map(c => c.term);
    expect(terms).not.toContain('叶凡');
  });

  it('khử cụm con: cụm ngắn sống trong cụm dài bị loại, tên gốc tần suất cao giữ lại', () => {
    // 青云宗 xuất hiện độc lập nhiều lần + 青云宗弟子 3 lần → giữ 青云宗; 云宗弟 (chỉ trong cụm dài) bị nuốt
    const base = '青云宗内门。青云宗大殿。青云宗后山。青云宗禁地。青云宗典籍。';
    const compound = '青云宗弟子来了。青云宗弟子走了。青云宗弟子跪下。';
    const fields = [mkField({ original: base + compound })];
    const terms = extractNameCandidates(fields).map(c => c.term);
    expect(terms).toContain('青云宗');
    expect(terms).not.toContain('云宗弟');
  });

  it('lọc hư từ + stop terms', () => {
    const fields = [mkField({
      original: '什么什么什么什么。时候时候时候时候。他的剑他的剑他的剑他的剑。',
    })];
    const terms = extractNameCandidates(fields).map(c => c.term);
    expect(terms).not.toContain('什么');
    expect(terms).not.toContain('时候');
    expect(terms.some(t => t.includes('的'))).toBe(false);
  });

  it('keyword lorebook được ưu tiên dù chỉ xuất hiện 1 lần', () => {
    const fields = [
      mkField({ path: 'data.character_book.entries[0].keys', group: 'lorebook_keys', original: '苏媚儿, 天剑门' }),
      mkField({ original: '一段văn bản không nhắc tên nào cả。' }),
    ];
    const cands = extractNameCandidates(fields);
    const terms = cands.map(c => c.term);
    expect(terms).toContain('苏媚儿');
    expect(terms).toContain('天剑门');
    expect(cands.find(c => c.term === '苏媚儿')?.fromKeys).toBe(true);
  });

  it('bỏ qua field schema (initvar/mvu_logic) và field không pending', () => {
    const fields = [
      mkField({ original: '好感度好感度好感度好感度', entryType: 'initvar' }),
      mkField({ original: '战斗力战斗力战斗力战斗力', status: 'done' }),
    ];
    const terms = extractNameCandidates(fields).map(c => c.term);
    expect(terms).not.toContain('好感度');
    expect(terms).not.toContain('战斗力');
  });

  it('tôn trọng trần maxCandidates', () => {
    // 30 "tên" khác nhau, mỗi tên lặp 3 lần
    let text = '';
    for (let i = 0; i < 30; i++) {
      const name = String.fromCharCode(0x4e00 + i * 7) + String.fromCharCode(0x4e01 + i * 7);
      text += `${name}。${name}。${name}。`;
    }
    const fields = [mkField({ original: text })];
    const cands = extractNameCandidates(fields, { maxCandidates: 10 });
    expect(cands.length).toBeLessThanOrEqual(10);
  });
});

describe('buildNameGlossaryPrompt + parseNameGlossaryResponse', () => {
  const candidates: NameCandidate[] = [
    { term: '叶凡', count: 27, fromKeys: false },
    { term: '青云宗', count: 12, fromKeys: true },
    { term: '金丹', count: 8, fromKeys: false },
  ];

  it('prompt chứa ứng viên + ngôn ngữ đích', () => {
    const { system, user } = buildNameGlossaryPrompt(candidates, 'Tiếng Việt');
    expect(system).toContain('Tiếng Việt');
    expect(user).toContain('叶凡 (27 lần)');
    expect(user).toContain('keyword lorebook');
  });

  it('parse dòng hợp lệ, chấp nhận nhiều kiểu phân cách + bỏ đánh số/code fence', () => {
    const raw = '```\n1. 叶凡=Diệp Phàm\n- 青云宗 → Thanh Vân Tông\n金丹\tKim Đan\n```';
    const entries = parseNameGlossaryResponse(raw, candidates);
    expect(entries).toEqual([
      { source: '叶凡', target: 'Diệp Phàm' },
      { source: '青云宗', target: 'Thanh Vân Tông' },
      { source: '金丹', target: 'Kim Đan' },
    ]);
  });

  it('chặn source bịa, target còn chữ Hán, target rỗng/SKIP, source trùng lặp', () => {
    const raw = [
      '不存在的词=Từ Bịa',       // source không nằm trong ứng viên
      '叶凡=叶凡 Phàm',           // target còn Hán
      '青云宗=',                  // target rỗng
      '金丹=SKIP',                // AI đánh dấu bỏ
      '叶凡=Diệp Phàm',
      '叶凡=Diệp Phàm Khác',      // trùng source — lấy dòng đầu
    ].join('\n');
    const entries = parseNameGlossaryResponse(raw, candidates);
    expect(entries).toEqual([{ source: '叶凡', target: 'Diệp Phàm' }]);
  });
});

describe('mergeGlossary', () => {
  it('entry đã có (user nhập tay) luôn thắng, chỉ thêm mục mới', () => {
    const existing = [{ source: '叶凡', target: 'Ye Fan (user chọn)' }];
    const incoming = [
      { source: '叶凡', target: 'Diệp Phàm' },
      { source: '金丹', target: 'Kim Đan' },
    ];
    const { merged, added } = mergeGlossary(existing, incoming);
    expect(added).toBe(1);
    expect(merged).toHaveLength(2);
    expect(merged.find(g => g.source === '叶凡')?.target).toBe('Ye Fan (user chọn)');
  });
});

describe('filterGlossaryForText', () => {
  // `名${i}号` để không tên nào là chuỗi con của tên khác (名1号 ⊄ 名17号)
  const big = Array.from({ length: 20 }, (_, i) => ({ source: `名${i}号`, target: `Tên ${i}` }));

  it('glossary nhỏ (≤ threshold) giữ nguyên — hành vi cũ không đổi', () => {
    const small = big.slice(0, 5);
    expect(filterGlossaryForText(small, 'văn bản không chứa gì')).toBe(small);
  });

  it('glossary to: chỉ giữ entry xuất hiện trong văn bản', () => {
    const text = 'trong đoạn này có 名3号 và 名17号 thôi';
    const out = filterGlossaryForText(big, text);
    expect(out.map(g => g.source).sort()).toEqual(['名17号', '名3号']);
  });
});
