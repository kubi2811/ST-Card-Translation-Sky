/**
 * (bug 124) User báo lại việc 118: "Chỗ dịch preset bị lỗi phần dịch regex, phần đó nó không
 * dịch và chưa đồng bộ được với prompt của preset, VẪN CÒN LỖI."
 *
 * Đo trên preset thật có sẵn trong repo (三人逆行 v11 ↔ bản dịch chính thức, 253 prompt /
 * 36 regex script) ra đúng hai lỗ, và test này khoá cả hai lại:
 *
 *   A. Bản 118 đòi số nhãn hai bên BẰNG NHAU mới ghép — lệch một cái là bỏ nguyên prompt.
 *      Đo thật: 89/213 cặp prompt bị vứt vì lý do này.
 *   B. Bản 118 chỉ học nhãn dạng "NHÃN:" nên mù hoàn toàn với TÊN THẺ GIẢ (<状态面板>) và
 *      nhãn trong <summary> — mà 4/36 regex của preset thật lại bám đúng vào chúng.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import {
  buildLabelMap,
  alignTokens,
  extractTagNames,
  extractInlineLabels,
  applyLabelMapToRegex,
} from '../presetLabelSync';

// ── A. Neo LCS: lệch một nhãn không được làm mất phần còn lại ────────────────
describe('alignTokens — neo bằng nhãn giống nhau thay vì đòi bằng số lượng', () => {
  const T = (label: string) => ({ label });

  it('CHÍNH CA LÀM MẤT 89/213 PROMPT: bản dịch thêm một nhãn thừa ở đoạn cuối', () => {
    // "OOC" giữ nguyên hai bên nên làm NEO. Đoạn trước neo cân (1↔1) → ghép được.
    // Đoạn sau neo lệch (1↔2) → chỉ bỏ đoạn đó. Bản cũ đòi tổng số bằng nhau nên
    // mất SẠCH cả prompt, kể cả cặp 选项一 hoàn toàn chắc chắn ở đoạn trước.
    const z = [T('选项一'), T('OOC'), T('选项二')];
    const v = [T('Lựa chọn 1'), T('OOC'), T('Lựa chọn 2'), T('Ghi chú')];
    const pairs = alignTokens(z, v);
    expect(pairs.map(([a, b]) => [a.label, b.label])).toEqual([['选项一', 'Lựa chọn 1']]);
  });

  it('nhãn thừa nằm GIỮA hai neo → hai đoạn cân hai bên vẫn ghép đủ', () => {
    const z = [T('选项一'), T('OOC'), T('选项二'), T('END')];
    const v = [T('Lựa chọn 1'), T('OOC'), T('Lựa chọn 2'), T('END')];
    const pairs = alignTokens(z, v);
    expect(pairs.map(([a, b]) => [a.label, b.label])).toEqual([
      ['选项一', 'Lựa chọn 1'],
      ['选项二', 'Lựa chọn 2'],
    ]);
  });

  it('đoạn giữa hai neo lệch số lượng → chỉ bỏ ĐOẠN ĐÓ, không bỏ cả prompt', () => {
    const z = [T('甲'), T('乙'), T('NEO'), T('丙')];
    const v = [T('A'), T('NEO'), T('C')];             // đoạn đầu 2↔1 lệch, đoạn sau 1↔1 cân
    const pairs = alignTokens(z, v);
    expect(pairs.map(([a, b]) => [a.label, b.label])).toEqual([['丙', 'C']]);
  });

  it('không có neo nào và số lượng lệch → không ghép bừa (giữ nguyên tính thận trọng của 118)', () => {
    expect(alignTokens([T('甲'), T('乙')], [T('A')])).toEqual([]);
  });
});

// ── B. Bóc tên thẻ giả + nhãn trong <summary> ────────────────────────────────
describe('extractTagNames — tên thẻ do preset tự chế', () => {
  it('bắt thẻ tự chế, bỏ thẻ HTML thật và comment', () => {
    const t = '<状态面板>\n<div class="x">a</div>\n<!-- ghi chú -->\n<诗词意境>b</诗词意境>\n</状态面板>';
    expect(extractTagNames(t)).toEqual(['状态面板', '诗词意境']);
  });

  it('thẻ có thuộc tính là HTML thật → không nhận làm nhãn', () => {
    expect(extractTagNames('<span style="color:red">x</span>')).toEqual([]);
  });
});

describe('extractInlineLabels — nhãn hiển thị trong thẻ inline (ca ảnh bug 124)', () => {
  it('bóc chữ trong <summary> của khối <details>', () => {
    const t = '<details>\n<summary>🌙 Lời thì thầm của Erii</summary>\n<p>nội dung</p>\n</details>';
    expect(extractInlineLabels(t)).toEqual(['🌙 Lời thì thầm của Erii']);
  });

  it('đoạn văn dài trong <b> không phải nhãn → bỏ qua', () => {
    expect(extractInlineLabels(`<b>${'x'.repeat(60)}</b>`)).toEqual([]);
  });
});

describe('buildLabelMap — học được cả tên thẻ giả, không chỉ nhãn có dấu hai chấm', () => {
  it('CHÍNH CA BUG 124: <状态面板> → <Bảng trạng thái> được học và áp vào regex', () => {
    const map = buildLabelMap(
      [{ identifier: 'panel', content: '<状态面板>\n>标题：{x}\n</状态面板>' }],
      [{ identifier: 'panel', content: '<Bảng trạng thái>\n>Tiêu đề: {x}\n</Bảng trạng thái>' }],
    );
    expect(map['状态面板']).toBe('Bảng trạng thái');
    expect(map['标题：']).toBe('Tiêu đề:');

    // Regex bám thẻ mở VÀ thẻ đóng — cả hai phải đổi theo.
    const r = applyLabelMapToRegex('<状态面板>([\\s\\S]*?)<\\/状态面板>', map);
    expect(r.changed).toBe(true);
    expect(r.reverted).toBe(false);
    expect(r.text).toBe('<Bảng trạng thái>([\\s\\S]*?)<\\/Bảng trạng thái>');
    expect(new RegExp(r.text).test('<Bảng trạng thái>abc</Bảng trạng thái>')).toBe(true);
  });

  it('nhãn <summary> được học (đúng hình dạng ảnh user gửi)', () => {
    const map = buildLabelMap(
      [{ identifier: 'w', content: '<details><summary>艾莉的低语</summary></details>' }],
      [{ identifier: 'w', content: '<details><summary>Lời thì thầm của Erii</summary></details>' }],
    );
    expect(map['艾莉的低语']).toBe('Lời thì thầm của Erii');
  });
});

// ── Hồi quy trên preset THẬT trong repo ─────────────────────────────────────
const DIR = 'bugNeedFix/NewFeature_Script_and_Preset/Preset/';
const ZH = DIR + '三人逆行v11.0—PrismFox 正式版.json';
const VI = DIR + 'It Takes Two v11.0-PrismFox Phiên bản chính thức.json';
const hasReal = fs.existsSync(ZH) && fs.existsSync(VI);

describe.skipIf(!hasReal)('preset THẬT — 4 regex bám thẻ giả nay được đồng bộ', () => {
  const load = () => ({
    zh: JSON.parse(fs.readFileSync(ZH, 'utf8')),
    vi: JSON.parse(fs.readFileSync(VI, 'utf8')),
  });

  it('học đúng tên thẻ mà bản dịch chính thức dùng', () => {
    const { zh, vi } = load();
    const map = buildLabelMap(zh.prompts, vi.prompts);
    // Ba tên này là thứ 3 script "播放器" bám vào; bản dịch chính thức dịch y hệt.
    expect(map['状态面板']).toBe('Bảng trạng thái');
    expect(map['诗词意境']).toBe('Ý cảnh thi từ');
    expect(map['当前播放']).toBe('Đang phát hiện tại');
  });

  it('số regex được đồng bộ > 0 và không script nào bị phá (compile fail)', () => {
    const { zh, vi } = load();
    const map = buildLabelMap(zh.prompts, vi.prompts);
    let changed = 0, reverted = 0;
    for (const s of zh.extensions.regex_scripts) {
      const r = applyLabelMapToRegex(s.findRegex || '', map);
      if (r.changed) changed++;
      if (r.reverted) reverted++;
    }
    expect(changed).toBeGreaterThanOrEqual(4);
    expect(reverted).toBe(0);
  });

  it('bảng nhãn phủ rộng hơn hẳn cơ chế cũ (chỉ nhãn "NHÃN:")', () => {
    const { zh, vi } = load();
    const map = buildLabelMap(zh.prompts, vi.prompts);
    const keys = Object.keys(map);
    const notColon = keys.filter(k => !/[：:]$/.test(k));
    expect(keys.length).toBeGreaterThan(173);   // cơ chế cũ đo được 173 khoá
    expect(notColon.length).toBeGreaterThanOrEqual(10);
  });
});
