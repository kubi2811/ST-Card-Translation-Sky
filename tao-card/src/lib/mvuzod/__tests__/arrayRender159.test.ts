// (bug 159-8) "Túi đồ (Array) trong Opening Form chỉ cho nhập một vật phẩm và số lượng… Status
// Bar cũng không hiện gì."
//
// Gốc: `array` KHÔNG có nhánh nào trong analyzeSection. Chuỗi phân loại là
// object → record → number → enum → boolean → **else**, nên array rơi vào `else` cùng với string
// và bị dựng thành MỘT Ô NHẬP CHỮ. Không phải "thiếu logic cập nhật" — nó chưa từng được nhận ra
// là mảng ngay từ bước phân tích schema.
import { describe, it, expect } from 'vitest';
import { buildProgrammaticRegex } from '../programmaticRegexBuilder';
import { normalizeMVUZODSchema } from '../normalizeSchema';
import type { MVUZODSchema } from '../../../types/mvuzod.types';

const SCHEMA = normalizeMVUZODSchema({
  version: '1.0',
  fields: [{
    path: '/Người Chơi', type: 'object', label: 'Người Chơi', defaultValue: {}, constraints: {},
    children: [
      { path: '/Người Chơi/Máu', type: 'number', label: 'Máu', defaultValue: 100, constraints: { min: 0, max: 100 } },
      {
        path: '/Người Chơi/Kho Đồ', type: 'array', label: 'Kho Đồ', defaultValue: [], constraints: {},
        children: [
          { path: '/Người Chơi/Kho Đồ/_child/Tên', type: 'string', label: 'Tên', defaultValue: '', constraints: {} },
          { path: '/Người Chơi/Kho Đồ/_child/Số Lượng', type: 'number', label: 'Số Lượng', defaultValue: 1, constraints: {} },
        ],
      },
    ],
  }],
}) as MVUZODSchema;

const build = (component: 'status_bar' | 'full_set') =>
  buildProgrammaticRegex({ schema: SCHEMA, component, themeId: 'fantasy_medieval', gameName: 'Thử' }).previewHtml;

describe('(bug 159-8) array phải hiện thành DANH SÁCH, không phải ô nhập chữ', () => {
  it('Status Bar dựng danh sách cuộn cho mảng', () => {
    const html = build('status_bar');
    expect(html, 'phải có khung danh sách cho Kho Đồ').toMatch(/kho-đồ-list|kho-do-list/i);
    expect(html, 'phải có mã lặp theo chỉ số mảng').toContain('data-array-index');
  });

  it('mảng rỗng hiện "Trống" chứ không im lặng — user báo "không hiện gì"', () => {
    expect(build('status_bar')).toContain('Trống');
  });

  it('ghép các trường con của phần tử để đọc được (Tên | Số Lượng)', () => {
    const html = build('status_bar');
    expect(html).toContain("item['Tên']");
    expect(html).toContain("item['Số Lượng']");
  });

  it('tra field con bằng PATH thật, không dùng label hiển thị', () => {
    const s = normalizeMVUZODSchema({
      version: '1.0',
      fields: [{ path: '/Player', type: 'object', label: 'Người chơi', defaultValue: {}, constraints: {}, children: [{
          path: '/Player/Inventory', type: 'array', label: 'Túi đồ', defaultValue: [], constraints: {},
          children: [
            { path: '/Player/Inventory/_child/ItemName', type: 'string', label: 'Tên vật phẩm', defaultValue: '', constraints: {} },
            { path: '/Player/Inventory/_child/Amount', type: 'number', label: 'Số lượng', defaultValue: 0, constraints: {} },
          ],
        }] }],
    }) as MVUZODSchema;
    const html = buildProgrammaticRegex({ schema: s, component: 'status_bar' }).previewHtml;
    expect(html).toContain("item['ItemName']");
    expect(html).toContain("item['Amount']");
    expect(html).not.toContain("item['Tên vật phẩm']");
    expect(html).not.toContain("item['Số lượng']");
  });

  it('record cũng tra field con bằng PATH thật, không dùng label', () => {
    const s = normalizeMVUZODSchema({
      version: '1.0',
      fields: [{ path: '/World', type: 'object', label: 'Thế giới', defaultValue: {}, constraints: {}, children: [{
          path: '/World/NPC', type: 'record', label: 'Quan hệ NPC', defaultValue: {}, constraints: {},
          children: [{ path: '/World/NPC/_child/Affinity', type: 'number', label: 'Hảo cảm', defaultValue: 0, constraints: {} }],
        }] }],
    }) as MVUZODSchema;
    const html = buildProgrammaticRegex({ schema: s, component: 'status_bar' }).previewHtml;
    expect(html).toContain("entry['Affinity']");
    expect(html).not.toContain("entry['Hảo cảm']");
  });

  it('KHÔNG còn dựng mảng thành ô nhập chữ như trước', () => {
    const html = build('status_bar');
    // Ô nhập chữ cho Kho Đồ sẽ có dạng <input ... id="...kho-đồ"> mà không phải trong danh sách.
    expect(html, 'mảng không được là input đơn').not.toMatch(/<input[^>]*id="[^"]*kho-đồ"(?![^>]*list)/i);
  });

  it('mảng vẫn được đếm là biến của schema (không bị bỏ rơi khỏi allLeafFields)', () => {
    const r = buildProgrammaticRegex({ schema: SCHEMA, component: 'status_bar', themeId: 'fantasy_medieval', gameName: 'T' });
    expect(r.fieldsRendered, 'Máu + Kho Đồ').toBeGreaterThanOrEqual(2);
  });

  it('full_set (Opening Form + Status Bar) dựng được, không vỡ', () => {
    expect(build('full_set').length).toBeGreaterThan(1000);
  });
});

// Nửa còn lại của mục 8: "chưa có cơ chế cập nhật". Luật array/record đã có trong prompt lúc TẠO
// thẻ, nhưng entry quy tắc ĐI KÈM THẺ — thứ AI đọc lúc CHƠI — thì im lặng hoàn toàn về hai kiểu
// đó. Nên AI chỉ replace/delta biến phẳng, còn Túi Đồ đứng nguyên rỗng suốt ván.
describe('(bug 159-8) entry quy tắc phải dạy cách chèn vào mảng / từ điển', () => {
  it('mảng: dạy insert với path kết thúc "/-", replace theo chỉ số, remove', async () => {
    const { generateUpdateRulesEntry } = await import('../scriptGenerator');
    const txt = generateUpdateRulesEntry(SCHEMA);
    expect(txt, 'phải nêu đích danh đường dẫn mảng').toContain('Kho Đồ');
    expect(txt).toContain('/-');
    expect(txt).toContain('"op":"insert"');
    expect(txt).toContain('"op":"remove"');
    expect(txt, 'chặn lỗi insert trùng').toMatch(/KHÔNG insert lại/i);
  });

  it('từ điển: dạy kiểm tên tồn tại trước khi insert (insert đè là xoá sạch dữ liệu cũ)', async () => {
    const { generateUpdateRulesEntry } = await import('../scriptGenerator');
    const s = normalizeMVUZODSchema({
      version: '1.0',
      fields: [{
        path: '/Quan Hệ NPC', type: 'record', label: 'Quan Hệ NPC', defaultValue: {}, constraints: {},
        children: [{ path: '/Quan Hệ NPC/_child/Hảo Cảm', type: 'number', label: 'Hảo Cảm', defaultValue: 0, constraints: {} }],
      }],
    }) as MVUZODSchema;
    const txt = generateUpdateRulesEntry(s);
    expect(txt).toContain('Quan Hệ NPC');
    expect(txt).toMatch(/PHẢI kiểm tên đã tồn tại/i);
  });

  it('thẻ KHÔNG có mảng/từ điển → không thêm đoạn nào (đừng làm entry phình vô ích)', async () => {
    const { generateUpdateRulesEntry } = await import('../scriptGenerator');
    const s = normalizeMVUZODSchema({
      version: '1.0',
      fields: [{ path: '/Máu', type: 'number', label: 'Máu', defaultValue: 100, constraints: {} }],
    }) as MVUZODSchema;
    expect(generateUpdateRulesEntry(s)).not.toContain('Cách thêm/bớt mục');
  });
});
