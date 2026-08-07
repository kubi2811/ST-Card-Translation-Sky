/**
 * (bug 224) MVUZOD Studio — hai lỗi có bằng chứng đo được, và một nút user xin.
 * ─────────────────────────────────────────────────────────────────────────────
 * Ảnh user gửi: "Schema chạy được (191 biến) — 38 cảnh báo nên xem", rồi 10 dòng đầu toàn một
 * dạng: 'Tên biến "tình trạng" xuất hiện 6 lần — dễ ghi đè nhau lúc chạy'.
 *
 * Soi ra thì phần lớn 38 cảnh báo đó là BÁO OAN, và lỗi nằm ở bộ kiểm chứ không ở schema: nó
 * gom trùng theo NHÃN trên TOÀN CÂY. Thẻ có 6 nhân vật, mỗi người một biến "tình trạng" là ăn
 * ngay một cảnh báo — dù MVU địa chỉ hoá biến bằng ĐƯỜNG DẪN ĐẦY ĐỦ
 * (stat_data['Nhân vật chính']['tình trạng']) nên hai biến khác cha không bao giờ đụng nhau.
 *
 * Rủi ro thật chỉ có một dạng: HAI BIẾN CÙNG MỘT CHA cùng tên — chúng là cùng một khoá object
 * nên cái sau xoá mất cái trước. Đó là mất dữ liệu, phải là LỖI chứ không phải cảnh báo.
 */
import { describe, it, expect } from 'vitest';
import { checkSchemaHealth } from '../schemaHealth';
import { buildSchemaFixInstruction } from '../schemaFixInstruction';
import type { MVUZODSchema, MVUZODField } from '../../../types/mvuzod.types';

const leaf = (label: string, over: Partial<MVUZODField> = {}): MVUZODField => ({
  label,
  path: label,
  type: 'string',
  ...over,
} as MVUZODField);

const obj = (label: string, children: MVUZODField[]): MVUZODField => ({
  label,
  path: label,
  type: 'object',
  children,
} as unknown as MVUZODField);

const mk = (fields: MVUZODField[]): MVUZODSchema => ({ fields } as MVUZODSchema);

const dupIssues = (s: MVUZODSchema) =>
  checkSchemaHealth(s).issues.filter(i => i.code === 'duplicate-name');

describe('(bug 224) đếm trùng tên biến — theo CHA, không theo cả cây', () => {
  it('ĐÚNG CA ẢNH USER: 6 nhân vật mỗi người một "tình trạng" ⇒ KHÔNG cảnh báo nào', () => {
    const nhanVat = ['Nhân vật chính', 'Artemis', 'Hestia', 'Nhân vật phụ', 'NPC A', 'NPC B'];
    const schema = mk(nhanVat.map(n => obj(n, [leaf('tình trạng'), leaf('quan hệ')])));
    expect(dupIssues(schema)).toEqual([]);
  });

  it('HAI biến cùng tên CÙNG MỘT CHA ⇒ báo LỖI (mất dữ liệu thật), nêu đúng tên cha', () => {
    const schema = mk([obj('Nhân vật chính', [leaf('tình trạng'), leaf('Tình Trạng'), leaf('máu')])]);
    const iss = dupIssues(schema);
    expect(iss).toHaveLength(1);
    expect(iss[0].level).toBe('error');
    expect(iss[0].message).toContain('Nhân vật chính');
    expect(iss[0].message).toContain('tình trạng');
    expect(iss[0].message).toMatch(/cái sau xoá mất cái trước/);
  });

  it('trùng ở GỐC schema cũng bắt được', () => {
    const iss = dupIssues(mk([leaf('Ngày'), leaf('ngày')]));
    expect(iss).toHaveLength(1);
    expect(iss[0].message).toContain('gốc schema');
  });

  it('nhãn có DẤU CÁCH không làm lệch việc tách cha/con', () => {
    // Cha "Quan hệ NPC" (2 dấu cách) — bản dùng dấu cách làm ký tự phân cách sẽ tách sai chỗ này.
    const schema = mk([
      obj('Quan hệ NPC', [leaf('Thần Giới Chi Chủ'), leaf('Trường lão Long Tước')]),
      obj('Hành trang', [leaf('Thần Giới Chi Chủ')]),
    ]);
    expect(dupIssues(schema)).toEqual([]);
  });

  it('cùng tên, cùng cấp nhưng KHÁC nhánh ⇒ không báo', () => {
    const schema = mk([
      obj('Thế giới', [obj('Địa điểm', [leaf('tên')])]),
      obj('Nhân vật', [obj('Trang bị', [leaf('tên')])]),
    ]);
    expect(dupIssues(schema)).toEqual([]);
  });
});

describe('(bug 224) buildSchemaFixInstruction — báo cáo kiểm → chỉ thị cho AI', () => {
  it('schema sạch ⇒ chỉ thị rỗng, không mời AI làm gì cả', () => {
    const r = checkSchemaHealth(mk([obj('Nhân vật', [leaf('tên')])]));
    const fix = buildSchemaFixInstruction(r);
    expect(fix.count).toBe(0);
    expect(fix.instruction).toBe('');
  });

  it('gom theo LOẠI lỗi kèm danh sách đường dẫn, không đọc lại từng dòng', () => {
    const schema = mk([obj('Chỉ số', [
      leaf('máu', { type: 'number' }),
      leaf('cấp', { type: 'number' }),
      leaf('kinh nghiệm', { type: 'number' }),
    ])]);
    const fix = buildSchemaFixInstruction(checkSchemaHealth(schema));
    expect(fix.codes).toContain('number-no-range');
    // MỘT dòng cho cả ba biến thiếu min/max, không phải ba dòng.
    expect((fix.instruction.match(/number-no-range/g) ?? []).length).toBe(1);
    expect(fix.instruction).toContain('"Chỉ số.máu"');
    expect(fix.instruction).toContain('min/max');
  });

  it('chỉ thị LUÔN kèm ràng buộc chống phá thẻ (không xoá, không đổi tên bừa, không đổi kiểu)', () => {
    const fix = buildSchemaFixInstruction(checkSchemaHealth(mk([leaf('x', { type: 'number' })])));
    expect(fix.instruction).toMatch(/KHÔNG xoá biến nào/);
    expect(fix.instruction).toMatch(/KHÔNG đổi tên biến KHÔNG nằm trong danh sách trùng tên/);
    expect(fix.instruction).toMatch(/KHÔNG đổi kiểu/);
  });

  it('mỗi mã lỗi có cách sửa RIÊNG — trùng tên thì ĐỔI TÊN, không xoá', () => {
    const schema = mk([obj('A', [leaf('t'), leaf('t')])]);
    const fix = buildSchemaFixInstruction(checkSchemaHealth(schema));
    expect(fix.instruction).toContain('duplicate-name');
    expect(fix.instruction).toMatch(/ĐỔI TÊN/);
  });

  it('danh sách đường dẫn dài bị cắt và NÓI RÕ còn bao nhiêu (không im lặng bỏ)', () => {
    const kids = Array.from({ length: 20 }, (_, i) => leaf(`số ${i}`, { type: 'number' }));
    const fix = buildSchemaFixInstruction(checkSchemaHealth(mk([obj('Bộ', kids)])));
    expect(fix.instruction).toMatch(/và \d+ biến nữa cùng loại/);
  });

  it('report null/rỗng không làm nổ', () => {
    expect(buildSchemaFixInstruction(null).count).toBe(0);
    expect(buildSchemaFixInstruction(undefined).instruction).toBe('');
  });
});
