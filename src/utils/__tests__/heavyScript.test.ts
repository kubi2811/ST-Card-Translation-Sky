// Script Nặng (Chia Phần) — bất biến sống còn: ghép các phần == file gốc 100%, không cắt giữa cấu trúc.
import { describe, it, expect } from 'vitest';
import { splitHeavyScript, mergeHeavyParts, heavyStats, HEAVY_PART_TARGET } from '../heavyScript';

/** Kiểm: điểm nối giữa 2 phần không nằm giữa chuỗi — đếm quote chưa đóng trong từng phần đơn giản
 *  bằng cách ghép và so sánh (bất biến chính), + kiểm depth từng phần cân bằng với phần kế. */
function joinAll(parts: { text: string }[]) { return parts.map(p => p.text).join(''); }

describe('splitHeavyScript — chia phần an toàn cho bundle khổng lồ', () => {
  it('BẤT BIẾN: ghép lại == gốc 100% (bundle Vue giả lập ~500k ký tự)', () => {
    // giả lập bundle: nhiều component + chuỗi sourcesContent dài + template literal
    const chunks: string[] = [];
    for (let i = 0; i < 300; i++) {
      chunks.push(`function comp${i}(){\n  const label = "Nhãn hiển thị ${i} 显示文本";\n  return { render(){ return \`<div class="c${i}" data-v-abc${i}>\${label}</div>\`; } };\n}\n`);
    }
    // 1 chuỗi sourcesContent khổng lồ 120k ký tự (KHÔNG được cắt bên trong)
    const giant = `var sourcesContent = ${JSON.stringify('x'.repeat(120_000) + '\\n giữa chuỗi có \\" quote giả')};\n`;
    chunks.splice(150, 0, giant);
    const code = chunks.join('');
    expect(code.length).toBeGreaterThan(150_000); // đủ lớn để ra nhiều phần + chuỗi 120k thử thách scanner

    const parts = splitHeavyScript(code);
    expect(parts.length).toBeGreaterThanOrEqual(3);
    expect(joinAll(parts)).toBe(code); // KHÔNG mất/đổi 1 ký tự nào

    // Chuỗi khổng lồ phải nằm TRỌN trong 1 phần (không phần nào kết thúc giữa nó)
    const giantPart = parts.find(p => p.text.includes('var sourcesContent'));
    expect(giantPart).toBeTruthy();
    expect(giantPart!.text).toContain('quote giả');
    // Phần chứa chuỗi khổng lồ được phép vượt target — đúng thiết kế
    expect(giantPart!.chars).toBeGreaterThan(HEAVY_PART_TARGET);
  });

  it('bundle MINIFY (không có xuống dòng) → vẫn chia được nhờ fallback cắt sau ; } độ sâu 0', () => {
    const stmt = 'var a1={x:1,y:"chuỗi 文本"};function f1(){return a1.x+1};';
    const code = stmt.repeat(3000); // ~170k ký tự, 0 newline
    expect(code.includes('\n')).toBe(false);
    const parts = splitHeavyScript(code, 50_000);
    expect(parts.length).toBeGreaterThan(2);
    expect(joinAll(parts)).toBe(code);
    // mỗi điểm cắt phải rơi đúng ranh giới statement (kết thúc bằng ; hoặc })
    for (let i = 0; i < parts.length - 1; i++) {
      expect(/[;}]$/.test(parts[i].text)).toBe(true);
    }
  });

  it('template literal lồng ${} + regex literal chứa dấu ngoặc → không làm scanner lạc trạng thái', () => {
    const block = 'const t = `giá trị ${obj.map(x => `${x}}` )} còn } trong chuỗi`;\nconst re = /[}{;]+/g;\nfunction ok(){ return 1; }\n';
    const code = block.repeat(2000);
    const parts = splitHeavyScript(code, 40_000);
    expect(joinAll(parts)).toBe(code);
    // không phần nào (trừ cuối) kết thúc lơ lửng giữa template (đếm backtick lẻ)
    for (let i = 0; i < parts.length - 1; i++) {
      expect((parts[i].text.match(/`/g) || []).length % 2).toBe(0);
    }
  });

  it('file nhỏ hơn target → 1 phần duy nhất; rỗng → 0 phần', () => {
    expect(splitHeavyScript('const a = 1;', 100).length).toBe(1);
    expect(splitHeavyScript('')).toEqual([]);
  });

  it('mergeHeavyParts: phần chưa dịch dùng bản gốc (resume giữa chừng vẫn ghép được)', () => {
    const parts = splitHeavyScript('aaa;\n'.repeat(30_000), 50_000); // ≥3 phần
    const translated = parts.map((_, i) => (i === 0 ? 'ĐÃ DỊCH;\n' : null));
    const merged = mergeHeavyParts(parts, translated);
    expect(merged.startsWith('ĐÃ DỊCH;\n')).toBe(true);
    expect(merged).toContain('aaa;\n');
  });

  it('heavyStats đếm dòng cho kiểm 1:1', () => {
    expect(heavyStats('a\nb\nc')).toEqual({ lines: 3, chars: 5 });
  });
});
