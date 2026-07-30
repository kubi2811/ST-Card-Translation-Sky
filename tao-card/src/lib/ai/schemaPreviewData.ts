/**
 * src/lib/ai/schemaPreviewData.ts — (bug 148-3) XEM TRƯỚC GIAO DIỆN VỚI BIẾN THẬT.
 * ─────────────────────────────────────────────────────────────────────────────
 * User: "Ở xem trước & tinh chỉnh bước 2 giao diện, thì có chế độ Preview xem trước giao diện
 * khi áp dụng các biến của Schema vừa chỉnh sửa hoặc giữ nguyên."
 *
 * Vì sao trước đây preview trông rỗng: giao diện dựng ra đọc biến qua `getAllVariables().stat_data`
 * rồi chờ `waitGlobalInitialized('Mvu')` — trong iframe xem trước KHÔNG có TavernHelper/MVU nên
 * `init()` treo ở dòng chờ đó, `populateData()` không bao giờ chạy, mọi ô số nằm trơ giá trị mẫu
 * cứng của HTML. Người dùng chỉnh schema mà chẳng thấy khác gì.
 *
 * Cách chữa: bơm một MVU GIẢ vào đầu iframe, mang đúng dữ liệu sinh TỪ CHÍNH SCHEMA đang chỉnh
 * (defaultValue là chính, thiếu thì suy giá trị mẫu hợp lý theo kiểu/miền). Không đụng một dòng
 * nào của HTML thật — thứ người dùng nhìn thấy vẫn là giao diện sẽ xuất ra thẻ.
 */

import type { MVUZODField, MVUZODSchema } from '../../types/mvuzod.types';

/** Giá trị mẫu cho một field lá — ưu tiên defaultValue, thiếu thì suy theo kiểu + miền. */
function sampleLeaf(f: MVUZODField): unknown {
  const c = f.constraints ?? {};
  if (f.defaultValue !== undefined && f.defaultValue !== null && f.defaultValue !== '') return f.defaultValue;

  if (c.enumValues?.length) return c.enumValues[0];
  switch (f.type) {
    case 'number': {
      const min = typeof c.min === 'number' ? c.min : 0;
      const max = typeof c.max === 'number' ? c.max : undefined;
      // Có trần thì lấy ~70% thang (thanh tiến trình nhìn ra hình dạng); không trần thì số tròn.
      return max !== undefined ? Math.round(min + (max - min) * 0.7) : Math.max(min, 12);
    }
    case 'boolean': return false;
    case 'array': return [];
    case 'record': return {};
    default: return '—';
  }
}

/**
 * Dựng cây `stat_data` mẫu từ schema. Array/Record có cấu trúc con (`/_child/`) được sinh
 * 1-2 phần tử mẫu để vòng lặp trong giao diện có thứ mà vẽ — danh sách rỗng thì người dùng
 * nhìn preview vẫn không biết mục đó trông ra sao.
 */
export function buildSampleStatData(schema: MVUZODSchema | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!schema?.fields?.length) return out;

  const childShape = (f: MVUZODField): Record<string, unknown> => {
    const shape: Record<string, unknown> = {};
    for (const c of f.children ?? []) {
      if (!c.path.includes('/_child/')) continue;
      shape[String(c.path.split('/').pop() ?? '')] = sampleLeaf(c);
    }
    return shape;
  };

  const walk = (fields: MVUZODField[], target: Record<string, unknown>) => {
    for (const f of fields) {
      const name = String(f.path ?? '').split('/').filter(Boolean).pop() ?? f.label;
      if (!name) continue;

      if (f.type === 'array') {
        const shape = childShape(f);
        const seeded = Array.isArray(f.defaultValue) && f.defaultValue.length ? f.defaultValue : null;
        target[name] = seeded ?? (Object.keys(shape).length ? [shape, { ...shape }] : ['Mục mẫu 1', 'Mục mẫu 2']);
        continue;
      }
      if (f.type === 'record') {
        const shape = childShape(f);
        const seeded = f.defaultValue && typeof f.defaultValue === 'object' && !Array.isArray(f.defaultValue)
          && Object.keys(f.defaultValue as object).length ? (f.defaultValue as Record<string, unknown>) : null;
        target[name] = seeded ?? (Object.keys(shape).length
          ? { 'Nhân vật A': shape, 'Nhân vật B': { ...shape } }
          : { 'Khoá mẫu': 'Giá trị mẫu' });
        continue;
      }
      // Nhóm object (children KHÔNG phải _child) → xuống một tầng.
      const groupKids = (f.children ?? []).filter(c => !c.path.includes('/_child/'));
      if (groupKids.length) {
        const sub: Record<string, unknown> = {};
        walk(groupKids, sub);
        target[name] = sub;
        continue;
      }
      target[name] = sampleLeaf(f);
    }
  };

  walk(schema.fields, out);
  return out;
}

/**
 * (bug 149) Gỡ rào markdown trước khi nhét vào iframe.
 *
 * `previewHtml` CỐ Ý mang ```html vì đó là quy ước output của regex SillyTavern — đúng cho thẻ
 * xuất ra, nhưng nhét thẳng vào iframe thì trình duyệt vẽ luôn mấy ký tự đó thành chữ nổi trên
 * đầu khung (đúng ảnh user gửi). GameFrontendPreview đã tự gỡ tại chỗ, PreviewTunerModal thì
 * không — nên gom về MỘT hàm dùng chung, thêm khung xem trước mới cũng không sót lần nữa.
 */
export function toIframeHtml(previewHtml: string): string {
  return String(previewHtml || '')
    .replace(/^\s*```(?:html)?\r?\n/i, '')
    .replace(/\r?\n?```\s*$/, '');
}

/**
 * Chèn MVU GIẢ + dữ liệu mẫu vào HTML preview.
 * Đặt NGAY SAU <head> để chạy trước mọi script của giao diện: `waitGlobalInitialized` trả về
 * ngay, `getAllVariables()` có dữ liệu, nên `populateData()` vẽ đúng số của schema đang chỉnh.
 */
export function withPreviewData(
  previewHtml: string,
  schema: MVUZODSchema | null | undefined,
  /**
   * (bug 159-4) Khung này đóng vai gì trong bộ đôi mô phỏng.
   * `role` để hai iframe chia sẻ MỘT trạng thái: Opening Form GHI, Status Bar ĐỌC. Không có nó
   * thì mỗi khung một bản dữ liệu riêng, điền form xong Status Bar vẫn đứng im — mà "điền form
   * thì Status Bar tự cập nhật theo" chính là yêu cầu của mục này.
   */
  role: 'form' | 'status' | 'solo' = 'solo',
): string {
  const stat = buildSampleStatData(schema);
  const stub = `<script>
/* (bug 148/159-4) MVU giả CHỈ dùng cho khung xem trước — không đi vào thẻ xuất ra.
 * (159-4) Nay GHI ĐƯỢC: bản cũ để insertOrAssignVariables/setvar là hàm rỗng nên bấm Xác nhận
 * trong Opening Form chẳng có gì xảy ra, và Status Bar không bao giờ đổi. Cách nối đúng chính là
 * cách MVU thật hoạt động: ai ghi thì phát sự kiện VARIABLE_UPDATE_ENDED, ai vẽ thì đã đăng ký
 * lắng nghe sự kiện đó qua eventOn — nên chỉ cần stub tôn trọng đúng hợp đồng ấy. */
(function () {
  var ROLE = ${JSON.stringify(role)};
  var DATA = { stat_data: ${JSON.stringify(stat)} };
  var listeners = [];

  function deepMerge(dst, src) {
    if (!src || typeof src !== 'object') return dst;
    Object.keys(src).forEach(function (k) {
      var v = src[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && dst[k] && typeof dst[k] === 'object' && !Array.isArray(dst[k])) {
        deepMerge(dst[k], v);
      } else {
        dst[k] = v;   // mảng và giá trị đơn thì THAY, không trộn — trộn mảng là nhân đôi phần tử
      }
    });
    return dst;
  }
  function fire() { listeners.slice().forEach(function (cb) { try { cb(); } catch (e) { console.warn(e); } }); }
  /** Đẩy thay đổi sang khung bên kia (Status Bar) qua cửa cha. */
  function broadcast() {
    if (ROLE === 'solo') return;
    try { parent.postMessage({ __stcsPreview: true, role: ROLE, stat: DATA.stat_data }, '*'); } catch (e) { /* khác origin thì bỏ */ }
  }

  window.getAllVariables = function () { return DATA; };
  window.getvar = function (path, opts) {
    var p = String(path || '').replace(/^stat_data\\./, '').split('.');
    var cur = DATA.stat_data;
    for (var i = 0; i < p.length; i++) { if (cur == null) break; cur = cur[p[i]]; }
    return cur === undefined ? (opts && opts.defaults) : cur;
  };
  window.setvar = function (path, value) {
    var p = String(path || '').replace(/^stat_data\\./, '').split('.').filter(Boolean);
    var cur = DATA.stat_data;
    for (var i = 0; i < p.length - 1; i++) { if (cur[p[i]] == null || typeof cur[p[i]] !== 'object') cur[p[i]] = {}; cur = cur[p[i]]; }
    if (p.length) cur[p[p.length - 1]] = value;
    fire(); broadcast();
    return true;
  };
  window.waitGlobalInitialized = function () { return Promise.resolve(); };
  window.eventOn = function (_evt, cb) { if (typeof cb === 'function') listeners.push(cb); };
  window.eventEmit = function () { fire(); };
  window.errorCatched = function (fn) { return function () { try { return fn.apply(this, arguments); } catch (e) { console.warn(e); } }; };
  window.Mvu = { events: { VARIABLE_UPDATE_ENDED: 'preview' }, getMvuData: function () { return DATA; } };
  /* Opening Form ghi qua ĐÚNG một đường này (xem buildSubmitHandler). */
  window.insertOrAssignVariables = function (vars) {
    if (vars && vars.stat_data) deepMerge(DATA.stat_data, vars.stat_data);
    else deepMerge(DATA.stat_data, vars || {});
    fire(); broadcast();
    return Promise.resolve();
  };
  window.replaceVariables = window.insertOrAssignVariables;
  window.activewi = function () { return Promise.resolve(true); };
  window.getwi = function () { return Promise.resolve(''); };

  /* Khung ĐỌC nhận dữ liệu do khung GHI gửi sang rồi vẽ lại. */
  if (ROLE === 'status') {
    addEventListener('message', function (ev) {
      var d = ev && ev.data;
      if (!d || !d.__stcsPreview || d.role === 'status' || !d.stat) return;
      deepMerge(DATA.stat_data, d.stat);
      fire();
    });
  }
})();
</script>`;

  if (/<head[^>]*>/i.test(previewHtml)) return previewHtml.replace(/<head[^>]*>/i, m => `${m}\n${stub}`);
  if (/<body[^>]*>/i.test(previewHtml)) return previewHtml.replace(/<body[^>]*>/i, m => `${m}\n${stub}`);
  return stub + previewHtml;
}
