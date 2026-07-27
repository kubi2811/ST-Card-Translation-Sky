import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { applyMvuToText } from '../mvuSync';

/**
 * (User 27/07 — việc 119) "Lỗi html khi dịch bằng tool" — bản tool dịch xong cả <script> chết
 * với "Missing } in template expression", nút ẩn/hiện không chạy nữa.
 *
 * Đối chiếu 3 file bug/119 (raw / claude-không-lỗi / tool-lỗi) chỉ ra đúng một dòng vỡ:
 *     RAW : ${base.预言流言 || '无'}
 *     TOOL: ${base.Lời Tiên Tri Và Tin Đồn || 'vô'}   ← dot-access có KHOẢNG TRẮNG = vỡ JS
 * trong khi các chỗ khác lành: ${base['Vị Trí Hiện Tại'] || ...}.
 *
 * Thủ phạm: nhánh fallback của applyMvuToText thay tên biến TRẦN ở mọi nơi, kể cả ngay sau
 * dấu chấm — bản dịch nhiều từ thì dot-access phải chuyển sang bracket ['...'] mới hợp lệ.
 */

// Các cặp lấy từ chính bản dịch của user (fallback đã thay được tên nào thì dict phải có
// tên đó — đây là tái tạo trung thực từ điển lúc dịch, không bịa).
const DICT = {
  '预言流言': 'Lời Tiên Tri Và Tin Đồn',
  '所在位置': 'Vị Trí Hiện Tại',
  '当前值': 'Giá Trị Hiện Tại',
  '上限值': 'Giá Trị Tối Đa',
  '能量池': 'Hồ Năng Lượng',
  '内心OS': 'Nội tâmOS',
  '状态': 'Trạng Thái',
};

describe('(việc 119) dot-access khi tên dịch có khoảng trắng', () => {
  it('CHÍNH CA BUG (dòng 831 file thật): base.预言流言 → base[\'Lời Tiên Tri Và Tin Đồn\'], JS còn parse được', () => {
    const src = `badgeHtml = \`<span class="v">"\${base.预言流言 || '无'}"</span>\`;`;
    const out = applyMvuToText(src, DICT, true);
    expect(out).toContain(`base['Lời Tiên Tri Và Tin Đồn']`);
    expect(out).not.toMatch(/base\.Lời/);
    expect(() => new Function(out)).not.toThrow();
  });

  it('chuỗi dot nhiều tầng CJK → từng tầng thành bracket, vẫn parse được', () => {
    const out = applyMvuToText(`const x = data.预言流言.状态;`, DICT, true);
    expect(out).toContain(`data['Lời Tiên Tri Và Tin Đồn']['Trạng Thái']`);
    expect(() => new Function(out)).not.toThrow();
  });

  it('các ngữ cảnh KHÁC vẫn thay trần như cũ (YAML, macro, bracket, chữ hiển thị)', () => {
    const out = applyMvuToText(
      `预言流言: giá trị\n{{getvar::预言流言}}\nobj['预言流言']\n<span>预言流言</span>`,
      DICT, true,
    );
    expect(out).toContain(`Lời Tiên Tri Và Tin Đồn: giá trị`);
    expect(out).toContain(`{{getvar::Lời Tiên Tri Và Tin Đồn}}`);
    expect(out).toContain(`obj['Lời Tiên Tri Và Tin Đồn']`);
    expect(out).toContain(`<span>Lời Tiên Tri Và Tin Đồn</span>`);
  });

  it('bản dịch là identifier hợp lệ (không khoảng trắng) → dot-access giữ nguyên dạng dot', () => {
    const out = applyMvuToText(`const y = obj.等级;`, { '等级': 'Level' }, true);
    expect(out).toContain('obj.Level');
    expect(() => new Function(out)).not.toThrow();
  });

  it('optional chaining (file thật dòng 940): detail.能量池?.当前值 → bracket đúng cú pháp ?.[...]', () => {
    const out = applyMvuToText(
      'const w = Math.min(100, (detail.能量池?.当前值 / detail.能量池?.上限值 * 100)) || 0;',
      DICT, true,
    );
    expect(out).toContain(`detail['Hồ Năng Lượng']?.['Giá Trị Hiện Tại']`);
    expect(() => new Function(out)).not.toThrow();
  });

  it('TỰ LÀNH bản đã vỡ: card dịch hỏng từ trước (obj.Tên Nhiều Từ) chạy qua lại → thành bracket', () => {
    // Lượt dịch trước đã ghi ra dạng vỡ — chạy lại applyMvuToText với cùng dict phải sửa được.
    const broken = `el.text(\`\${base.Lời Tiên Tri Và Tin Đồn || 'vô'}\`);`;
    const out = applyMvuToText(broken, DICT, true);
    expect(out).toContain(`base['Lời Tiên Tri Và Tin Đồn']`);
    expect(() => new Function(out)).not.toThrow();
  });

  it('ca thật nguyên văn từ file bug/119 — cả đoạn parse sạch sau dịch', () => {
    const src = [
      `const row = (k,v) => \`<div class="row"><span class="k">\${k}</span><span class="v">\${v || '无'}</span></div>\`;`,
      `html += \`<div class="row"><span class="k">预言流言</span><span class="v">"\${base.预言流言 || '无'}"</span></div>\`;`,
      `$('#ui-mp').text(\`\${formatNum(mpPool.当前值 || 0)}\`);`,
    ].join('\n');
    const out = applyMvuToText(src, DICT, true);
    expect(() => new Function(out)).not.toThrow();
    expect(out).toContain(`mpPool['Giá Trị Hiện Tại']`);
  });
});

/* ─── Hồi quy trên NGUYÊN FILE THẬT user gửi (tự skip khi máy không có bug/119) ─── */
const DIR = fileURLToPath(new URL('../../../bug/119/', import.meta.url));
const BROKEN = DIR + 'html dịch lỗi bằng tool bị lỗi không ấn đc.txt';
const hasReal = fs.existsSync(BROKEN);

describe.skipIf(!hasReal)('(việc 119) file THẬT của user: tự lành hoàn toàn', () => {
  const getJs = (h: string) =>
    [...h.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
  const countErrs = (html: string) => {
    let n = 0;
    for (const s of getJs(html)) { try { new Function(s); } catch { n++; } }
    return n;
  };

  it('bản tool-lỗi: đúng 1 script vỡ TRƯỚC khi vá, 0 script vỡ SAU khi vá', () => {
    const broken = fs.readFileSync(BROKEN, 'utf8');
    expect(countErrs(broken)).toBe(1);            // tái hiện đúng lỗi user báo

    const healed = applyMvuToText(broken, DICT, true);
    expect(countErrs(healed)).toBe(0);            // chữa lành hoàn toàn
    expect(healed).toContain(`base['Lời Tiên Tri Và Tin Đồn']`);
    // Những chỗ vốn lành (đã bracket sẵn) không bị đụng
    expect(healed).toContain(`['Vị Trí Hiện Tại']`);
  });
});
