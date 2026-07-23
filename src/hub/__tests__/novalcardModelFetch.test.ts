import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * (User 23/07 — việc 84) "Chỗ Trích Card phần Thiết lập API mục model phụ chưa có nút lấy model
 * tự động."
 *
 * Trích Card là MỘT file HTML tĩnh tự chứa (public/apps/novalcard-vi.html) — không qua bundler,
 * không type-check, không lint. Gõ sai một id trong `$("...")` là nút im lặng không hoạt động,
 * không lỗi nào hiện ra. Test này là lưới an toàn duy nhất của file đó: soi thẳng nội dung,
 * bắt lỗi lệch id giữa markup và JS.
 */

const HTML = fs.readFileSync(
  path.resolve(__dirname, '../../../public/apps/novalcard-vi.html'),
  'utf8',
);

/** Đếm số lần một id được KHAI BÁO trong markup (id="..."). */
const declaredCount = (id: string) =>
  (HTML.match(new RegExp(`id="${id}"`, 'g')) || []).length;

describe('Trích Card — nút tải danh sách mô hình cho MỌI ô model', () => {
  const FIELDS = [
    { label: 'model chính P1', btn: 'fetchModels', msg: 'modelMsg', sel: 'modelSelect', input: 'model' },
    { label: 'model PHỤ P1', btn: 'fetchModels2', msg: 'modelMsg2', sel: 'modelSelect2', input: 'secondaryModel' },
    { label: 'model chính (provider 2+)', btn: 'pmFetchModels', msg: 'pmModelMsg', sel: 'pmModelSelect', input: 'pmModel' },
    { label: 'model phụ (provider 2+)', btn: 'pmFetchModels2', msg: 'pmModelMsg2', sel: 'pmModelSelect2', input: 'pmSecondaryModel' },
  ];

  for (const f of FIELDS) {
    it(`${f.label}: có đủ nút + ô thông báo + dropdown + ô nhập, mỗi id khai báo ĐÚNG 1 lần`, () => {
      for (const id of [f.btn, f.msg, f.sel, f.input]) {
        expect(declaredCount(id), `id "${id}" phải được khai báo đúng 1 lần trong markup`).toBe(1);
      }
    });

    it(`${f.label}: đã được lắp qua wireModelFetch với đúng bộ id`, () => {
      const call = new RegExp(
        `wireModelFetch\\(\\s*"${f.btn}"\\s*,\\s*"${f.msg}"\\s*,\\s*"${f.sel}"\\s*,\\s*"${f.input}"`,
      );
      expect(HTML).toMatch(call);
    });
  }

  it('phần gọi API được dùng CHUNG, không copy-paste 4 lần', () => {
    expect((HTML.match(/async function fetchModelIds\(/g) || []).length).toBe(1);
    expect((HTML.match(/function wireModelFetch\(/g) || []).length).toBe(1);
  });

  it('ô trong modal lấy Base URL/Key của CHÍNH provider đó, không lấy của Provider 1', () => {
    expect(HTML).toMatch(/connPm\s*=\s*\(\)\s*=>\s*\(\{[^}]*pmBaseUrl/);
    expect(HTML).toMatch(/wireModelFetch\("pmFetchModels",[^)]*connPm\)/);
    expect(HTML).toMatch(/wireModelFetch\("pmFetchModels2",[^)]*connPm\)/);
  });

  it('ô của Provider 1 lấy Base URL/Key từ cấu hình chính', () => {
    expect(HTML).toMatch(/wireModelFetch\("fetchModels",[^)]*connP1\)/);
    expect(HTML).toMatch(/wireModelFetch\("fetchModels2",[^)]*connP1\)/);
  });

  it('đổi profile API → ẩn CẢ HAI dropdown (danh sách của provider cũ không còn đúng)', () => {
    const line = HTML.split('\n').find(l => l.includes('$("apiProfile").onchange')) || '';
    expect(line).toContain('$("modelSelect").style.display="none"');
    expect(line).toContain('$("modelSelect2").style.display="none"');
  });

  it('mở provider khác trong modal → reset dropdown + thông báo cũ', () => {
    expect(HTML).toMatch(/for\(const id of \["pmModelSelect","pmModelSelect2"\]\)/);
  });

  it('không còn hàm modelsEndpoint chết sau khi gom về fetchModelIds', () => {
    expect(HTML).not.toContain('function modelsEndpoint(');
    expect(HTML).not.toContain('modelsEndpoint()');
  });
});
