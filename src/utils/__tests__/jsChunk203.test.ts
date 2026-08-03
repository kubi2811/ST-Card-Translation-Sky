/**
 * (bug 203) CẮT FIELD JAVASCRIPT — bất biến: KHÔNG BAO GIỜ cắt vào giữa một nút cú pháp.
 * ─────────────────────────────────────────────────────────────────────────────
 * Bệnh gốc đo được trên chính schema user gửi (bug/203/message.txt, 29.700 ký tự): đường cắt
 * cũ dừng ngay sau `const escapeRegExp = text =>` và giữa một object literal ⇒ mảnh nào gửi
 * cho AI cũng là JS cụt ⇒ ghép lại vỡ cú pháp ⇒ tool tự dịch lại ⇒ cắt y chỗ cũ ⇒ vỡ y hệt.
 * Vòng lặp đó là thứ user thấy: 10 phút, hơn 600 nghìn token, ước tính còn 713 phút.
 *
 * Test dưới đây khoá đúng bất biến ĐÃ THIẾU: mọi mốc cắt phải nằm ở ranh giới giữa hai nút
 * anh em, không ở giữa một chuỗi/định danh/mẫu. Kiểm bằng acorn chứ không nhìn mắt thường.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parse as acornParse } from 'acorn';
import { planJsChunkCuts, sliceAtCuts } from '../jsChunkBoundaries';
import { chunkText } from '../chunking';

const FIXTURE = path.resolve(__dirname, '../../..', 'bug', '203', 'message.txt');

/** Mọi nút trong cây, phẳng ra. */
function allNodes(code: string): Array<{ type: string; start: number; end: number }> {
  const out: Array<{ type: string; start: number; end: number }> = [];
  const seen = new Set<unknown>();
  const walk = (n: unknown): void => {
    if (!n || typeof n !== 'object' || seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) { n.forEach(walk); return; }
    const node = n as { type?: string; start?: number; end?: number };
    if (typeof node.type === 'string' && typeof node.start === 'number' && typeof node.end === 'number') {
      out.push({ type: node.type, start: node.start, end: node.end });
    }
    Object.values(n as Record<string, unknown>).forEach(walk);
  };
  walk(acornParse(code, { ecmaVersion: 'latest', sourceType: 'module' }));
  return out;
}

/** Không mốc cắt nào được rơi vào GIỮA một lá cú pháp (chuỗi, mẫu, định danh, regex, số). */
function cutsInsideLeaves(code: string, cuts: number[]): string[] {
  const LEAF = new Set(['Literal', 'TemplateLiteral', 'TemplateElement', 'Identifier', 'PrivateIdentifier']);
  const bad: string[] = [];
  for (const n of allNodes(code)) {
    if (!LEAF.has(n.type)) continue;
    for (const c of cuts) {
      if (c > n.start && c < n.end) bad.push(`${n.type}[${n.start},${n.end}] bị cắt ở ${c}`);
    }
  }
  return bad;
}

describe('(bug 203) mốc cắt phải ở ranh giới cú pháp', () => {
  const THREE_CONSTS = [
    `const a = {\n${'  x: 1,\n'.repeat(400)}};`,
    `const b = {\n${'  y: 2,\n'.repeat(400)}};`,
    `const c = {\n${'  z: 3,\n'.repeat(400)}};`,
  ].join('\n\n');

  it('cắt GIỮA hai câu lệnh cấp cao nhất, không cắt vào trong', () => {
    const plan = planJsChunkCuts(THREE_CONSTS, 4000)!;
    expect(plan).not.toBeNull();
    expect(cutsInsideLeaves(THREE_CONSTS, plan.cuts)).toEqual([]);
    for (const c of plan.cuts) expect(THREE_CONSTS.slice(c, c + 6)).toMatch(/^const /);
  });

  it('ghép lại phải ra ĐÚNG chuỗi gốc, không thêm bớt một ký tự', () => {
    const plan = planJsChunkCuts(THREE_CONSTS, 4000)!;
    const pieces = sliceAtCuts(THREE_CONSTS, plan.cuts);
    expect(pieces.join('')).toBe(THREE_CONSTS);
    expect(pieces.every((p) => p.length > 0)).toBe(true);
  });

  it('một câu lệnh ĐƠN LẺ quá dài → xuống cắt giữa hai thuộc tính, vẫn không vỡ nút nào', () => {
    const huge = `const only = {\n${Array.from({ length: 500 }, (_, i) => `  khoa${i}: 'giá trị số ${i}',`).join('\n')}\n};`;
    const plan = planJsChunkCuts(huge, 4000)!;
    expect(plan.cuts.length).toBeGreaterThan(0);
    expect(cutsInsideLeaves(huge, plan.cuts)).toEqual([]);
    expect(sliceAtCuts(huge, plan.cuts).join('')).toBe(huge);
  });

  it('KHÔNG BAO GIỜ cắt vào giữa một template literal khổng lồ — thà để mảnh quá khổ', () => {
    const tpl = 'const t = `' + 'a'.repeat(20000) + '`;\nconst sau = 1;';
    const plan = planJsChunkCuts(tpl, 5000);
    if (plan) expect(cutsInsideLeaves(tpl, plan.cuts)).toEqual([]);
  });

  it('chuỗi chứa dấu ngoặc lệch (regex escape) không đánh lừa được nữa', () => {
    // Đúng dòng làm bộ đếm ngoặc cũ loạn: `[.*+?^${}()|[\]\\]` có ngoặc lệch NẰM TRONG regex.
    const code = [
      "const escapeRegExp = text =>\n  text.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&');",
      `const b = {\n${'  y: 2,\n'.repeat(400)}};`,
      `const c = {\n${'  z: 3,\n'.repeat(400)}};`,
    ].join('\n\n');
    const plan = planJsChunkCuts(code, 3000)!;
    expect(cutsInsideLeaves(code, plan.cuts)).toEqual([]);
    // Và tuyệt đối không được dừng ngay sau dấu mũi tên như bản cũ.
    for (const c of plan.cuts) expect(code.slice(0, c).trimEnd().endsWith('=>')).toBe(false);
  });

  it('văn xuôi và nội dung không phải JS thì KHÔNG đi đường này (giữ nguyên hành vi cũ)', () => {
    const prose = ('Đây là một đoạn văn xuôi rất dài kể chuyện. '.repeat(500));
    expect(planJsChunkCuts(prose, 4000)).toBeNull();
    const html = '<div class="x">' + 'nội dung '.repeat(2000) + '</div>';
    expect(planJsChunkCuts(html, 4000)).toBeNull();
  });

  it('JS hỏng cú pháp → trả null để rơi về thuật toán cũ, không ném', () => {
    const broken = 'const a = {\n' + '  x: 1,\n'.repeat(2000);
    expect(() => planJsChunkCuts(broken, 4000)).not.toThrow();
    expect(planJsChunkCuts(broken, 4000)).toBeNull();
  });

  it('ngắn hơn hạn mức thì không cắt', () => {
    expect(planJsChunkCuts('const a = 1;', 4000)).toBeNull();
  });

  it('chunkText dùng bộ cắt mới cho JS và vẫn ghép lại khớp', () => {
    const pieces = chunkText(THREE_CONSTS, 4000);
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.join('')).toBe(THREE_CONSTS);
    for (const p of pieces.slice(1)) expect(p.startsWith('const ')).toBe(true);
  });
});

describe.skipIf(!fs.existsSync(FIXTURE))('(bug 203) chính schema user gửi', () => {
  const code = fs.readFileSync(FIXTURE, 'utf8');

  it('bản gốc parse sạch — nếu không thì phép thử vô nghĩa', () => {
    expect(() => acornParse(code, { ecmaVersion: 'latest', sourceType: 'module' })).not.toThrow();
  });

  for (const size of [9000, 12000, 15000]) {
    it(`maxChars=${size}: không mốc nào cắt vào giữa nút, ghép lại khớp`, () => {
      const pieces = chunkText(code, size);
      expect(pieces.join('')).toBe(code);
      const cuts: number[] = [];
      let acc = 0;
      for (const p of pieces.slice(0, -1)) { acc += p.length; cuts.push(acc); }
      expect(cutsInsideLeaves(code, cuts)).toEqual([]);
      // Bệnh cũ: mảnh dừng ngay sau `=>`. Không bao giờ được lặp lại.
      for (const c of cuts) expect(code.slice(0, c).trimEnd().endsWith('=>')).toBe(false);
    });
  }

  it('mọi mốc cắt đều đứng ở đầu một dòng mới (đọc log là thấy ngay chỗ nối)', () => {
    const pieces = chunkText(code, 9000);
    let acc = 0;
    for (const p of pieces.slice(0, -1)) {
      acc += p.length;
      expect(/\s/.test(code[acc - 1]), `ký tự trước mốc ${acc}: ${JSON.stringify(code[acc - 1])}`).toBe(true);
    }
  });
});
