/**
 * (bugNeedFix/180) "{{user}} bị dịch thành chữ tiếng Trung gì đó — tất cả entry có {{user}}".
 * ─────────────────────────────────────────────────────────────────────────────
 * Dữ liệu trong test lấy nguyên văn từ ảnh user gửi (lorebook 33, 53, 56):
 *     尚未认识{{user}}。   →   chưa quen biết{{基础信息}}.
 */
import { describe, it, expect } from 'vitest';
import {
  findMacros, isProtectedMacro, restoreMacros,
  isMacroPollutedTerm, stripMacroTermsFromDict, STANDARD_MACROS,
} from '../macroGuard';
import { scanFieldsHealth } from '../cardHealth';
import { extractNameCandidates, harvestGlossaryFromFields } from '../nameGlossary';
import type { TranslationField } from '../../types/card';

const f = (o: Partial<TranslationField>): TranslationField => ({
  path: 'data.character_book.entries[33].content', label: 'lorebook[33].content',
  group: 'lorebook', status: 'done', retries: 0, original: '', translated: '', ...o,
} as TranslationField);

describe('findMacros', () => {
  it('bóc đúng macro và vị trí', () => {
    const m = findMacros('xin chào {{user}} và {{char}}!');
    expect(m.map(x => x.inner)).toEqual(['user', 'char']);
    expect(m[0].raw).toBe('{{user}}');
  });

  it('không bắt nhầm ngoặc nhọn thường của code', () => {
    expect(findMacros('const a = {b: {c: 1}};')).toEqual([]);
  });
});

describe('isProtectedMacro — cái gì cấm dịch', () => {
  it('macro chuẩn của SillyTavern', () => {
    for (const name of ['user', 'char', 'persona', 'random', 'newline']) {
      expect(isProtectedMacro(name), name).toBe(true);
    }
    expect(STANDARD_MACROS.has('user')).toBe(true);
  });

  it('ruột ASCII (macro riêng của thẻ) cũng phải giữ nguyên', () => {
    expect(isProtectedMacro('getvar::affection')).toBe(true);
    expect(isProtectedMacro('roll:d6')).toBe(true);
  });

  it('ruột là chữ tự nhiên do tác giả đặt thì KHÔNG đụng vào — dịch được', () => {
    expect(isProtectedMacro('基础信息')).toBe(false);
    expect(isProtectedMacro('Thông tin cơ bản')).toBe(false);
  });
});

describe('restoreMacros — ca thật của user', () => {
  const ORIG = '【炎孕世界观适配】尚未认识{{user}}。';
  const BAD = '【Thích ứng thế giới quan Haramase】 Vẫn chưa quen biết {{基础信息}}.';

  it('trả {{user}} về nguyên văn', () => {
    const r = restoreMacros(ORIG, BAD);
    expect(r.text).toContain('{{user}}');
    expect(r.text).not.toContain('{{基础信息}}');
    expect(r.fixes).toEqual([{ wrong: '基础信息', right: 'user' }]);
    // Phần chữ đã dịch đúng thì GIỮ NGUYÊN, không đụng.
    expect(r.text).toContain('Thích ứng thế giới quan Haramase');
    expect(r.text).toContain('Vẫn chưa quen biết');
  });

  it('bản dịch đúng thì không sửa gì', () => {
    const good = '【Thích ứng】 Vẫn chưa quen biết {{user}}.';
    const r = restoreMacros(ORIG, good);
    expect(r.fixes).toEqual([]);
    expect(r.text).toBe(good);
  });

  it('nhiều macro: ghép cặp theo thứ tự, chỉ sửa cái sai', () => {
    const r = restoreMacros(
      '{{user}} gặp {{char}} tại {{地点}}。',
      '{{基础信息}} gặp {{char}} tại {{Địa điểm}}.',
    );
    expect(r.text).toContain('{{user}} gặp {{char}} tại {{Địa điểm}}');
    expect(r.fixes).toEqual([{ wrong: '基础信息', right: 'user' }]);
  });

  it('macro do tác giả đặt bằng chữ tự nhiên vẫn được dịch — không ép về gốc', () => {
    const r = restoreMacros('{{地点}}', '{{Địa điểm}}');
    expect(r.fixes).toEqual([]);
    expect(r.text).toBe('{{Địa điểm}}');
  });

  it('LỆCH SỐ macro thì KHÔNG đoán — nhưng phải nói rõ macro nào đã mất', () => {
    const r = restoreMacros('{{user}} và {{char}}', 'chỉ còn {{基础信息}}');
    expect(r.fixes).toEqual([]);          // không tự sửa: ghép cặp lúc này là đoán mò
    expect(r.text).toBe('chỉ còn {{基础信息}}');
    // Cả hai macro bắt buộc đều biến mất khỏi bản dịch ⇒ liệt kê đích danh cho user.
    expect(r.unresolved).toEqual(['{{user}}', '{{char}}']);
  });

  it('lệch số nhưng macro bắt buộc vẫn còn đủ ⇒ không kêu oan', () => {
    const r = restoreMacros('{{user}} xin chào', '{{user}} xin chào {{Thêm}}');
    expect(r.unresolved).toEqual([]);
  });

  it('không có macro thì trả nguyên văn', () => {
    expect(restoreMacros('abc', 'xyz').text).toBe('xyz');
  });
});

describe('Chặn macro lọt vào từ điển (nguồn dạy model đổi macro)', () => {
  it('nhận diện mục dính macro', () => {
    expect(isMacroPollutedTerm('{{user}}')).toBe(true);
    expect(isMacroPollutedTerm('user')).toBe(true);
    expect(isMacroPollutedTerm('char')).toBe(true);
    expect(isMacroPollutedTerm('丘恩丘恩')).toBe(false);
  });

  it('lọc sạch khỏi bảng nguồn→đích, và nói rõ đã bỏ cái gì', () => {
    const { clean, removed } = stripMacroTermsFromDict({
      '好感度': 'Độ hảo cảm',
      'user': '基础信息',
      '{{char}}': 'Nhân vật',
    });
    expect(clean).toEqual({ '好感度': 'Độ hảo cảm' });
    expect(removed).toHaveLength(2);
  });

  it('glossary tự thu hoạch KHÔNG nhận cặp dính macro', () => {
    const got = harvestGlossaryFromFields([
      f({ group: 'lorebook_keys', original: '丘恩丘恩,{{user}}', translated: 'Chunchun,{{基础信息}}' }),
    ]);
    expect(got.some(g => /\{\{/.test(g.source) || /\{\{/.test(g.target))).toBe(false);
  });

  it('bộ quét ứng viên tên riêng không đề xuất tên macro', () => {
    const cands = extractNameCandidates([
      f({ status: 'pending', group: 'lorebook_keys', path: 'data.character_book.entries[0].keys',
          original: 'user,char,丘恩丘恩' }),
    ], { minCount: 1 });
    expect(cands.some(c => STANDARD_MACROS.has(c.term.toLowerCase()))).toBe(false);
  });
});

describe('Chốt chặn: Sức khoẻ thẻ báo LỖI khi macro bị đổi tên', () => {
  it('bắt được đúng ca user gặp, và nói rõ hậu quả', () => {
    const rep = scanFieldsHealth([
      f({ original: '【炎孕世界观适配】尚未认识{{user}}。',
          translated: '【Thích ứng thế giới quan Haramase】 Vẫn chưa quen biết {{基础信息}}.' }),
    ]);
    expect(rep.counts.renamedMacros).toBe(1);
    const iss = rep.issues.find(i => i.kind === 'macro_renamed');
    expect(iss?.severity).toBe('error');
    expect(iss?.detail).toContain('{{基础信息}}');
    expect(iss?.detail).toContain('{{user}}');
    expect(rep.ok).toBe(false);
  });

  it('bản dịch giữ đúng macro thì không báo gì', () => {
    const rep = scanFieldsHealth([
      f({ original: '尚未认识{{user}}。', translated: 'Vẫn chưa quen biết {{user}}.' }),
    ]);
    expect(rep.counts.renamedMacros).toBe(0);
    expect(rep.issues.some(i => i.kind === 'macro_renamed')).toBe(false);
  });
});
