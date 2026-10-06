/**
 * (bug 254a — PhatSiz) Key MVU có đuôi code ASCII: 鞋子_tag → "Giày tag" (mất `_`). Card ghép key
 * động `部位 + '_tag'` sẽ ra "Giày_tag" — không khớp. Đuôi code phải giữ nguyên cả dấu `_`.
 */
import { describe, it, expect } from 'vitest';
import {
  unifyVarWordSeparators, unifyVietnameseUnderscoresInText, sanitizeMvuVarName,
  enforceExactConsistency, mirrorAsciiSuffix, sourceAsciiSuffix,
} from '../mvuSync';

describe('bug 254a — đuôi code ASCII của key MVU', () => {
  it('sourceAsciiSuffix chỉ nhận đuôi ASCII sau chữ Hán', () => {
    expect(sourceAsciiSuffix('鞋子_tag')).toBe('_tag');
    expect(sourceAsciiSuffix('场景-sfw')).toBe('-sfw');
    expect(sourceAsciiSuffix('stat_data')).toBeNull();
    expect(sourceAsciiSuffix('阶段 1_静谧')).toBeNull();
    expect(sourceAsciiSuffix('鞋子')).toBeNull();
  });

  it('bản dịch AI viết "Giày tag" / "Phụ Kiện tag" → giữ đúng `_tag`', () => {
    expect(sanitizeMvuVarName('鞋子_tag', 'Giày tag')).toBe('Giày_tag');
    expect(sanitizeMvuVarName('配饰_tag', 'Phụ Kiện tag')).toBe('Phụ Kiện_tag');
    expect(sanitizeMvuVarName('内衣_tag', 'Áo_Lót_tag')).toBe('Áo Lót_tag');
    expect(sanitizeMvuVarName('内裤_tag', 'Quần Lót Tag')).toBe('Quần Lót_tag');
    expect(sanitizeMvuVarName('服装.鞋子_tag', 'Trang Phục.Giày tag')).toBe('Trang Phục.Giày_tag');
    expect(mirrorAsciiSuffix('鞋子_tag', 'Giày')).toBe('Giày_tag');
  });

  it('sweep `_` → space (bug #8) KHÔNG phá đuôi code nhưng vẫn sửa từ Việt bị nối', () => {
    expect(unifyVarWordSeparators('Giày_tag')).toBe('Giày_tag');
    expect(unifyVarWordSeparators('Áo_Lót_tag')).toBe('Áo Lót_tag');
    expect(unifyVarWordSeparators('Kiện_tag')).toBe('Kiện_tag');
    // bug #8 vẫn như cũ
    expect(unifyVarWordSeparators('Lưu_Tam_Bảo')).toBe('Lưu Tam Bảo');
    expect(unifyVarWordSeparators('Tình_Cảm_Với_User')).toBe('Tình Cảm Với User');
    expect(unifyVarWordSeparators('tình_cảm_với_user')).toBe('tình cảm với user');
    const { text } = unifyVietnameseUnderscoresInText("const k = data['Phụ Kiện_tag']; x.Giày_tag = 1; y = 'Độ_Hảo_Cảm';");
    expect(text).toContain("data['Phụ Kiện_tag']");
    expect(text).toContain('x.Giày_tag = 1');
    expect(text).toContain("'Độ Hảo Cảm'");
  });

  it('từ điển: 鞋子_tag luôn = bản dịch của 鞋子 + "_tag" (ghép key động mới khớp)', () => {
    const { fixedDict } = enforceExactConsistency({ '鞋子': 'Giày', '鞋子_tag': 'Giày dép tag', '配饰_tag': 'Phụ Kiện tag' });
    expect(fixedDict['鞋子_tag']).toBe('Giày_tag');
    expect(fixedDict['配饰_tag']).toBe('Phụ Kiện_tag');
  });

  it('mục user tự sửa (manual) không bị ép theo thân', () => {
    const { fixedDict } = enforceExactConsistency(
      { '鞋子': 'Giày', '鞋子_tag': 'Thẻ Giày_tag' },
      { '鞋子_tag': { sources: ['yaml'], occurrences: 1, confidence: 'manual' } },
    );
    expect(fixedDict['鞋子_tag']).toBe('Thẻ Giày_tag');
  });
});
