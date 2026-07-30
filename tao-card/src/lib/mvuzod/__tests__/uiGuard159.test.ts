// (bug 159 mục 6+7) "Thêm biến mới vào schema thì phát sinh lỗi nhỏ" và "Opening Form preview
// trong Regex Lab thì chạy, đưa vào SillyTavern thì bấm nút không được".
//
// Hai lỗ hổng đứng sau:
//   • checkHtmlScripts CHỈ được gọi trong panel preview, KHÔNG chạy trong pipeline hay bước kiểm
//     tra tổng thể — nên giao diện vỡ JS vẫn vào thẻ mà không ai cảnh báo. Vỡ JS thì mọi hàm gắn
//     vào onclick không tồn tại ⇒ bấm nút chẳng có gì xảy ra, mà không có lỗi đỏ nào.
//   • ID trùng: sanitizeId cắt 30 ký tự và bỏ ký tự lạ, nên "Máu (HP)" với "Máu HP" ra cùng một
//     id. getElementById lấy phần tử ĐẦU TIÊN ⇒ form đọc/ghi sai trường.
import { describe, it, expect } from 'vitest';
import { simulateCard } from '../simulateCard';
import { buildProgrammaticRegex } from '../programmaticRegexBuilder';
import { normalizeMVUZODSchema } from '../normalizeSchema';
import type { MVUZODSchema } from '../../../types/mvuzod.types';

const INIT = 'Máu: 100\n';
const SCHEMA = normalizeMVUZODSchema({
  version: '1.0',
  fields: [{ path: '/Máu', type: 'number', label: 'Máu', defaultValue: 100, constraints: {} }],
}) as MVUZODSchema;

describe('(bug 159-7) giao diện vỡ JS phải bị BẮT ở bước kiểm tổng thể', () => {
  it('script vỡ cú pháp → báo lỗi đích danh', () => {
    const r = simulateCard({
      initVarContent: INIT, schema: SCHEMA,
      readerSources: [{ name: 'Status Bar', content: '<div></div><script>function a( {</script>' }],
    });
    const hit = r.issues.filter(i => i.code === 'sim-ui-script-broken');
    expect(hit.length, 'vỡ JS mà không báo thì user không bao giờ biết vì sao nút chết').toBe(1);
    expect(hit[0].message).toContain('Status Bar');
    expect(r.ok, 'phải coi là KHÔNG ổn').toBe(false);
  });

  it('script lành → im lặng', () => {
    const r = simulateCard({
      initVarContent: INIT, schema: SCHEMA,
      readerSources: [{ name: 'Status Bar', content: '<script>function a(){ return 1; }</script>' }],
    });
    expect(r.issues.filter(i => i.code === 'sim-ui-script-broken')).toEqual([]);
  });
});

describe('(bug 159-6) id HTML trùng phải bị bắt', () => {
  it('hai phần tử cùng id → báo lỗi', () => {
    const r = simulateCard({
      initVarContent: INIT, schema: SCHEMA,
      readerSources: [{ name: 'Opening Form', content: '<input id="stcs-mau"><input id="stcs-mau">' }],
    });
    const hit = r.issues.filter(i => i.code === 'sim-ui-duplicate-id');
    expect(hit.length).toBe(1);
    expect(hit[0].message).toContain('stcs-mau');
  });

  it('id khác nhau → im lặng', () => {
    const r = simulateCard({
      initVarContent: INIT, schema: SCHEMA,
      readerSources: [{ name: 'Opening Form', content: '<input id="a"><input id="b">' }],
    });
    expect(r.issues.filter(i => i.code === 'sim-ui-duplicate-id')).toEqual([]);
  });
});

describe('(bug 159-6) bộ sinh id không đẻ ra id trùng nữa', () => {
  it('hai nhãn khác nhau nhưng cùng dạng chuẩn hoá → vẫn ra id KHÁC nhau', () => {
    // "Máu (HP)" và "Máu HP" đều bị sanitizeId biến thành "máu-hp".
    const s = normalizeMVUZODSchema({
      version: '1.0',
      fields: [{
        path: '/Nhân Vật', type: 'object', label: 'Nhân Vật', defaultValue: {}, constraints: {},
        children: [
          { path: '/Nhân Vật/Máu (HP)', type: 'number', label: 'Máu (HP)', defaultValue: 1, constraints: {} },
          { path: '/Nhân Vật/Máu HP', type: 'number', label: 'Máu HP', defaultValue: 2, constraints: {} },
        ],
      }],
    }) as MVUZODSchema;
    const html = buildProgrammaticRegex({ schema: s, component: 'status_bar', themeId: 'fantasy_medieval', gameName: 'T' }).previewHtml;
    const ids = [...html.matchAll(/\bid\s*=\s*["']([^"']+)["']/g)].map(m => m[1]);
    const dup = ids.filter((v, i) => ids.indexOf(v) !== i);
    expect(dup, `id trùng: ${dup.join(', ')}`).toEqual([]);
  });

  it('giao diện sinh ra từ schema thường cũng không có id trùng', () => {
    const s = normalizeMVUZODSchema({
      version: '1.0',
      fields: [
        { path: '/Ngày', type: 'number', label: 'Ngày', defaultValue: 1, constraints: {} },
        { path: '/Máu', type: 'number', label: 'Máu', defaultValue: 100, constraints: { min: 0, max: 100 } },
        { path: '/Khung Giờ', type: 'string', label: 'Khung Giờ', defaultValue: '', constraints: { enumValues: ['Sáng', 'Tối'] } },
      ],
    }) as MVUZODSchema;
    const html = buildProgrammaticRegex({ schema: s, component: 'full_set', themeId: 'fantasy_medieval', gameName: 'T' }).previewHtml;
    const ids = [...html.matchAll(/\bid\s*=\s*["']([^"']+)["']/g)].map(m => m[1]);
    expect(ids.filter((v, i) => ids.indexOf(v) !== i)).toEqual([]);
  });
});
