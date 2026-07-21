// (User 21/07 — bug 70) Thẻ có biến MVU tên NGẮN (vd "B") làm bộ kiểm tra báo lỗi giả:
//   'API call "getElementById" appears 5x in original but only 0x in translation'
// Gốc rễ: bước đổi tên biến dùng split/join TRẦN → getElement**B**yId thành getElementTuổiyId.
// Nguy hiểm gấp đôi: bản méo đó còn được gán làm fixValue, bấm "Fix" là hỏng code thật.
import { describe, it, expect } from 'vitest';
import { replaceVarSafe, sortedVarPairs, verifyFields } from '../aiVerify';
import type { TranslationField } from '../../types/card';

describe('replaceVarSafe — không cắn vào giữa định danh JS', () => {
  it('biến "B" KHÔNG phá getElementById (đúng ca bug 70)', () => {
    const code = 'const el = document.getElementById("box"); el.getElementById;';
    expect(replaceVarSafe(code, 'B', 'Tuổi')).toBe(code);   // không đổi gì
  });

  it('vẫn đổi được biến "B" khi nó ĐỨNG RIÊNG', () => {
    expect(replaceVarSafe('stat_data.B = 1', 'B', 'Tuổi')).toBe('stat_data.Tuổi = 1');
    expect(replaceVarSafe("obj['B']", 'B', 'Tuổi')).toBe("obj['Tuổi']");
    expect(replaceVarSafe('B: 5', 'B', 'Tuổi')).toBe('Tuổi: 5');
  });

  it('không đụng định danh chứa tên biến (Bond, myB, B2)', () => {
    const t = 'Bond myB B2 getElementById';
    expect(replaceVarSafe(t, 'B', 'X')).toBe(t);
  });

  it('tên CJK thay bình thường; ký tự đặc biệt regex được escape', () => {
    expect(replaceVarSafe('好感度: 10', '好感度', 'Độ hảo cảm')).toBe('Độ hảo cảm: 10');
    expect(replaceVarSafe('a.b$c', 'a.b$c', 'X')).toBe('X');
  });

  it('sortedVarPairs: key DÀI trước (好感度 không bị 好感 ăn nửa)', () => {
    const pairs = sortedVarPairs({ 好感: 'affection', 好感度: 'affection_level' });
    expect(pairs[0][0]).toBe('好感度');
  });
});

describe('verifyFields — hết báo lỗi giả cho code còn nguyên', () => {
  const CODE = `<script>
    const a = document.getElementById('x1');
    const b = document.getElementById('x2');
    document.getElementById('x3').addEventListener('click', () => {});
    stat_data.B = 1;
  </script>`;

  /** Bản dịch giữ NGUYÊN code, chỉ đổi tên biến MVU đúng như yêu cầu. */
  const TRANSLATED = CODE.replace('stat_data.B = 1', 'stat_data.Tuổi = 1');

  const field = (): TranslationField => ({
    path: 'regex.0.replaceString', group: 'regex', status: 'done',
    original: CODE, translated: TRANSLATED, label: 'regex[0].replaceString',
  } as unknown as TranslationField);

  it('không còn lỗi "API call ... 0x" khi bản dịch còn đủ getElementById', () => {
    const issues = verifyFields([field()], { B: 'Tuổi' }, 'Chinese');
    const apiIssues = issues.filter(i => /API call/.test(i.description));
    expect(apiIssues).toEqual([]);
  });

  it('không còn báo "biến B chưa đổi tên" khi B chỉ còn nằm trong getElementById', () => {
    const issues = verifyFields([field()], { B: 'Tuổi' }, 'Chinese');
    const mvuIssues = issues.filter(i => /MVU variable "B"/.test(i.description));
    expect(mvuIssues).toEqual([]);
  });

  it('VẪN bắt được lỗi thật: bản dịch làm mất hẳn getElementById', () => {
    const broken = { ...field(), translated: CODE.split('getElementById').join('layPhanTuTheoId') } as TranslationField;
    const issues = verifyFields([broken], {}, 'Chinese');
    expect(issues.some(i => /API call "getElementById"/.test(i.description))).toBe(true);
  });

  it('VẪN bắt được lỗi thật: biến MVU đứng riêng mà chưa đổi tên', () => {
    const notRenamed = { ...field(), translated: CODE } as TranslationField;  // giữ nguyên stat_data.B
    const issues = verifyFields([notRenamed], { B: 'Tuổi' }, 'Chinese');
    expect(issues.some(i => /MVU variable "B"/.test(i.description))).toBe(true);
  });
});
