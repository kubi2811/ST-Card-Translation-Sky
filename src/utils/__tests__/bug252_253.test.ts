/**
 * (bug 252) Dịch regex phải dùng font hiển thị được tiếng Việt (hết chữ lồi lõm, đậm nhạt, to nhỏ).
 * (bug 253) PhatSiz gửi "raw + sai + đúng" của entry [mvu_update] loại controller (fixtures/bug253-*):
 *   - văn xuôi bị dịch vụn từng cụm (đường surgical) ⇒ "`<UpdateVariable>` Bắt đầu、", "2026Năm3Tháng15Ngày";
 *   - từ điển MVU nhặt "key" rác từ dòng markdown ⇒ mất dấu `/`, backtick 264 → 250;
 *   - Kiểm Tra Field báo HTML hỏng oan (11 → 22 thẻ mở) vì đếm `<Tên Khu Tị Nạn>` là thẻ;
 *   - Xuất file ghi "còn 0 trường có chữ Hán … và 8 trường bị tự động bỏ qua" và chặn xuất oan.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { applyVietnameseFonts, classifyCjkFont, fixFontList } from '../vnFonts';
import { postProcessRegexHtml, extractPotentialMvuKeys, isPlausibleMvuKey } from '../mvuSync';
import { isProseDominantDoc, measureDocShape } from '../docShape';
import { verifyFields } from '../aiVerify';
import { scanFieldsHealth } from '../cardHealth';
import type { CharacterCard, TranslationField } from '../../types/card';

const fx = (n: string) => readFileSync(fileURLToPath(new URL(`./fixtures/${n}`, import.meta.url)), 'utf8');
const RAW = fx('bug253-controller.raw.txt');
const GOOD = fx('bug253-controller.good.txt');

describe('(bug 252) font tiếng Việt', () => {
  it.each([
    ['"Noto Serif SC", serif', 'serif'], ['微软雅黑', 'sans'], ['"LXGW WenKai", cursive', 'hand'],
    ["'Ma Shan Zheng'", 'hand'], ['宋体', 'serif'], ['PingFang SC', 'sans'], ['霞鹜文楷', 'hand'],
  ])('%s ⇒ %s', (f, cls) => {
    expect(classifyCjkFont(f.split(',')[0])).toBe(cls);
  });

  it('không đụng font Latin', () => {
    expect(classifyCjkFont('Georgia')).toBeNull();
    expect(fixFontList("'Roboto', sans-serif")).toBeNull();
  });

  it('chèn font Việt LÊN TRƯỚC font CJK, giữ font CJK làm dự phòng, không nháy', () => {
    expect(fixFontList('"Noto Serif SC", serif')!.list).toBe('Noto Serif, "Noto Serif SC", serif');
    expect(fixFontList("Arial, '微软雅黑', sans-serif")!.list).toBe("Arial, Be Vietnam Pro, '微软雅黑', sans-serif");
  });

  it('CSS + style="" + chuỗi JS nháy đơn đều sửa được mà KHÔNG vỡ dấu nháy', () => {
    const src = [
      '<style>.t{font-family:"Ma Shan Zheng",cursive;color:red}</style>',
      '<div style="font-family: \'Noto Sans SC\', sans-serif">x</div>',
      "<script>el.innerHTML = '<span style=\"font-family:微软雅黑\">a</span>'; el.style.fontFamily = '\"宋体\", serif';</script>",
    ].join('\n');
    const r = applyVietnameseFonts(src);
    expect(r.fixes).toBe(4);
    expect(r.text).toContain('font-family:Lora, "Ma Shan Zheng",cursive;color:red');
    expect(r.text).toContain("font-family: Be Vietnam Pro, 'Noto Sans SC', sans-serif\"");
    expect(r.text).toContain('<span style="font-family:Be Vietnam Pro, 微软雅黑">a</span>\';');
    expect(r.text).toContain("el.style.fontFamily = 'Noto Serif, \"宋体\", serif'");
    // Nạp font: @import ở ĐẦU <style> có sẵn, url() không nháy.
    expect(r.text).toMatch(/<style>@import url\(https:\/\/fonts\.googleapis\.com\/css2\?family=/);
    expect(r.text).not.toMatch(/@import url\(['"]/);
    // Nạp ĐỦ mọi font đã chèn (bản đầu bỏ sót Lora vì thấy chữ 'Lora' trong chính font-family vừa chèn).
    for (const fam of ['Lora', 'Be+Vietnam+Pro', 'Noto+Serif']) expect(r.text).toContain(`family=${fam}`);
  });

  it('chạy lại lần hai không chèn thêm (idempotent)', () => {
    const once = applyVietnameseFonts('<p style="font-family:SimSun">a</p>').text;
    expect(applyVietnameseFonts(once).text).toBe(once);
  });

  it('postProcessRegexHtml (đường dịch regex) áp bộ font mới', () => {
    expect(postProcessRegexHtml('<b style="font-family:\'Noto Serif SC\'">Chào</b>')).toContain('font-family:Noto Serif, \'Noto Serif SC\'');
  });
});

describe('(bug 253) entry hướng dẫn markdown không đi đường dịch vụn từng cụm', () => {
  it('file thật của PhatSiz là tài liệu văn xuôi', () => {
    const s = measureDocShape(RAW);
    expect(s.hasExecutableCode).toBe(false);
    expect(isProseDominantDoc(RAW)).toBe(true);
  });
  it('code thật / [initvar] / EJS vẫn là code', () => {
    expect(isProseDominantDoc('<% if (getvar("好感度") > 50) { %>你好<% } %>'.repeat(30))).toBe(false);
    expect(isProseDominantDoc('stat_data:\n  好感度: [50, "好感度说明"]\n  体力: [100, "体力"]\n'.repeat(20))).toBe(false);
    expect(isProseDominantDoc('<script>const a = "你好世界"; function f(){ return "测试文本" }</script>'.repeat(20))).toBe(false);
  });
});

describe('(bug 253) từ điển MVU không nhặt "key" rác từ markdown', () => {
  it('dòng liệt kê ký tự cấm không thành tên biến', () => {
    expect(isPlausibleMvuKey('`.`　`/`　空格　`')).toBe(false);
    expect(isPlausibleMvuKey('| op 拼写 | 用途 | value 类型 |')).toBe(false);
    expect(isPlausibleMvuKey('灾难/暴雪场景')).toBe(true);   // key thật có "/" vẫn hợp lệ
    expect(isPlausibleMvuKey('好感度')).toBe(true);
  });
  it('quét entry [mvu_update] thật không ra key chứa backtick', () => {
    const card = { data: { character_book: { entries: [{ comment: 'mvu_update 变量更新规则', content: RAW }] } } } as unknown as CharacterCard;
    const keys = extractPotentialMvuKeys(card).map(k => k.key);
    expect(keys.filter(k => k.includes('`'))).toEqual([]);
  });
});

describe('(bug 253) báo động giả', () => {
  it('Kiểm Tra Field không báo HTML hỏng cho bản dịch ĐÚNG (chỗ giữ chỗ <Tên Khu Tị Nạn> không phải thẻ)', () => {
    const f = { path: 'data.character_book.entries[13].content', label: 'lorebook[13].content [controller]', group: 'lorebook',
      entryType: 'controller', original: RAW, translated: GOOD, status: 'done', retries: 0 } as unknown as TranslationField;
    const html = verifyFields([f], {}, 'Chinese').filter(i => i.category === 'html_broken');
    expect(html).toEqual([]);
  });

  it('Xuất file: trường bị bỏ qua mà KHÔNG còn chữ Hán thì không chặn; còn chữ Hán thì chặn', () => {
    const mk = (path: string, original: string) => ({ path, label: path, group: 'description', original, translated: '', status: 'skipped', retries: 0 }) as unknown as TranslationField;
    const h = scanFieldsHealth([mk('a', 'OK 123'), mk('b', 'Hello world'), mk('c', '还没翻译')], []);
    expect(h.counts.skipped).toBe(3);
    expect(h.counts.skippedWithSource).toBe(1);
  });
});
