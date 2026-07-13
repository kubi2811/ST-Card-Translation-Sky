import { describe, it, expect } from 'vitest';
import {
  canonicalizeMvuVarName,
  enforceExactConsistency,
  enforceInitvarCovariance,
} from '../mvuSync';

/**
 * (User yêu cầu 2026 — lỗi NGHIÊM TRỌNG do nhiều dịch giả báo)
 * Cùng 1 biến MVU nguồn bị dịch KHÔNG đồng nhất: chỗ `Họ_Tên`, chỗ `Họ Tên`, chỗ `Họ-Tên`.
 * MVU truy cập biến bằng KEY chuỗi ⇒ lệch dạng = hỏng. Dạng chuẩn đã chốt = "Họ Tên" (cách, bỏ _/-).
 * KHÔNG được đụng identifier code ASCII (stat_data, mvu_update, _mvu) — sẽ phá script.
 */
describe('canonicalizeMvuVarName (chuẩn hoá tên biến đã dịch về dạng "Họ Tên")', () => {
  it('bỏ gạch dưới `_` → space', () => {
    expect(canonicalizeMvuVarName('Họ_Tên')).toBe('Họ Tên');
  });
  it('bỏ gạch ngang `-` → space', () => {
    expect(canonicalizeMvuVarName('Họ-Tên')).toBe('Họ Tên');
  });
  it('gộp space thừa', () => {
    expect(canonicalizeMvuVarName('Họ   Tên')).toBe('Họ Tên');
  });
  it('nhiều từ + lẫn _ và - và space', () => {
    expect(canonicalizeMvuVarName('Họ_Tên-Đầy  Đủ')).toBe('Họ Tên Đầy Đủ');
  });
  it('bỏ nháy bao quanh (dict value đôi khi kèm nháy) + chuẩn hoá', () => {
    expect(canonicalizeMvuVarName("'Võ_Lực'")).toBe('Võ Lực');
    expect(canonicalizeMvuVarName('"Trí_Lực"')).toBe('Trí Lực');
  });
  it('CJK có gạch dưới → space (biến chưa dịch nhưng dính _)', () => {
    expect(canonicalizeMvuVarName('武_力')).toBe('武 力');
  });

  // ── BẢO VỆ: identifier code ASCII KHÔNG bị đụng (giữ nguyên `_`) ──
  it('ASCII snake_case (stat_data) GIỮ NGUYÊN — là biến hệ thống', () => {
    expect(canonicalizeMvuVarName('stat_data')).toBe('stat_data');
  });
  it('prefix chức năng mvu_update GIỮ NGUYÊN', () => {
    expect(canonicalizeMvuVarName('mvu_update')).toBe('mvu_update');
  });
  it('tên bắt đầu bằng `_` (ASCII) GIỮ NGUYÊN', () => {
    expect(canonicalizeMvuVarName('_internalFlag')).toBe('_internalFlag');
    expect(canonicalizeMvuVarName('user_name_en')).toBe('user_name_en');
  });
  it('rỗng / không phải chuỗi → trả về như cũ', () => {
    expect(canonicalizeMvuVarName('')).toBe('');
    // @ts-expect-error kiểm đầu vào lạ
    expect(canonicalizeMvuVarName(null)).toBe(null);
  });
  it('đã sạch sẵn → không đổi (idempotent)', () => {
    expect(canonicalizeMvuVarName('Họ Tên')).toBe('Họ Tên');
    expect(canonicalizeMvuVarName(canonicalizeMvuVarName('Họ_Tên'))).toBe('Họ Tên');
  });
});

describe('enforceExactConsistency — làm sạch dấu ở dạng canonical', () => {
  it('biến đơn dính `_` → dict value về dạng space', () => {
    const { fixedDict } = enforceExactConsistency({ '姓名': 'Họ_Tên' });
    expect(fixedDict['姓名']).toBe('Họ Tên');
  });
  it('2 biến nguồn dịch lệch dạng (Họ_Tên vs Họ Tên) → GOM về 1 dạng "Họ Tên"', () => {
    const { fixedDict } = enforceExactConsistency({ '姓名': 'Họ_Tên', '名字': 'Họ Tên' });
    expect(fixedDict['姓名']).toBe('Họ Tên');
    expect(fixedDict['名字']).toBe('Họ Tên');
  });
});

describe('enforceInitvarCovariance — an toàn cú pháp khi tên chuẩn có space', () => {
  const dict = { '姓名': 'Họ Tên' };
  it('Zod key BARE (không nháy) lệch dạng → BỌC NHÁY để không vỡ JS', () => {
    const input = `z.object({\n  Họ_Tên: z.string(),\n})`;
    const { text } = enforceInitvarCovariance(input, dict, false);
    expect(text).toContain(`'Họ Tên': z.string()`);
    expect(text).not.toContain('Họ_Tên');
  });
  it('YAML key đã có nháy → giữ nháy, chỉ đổi bên trong', () => {
    const input = `'Họ_Tên': 0`;
    const { text } = enforceInitvarCovariance(input, dict, false);
    expect(text).toContain(`'Họ Tên':`);
  });
  it('macro {{getvar::Họ_Tên}} → chuẩn hoá về Họ Tên', () => {
    const input = `Xin chào {{getvar::Họ_Tên}}!`;
    const { text } = enforceInitvarCovariance(input, dict, false);
    expect(text).toBe(`Xin chào {{getvar::Họ Tên}}!`);
  });
  it('bracket access obj[\'Họ_Tên\'] → obj[\'Họ Tên\']', () => {
    const input = `_.get(stat_data, 'Họ_Tên')`;
    const { text } = enforceInitvarCovariance(input, dict, false);
    expect(text).toContain(`'Họ Tên'`);
  });
});
