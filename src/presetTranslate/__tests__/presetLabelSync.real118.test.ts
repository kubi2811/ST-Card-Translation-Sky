import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildLabelMap, applyLabelMapToRegex, applyLabelMapToText } from '../presetLabelSync';

/**
 * (việc 118) Hồi quy trên DỮ LIỆU THẬT user gửi — preset 绘绘绘绘绘 (bug/118, tự skip nếu máy
 * không có file). Mô phỏng đúng trạng thái pipeline lúc bước regex chạy: prompts ĐÃ dịch
 * (lấy từ bản .vi user gửi), regex CHƯA — rồi kiểm bảng nhãn đồng bộ được cả 2 script options.
 */

const DIR = fileURLToPath(new URL('../../../bug/118/', import.meta.url));
const zhPath = () => DIR + fs.readdirSync(DIR).find(f => f.endsWith('.json') && !f.includes('.vi.'));
const viPath = () => DIR + fs.readdirSync(DIR).find(f => f.endsWith('.vi.json'));
const has = fs.existsSync(DIR) && !!fs.readdirSync(DIR).find(f => f.endsWith('.vi.json'));

interface P { identifier?: string; content?: string }
interface RS { scriptName?: string; findRegex?: string; replaceString?: string }

describe.skipIf(!has)('bug/118 — preset thật: đồng bộ nhãn regex với prompt đã dịch', () => {
  const load = () => {
    const zh = JSON.parse(fs.readFileSync(zhPath(), 'utf8')) as { prompts: P[]; extensions: { regex_scripts: RS[] } };
    const vi = JSON.parse(fs.readFileSync(viPath(), 'utf8')) as { prompts: P[]; extensions: { regex_scripts: RS[] } };
    return { zh, vi };
  };

  it('bảng nhãn dựng từ 2 bản thật chứa đủ 4 nhãn options (kèm chuyển ： → :)', () => {
    const { zh, vi } = load();
    const map = buildLabelMap(zh.prompts, vi.prompts);
    expect(map['选项一：']).toBe('Lựa chọn 1:');
    expect(map['选项四：']).toBe('Lựa chọn 4:');
  });

  it('CẢ 2 findRegex bám 选项一 trong preset thật được đồng bộ, compile sạch, hết chữ Hán', () => {
    const { zh, vi } = load();
    const map = buildLabelMap(zh.prompts, vi.prompts);
    const targets = zh.extensions.regex_scripts.filter(r => /选项一/.test(String(r.findRegex || '')));
    expect(targets.length).toBe(2);   // đúng 2 script "Thanh tùy chọn" trong ảnh user khoanh đỏ
    for (const r of targets) {
      const res = applyLabelMapToRegex(String(r.findRegex), map);
      expect(res.changed).toBe(true);
      expect(res.reverted).toBe(false);
      expect(res.text).not.toMatch(/[一-鿿]/);
      // Regex mới phải khớp đầu ra AI viết theo prompt vi thật
      const sample = '<options>\n>Lựa chọn 1: đi\n>Lựa chọn 2: ở\n>Lựa chọn 3: hỏi\n>Lựa chọn 4: ôm\n</options>';
      const m = res.text.match(/^\/([\s\S]+)\/([a-z]*)$/i);
      const re = m ? new RegExp(m[1], m[2]) : new RegExp(res.text);
      expect(re.test(sample)).toBe(true);
    }
  });

  it('replaceString của 2 script đó cũng được áp nhãn (phần HTML gọi 选项 hết lệch)', () => {
    const { zh, vi } = load();
    const map = buildLabelMap(zh.prompts, vi.prompts);
    const targets = zh.extensions.regex_scripts.filter(r => /选项一/.test(String(r.findRegex || '')));
    for (const r of targets) {
      const res = applyLabelMapToText(String(r.replaceString || ''), map);
      // HTML có nhắc nhãn thì phải đổi; không nhắc thì không bịa thay đổi
      if (/选项一：/.test(String(r.replaceString))) expect(res.changed).toBe(true);
    }
  });
});
