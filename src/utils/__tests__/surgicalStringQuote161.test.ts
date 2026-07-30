/**
 * (bug 161) UI DỊCH XONG KHÔNG BẤM ĐƯỢC NÚT NÀO — dấu nháy lọt vào giữa chuỗi JS.
 * ─────────────────────────────────────────────────────────────────────────────
 * Bằng chứng user gửi (bug/161), parse bằng chính engine JS:
 *   ui raw.txt             → script OK
 *   ui dịch lỗi.txt        → ❌ Unexpected identifier 'bao'  (dòng 410)
 *   ui fix bằng claude.txt → script OK
 * Dòng 410:
 *   nguyên bản : +'同时返回JSON对象，包含：\n'
 *   bản dịch   : +'Đồng thời trả vềJSONđối tượng, 'bao gồm':\n'
 * Chuỗi bị xẻ đôi → `bao` thành định danh trần → CẢ khối <script> không parse được → mọi hàm
 * go()/connectApi()… không tồn tại → bấm nút nào cũng không ăn, kể cả nút đầu tiên. HTML vẫn hiện
 * ra bình thường nên user không thấy dấu hiệu gì. Cùng họ với bug 151/160.
 *
 * AI LÀ NGƯỜI THÊM DẤU NHÁY, KHÔNG PHẢI TOOL. Cụm Hán `对象，包含` là MỘT token (bộ tách nối cụm
 * qua dấu câu full-width), và model dịch nó thành `đối tượng, 'bao gồm'` — tự ý thêm nháy vì tưởng
 * đó là nhãn. Tool chèn nguyên văn vào giữa chuỗi đang mở là chết.
 * Nên bản vá phải là một BẤT BIẾN tất định: cụm gốc nằm trong chuỗi mà bản dịch mọc thêm dấu nháy
 * cùng loại với dấu đang bao chuỗi → bỏ dấu đó đi. Không trông chờ AI ngoan.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { extractCJKTokens, reinsertTranslations } from '../surgical';

/** Đúng dòng 410 của file bằng chứng (\\n trong nguồn là 2 ký tự, không phải xuống dòng thật). */
const LINE = `    +'同时返回JSON对象，包含：\\n'`;

/** Dịch bằng bảng tra rồi ghép lại — mô phỏng đúng đường tool đi. */
function translateWith(src: string, map: Record<string, string>): string {
  const tokens = extractCJKTokens(src);
  for (const t of tokens) {
    const key = t.text.trim();
    if (map[key] !== undefined) t.translated = map[key];
  }
  return reinsertTranslations(src, tokens);
}

/** Chuỗi có phải JS hợp cú pháp — dùng chính engine, không tự đoán. */
function jsOk(code: string): { ok: boolean; err?: string } {
  try { new Function(code); return { ok: true }; } catch (e) { return { ok: false, err: (e as Error).message }; }
}

describe('(bug 161) AI thêm dấu nháy vào bản dịch → không được chèn vào giữa chuỗi', () => {
  it('ca thật của user: kết quả phải parse được', () => {
    const out = translateWith(LINE, { '同时返回': 'Đồng thời trả về', '对象，包含': `đối tượng, 'bao gồm'` });
    const r = jsOk(`const x = ''${out.trim()}`);
    expect(r.ok, `vẫn vỡ cú pháp (${r.err}) — kết quả: ${out}`).toBe(true);
  });

  it('nháy KÉP mọc thêm trong chuỗi nháy kép cũng phải xử', () => {
    const src = `  msg = "返回对象，包含：";`;
    const out = translateWith(src, { '返回对象，包含': `Trả về đối tượng, "bao gồm"` });
    const r = jsOk(out);
    expect(r.ok, `vỡ (${r.err}): ${out}`).toBe(true);
  });

  it('nháy KÉP trong chuỗi NHÁY ĐƠN thì vô hại — phải giữ nguyên, không sửa oan', () => {
    const out = translateWith(`  msg = '返回对象：';`, { '返回对象': `Trả về "đối tượng"` });
    expect(out, 'nháy kép nằm trong chuỗi nháy đơn là hợp lệ, đừng bóc').toContain('"đối tượng"');
    expect(jsOk(out).ok).toBe(true);
  });

  it('bản dịch KHÔNG có nháy thì không đụng tới', () => {
    const out = translateWith(LINE, { '同时返回': 'Đồng thời trả về', '对象，包含': 'đối tượng, bao gồm' });
    expect(out).toContain('đối tượng, bao gồm');
    expect(jsOk(`const x = ''${out.trim()}`).ok).toBe(true);
  });

  it('ngoài chuỗi thì giữ nguyên hành vi cũ (không phải chỗ nào có nháy cũng bóc)', () => {
    // Văn xuôi trong HTML — nháy ở đây là dấu câu bình thường của người đọc.
    const src = `<p>返回对象</p>`;
    const out = translateWith(src, { '返回对象': `Trả về 'đối tượng'` });
    expect(out, 'văn xuôi HTML: nháy là dấu câu, phải giữ').toContain(`'đối tượng'`);
  });
});

// ── Chạy trên CHÍNH file user gửi. Máy khác không có bug/ thì bỏ qua. ──
const RAW = resolve(__dirname, '../../../bug/161/ui raw.txt');

describe.skipIf(!existsSync(RAW))('(bug 161) cả FILE THẬT của user dịch xong vẫn phải parse được', () => {
  /** Lấy nội dung các khối <script> không có src. */
  const scriptsOf = (html: string) =>
    [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);

  it('file gốc vốn parse được (mốc so sánh)', () => {
    for (const code of scriptsOf(readFileSync(RAW, 'utf-8'))) {
      expect(jsOk(code).ok, 'file gốc phải sạch, không thì bài test vô nghĩa').toBe(true);
    }
  });

  it('ép MỌI cụm Hán thành bản dịch xấu nhất mà script vẫn chạy', () => {
    // Không cần AI: ép mọi token thành bản dịch "xấu nhất có thể" — có dấu cách, có dấu tiếng
    // Việt, có cả nháy đơn lẫn nháy kép. Đây chính là loại đầu ra đã làm vỡ file của user. Qua
    // được bài này thì pipeline chịu được gần như mọi thứ model có thể trả về.
    const html = readFileSync(RAW, 'utf-8');
    for (const code of scriptsOf(html)) {
      const tokens = extractCJKTokens(code);
      expect(tokens.length, 'phải có cụm Hán để dịch').toBeGreaterThan(50);
      for (const t of tokens) {
        // Token là khoá/định danh code thì reinsert có đường xử riêng (bọc nháy/bracket) — vẫn ép
        // bản dịch bẩn để chắc chắn đường đó cũng không vỡ.
        t.translated = `Bản 'dịch' có "nháy" và dấu cách`;
      }
      const out = reinsertTranslations(code, tokens);
      const r = jsOk(out);
      expect(r.ok, `script vỡ sau khi dịch: ${r.err}`).toBe(true);
    }
  });

  it('bản dịch không được dính chữ vào nhau ở ranh giới Hán–Latin', () => {
    // Bằng chứng user còn có "thuầnJSONmảng", "không cầnmarkdownkhối" — tiếng Trung không cần dấu
    // cách nên bộ gom cắt quanh cụm Latin, nối lại là dính liền. Lưới auto-space của bug 160 phải
    // xử được ngay trong file này.
    const code = scriptsOf(readFileSync(RAW, 'utf-8'))[0];
    const tokens = extractCJKTokens(code);
    for (const t of tokens) if (!t.isIdentifier && !t.isObjectKey && !t.isDotNotation) t.translated = 'Bản dịch';
    const out = reinsertTranslations(code, tokens);
    // "Bản dịchJSON" hoặc "JSONBản" = dính chữ.
    const stuck = out.match(/Bản dịch(?=[A-Za-z])|(?<=[A-Za-z])Bản dịch/g) ?? [];
    expect(stuck.length, `còn ${stuck.length} chỗ dính chữ vào cụm Latin`).toBe(0);
  });
});
