// (bug 156) "check xem sau khi dịch thì schema và phần hướng dẫn cập nhật định dạng biến có
// trùng và đúng với nhau không".
//
// Lệch nhau thì KHÔNG CÓ LỖI NÀO BÁO nhưng hỏng cả hai chiều: tên chỉ có ở hướng dẫn → AI xuất
// JSONPatch trỏ vào đường không tồn tại (chỉ số đứng im); tên chỉ có ở schema → AI không biết
// biến đó tồn tại nên không bao giờ cập nhật (nằm chết ở giá trị khởi tạo).
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  checkSchemaVsUpdateFormat, extractZodRootNames, extractGuidePathRoots,
} from '../mvuSchemaFormatSync';

const ZOD = `registerMvuSchema({
  'Thiên Tuyển Giả': z.object({ 'Họ Tên': z.string() }),
  'Túi Đồ': z.object({}),
});`;
const GUIDE = `valid_paths:
  /Thiên Tuyển Giả/{Họ Tên, Tuổi Tác(number)}
  /Túi Đồ/Danh Sách Vật Phẩm/-   insert:{Tên Vật Phẩm}`;

describe('(bug 156) trích tên biến hai bên', () => {
  it('zod: lấy đúng tên gốc', () => {
    expect(extractZodRootNames(ZOD).sort()).toEqual(['Thiên Tuyển Giả', 'Túi Đồ']);
  });

  it('hướng dẫn: lấy đoạn đầu đường dẫn, BỎ mẫu giữ chỗ ${/path/to/…} và thẻ XML', () => {
    const g = extractGuidePathRoots(`${GUIDE}
      { "op": "replace", "path": "\${/path/to/variable}" }
      </Analysis>`);
    expect(g).toContain('Thiên Tuyển Giả');
    expect(g).toContain('Túi Đồ');
    expect(g, 'mẫu giữ chỗ không phải biến thật').not.toContain('path');
    expect(g).not.toContain('Analysis');
  });
});

describe('(bug 156) đối chiếu', () => {
  it('khớp nhau → ok', () => {
    const r = checkSchemaVsUpdateFormat(ZOD, GUIDE);
    expect(r.ok).toBe(true);
    expect(r.matched).toBe(2);
  });

  it('hướng dẫn có tên schema KHÔNG khai → báo (AI ghi vào đường không tồn tại)', () => {
    const r = checkSchemaVsUpdateFormat(ZOD, `${GUIDE}\n  /Kho Báu Ẩn/Số Lượng  number`);
    expect(r.ok).toBe(false);
    expect(r.onlyInGuide).toContain('Kho Báu Ẩn');
  });

  it('schema có tên hướng dẫn KHÔNG nhắc → báo (AI không bao giờ cập nhật)', () => {
    const zod = `${ZOD.slice(0, -3)}  'Đồng Đội': z.object({}),\n});`;
    const r = checkSchemaVsUpdateFormat(zod, GUIDE);
    expect(r.ok).toBe(false);
    expect(r.onlyInSchema).toContain('Đồng Đội');
  });

  it('lệch DẤU / hoa-thường thì KHÔNG báo — MVU vẫn khớp, báo là làm phiền', () => {
    const r = checkSchemaVsUpdateFormat(ZOD, GUIDE.replace('Túi Đồ', 'TÚI ĐỒ'));
    expect(r.ok).toBe(true);
  });

  it('thiếu hẳn một bên → bỏ qua, không phán bừa', () => {
    expect(checkSchemaVsUpdateFormat('', GUIDE).skipped).toBe(true);
    expect(checkSchemaVsUpdateFormat(ZOD, '').skipped).toBe(true);
  });
});

// Đối chiếu trên chính cặp file user gửi — đây là card ĐÚNG, nên phép kiểm phải im lặng.
const DIR = resolve(__dirname, '../../../bug/156');
const Z = resolve(DIR, 'zod schema.txt');
const M = resolve(DIR, '[mvu_update] Định Dạng Xuất Biến.txt');
describe.skipIf(!existsSync(Z) || !existsSync(M))('(bug 156) trên card thật của user', () => {
  it('card đúng → KHÔNG được báo lệch (chống báo động giả)', () => {
    const r = checkSchemaVsUpdateFormat(readFileSync(Z, 'utf-8'), readFileSync(M, 'utf-8'));
    expect(r.onlyInGuide, 'báo oan tên chỉ có ở hướng dẫn').toEqual([]);
    expect(r.onlyInSchema, 'báo oan tên chỉ có ở schema').toEqual([]);
    expect(r.matched).toBeGreaterThanOrEqual(7);
  });

  it('đổi tên MỘT bên → bắt được ngay', () => {
    const guide = readFileSync(M, 'utf-8').replace(/Túi Đồ Quỷ Dị/g, 'Túi Đồ Kỳ Dị');
    const r = checkSchemaVsUpdateFormat(readFileSync(Z, 'utf-8'), guide);
    expect(r.ok).toBe(false);
    expect(r.onlyInGuide.join(' ')).toContain('Kỳ Dị');
    expect(r.onlyInSchema.join(' ')).toContain('Quỷ Dị');
  });
});
