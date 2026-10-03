/**
 * (bug 242) PhatSiz — [mvu_update] dịch ra `Nhóm['Nhóm.Thuộc tính']` (lặp tên nhóm trong path).
 * (bug 249) Pvkhoa — "dịch card có MVU luôn luôn có lỗi liên quan đến schema field":
 *   Kiểm Tra Field báo đỏ "Zod schema field "prefault:未描述" missing in translation" cho mọi giá
 *   trị .prefault()/.default() đã được dịch (dịch giá trị hiển thị là ĐÚNG), và mục
 *   "Schema ↔ Hướng dẫn" coi chú thích `/* … *\/` là một biến.
 */
import { describe, it, expect } from 'vitest';
import { fixRedundantParentInBracketPath } from '../mvuSync';
import { quickVerify, verifyFields } from '../aiVerify';
import { extractGuidePathRoots } from '../mvuSchemaFormatSync';
import type { CharacterCard, TranslationField } from '../../types/card';

describe('(bug 242) đường dẫn biến lặp tên nhóm', () => {
  it('sửa đúng 5 mẫu trong ảnh', () => {
    const src = [
      "`Nhân Vật Chính['Nhân Vật Chính.Ngày Sinh']`",
      "`Đánh Giá Chuyên Môn['Đánh Giá Chuyên Môn.Vị Thế Hiện Tại']`",
      "`Phân Tích Giá Trị['Phân Tích Giá Trị.Trạng Thái Hợp Đồng']`",
      "`Nhân Mạch['Nhân Mạch.Mạng Lưới Xã Giao']`",
      '`Hiệu Ứng Hồ Điệp["Hiệu Ứng Hồ Điệp.Danh Sách Đã Xóa"]`',
    ].join('\n');
    const r = fixRedundantParentInBracketPath(src);
    expect(r.fixes).toBe(5);
    expect(r.text).toContain("`Nhân Vật Chính['Ngày Sinh']`");
    expect(r.text).toContain("`Đánh Giá Chuyên Môn['Vị Thế Hiện Tại']`");
    expect(r.text).toContain('`Hiệu Ứng Hồ Điệp["Danh Sách Đã Xóa"]`');
  });

  it('không đụng path đúng, và không đụng khi tên trước [ KHÁC phần đầu', () => {
    const ok = "a['Ngày Sinh'] · Nhân Vật['Nhân Vật Chính.Tuổi'] · stat_data['Túi Đồ.Vàng'] · XNhân['Nhân.Y']";
    expect(fixRedundantParentInBracketPath(ok).fixes).toBe(0);
  });

  it('bản GỐC tự dùng key có chấm như vậy ⇒ giữ nguyên (card cố ý)', () => {
    const orig = "主角['主角.生日']";
    const tr = "Nhân Vật Chính['Nhân Vật Chính.Ngày Sinh']";
    expect(fixRedundantParentInBracketPath(tr, orig).fixes).toBe(0);
  });

  it('Kiểm Tra Field bắt được trên thẻ đã dịch sẵn, kèm Sửa nhanh', () => {
    const f = {
      path: 'data.character_book.entries[49].content', label: '[mvu_update]', group: 'lorebook',
      original: "主角['生日']", translated: "Nhân Vật Chính['Nhân Vật Chính.Ngày Sinh']", status: 'done', retries: 0,
    } as unknown as TranslationField;
    const issues = verifyFields([f], {}, 'Chinese').filter(i => i.description.includes('lặp tên nhóm'));
    expect(issues).toHaveLength(1);
    expect(issues[0].autoFixable).toBe(true);
    expect(issues[0].fixValue).toBe("Nhân Vật Chính['Ngày Sinh']");
  });
});

const card = (th: string): CharacterCard => ({
  data: { name: 'x', extensions: { tavern_helper: { scripts: [{ name: 's', content: th }] } } },
} as unknown as CharacterCard);

describe('(bug 249) không báo lỗi oan cho giá trị .prefault/.default đã dịch', () => {
  const ORIG = "const S = z.object({ hp: z.number().prefault(100), mood: z.string().prefault('未描述'), t: z.string().default('太阳风暴后第30天') });";
  const TRANS = "const S = z.object({ hp: z.number().prefault(100), mood: z.string().prefault('Chưa mô tả'), t: z.string().default('Ngày thứ 30 sau bão mặt trời') });";

  it('giá trị đã dịch ⇒ KHÔNG còn lỗi "Zod schema field prefault:… missing"', () => {
    const issues = quickVerify(card(ORIG), card(TRANS));
    expect(issues.filter(i => /prefault|Zod schema field/.test(i.description))).toEqual([]);
  });

  it('nhưng MẤT hẳn lời gọi .prefault/.default thì vẫn báo', () => {
    const broken = "const S = z.object({ hp: z.number().prefault(100), mood: z.string(), t: z.string() });";
    const issues = quickVerify(card(ORIG), card(broken));
    expect(issues.some(i => /Mất 2\/2 lời gọi \.prefault/.test(i.description))).toBe(true);
  });

  it('tên trường Zod đổi theo từ điển MVU ⇒ không phải "mất"', () => {
    const o = 'const S = z.object({ hp: z.number(), level: z.number() });';
    const t = 'const S = z.object({ hp: z.number(), CapDo: z.number() });';
    expect(quickVerify(card(o), card(t)).some(i => i.description.includes('"level"'))).toBe(true);
    expect(quickVerify(card(o), card(t), { level: 'CapDo' }).some(i => i.description.includes('"level"'))).toBe(false);
  });

  it('chú thích /* … */ trong hướng dẫn KHÔNG bị coi là biến', () => {
    const guide = "/* Bên trong mỗi trang: Tiêu đề cố định */\n- path: /Nhân Vật Chính/Ngày Sinh";
    expect(extractGuidePathRoots(guide)).toEqual(['Nhân Vật Chính']);
  });
});
