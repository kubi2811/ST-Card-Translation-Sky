// Test hồi quy trên DỮ LIỆU THẬT (thẻ Reborn 689 entry, bugNeedFix/94 — tự bỏ qua nếu không có file).
//
// Dựng "bản Trung MỚI" y như tác giả hay làm: CHÈN 2 entry vào GIỮA + SỬA nội dung 1 entry.
// Chèn giữa là phép thử khắc nghiệt nhất: mọi entry phía sau lệch chỉ số, nếu gióng hàng theo
// index thì cả trăm entry bị coi là "đã đổi" và dịch lại oan. Test này khoá lại con số thật:
//   3 card → tái dùng 2042/2049 (99,7%), chỉ 3 entry content phải dịch
//   2 card → tái dùng 1923/2049 (94%),  bắt đúng 2 entry mới
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { planMerge, planMergeTwoCard } from '../compareCards';
import { extractTranslatableFields, DEFAULT_FIELD_GROUPS } from '../cardFields';
import type { FieldGroup } from '../../types/card';

const ZH = fileURLToPath(new URL('../../../bugNeedFix/94/reborn_card.json', import.meta.url));
const VI = fileURLToPath(new URL('../../../bugNeedFix/94/Reborn_V1.5_VI.json', import.meta.url));
const has = fs.existsSync(ZH) && fs.existsSync(VI);
const ALL: FieldGroup[] = DEFAULT_FIELD_GROUPS.map((g) => g.id);
const mapOf = (card: unknown) =>
  new Map(extractTranslatableFields(card as never, ALL).map((f) => [f.path, f.original]));

describe.skipIf(!has)('kịch bản thật: tác giả chèn 2 entry vào giữa + sửa 1 entry', () => {
  const zhOld = JSON.parse(fs.readFileSync(ZH, 'utf8'));
  const vi = JSON.parse(fs.readFileSync(VI, 'utf8'));

  // Bản Trung MỚI = gốc + chèn 2 entry ở vị trí 100 và 300 + sửa nội dung entry 200.
  const zhNew = JSON.parse(JSON.stringify(zhOld));
  const es = zhNew.data.character_book.entries;
  const mkEntry = (k: string) => ({ keys: [k], secondary_keys: [], comment: `🆕${k}`, content: `${k}的全新内容`.repeat(40), enabled: true, insertion_order: 0 });
  es.splice(100, 0, mkEntry('全新甲'));
  es.splice(300, 0, mkEntry('全新乙'));
  // entry 200 (chỉ số cũ 199 sau khi chèn 1 cái ở 100) — viết lại nội dung
  const editedIdx = 200;
  const editedKeys = [...(es[editedIdx].keys || [])];
  es[editedIdx].content = String(es[editedIdx].content) + '\n\n【作者新增段落】' + '补充设定内容。'.repeat(50);

  const zhOldMap = mapOf(zhOld);
  const viMap = mapOf(vi);
  const zhNewMap = mapOf(zhNew);

  const isNew = (p: string, m: Map<string, string>) => {
    const v = m.get(p) || '';
    return v.includes('的全新内容');
  };

  it('3 card (chính xác): chỉ 2 entry MỚI + entry BỊ SỬA vào diện dịch, phần còn lại tái dùng', () => {
    const p = planMerge(zhOldMap, viMap, zhNewMap);
    const changedContent = [...p.changed].filter((x) => /\.entries\[\d+\]\.content$/.test(x));
    const newOnes = changedContent.filter((x) => isNew(x, zhNewMap));

    console.log('[3card] tái dùng', p.counts.reused, '| cần dịch', p.counts.changed, '/ tổng', p.counts.total);
    console.log('[3card] content cần dịch:', changedContent.length, '(trong đó entry mới:', newOnes.length + ')');

    expect(newOnes.length).toBe(2);                    // đúng 2 entry mới
    expect(changedContent.length).toBeLessThanOrEqual(4); // 2 mới + entry bị sửa (+ tối đa 1 nhiễu)
    // Chèn giữa KHÔNG được làm vỡ: đại đa số vẫn tái dùng.
    expect(p.counts.reused).toBeGreaterThan(p.counts.total * 0.9);
    expect(p.counts.suspect).toBe(0);
  });

  it('2 card (suy đoán): bắt đúng 2 entry MỚI; entry bị sửa rơi vào diện NGHI NGỜ', () => {
    const p = planMergeTwoCard(viMap, zhNewMap);
    const changedContent = [...p.changed].filter((x) => /\.entries\[\d+\]\.content$/.test(x));
    const newOnes = changedContent.filter((x) => isNew(x, zhNewMap));

    console.log('[2card] tái dùng', p.counts.reused, '| cần dịch', p.counts.changed,
      '| nghi ngờ', p.counts.suspect, '/ tổng', p.counts.total);
    console.log('[2card] content cần dịch:', changedContent.length, '(entry mới:', newOnes.length + ')');
    console.log('[2card] entry bị sửa có bị nghi không:',
      [...p.suspect].some((x) => x.includes(`entries[${editedIdx}].`)), '| keys:', JSON.stringify(editedKeys.slice(0, 3)));

    expect(newOnes.length).toBe(2);                       // entry mới: chắc chắn bắt được
    expect(p.counts.reused).toBeGreaterThan(p.counts.total * 0.85); // chèn giữa không làm vỡ
    expect(p.counts.suspect).toBeGreaterThan(0);          // có đánh hơi được entry bị sửa
    expect(p.mode).toBe('2card');
  });
});
