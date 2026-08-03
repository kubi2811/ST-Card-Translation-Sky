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
/** Thẻ THẬT trong kho — ca `z.object({…53K…}).prefault({})` làm lộ hồi quy của vòng 1. */
const CARD_EUROPE = path.resolve(__dirname, '../../..', 'samples', 'Europe_1351_Card (1).json');

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

  /*
   * (vòng 2 — do bộ soi phản biện bắt được) Họ thẻ Zod luôn kết thúc bằng một lời gọi ĐUÔI:
   *   export const Schema = z.object({ …53.000 ký tự… }).prefault({});
   * Nút ngoài cùng là `.prefault({})` với đối số là object RỖNG. Bản đầu đi vào "con duy nhất"
   * nên rơi vào cái object rỗng đó rồi bó tay, còn 53K nằm trong CALLEE thì không bao giờ được
   * ngó tới ⇒ trả về nguyên một mảnh 53K, gấp 5,9 lần hạn mức thật ⇒ chạm trần token, AI cắt
   * cụt. Tức là TỆ HƠN đường cắt cũ. Phải luôn đi theo nhánh LỚN NHẤT.
   */
  const zodBody = (n: number) => `z.object({\n${Array.from({ length: n }, (_, i) => `  truong${i}: z.string().prefault('giá trị mặc định số ${i} cho trường này'),`).join('\n')}\n})`;

  for (const tail of ['', '.prefault({})', '.optional()', '.nullable()', '.refine(fn, "thông điệp")']) {
    it(`lời gọi đuôi "${tail || '(không có)'}" không được che khuất khối lớn bên trong`, () => {
      const code = `export const Schema = ${zodBody(300)}${tail};\n`;
      expect(code.length).toBeGreaterThan(15000);
      const plan = planJsChunkCuts(code, 8000);
      expect(plan, 'phải lập được kế hoạch cắt').not.toBeNull();
      const pieces = sliceAtCuts(code, plan!.cuts);
      expect(pieces.join('')).toBe(code);
      expect(cutsInsideLeaves(code, plan!.cuts)).toEqual([]);
      expect(plan!.maxPieceLen, 'không mảnh nào được vượt hạn mức').toBeLessThanOrEqual(8000);
    });
  }

  it('mốc cắt cuối cùng không bị bỏ quên — mảnh ĐUÔI cũng phải trong hạn mức', () => {
    // Thiếu bước "xả mốc còn treo" thì đuôi gộp cả đoạn: đo được 18.071 ký tự với hạn mức 15.000.
    const code = `const x = {\n${Array.from({ length: 900 }, (_, i) => `  k${i}: 'giá trị ${i}',`).join('\n')}\n};\n`;
    const pieces = chunkText(code, 6000);
    expect(pieces.join('')).toBe(code);
    for (const p of pieces) expect(p.length).toBeLessThanOrEqual(6000);
  });

  it('đuôi vụn được nhập lại — mỗi mảnh là một lượt gọi API, không tốn lượt cho vài chục ký tự', () => {
    // Đo ở lần chạy thật: mảnh cuối chỉ 46 ký tự ⇒ thừa nguyên một lượt gọi.
    const code = `const a = {\n${Array.from({ length: 400 }, (_, i) => `  k${i}: 'v${i}',`).join('\n')}\n};\nconst z = 1;\n`;
    for (const size of [3000, 5000]) {
      const pieces = chunkText(code, size);
      expect(pieces.join('')).toBe(code);
      const tail = pieces[pieces.length - 1].length;
      const prev = pieces.length >= 2 ? pieces[pieces.length - 2].length : 0;
      const tiny = Math.max(500, Math.floor(size * 0.05));
      // Hoặc đuôi đủ lớn để đáng một lượt gọi, hoặc nhập vào mảnh trước thì vỡ hạn mức.
      expect(tail >= tiny || tail + prev > size,
        `maxChars=${size}, các mảnh: ${pieces.map((p) => p.length).join(',')}`).toBe(true);
    }
  });

  it('mảnh mà cây cú pháp không chia nhỏ được nữa vẫn phải qua lưới đỡ của thuật toán cũ', () => {
    // Một chuỗi khổng lồ là nút LÁ: không thể cắt trong nó. Nhưng cũng không được phép gửi
    // nguyên khối cho AI — trần 15.000 sinh ra để chống cắt cụt đầu ra.
    const code = `const a = 1;\nconst t = '${'nội dung dài. '.repeat(3000)}';\nconst b = 2;\n`;
    const pieces = chunkText(code, 9000);
    expect(pieces.join('')).toBe(code);
    expect(pieces.every((p) => p.length <= 9000 * 1.5), pieces.map((p) => p.length).join(',')).toBe(true);
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

  it('không mảnh nào vượt hạn mức — trần này sinh ra để chống cắt cụt đầu ra AI', () => {
    for (const size of [9000, 12000, 15000]) {
      for (const p of chunkText(code, size)) {
        expect(p.length, `maxChars=${size}`).toBeLessThanOrEqual(size * 1.5);
      }
    }
  });

  it('mọi mốc cắt đều đứng ở đầu một dòng mới (đọc log là thấy ngay chỗ nối)', () => {
    const pieces = chunkText(code, 9000);
    let acc = 0;
    for (const p of pieces.slice(0, -1)) {
      acc += p.length;
      expect(/\s/.test(code[acc - 1]), `ký tự trước mốc ${acc}: ${JSON.stringify(code[acc - 1])}`).toBe(true);
    }
  });
});

describe.skipIf(!fs.existsSync(CARD_EUROPE))('(bug 203) thẻ THẬT trong kho — ca lời gọi đuôi', () => {
  it('field 53K của Europe_1351 không còn ra mảnh khổng lồ', () => {
    const card = JSON.parse(fs.readFileSync(CARD_EUROPE, 'utf8'));
    const js = card?.data?.extensions?.tavern_helper?.[0]?.[1]?.[1]?.content as string;
    expect(typeof js, 'cấu trúc thẻ mẫu đổi rồi thì test này vô nghĩa').toBe('string');
    expect(js.length).toBeGreaterThan(50000);

    for (const size of [9000, 15000]) {
      const pieces = chunkText(js, size);
      expect(pieces.join(''), `maxChars=${size}`).toBe(js);
      const longest = pieces.reduce((m, p) => Math.max(m, p.length), 0);
      // Vòng 1 trả về đúng một mảnh 53.038 ký tự ở đây — 5,9 lần hạn mức của field code.
      expect(longest, `maxChars=${size}, các mảnh: ${pieces.map((p) => p.length).join(',')}`)
        .toBeLessThanOrEqual(size * 1.5);
    }
  });
});
