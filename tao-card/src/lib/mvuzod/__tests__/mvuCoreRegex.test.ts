import { describe, it, expect } from 'vitest';
import { buildMvuCoreRegexScripts, UPDATE_VARIABLE_STRIP_REGEX } from '../mvuCoreRegex';
import { OPENING_FORM_ANCHOR, STATUS_BAR_ANCHOR } from '../regexAnchors';

/**
 * (User 21/07) "MVU có 4 file mà card tui mới có 2 cái."
 *
 * Đối chiếu card MVU THẬT đang chạy được (bug/MODDED_Tìm kiếm Ngụy nhân) thì bộ regex MVU là
 * 2 CẶP + 1, mỗi giao diện cần ĐỦ MỘT CẶP:
 *   - 1 script promptOnly: ẩn mỏ neo khỏi prompt gửi cho AI
 *   - 1 script markdownOnly: thay mỏ neo bằng HTML để hiển thị
 * Thiếu script render thì user chỉ thấy mỏ neo trơ; thiếu script ẩn thì mỏ neo lọt vào
 * prompt làm bẩn context.
 * Cộng thêm 1 script xoá khối <UpdateVariable> khỏi phần hiển thị.
 */
describe('buildMvuCoreRegexScripts — bộ regex lõi MVU', () => {
  const scripts = buildMvuCoreRegexScripts();

  it('sinh đủ 5 script (2 cặp + 1 strip UpdateVariable)', () => {
    expect(scripts).toHaveLength(5);
  });

  it('Status Bar có ĐỦ CẶP ẩn + render', () => {
    const pair = scripts.filter(s => s.findRegex === STATUS_BAR_ANCHOR);
    expect(pair).toHaveLength(2);
    expect(pair.some(s => s.promptOnly === true)).toBe(true);   // ẩn khỏi prompt
    expect(pair.some(s => s.markdownOnly === true)).toBe(true); // render ra màn hình
  });

  it('Opening Form có ĐỦ CẶP ẩn + render (trước đây chỉ có render)', () => {
    const pair = scripts.filter(s => s.findRegex === OPENING_FORM_ANCHOR);
    expect(pair).toHaveLength(2);
    expect(pair.some(s => s.promptOnly === true)).toBe(true);
    expect(pair.some(s => s.markdownOnly === true)).toBe(true);
  });

  it('có script xoá khối <UpdateVariable> khỏi hiển thị', () => {
    const strip = scripts.find(s => s.findRegex === UPDATE_VARIABLE_STRIP_REGEX);
    expect(strip).toBeDefined();
    expect(strip!.replaceString).toBe('');
  });

  it('script ẩn phải để replaceString rỗng (ẩn = thay bằng không có gì)', () => {
    for (const s of scripts.filter(x => x.promptOnly && !x.markdownOnly)) {
      expect(s.replaceString).toBe('');
    }
  });

  it('không script nào bị tắt sẵn', () => {
    expect(scripts.every(s => s.disabled === false)).toBe(true);
  });

  it('hai mỏ neo không trùng nhau (chống bug đè script)', () => {
    expect(OPENING_FORM_ANCHOR).not.toBe(STATUS_BAR_ANCHOR);
  });
});
