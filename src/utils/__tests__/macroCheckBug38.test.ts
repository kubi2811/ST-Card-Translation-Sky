// bugNeedFix/38 — kiểm sâu báo "macro damaged" GIẢ: placeholder {{chữ CJK}} được phép dịch ruột;
// macro lệnh (format_message_variable::…) được phép đổi arg theo từ điển MVU (map từng đoạn path).
import { describe, it, expect } from 'vitest';
import { verifyFields } from '../aiVerify';
import type { TranslationField } from '../../types/card';

const mkField = (original: string, translated: string, path = 'data.character_book.entries[13].content'): TranslationField => ({
  path,
  label: 'Entry test',
  group: 'lorebook',
  original,
  translated,
  status: 'done',
  retries: 0,
});

const macroIssues = (fields: TranslationField[], dict: Record<string, string> = {}) =>
  verifyFields(fields, dict, 'Chinese').filter(i => i.category === 'macro_damaged');

describe('bug 38 — placeholder {{chữ hiển thị}} được DỊCH ruột → KHÔNG báo damaged', () => {
  it('CA THẬT (ảnh user): {{仅列出数值/文案有变的 path}} → {{Chỉ liệt kê các path…}} không báo lỗi', () => {
    const f = mkField(
      '- Changed: {{仅列出数值/文案有变的 path}}\n- Time: {{时间/地点/是否亲密中}}',
      '- Changed: {{Chỉ liệt kê các path có thay đổi về giá trị/văn bản}}\n- Time: {{Thời gian/địa điểm/có đang thân mật không}}',
    );
    expect(macroIssues([f])).toHaveLength(0);
  });

  it('placeholder MẤT THẬT (gốc 2, dịch còn 1) → báo đúng 1 lỗi', () => {
    const f = mkField(
      'A {{占位文字一}} B {{占位文字二}}',
      'A {{Chữ giữ chỗ một}} B ',
    );
    expect(macroIssues([f])).toHaveLength(1);
  });
});

describe('bug 38 — macro lệnh đổi arg theo từ điển MVU → KHÔNG báo damaged', () => {
  it('CA THẬT: {{format_message_variable::stat_data.在场女性}} map theo dict', () => {
    const f = mkField(
      'Hiện: {{format_message_variable::stat_data.在场女性}}',
      'Hiện: {{format_message_variable::stat_data.Nữ đang có mặt}}',
      'data.character_book.entries[17].content',
    );
    expect(macroIssues([f], { 在场女性: 'Nữ đang có mặt' })).toHaveLength(0);
  });

  it('CA THẬT: path chấm nhiều đoạn {{…::stat_data.交互记录.换装状态}} — dict chỉ có 1 đoạn, đoạn kia AI dịch → vẫn pass (đủ số macro cùng type)', () => {
    const f = mkField(
      '{{format_message_variable::stat_data.交互记录.换装状态}}',
      '{{format_message_variable::stat_data.Ghi chép tương tác.Trạng thái thay đồ}}',
    );
    expect(macroIssues([f], { 交互记录: 'Ghi chép tương tác' })).toHaveLength(0);
  });

  it('CA THẬT: {{format_message_variable::stat_data.主角.年龄}} dict đủ 2 đoạn', () => {
    const f = mkField(
      '{{format_message_variable::stat_data.主角.年龄}} / {{format_message_variable::stat_data.主角.身份}}',
      '{{format_message_variable::stat_data.Nhân vật chính.Tuổi}} / {{format_message_variable::stat_data.Nhân vật chính.Thân phận}}',
      'data.character_book.entries[42].content',
    );
    expect(macroIssues([f], { 主角: 'Nhân vật chính', 年龄: 'Tuổi', 身份: 'Thân phận' })).toHaveLength(0);
  });

  it('getvar cũ vẫn hoạt động: map xuôi theo dict', () => {
    const f = mkField('{{getvar::好感度}}', '{{getvar::Hảo cảm}}');
    expect(macroIssues([f], { 好感度: 'Hảo cảm' })).toHaveLength(0);
  });
});

describe('bug 38 — damage THẬT vẫn phải bắt', () => {
  it('{{char}} biến mất khỏi bản dịch → báo lỗi', () => {
    const f = mkField('Hello {{char}}, how are you my friend today', 'Xin chào, bạn khoẻ không hôm nay');
    expect(macroIssues([f]).length).toBeGreaterThanOrEqual(1);
  });

  it('macro lệnh vỡ ngoặc ({{getvar::hp}} → {getvar::hp}) → báo lỗi', () => {
    const f = mkField('HP: {{getvar::hp}} điểm sinh mệnh hiện tại', 'HP: {getvar::hp} điểm sinh mệnh hiện tại');
    expect(macroIssues([f]).length).toBeGreaterThanOrEqual(1);
  });

  it('macro lệnh MẤT HẲN (không có macro cùng type trong bản dịch) → báo lỗi', () => {
    const f = mkField(
      'X {{format_message_variable::stat_data.在场女性}} Y',
      'X  Y',
    );
    expect(macroIssues([f]).length).toBeGreaterThanOrEqual(1);
  });
});
