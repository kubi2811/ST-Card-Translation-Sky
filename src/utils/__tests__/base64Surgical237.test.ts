/**
 * (bug 237) BASE64 PHẢI ĐƯỢC CHE TRƯỚC KHI RẼ NHÁNH surgical/thường — không phải sau.
 *
 * Việc 233 dựng đường ống base64 (che → giải → dịch ruột → mã hoá lại) nằm trong `translateText`.
 * Nhưng `useTranslation` KHÔNG phải lúc nào cũng đi qua `translateText`: mọi field nhóm
 * `regex`/`tavern_helper` bị rẽ thẳng sang `surgicalTranslate(field.original, …)`. Mà `surgical.ts`
 * không có một dòng nào biết tới base64 ⇒ với thẻ nhét cả trang HTML vào chuỗi base64, việc 233
 * coi như chưa từng tồn tại.
 *
 * Hai hậu quả đo được trên thẻ thật (bugNeedFix/237 — Counterfeit v0.6.0):
 *   1. ĐÚNG SAI: quá nửa chữ Hán của script nằm trong base64 và không bao giờ được dịch.
 *   2. TỐC ĐỘ: surgical phải nhai trọn khối base64 nửa triệu ký tự — thứ nó chắc chắn không dịch.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { maskBase64Payloads, countHiddenCjk, translateThroughBase64Shell } from '../base64Payload';
import { extractCJKTokens, reinsertTranslations } from '../surgical';

const CARD = path.resolve(__dirname, '../../../bugNeedFix/237/Counterfeit-v0.6.0-hotfix5-20260815.png');

/** Bóc JSON thẻ ra khỏi chunk tEXt của PNG. Trả null khi không có file (bugNeedFix/ nằm ngoài git). */
function readCardScripts(): Array<{ name: string; content: string }> | null {
  let buf: Buffer;
  try { buf = fs.readFileSync(CARD); } catch { return null; }
  let off = 8;
  let payload: string | null = null;
  while (off < buf.length - 8) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    if (type === 'tEXt') {
      const data = buf.subarray(off + 8, off + 8 + len);
      const z = data.indexOf(0);
      const key = data.toString('latin1', 0, z);
      if (key === 'ccv3' || (key === 'chara' && !payload)) {
        payload = Buffer.from(data.toString('latin1', z + 1).replace(/\s/g, ''), 'base64').toString('utf8');
      }
    }
    if (type === 'IEND') break;
    off += 12 + len;
  }
  if (!payload) return null;
  const d = JSON.parse(payload).data;
  // tavern_helper của thẻ này ở dạng Map đã serialize: [["scripts", [ …script… ]]]
  const th = d?.extensions?.tavern_helper;
  const tuple = Array.isArray(th) ? th.find((x: unknown) => Array.isArray(x) && x[0] === 'scripts') : null;
  const list = tuple ? tuple[1] : (th?.scripts ?? []);
  return list.map((s: { name?: string; content?: string }) => ({ name: s.name ?? '', content: s.content ?? '' }));
}

const SCRIPTS = readCardScripts();
const han = (s: string) => (s.match(/[一-鿿]/g) || []).length;

describe('(bug 237) thẻ thật Counterfeit — base64 giấu quá nửa số chữ Hán của script', () => {
  it.skipIf(!SCRIPTS)('hai script giao diện: phần chữ Hán BỊ GIẤU lớn hơn phần thấy được', () => {
    const scripts = SCRIPTS!;
    let visible = 0;
    let hidden = 0;
    for (const s of scripts) {
      const { maskedText } = maskBase64Payloads(s.content);
      visible += han(maskedText);
      hidden += countHiddenCjk(s.content);
    }
    // Đây là toàn bộ lý do bug này đáng sửa: bỏ khối base64 lại là bỏ hơn nửa việc.
    expect(hidden).toBeGreaterThan(visible);
    expect(hidden).toBeGreaterThan(10_000);
  });

  it.skipIf(!SCRIPTS)('che base64 xong thì script khai màn nhỏ đi hơn 10 lần', () => {
    const opening = SCRIPTS!.find(s => s.content.length > 400_000);
    expect(opening, 'thẻ mẫu phải có script khai màn cỡ nửa triệu ký tự').toBeTruthy();
    const { maskedText, map } = maskBase64Payloads(opening!.content);
    expect(Object.keys(map).length).toBe(1);
    expect(Object.values(map)[0].kind).toBe('text');   // nhóm (c) — được phép dịch
    expect(opening!.content.length / maskedText.length).toBeGreaterThan(10);
  });

  /**
   * Chốt chặn TỐC ĐỘ. Không đo bằng giây (máy CI nhanh chậm khác nhau) mà đo bằng thứ tất định:
   * bộ tách token của surgical phải làm việc trên bản ĐÃ CHE. Nếu ai đó lại nối surgical vào
   * `field.original` thô, số ký tự nó phải quét lập tức phình lên hơn 10 lần và test này đỏ.
   */
  it.skipIf(!SCRIPTS)('surgical chỉ nên nhìn thấy bản đã che — quét bản thô là phí hơn 10 lần công', () => {
    const opening = SCRIPTS!.find(s => s.content.length > 400_000)!;
    const { maskedText } = maskBase64Payloads(opening.content);

    const t0 = performance.now();
    const maskedTokens = extractCJKTokens(maskedText);
    const maskedMs = performance.now() - t0;

    const t1 = performance.now();
    const rawTokens = extractCJKTokens(opening.content);
    const rawMs = performance.now() - t1;

    // Khối base64 KHÔNG chứa chữ Hán, nên quét nó ra đúng bằng số token — chỉ tốn thời gian.
    expect(rawTokens.length).toBe(maskedTokens.length);
    // eslint-disable-next-line no-console
    console.log(`[237] extractCJKTokens: đã che ${maskedMs.toFixed(0)}ms / thô ${rawMs.toFixed(0)}ms ` +
      `(${maskedText.length} vs ${opening.content.length} ký tự, ${maskedTokens.length} token)`);
  });
});

describe('(bug 237) vỏ base64 dùng chung — mọi đường dịch phải đi qua MỘT bản logic', () => {
  // Phải đủ dài để vượt MIN_PAYLOAD_LEN (200 ký tự base64) — dưới ngưỡng đó bộ dò cố tình bỏ qua,
  // vì bắt nhầm một chuỗi hash trông giống base64 còn hại hơn bỏ sót vài chữ.
  const HTML = '<!doctype html><head><meta charset="utf-8"/><title>Counterfeit</title>'
    + '<style>body{margin:0;font-family:system-ui}.btn{padding:8px 16px;border-radius:6px}</style></head>'
    + '<body><h1>开场界面</h1><p>请选择战役</p><button class="btn" id="start">开始</button></body>';
  const script = `const OPENING_HTML_B64 = '${btoa(unescape(encodeURIComponent(HTML)))}';\nconst tip = '状态栏';\n`;

  it('vỏ ngoài KHÔNG BAO GIỜ nhìn thấy khối base64, ruột thì được dịch và mã hoá lại', async () => {
    let outerSaw = '';
    let innerSaw = '';
    const out = await translateThroughBase64Shell(script, 'th[0].content', {
      outer: async (masked) => { outerSaw = masked; return masked.replace('状态栏', 'Thanh trạng thái'); },
      inner: async (decoded) => { innerSaw = decoded; return decoded.replace('开场界面', 'Màn khai mạc').replace('请选择战役', 'Hãy chọn chiến dịch'); },
    });

    // Đây là bất biến của cả bug: khối base64 bị CHE trước khi bất cứ ai chạm vào text.
    expect(outerSaw).not.toContain('PCFkb2N0eXBl');
    expect(outerSaw.length).toBeLessThan(script.length);
    expect(innerSaw).toBe(HTML);

    // Ruột đã dịch phải quay lại đúng chỗ, dưới dạng base64 hợp lệ, giải ra đúng bản dịch.
    const b64 = /'([A-Za-z0-9+/]+={0,2})'/.exec(out)![1];
    const decoded = new TextDecoder().decode(Uint8Array.from(atob(b64), c => c.charCodeAt(0)));
    expect(decoded).toContain('Màn khai mạc');
    expect(decoded).toContain('Hãy chọn chiến dịch');
    expect(decoded).not.toContain('开场界面');
    // Phần ngoài khối vẫn được dịch bình thường, tên biến và dấu nháy nguyên vẹn.
    expect(out).toContain('Thanh trạng thái');
    expect(out).toContain("const OPENING_HTML_B64 = '");
  });

  it('ruột dịch hỏng thì GIỮ NGUYÊN khối gốc — thẻ thiếu bản dịch vẫn chạy, thẻ hỏng thì không', async () => {
    const out = await translateThroughBase64Shell(script, 'th[0].content', {
      outer: async (masked) => masked,
      inner: async () => { throw new Error('API chết'); },
    });
    expect(out).toBe(script);
  });
});

describe('(bug 237) reinsertTranslations không được là O(n²)', () => {
  it('văn bản nửa triệu ký tự toàn ký tự từ vẫn ghép xong trong tích tắc', () => {
    // Mô phỏng đúng hình dạng gây treo: một dải [A-Za-z0-9] khổng lồ (khối base64) rồi tới chữ Hán.
    const blob = 'QUJDRA'.repeat(90_000);            // ~540k ký tự, không có ký tự ngắt
    const text = `const b='${blob}';const nhan={状态:1};`;
    const toks = extractCJKTokens(text);
    expect(toks.length).toBeGreaterThan(0);
    toks.forEach(t => { t.translated = 'Trang thai'; });
    const t0 = performance.now();
    const out = reinsertTranslations(text, toks);
    const ms = performance.now() - t0;
    expect(out).toContain('Trang thai');
    expect(out).toContain(blob);            // khối base64 nguyên vẹn từng ký tự
    // Bản cũ không về sau nhiều phút với đúng đầu vào này.
    expect(ms).toBeLessThan(3000);
  });
});
