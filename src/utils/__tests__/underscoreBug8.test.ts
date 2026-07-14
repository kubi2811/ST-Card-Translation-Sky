import { describe, it, expect } from 'vitest';
import {
  unifyVarWordSeparators,
  unifyVietnameseUnderscoresInText,
  canonicalizeMvuVarName,
  enforceVariableCasing,
} from '../mvuSync';

/**
 * (User 2026 — bugNeedFix/8, card 9.png_vi.json) Biến Việt bị AI nối `_` TRÀN VÀO LOREBOOK:
 * 272 chỗ (Lưu_Tam_Bảo 49x, Phòng_Tuyến_Với_Lưu_Tam_Bảo 40x…), initvar TRỘN 8 key space + 8 key `_`.
 * Gốc kép: (1) prompt dịch biến MVU cũ ÉP `_` (Độ_Hảo_Cảm) đánh nhau với chuẩn space ở nơi khác;
 * (2) quy tắc token cũ đòi "mọi mảnh non-ASCII" nên từ Việt thuần-ASCII (Tam/Bi/User/Tin) làm cả từ
 * lọt lưới. Mọi chuỗi test dưới đây lấy TỪ CARD THẬT của user.
 */

describe('unifyVarWordSeparators — quy tắc mới (bug #8: mảnh ASCII "Tam"/"Bi"/"User" không còn che chắn _)', () => {
  it('các biến THẬT trong card user → về dấu cách', () => {
    expect(unifyVarWordSeparators('Lưu_Tam_Bảo')).toBe('Lưu Tam Bảo');
    expect(unifyVarWordSeparators('Phòng_Tuyến_Với_Lưu_Tam_Bảo')).toBe('Phòng Tuyến Với Lưu Tam Bảo');
    expect(unifyVarWordSeparators('Giới_Hạn_Từ_Bi')).toBe('Giới Hạn Từ Bi');
    expect(unifyVarWordSeparators('Tình_Cảm_Với_User')).toBe('Tình Cảm Với User');
    expect(unifyVarWordSeparators('Độ_Tin_Tưởng')).toBe('Độ Tin Tưởng');
    expect(unifyVarWordSeparators('Vị_Trí_User')).toBe('Vị Trí User');
  });

  it('marker MVU đầu từ (_/$) giữ nguyên vị trí', () => {
    expect(unifyVarWordSeparators('_Loại_Hình')).toBe('_Loại Hình');
    expect(unifyVarWordSeparators('$Loại_Mở_Đầu')).toBe('$Loại Mở Đầu');
  });

  it('identifier thật GIỮ NGUYÊN: ASCII thuần, mixed CJK, có chữ số', () => {
    expect(unifyVarWordSeparators('stat_data')).toBe('stat_data');
    expect(unifyVarWordSeparators('sfw_keywords')).toBe('sfw_keywords');
    expect(unifyVarWordSeparators('场景_sfw')).toBe('场景_sfw');
    expect(unifyVarWordSeparators('隐藏_evt_01')).toBe('隐藏_evt_01');
    expect(unifyVarWordSeparators('1_Tĩnh')).toBe('1_Tĩnh'); // mảnh số (enum 阶段 1_静谧)
  });

  it('CJK thuần vẫn về space như cũ', () => {
    expect(unifyVarWordSeparators('武_力')).toBe('武 力');
  });

  it('canonicalizeMvuVarName ăn theo quy tắc mới', () => {
    expect(canonicalizeMvuVarName('Lưu_Tam_Bảo')).toBe('Lưu Tam Bảo');
    expect(canonicalizeMvuVarName('Họ_Tên')).toBe('Họ Tên'); // hành vi cũ giữ nguyên
  });
});

describe('unifyVietnameseUnderscoresInText — sweep dict-less (chữa card đã nhiễm, dict trống)', () => {
  it('dòng _.get THẬT từ regex card user → sạch underscore', () => {
    const src = "const masterBottom = Number(_.get(stat, ['Thẩm Thê Tuyết', 'Phòng_Tuyến_Với_Lưu_Tam_Bảo', 'Giới_Hạn_Từ_Bi'], 100));";
    const { text, count } = unifyVietnameseUnderscoresInText(src);
    expect(text).toContain("'Phòng Tuyến Với Lưu Tam Bảo'");
    expect(text).toContain("'Giới Hạn Từ Bi'");
    expect(count).toBe(2);
  });

  it('initvar YAML TRỘN 2 kiểu (thật từ card) → thống nhất space', () => {
    const src = [
      'Biến Thế Giới:',
      '  Ngày Hiện Tại: Ngày 15 tháng 7 năm Thiên Nguyên 482',
      '  Vị_Trí_User: Ngoài phòng khách',
      'Thẩm Thê Tuyết:',
      '  Tình_Cảm_Với_User:',
      '    Độ Gắn Kết: 75',
      '  Phòng_Tuyến_Với_Lưu_Tam_Bảo:',
    ].join('\n');
    const { text } = unifyVietnameseUnderscoresInText(src);
    expect(text).toContain('Vị Trí User: Ngoài phòng khách');
    expect(text).toContain('Tình Cảm Với User:');
    expect(text).toContain('Phòng Tuyến Với Lưu Tam Bảo:');
    expect(text).toContain('Biến Thế Giới:'); // dòng vốn đúng không bị đụng
  });

  it('key JS/Zod KHÔNG nháy → đổi space + tự BỌC NHÁY (không SyntaxError)', () => {
    const src = 'const colorSchemes = { Giới_Hạn_Từ_Bi: [1, 2], progress: [3] };';
    const { text } = unifyVietnameseUnderscoresInText(src);
    expect(text).toContain("{ 'Giới Hạn Từ Bi': [1, 2]");
    expect(text).toContain('progress: [3]'); // key ASCII giữ nguyên, không quote thừa
  });

  it('code ASCII/URL/macro không bị đụng', () => {
    const src = "import 'https://cdn.example.com/a_b_c.js'; const x = stat_data.foo_bar; {{__ejs_0__}}";
    expect(unifyVietnameseUnderscoresInText(src).text).toBe(src);
  });

  it('gạch `_` RÁC ở cuối tên (Tô Yến Hề_ trong dict user) → cắt bỏ', () => {
    const { text } = unifyVietnameseUnderscoresInText("getwi(null, 'Tô Yến Hề_')");
    expect(text).toContain("'Tô Yến Hề'");
  });
});

describe('enforceVariableCasing — dict-driven, giờ MÙ separator (bug #8)', () => {
  const dict = { '慈悲底线': 'Giới Hạn Từ Bi', '对刘三保的防线': 'Phòng Tuyến Với Lưu Tam Bảo' };

  it('token lệch separator trong mảng path → ép về đúng dạng dict', () => {
    const r = enforceVariableCasing("_.get(stat, ['Phòng_tuyến_với_Lưu_Tam_Bảo', 'giới_hạn_từ_bi'])", dict);
    expect(r.text).toContain("'Phòng Tuyến Với Lưu Tam Bảo'");
    expect(r.text).toContain("'Giới Hạn Từ Bi'");
  });

  it('key JS không nháy lệch separator → thay bằng dạng dict CÓ NHÁY', () => {
    const r = enforceVariableCasing('const m = { Giới_Hạn_Từ_Bi: 100 };', dict);
    expect(r.text).toContain("{ 'Giới Hạn Từ Bi': 100 }");
  });

  it('macro {{getvar::…}} lệch separator → ép theo dict', () => {
    const r = enforceVariableCasing('{{getvar::Giới_Hạn_Từ_Bi}}', dict);
    expect(r.text).toBe('{{getvar::Giới Hạn Từ Bi}}');
  });
});
