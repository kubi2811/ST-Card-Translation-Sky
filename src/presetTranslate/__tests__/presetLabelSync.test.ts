import { describe, it, expect } from 'vitest';
import {
  extractLineLabels,
  buildLabelMap,
  applyLabelMapToRegex,
  applyLabelMapToText,
} from '../presetLabelSync';

/**
 * (User 27/07 — việc 118) "Chỗ dịch preset bị lỗi phần dịch regex, phần đó nó không dịch và
 * chưa đồng bộ được với prompt của preset."
 *
 * Dữ liệu thật (bug/118, preset 绘绘绘绘绘): prompt `options_fmt` dịch 选项一→"Lựa chọn 1"
 * nhưng findRegex vẫn bám 选项一：— AI xuất theo prompt mới, regex rình chữ cũ, không bao giờ
 * khớp. Nhãn không phải tag/var nên regex pass cũ trả 'manual' rồi bỏ qua nguyên script.
 */

// Chép NGUYÊN VĂN từ bug/118 — đây là hợp đồng với dữ liệu thật, không phải ví dụ bịa.
const ZH_PROMPT = `{{setvar::options_fmt::<options>
>选项一：{积极推进但承担明确代价的具体行动}
>选项二：{谨慎调查、交涉或观察的具体行动}
>选项三：{围绕当前人物关系的具体互动}
>选项四：{输出一个当下最符合的nsfw的具体行动}
</options>}}`;

const VI_PROMPT = `{{setvar::options_fmt::<options>
>Lựa chọn 1: {Hành động cụ thể tích cực thúc đẩy nhưng phải chịu cái giá rõ ràng}
>Lựa chọn 2: {Hành động cụ thể cẩn trọng điều tra, giao thiệp hoặc quan sát}
>Lựa chọn 3: {Tương tác cụ thể xoay quanh mối quan hệ nhân vật hiện tại}
>Lựa chọn 4: {Xuất ra một hành động nsfw cụ thể phù hợp nhất hiện tại}
</options>}}`;

const REAL_FIND_REGEX =
  '<options>\\s*?>选项一：\\s*([^>]+?)\\s*?>选项二：\\s*([^>]+?)\\s*?>选项三：\\s*([^>]+?)\\s*?>选项四：\\s*([^>]+?)\\s*<\\/options>';

describe('extractLineLabels — bóc nhãn đầu dòng dạng ">NHÃN："', () => {
  it('bóc đúng 4 nhãn từ prompt thật, đúng thứ tự', () => {
    expect(extractLineLabels(ZH_PROMPT)).toEqual(['选项一', '选项二', '选项三', '选项四']);
    expect(extractLineLabels(VI_PROMPT)).toEqual(['Lựa chọn 1', 'Lựa chọn 2', 'Lựa chọn 3', 'Lựa chọn 4']);
  });

  it('bỏ nhiễu macro/cú pháp — không nhặt {{setvar hay URL', () => {
    expect(extractLineLabels('{{setvar::x::y}}\nhttps://a.com\n>Nhãn thật: nội dung')).toEqual(['Nhãn thật']);
  });

  it('văn bản không có nhãn → mảng rỗng', () => {
    expect(extractLineLabels('Chỉ là một đoạn văn bình thường không có dấu hai chấm đầu dòng đúng dạng')).toEqual([]);
  });
});

describe('buildLabelMap — ghép cặp prompt trước/sau dịch theo identifier', () => {
  const pristine = [{ identifier: 'options_fmt', content: ZH_PROMPT }];
  const translated = [{ identifier: 'options_fmt', content: VI_PROMPT }];

  it('CHÍNH CA BUG: 选项一 → "Lựa chọn 1" — map KÈM dấu hai chấm (：fullwidth → : thường)', () => {
    const map = buildLabelMap(pristine, translated);
    expect(map).toEqual({
      '选项一：': 'Lựa chọn 1:',
      '选项二：': 'Lựa chọn 2:',
      '选项三：': 'Lựa chọn 3:',
      '选项四：': 'Lựa chọn 4:',
    });
  });

  it('lệch số nhãn hai bên → KHÔNG ghép bừa', () => {
    const map = buildLabelMap(pristine, [{ identifier: 'options_fmt', content: '>Lựa chọn 1: {x}' }]);
    expect(Object.keys(map)).toHaveLength(0);
  });

  it('bản dịch còn chữ Hán (chưa dịch xong) → không học', () => {
    const map = buildLabelMap(pristine, [{ identifier: 'options_fmt', content: ZH_PROMPT }]);
    expect(Object.keys(map)).toHaveLength(0);
  });

  it('prompt không ghép được identifier → bỏ qua, không nổ', () => {
    expect(buildLabelMap(pristine, [{ identifier: 'khac', content: VI_PROMPT }])).toEqual({});
    expect(buildLabelMap(undefined, undefined)).toEqual({});
  });
});

describe('applyLabelMapToRegex — đồng bộ findRegex với prompt đã dịch', () => {
  const map = buildLabelMap(
    [{ identifier: 'options_fmt', content: ZH_PROMPT }],
    [{ identifier: 'options_fmt', content: VI_PROMPT }],
  );

  it('CHÍNH CA BUG: findRegex thật của preset được dịch và VẪN COMPILE được', () => {
    const r = applyLabelMapToRegex(REAL_FIND_REGEX, map);
    expect(r.changed).toBe(true);
    expect(r.reverted).toBe(false);
    expect(r.text).toContain('Lựa chọn 1');
    expect(r.text).not.toMatch(/[一-鿿]/);
    expect(() => new RegExp(r.text)).not.toThrow();
  });

  it('regex đã dịch KHỚP THẬT đầu ra mà AI sinh theo prompt mới', () => {
    const r = applyLabelMapToRegex(REAL_FIND_REGEX, map);
    const aiOutput = `<options>
>Lựa chọn 1: Tiến vào hang động ngay lập tức
>Lựa chọn 2: Quan sát từ xa trước
>Lựa chọn 3: Hỏi ý kiến đồng hành
>Lựa chọn 4: Kéo nàng lại gần
</options>`;
    expect(new RegExp(r.text).test(aiOutput)).toBe(true);
    // Còn regex CŨ (chưa đồng bộ) thì trượt — đúng hiện tượng user báo.
    expect(new RegExp(REAL_FIND_REGEX).test(aiOutput)).toBe(false);
  });

  it('nhãn dịch chứa ký tự đặc biệt của regex → được escape, không phá regex', () => {
    const r = applyLabelMapToRegex('>标签：(.+)', { '标签': 'Mục (1.a)' });
    expect(r.changed).toBe(true);
    expect(() => new RegExp(r.text)).not.toThrow();
    expect(new RegExp(r.text).test('>Mục (1.a)：nội dung')).toBe(true);
  });

  it('không nhãn nào xuất hiện → giữ nguyên', () => {
    const r = applyLabelMapToRegex('<div>[^<]+</div>', map);
    expect(r.changed).toBe(false);
  });

  it('vỏ /.../flags của ST được tôn trọng khi compile check', () => {
    const r = applyLabelMapToRegex('/选项一：(.+)/gi', { '选项一': 'Lựa chọn 1' });
    expect(r.changed).toBe(true);
    expect(r.text).toBe('/Lựa chọn 1：(.+)/gi');
  });
});

describe('applyLabelMapToText — đồng bộ replaceString/HTML', () => {
  it('thay nhãn trong HTML, nhãn dài thay trước', () => {
    const r = applyLabelMapToText('<b>选项一</b> và 选项一十', { '选项一': 'Lựa chọn 1', '选项一十': 'Lựa chọn 11' });
    expect(r.text).toBe('<b>Lựa chọn 1</b> và Lựa chọn 11');
    expect(r.changed).toBe(true);
  });

  it('không có gì để thay → changed=false', () => {
    expect(applyLabelMapToText('sạch rồi', { '选项一': 'x' }).changed).toBe(false);
  });
});
