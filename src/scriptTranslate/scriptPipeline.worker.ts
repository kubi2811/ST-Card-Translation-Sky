/* ─── Worker cho "Dịch Script" ───
 * MỌI phép quét/biến đổi chuỗi cỡ MB (beautify, parse AST, extract token, reinsert,
 * validate) chạy ở đây — main thread chỉ điều phối lô AI. Bài học xương máu từ các bug
 * treo 36/37/39: một long-task đồng bộ trên chuỗi 1.5MB là "Trang không phản hồi" ngay.
 * Prettier CHỈ được import trong file này → nó nằm trong chunk worker, main bundle không phình.
 */
import * as acorn from 'acorn';
import {
  extractCJKTokens,
  reinsertTranslations,
  verifyCodeStructureParity,
  type CJKToken,
} from '../utils/surgical';
import { jsParseErrorAny } from '../utils/scriptSafety';
import { countCjk } from '../utils/langDetect';

interface Zone { start: number; end: number; reason: string }

interface Req {
  id: number;
  op: 'beautify' | 'protectZones' | 'extract' | 'reinsert' | 'validate' | 'stats';
  code?: string;
  original?: string;
  zones?: Zone[];
  tokens?: CJKToken[];
}

interface Res {
  id: number;
  ok: boolean;
  error?: string;
  result?: unknown;
}

/** Thu thập zone bảo vệ bằng AST acorn: regex literal + sourcemap (sourcesContent) + //# sourceMappingURL. */
function collectProtectZones(code: string): { zones: Zone[]; parseFailed: boolean } {
  const zones: Zone[] = [];
  let parseFailed = false;
  try {
    const comments: Array<{ start: number; end: number; text: string }> = [];
    const ast = acorn.parse(code, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      onComment: (_block, text, start, end) => comments.push({ start, end, text }),
    }) as unknown as Record<string, unknown>;

    for (const c of comments) {
      if (c.text.includes('sourceMappingURL=')) zones.push({ start: c.start, end: c.end, reason: 'sourceMappingURL' });
    }

    // Walker tay (không thêm dep acorn-walk): duyệt mọi node object có .type.
    const stack: unknown[] = [ast];
    while (stack.length) {
      const node = stack.pop();
      if (!node || typeof node !== 'object') continue;
      if (Array.isArray(node)) { for (const n of node) stack.push(n); continue; }
      const n = node as Record<string, unknown> & { type?: string; start?: number; end?: number };
      if (typeof n.type === 'string' && typeof n.start === 'number' && typeof n.end === 'number') {
        // Regex literal → CJK bên trong do pass alternation lo, extract KHÔNG đụng.
        if (n.type === 'Literal' && (n as { regex?: unknown }).regex) {
          zones.push({ start: n.start, end: n.end, reason: 'regex-literal' });
        }
        // String/template literal KHỔNG LỒ chứa sourcemap (sourcesContent = source gốc nhúng
        // làm DATA) → mặc định GIỮ NGUYÊN: dịch phần này tốn token mà runtime không dùng.
        if (
          (n.type === 'Literal' || n.type === 'TemplateLiteral') &&
          n.end - n.start > 2000
        ) {
          const raw = code.slice(n.start, Math.min(n.end, n.start + 4000));
          if (raw.includes('sourcesContent') || raw.includes('"version":3') || raw.includes('\\"version\\":3')) {
            zones.push({ start: n.start, end: n.end, reason: 'sourcemap-data' });
          }
        }
      }
      for (const k of Object.keys(n)) {
        if (k === 'type' || k === 'start' || k === 'end') continue;
        const v = n[k];
        if (v && typeof v === 'object') stack.push(v);
      }
    }
  } catch {
    parseFailed = true;
    // Fallback không AST: vẫn bảo vệ dòng //# sourceMappingURL=
    const re = /\/\/[#@]\s*sourceMappingURL=[^\n]*/g;
    for (let m = re.exec(code); m; m = re.exec(code)) {
      zones.push({ start: m.index, end: m.index + m[0].length, reason: 'sourceMappingURL' });
    }
  }
  return { zones, parseFailed };
}

self.onmessage = async (ev: MessageEvent<Req>) => {
  const { id, op } = ev.data;
  const reply = (res: Omit<Res, 'id'>) => (self as unknown as Worker).postMessage({ id, ...res });
  try {
    switch (op) {
      case 'stats': {
        const code = ev.data.code || '';
        const lines = code.split('\n').length;
        reply({ ok: true, result: { chars: code.length, cjkChars: countCjk(code), lines, looksMinified: lines < code.length / 2000 } });
        return;
      }
      case 'beautify': {
        const code = ev.data.code || '';
        try {
          const [prettier, babel, estree] = await Promise.all([
            import('prettier/standalone'),
            import('prettier/plugins/babel'),
            import('prettier/plugins/estree'),
          ]);
          const pretty = await prettier.format(code, {
            parser: 'babel',
            plugins: [babel.default ?? babel, (estree as { default?: unknown }).default ?? estree] as never[],
            printWidth: 120,
          });
          reply({ ok: true, result: pretty });
        } catch (e) {
          // Beautify là TIỆN NGHI, không phải điều kiện đúng đắn — fail thì dịch bản gốc.
          reply({ ok: false, error: (e as Error)?.message || String(e) });
        }
        return;
      }
      case 'protectZones': {
        reply({ ok: true, result: collectProtectZones(ev.data.code || '') });
        return;
      }
      case 'extract': {
        const tokens = extractCJKTokens(ev.data.code || '', (ev.data.zones || []) as never, 'preserve');
        reply({ ok: true, result: tokens });
        return;
      }
      case 'reinsert': {
        reply({ ok: true, result: reinsertTranslations(ev.data.code || '', ev.data.tokens || []) });
        return;
      }
      case 'validate': {
        const code = ev.data.code || '';
        const original = ev.data.original || '';
        const parseError = jsParseErrorAny(code);
        const parity = verifyCodeStructureParity(original, code);
        reply({
          ok: true,
          result: {
            parseOk: !parseError,
            parseError: parseError ? `dòng ${parseError.line}: ${parseError.msg}` : undefined,
            parityOk: parity.ok,
            parityDetail: parity.reason,
            cjkChars: countCjk(code),
          },
        });
        return;
      }
    }
    reply({ ok: false, error: `op lạ: ${op}` });
  } catch (e) {
    reply({ ok: false, error: (e as Error)?.message || String(e) });
  }
};
