import { describe, it, expect } from 'vitest';
import { normalizeEjsExpr } from '../aiVerify';

/**
 * (User 2026) "Nghiệm thu" báo SAI 78 "EJS template expression missing" vì tên biến/chuỗi so sánh
 * bên trong EJS đã được DỊCH có chủ ý (Chiến lược B/C) → expression khác card gốc nhưng KHÔNG vỡ.
 * normalizeEjsExpr so CẤU TRÚC (bỏ nội dung chuỗi) → bản gốc & bản dịch cùng cấu trúc = KHÔNG lỗi.
 */
describe('normalizeEjsExpr — so cấu trúc EJS, bỏ nội dung chuỗi đã dịch', () => {
  it('expression chỉ khác vì CHUỖI được dịch → chuẩn hoá GIỐNG nhau', () => {
    const orig = "if (!_.has(getvar('stat_data'), '系统指点.初始化'))";
    const trans = "if (!_.has(getvar('stat_data'), 'Hệ thống chỉ điểm.Khởi tạo'))";
    expect(normalizeEjsExpr(orig)).toBe(normalizeEjsExpr(trans));
  });

  it('so sánh chuỗi đã dịch (=== "…") → cùng cấu trúc', () => {
    expect(normalizeEjsExpr("enemyType === '家族敌对'"))
      .toBe(normalizeEjsExpr("enemyType === 'Gia tộc đối địch'"));
  });

  it('CẤU TRÚC khác (thiếu điều kiện / đổi code) → KHÁC nhau (vẫn bắt lỗi thật)', () => {
    expect(normalizeEjsExpr("if (a === 'x' && b)"))
      .not.toBe(normalizeEjsExpr("if (a === 'x')"));
  });

  it('giữ nguyên phần code (getvar, map, =>), chỉ rỗng hoá chuỗi', () => {
    const n = normalizeEjsExpr("informants.map(id => { var x = getvar('通缉') })");
    expect(n).toContain('informants.map(id => {');
    expect(n).toContain("getvar('')");   // chuỗi bị rỗng hoá
    expect(n).not.toContain('通缉');       // nội dung chuỗi đã bỏ
  });
});
