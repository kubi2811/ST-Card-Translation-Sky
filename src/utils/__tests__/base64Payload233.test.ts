/**
 * (việc 233) RULE C15 — tài liệu bị nhúng dưới dạng base64 trong script.
 *
 * Test chạy trên ĐÚNG HAI FILE THẬT user gửi (bug/233) khi có, và trên các ca dựng tay cho những
 * nhóm mà hai file đó không có (ảnh nhị phân, data-URI, base64 phi chuẩn). Phần "an toàn" quan
 * trọng ngang phần "chạy được": chỉ dẫn xếp việc đụng nhầm nhóm (a)/(b) vào loại [FATAL].
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  findBase64Payloads, decodeBase64Text, encodeBase64Text,
  maskBase64Payloads, unmaskBase64Payloads, countHiddenCjk, judgeInnerPayload,
  scanCardForPayloads, scanFieldsForPayloads,
} from '../base64Payload';

const DIR = path.resolve(__dirname, '../../../bug/233');
const readReal = (f: string): string | null => {
  try { return fs.readFileSync(path.join(DIR, f), 'utf8'); } catch { return null; }
};
const REAL = {
  script: readReal('Script.txt'),
  greeting: readReal('Lời Chào Gắn Kết.txt'),
};
const han = (s: string) => (s.match(/[一-鿿]/g) || []).length;

describe('(233) nhóm (c) — payload văn bản: hai file thật của user', () => {
  it.skipIf(!REAL.script)('Script.txt: tìm đúng 1 payload, giải ra trang HTML, KHÔNG đụng __WN_PHONE_HTML_B64__', () => {
    const t = REAL.script!;
    const ps = findBase64Payloads(t);
    const texts = ps.filter(p => p.kind === 'text');

    expect(texts).toHaveLength(1);
    expect(texts[0].decoded!.slice(0, 40)).toContain('<!doctype html>');
    expect(texts[0].label, 'phải gọi tên được payload theo biến gán').toBe('b64');
    // Token dựng-sẵn nằm trong chú thích đầu file: bộ dò tuyệt đối không được coi nó là payload.
    expect(t).toContain('__WN_PHONE_HTML_B64__');
    expect(ps.some(p => p.raw.includes('WN_PHONE'))).toBe(false);
  });

  it.skipIf(!REAL.script)('phần chữ Hán ẨN lớn hơn hẳn phần thấy được — đây là lý do tồn tại của tính năng', () => {
    const t = REAL.script!;
    const hidden = countHiddenCjk(t);
    const visible = han(t) - 0;   // chữ Hán ngoài base64 (base64 không chứa chữ Hán)
    expect(hidden).toBeGreaterThan(9000);
    expect(hidden, 'ẩn phải nhiều hơn thấy được').toBeGreaterThan(visible);
  });

  it.skipIf(!REAL.greeting)('Lời Chào Gắn Kết.txt: payload gán cho EMBEDDED_HTML_B64', () => {
    const ps = findBase64Payloads(REAL.greeting!).filter(p => p.kind === 'text');
    expect(ps).toHaveLength(1);
    expect(ps[0].label).toBe('EMBEDDED_HTML_B64');
    expect(ps[0].decoded!.startsWith('<head>')).toBe(true);
    expect(countHiddenCjk(REAL.greeting!)).toBeGreaterThan(3000);
  });

  it.skipIf(!REAL.script)('VÒNG TRÒN KHÉP KÍN: che → gỡ che mà không dịch gì phải ra ĐÚNG từng ký tự', () => {
    const t = REAL.script!;
    const { maskedText, map } = maskBase64Payloads(t);
    expect(maskedText.length, 'che xong phải ngắn hơn hẳn').toBeLessThan(t.length / 3);
    expect(unmaskBase64Payloads(maskedText, map)).toBe(t);
  });

  it.skipIf(!REAL.script)('mã hoá lại bản ĐÃ DỊCH: chỉ ruột chuỗi đổi, nháy và tên biến nguyên vẹn', () => {
    const t = REAL.script!;
    const { maskedText, map } = maskBase64Payloads(t);
    const out = unmaskBase64Payloads(maskedText, map, (p) =>
      p.kind === 'text' ? encodeBase64Text(p.decoded!.replace(/手机/g, 'Điện Thoại')) : undefined);

    expect(out).not.toBe(t);
    expect(out).toContain("const b64 = '");          // nháy + tên biến y nguyên
    expect(out).toContain("__WN_PHONE_HTML_B64__");  // token dựng-sẵn y nguyên
    // Base64 mới phải hợp lệ và giải ra đúng bản đã dịch.
    const again = findBase64Payloads(out).filter(p => p.kind === 'text');
    expect(again).toHaveLength(1);
    expect(again[0].decoded).toContain('Điện Thoại');
    expect(again[0].decoded).not.toContain('手机');
    // Không được lẫn xuống dòng/khoảng trắng vào chuỗi base64 (lỗi [FATAL] của chỉ dẫn).
    expect(/[\s]/.test(again[0].raw)).toBe(false);
    expect(again[0].raw.length % 4).toBe(0);
  });
});

describe('(233) nhóm (a) token dựng-sẵn — [FATAL] nếu đụng vào', () => {
  const cases = [
    ['__WN_PHONE_HTML_B64__', 'const html = __WN_PHONE_HTML_B64__;'],
    ['{{ASSET_B64}}', 'const a = "{{ASSET_B64}}";'],
    ['%PAYLOAD_B64%', 'const a = "%PAYLOAD_B64%";'],
    ['${VAR_B64}', 'const a = `${VAR_B64}`;'],
  ] as const;
  for (const [tok, src] of cases) {
    it(`${tok} không bị coi là payload`, () => {
      expect(findBase64Payloads(src).some(p => p.kind === 'text')).toBe(false);
      const { maskedText, map } = maskBase64Payloads(src);
      expect(maskedText).toBe(src);
      expect(unmaskBase64Payloads(maskedText, map)).toBe(src);
    });
  }

  it('token DÀI toàn chữ HOA (đủ ngưỡng 200) vẫn bị xếp vào nhóm dựng-sẵn, không giải', () => {
    const tok = 'A'.repeat(120) + 'B'.repeat(120);
    const ps = findBase64Payloads(`const X = "${tok}";`);
    expect(ps[0]?.kind).toBe('placeholder');
  });
});

describe('(233) nhóm (b) nhị phân — [FATAL] nếu giải', () => {
  it('data:image/png;base64 bị loại theo MIME — không cần giải cũng biết là ảnh', () => {
    // Byte PNG thật (chữ ký \x89PNG…) mã hoá chuẩn, đủ dài để lọt ngưỡng.
    const bytes = new Uint8Array(400);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    for (let i = 8; i < bytes.length; i++) bytes[i] = (i * 53) % 256;
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    const src = `<img src="data:image/png;base64,${btoa(bin).replace(/=+$/, '')}A">`;
    const ps = findBase64Payloads(src);
    expect(ps[0].kind).toBe('binary');
    expect(ps[0].why).toContain('mime');
    // Che rồi gỡ che phải ra đúng chuỗi cũ — ảnh không được suy suyển một ký tự.
    const { maskedText, map } = maskBase64Payloads(src);
    expect(unmaskBase64Payloads(maskedText, map)).toBe(src);
  });

  it('tên biến kiểu tài sản (FONT_B64) giữ nguyên dù giải ra được chữ', () => {
    const b64 = encodeBase64Text('<html>' + 'x'.repeat(400) + '</html>');
    const ps = findBase64Payloads(`const FONT_B64 = '${b64}';`);
    expect(ps[0].kind).toBe('binary');
  });

  it('byte nhị phân thật (không phải UTF-8) → nhóm (b)', () => {
    const bytes = new Uint8Array(400);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 37) % 256;
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    const ps = findBase64Payloads(`const D = '${btoa(bin)}';`);
    expect(ps[0].kind).toBe('binary');
  });

  it('base64 PHI CHUẨN (mã hoá lại không ra đúng chuỗi cũ) → nhóm (b), không đụng', () => {
    // Padding thừa/thiếu, hoặc bảng chữ khác → không tái tạo được y nguyên ⇒ phải bỏ qua.
    const good = encodeBase64Text('<html>' + 'a'.repeat(400) + '</html>');
    const weird = good.replace(/=+$/, '');   // bỏ padding
    expect(decodeBase64Text(weird)).toBeNull();
    const ps = findBase64Payloads(`const D = '${weird}';`);
    expect(ps[0].kind).toBe('binary');
  });

  it('giải ra KHÔNG phải mã/markup (văn xuôi thuần) → lùi về (b) theo điều khoản RECOVERY', () => {
    const b64 = encodeBase64Text('Đây chỉ là một đoạn văn xuôi rất dài. '.repeat(20));
    const ps = findBase64Payloads(`const D = '${b64}';`);
    expect(ps[0].kind).toBe('binary');
    expect(ps[0].why).toContain('để nguyên cho chắc');
  });
});

describe('(233) chặn bản dịch ruột làm HỎNG payload đang chạy tốt', () => {
  const ORIG = '<html>' + 'nội dung '.repeat(200) + '</html>';

  it('bản dịch rỗng → không nhận', () => {
    expect(judgeInnerPayload(ORIG, '').ok).toBe(false);
    expect(judgeInnerPayload(ORIG, '   ').ok).toBe(false);
  });

  it('bản dịch CỤT (dưới 50%) → không nhận, giữ nguyên khối gốc', () => {
    const v = judgeInnerPayload(ORIG, ORIG.slice(0, Math.floor(ORIG.length * 0.4)));
    expect(v.ok).toBe(false);
    expect(v.why).toContain('cụt');
  });

  it('bản dịch còn sót ô giữ chỗ → không nhận', () => {
    expect(judgeInnerPayload(ORIG, ORIG + ' __B64_PAYLOAD_0__').ok).toBe(false);
  });

  it('bản dịch bình thường → nhận', () => {
    expect(judgeInnerPayload(ORIG, ORIG.replace(/nội dung/g, 'nội dung đã dịch')).ok).toBe(true);
  });
});

describe('(233) giải/mã cơ bản', () => {
  it('khép kín với tiếng Việt có dấu và chữ Hán', () => {
    const s = '<html>Điện Thoại · 手机 · ăn cơm chưa</html>';
    expect(decodeBase64Text(encodeBase64Text(s))).toBe(s);
  });

  it('mã hoá không bao giờ chèn xuống dòng dù văn bản rất dài', () => {
    const b = encodeBase64Text('<div>' + 'ă'.repeat(200000) + '</div>');
    expect(b).not.toMatch(/\s/);
    expect(b.length).toBeGreaterThan(200000);
  });

  it('chuỗi ngắn hơn ngưỡng thì kệ nó', () => {
    expect(findBase64Payloads(`const a = '${encodeBase64Text('<html>hi</html>')}';`)).toHaveLength(0);
  });

  it('text rỗng/không phải chuỗi không làm nổ', () => {
    expect(findBase64Payloads('')).toEqual([]);
    expect(findBase64Payloads(null as unknown as string)).toEqual([]);
    expect(decodeBase64Text('!!!')).toBeNull();
  });
});

describe('(233) báo cáo lúc nhập thẻ — trả lời "thẻ có mã hoá không, tool làm được không"', () => {
  const htmlB64 = encodeBase64Text('<!doctype html><html><body><h1>手机应用</h1>' + '<p>内容</p>'.repeat(60) + '</body></html>');
  const CARD = {
    data: {
      name: 'T',
      extensions: {
        TavernHelper_scripts: [
          { name: 'shell', content: `/* 装配：__WN_PHONE_HTML_B64__ */\nfunction phoneHtml(){ const b64 = '${htmlB64}'; return b64; }` },
        ],
        regex_scripts: [
          { scriptName: 'ảnh', replaceString: `<img src="data:image/png;base64,${'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB'.repeat(12)}">` },
        ],
      },
    },
  };

  it('quét THẲNG trên thẻ (không đợi trích field) và gọi tên đúng biến', () => {
    const r = scanCardForPayloads(CARD);
    expect(r.total).toBeGreaterThanOrEqual(1);
    expect(r.translatable).toBe(1);
    expect(r.hiddenCjk).toBeGreaterThan(0);
    const item = r.items.find(i => i.kind === 'text')!;
    expect(item.label).toBe('b64');
    expect(item.fieldLabel).toContain('TavernHelper_scripts');
    // Ảnh phải nằm ở nhóm giữ nguyên, và token dựng-sẵn không được tính là khối nào.
    expect(r.keptVerbatim).toBeGreaterThanOrEqual(1);
    expect(r.items.every(i => !i.label.includes('WN_PHONE'))).toBe(true);
  });

  it('thẻ SẠCH thì báo cáo rỗng — không doạ người dùng vô cớ', () => {
    const r = scanCardForPayloads({ data: { name: 'A', description: 'Xin chào '.repeat(80) } });
    expect(r.total).toBe(0);
    expect(r.translatable).toBe(0);
  });

  it('thẻ tự trỏ vòng / rác không làm nổ bộ quét', () => {
    const loop: Record<string, unknown> = { a: 1 };
    loop.self = loop;
    expect(() => scanCardForPayloads(loop)).not.toThrow();
    expect(scanCardForPayloads(null).total).toBe(0);
    expect(scanFieldsForPayloads([]).total).toBe(0);
  });

  it('maskedChars đếm đúng phần sẽ được che khỏi lượt gọi AI', () => {
    const r = scanCardForPayloads(CARD);
    expect(r.maskedChars).toBeGreaterThan(htmlB64.length);
  });
});

/**
 * Nối vào đường ống: `translateText` phải là VỎ che base64 rồi mới gọi lõi, và ruột payload phải
 * đi qua ĐÚNG đường ống đó một lần nữa. Khoá bằng mã nguồn vì luồng này cần API thật mới chạy.
 */
describe('(233) nối vào đường ống dịch', () => {
  const SRC = fs.readFileSync(path.resolve(__dirname, '../apiClient.ts'), 'utf8');

  it('translateText che base64 TRƯỚC, rồi mới gọi lõi cũ (lõi không bị sửa)', () => {
    expect(SRC).toContain('async function translateTextCore(');
    expect(SRC).toMatch(/const \{ maskedText, map \} = maskBase64Payloads\(text\);/);
    // Không còn payload thì đi thẳng lõi — không thêm chi phí cho thẻ bình thường.
    expect(SRC).toMatch(/if \(entries\.length === 0\) \{\s*\n\s*return translateTextCore\(/);
  });

  it('ruột payload gọi ĐỆ QUY translateText (để base64 lồng nhau cũng được xử lý) và có trần tầng', () => {
    expect(SRC).toMatch(/const innerTranslated = await translateText\(/);
    expect(SRC).toContain('b64Depth + 1');
    expect(SRC).toContain('b64Depth >= MAX_NESTING');
  });

  it('KHÔNG truyền callback/resume của field cha xuống lượt dịch ruột (nhịp cắt khác nhau)', () => {
    const inner = SRC.slice(SRC.indexOf('const innerTranslated = await translateText('));
    const call = inner.slice(0, inner.indexOf(');'));
    expect(call).toContain('undefined, undefined, parallelChunks');
    expect(call).not.toContain('onChunkComplete');
    expect(call).not.toContain('previouslyCompletedChunks');
  });

  it('bản dịch ruột phải qua cửa judgeInnerPayload VÀ kiểm mã hoá khép kín trước khi nhận', () => {
    expect(SRC).toContain('judgeInnerPayload(p.decoded!, innerTranslated)');
    expect(SRC).toContain('decodeBase64Text(reencoded) !== innerTranslated');
  });

  it('hỏng phần ruột thì GIỮ NGUYÊN khối gốc, không làm hỏng thẻ', () => {
    expect(SRC).toContain('giữ nguyên khối gốc');
    // Người dùng bấm Dừng thì vẫn phải dừng thật, không nuốt.
    expect(SRC).toMatch(/if \(signal\?\.aborted\) throw err;/);
  });
});

describe('(233) báo cho người dùng ngay lúc nhập thẻ', () => {
  const STORE = fs.readFileSync(path.resolve(__dirname, '../../store.ts'), 'utf8');
  const APP = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');
  const UPLOAD = fs.readFileSync(path.resolve(__dirname, '../../components/FileUpload.tsx'), 'utf8');

  it('quét ngay trong setCard — phủ mọi đường nhập, không đợi trích field', () => {
    expect(STORE).toContain('scanCardForPayloads(card)');
    expect(STORE).toContain('base64NoticeSeen: false,');
  });

  it('gỡ thẻ thì dọn luôn báo cáo', () => {
    expect(STORE).toMatch(/fields: \[\],\s*\n\s*base64Report: null,/);
  });

  it('popup được gắn vào App, và nhãn thường trực nằm ở ô thẻ', () => {
    expect(APP).toContain('<Base64NoticeModal />');
    expect(UPLOAD).toContain('ui.b64Badge');
    expect(UPLOAD).toContain('setBase64NoticeSeen(false)');
  });
});
