/**
 * (bug 213) KIỂM TRÊN CARD THẬT, CỠ LỚN — fixture user gửi ở bug/203 (2.6MB và 10.5MB PNG).
 *
 * Các bản vá đợt 1–5 đụng thẳng vào đường chunk / phân loại entry / chỉ mục mốc. Test đơn vị đã
 * khoá từng luật, nhưng thứ dễ vỡ nhất khi tối ưu là BẤT BIẾN TRÊN DỮ LIỆU THẬT: ghép chunk lại
 * phải ra đúng nguyên văn, không sót không thừa một ký tự nào.
 *
 * File tự bỏ qua nếu thiếu fixture (máy khác clone repo không có bug/203).
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chunkText, buildMarkerIndex, countMarkersBefore } from '../chunking';
import { isJsonPatchContent } from '../cardFields';
import { hasEjsBlocks } from '../chunkDoctor';

const CARDS = ['../../../bug/203/v1.0.5_1.png', '../../../bug/203/v3.01.png']
  .map(p => fileURLToPath(new URL(p, import.meta.url)))
  .filter(existsSync);

/**
 * Đọc thẻ nhân vật từ tEXt chunk của PNG.
 * (`pngHandler.extractCharaFromPNG` nhận `File` và dùng FileReader — API trình duyệt, không chạy
 * được ở môi trường node của vitest, nên đọc thẳng ở đây.)
 */
function charaFromPng(path: string): string | null {
  const buf = readFileSync(path);
  let off = 8;   // bỏ chữ ký PNG
  let latest: string | null = null;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const dataAt = off + 8;
    if (type === 'IEND') break;
    if (type === 'tEXt' && dataAt + len <= buf.length) {
      const data = buf.subarray(dataAt, dataAt + len);
      const sep = data.indexOf(0);
      if (sep > 0) {
        const key = data.toString('ascii', 0, sep).toLowerCase();
        if (key === 'chara' || key === 'ccv3') {
          const b64 = data.toString('ascii', sep + 1);
          try { latest = Buffer.from(b64, 'base64').toString('utf-8'); } catch { /* bỏ qua chunk hỏng */ }
        }
      }
    }
    off = dataAt + len + 4;   // + CRC
  }
  return latest;
}

describe.skipIf(CARDS.length === 0)('card thật cỡ lớn (bug/203)', () => {
  /** Gom mọi chuỗi đáng kể trong card để đem đi chunk. */
  const textsOf = (cardJson: string): string[] => {
    const card = JSON.parse(cardJson) as unknown;
    const out: string[] = [];
    const walk = (v: unknown) => {
      if (typeof v === 'string') { if (v.length > 2000) out.push(v); return; }
      if (Array.isArray(v)) { v.forEach(walk); return; }
      if (v && typeof v === 'object') { Object.values(v as Record<string, unknown>).forEach(walk); }
    };
    walk(card);
    return out;
  };

  for (const path of CARDS) {
    const name = path.split(/[\\/]/).pop();

    it(`${name}: đọc được thẻ và có nội dung lớn để thử`, () => {
      const json = charaFromPng(path);
      expect(json).toBeTruthy();
      expect(json!.length).toBeGreaterThan(10_000);
    });

    it(`${name}: BẤT BIẾN — ghép chunk lại phải ra ĐÚNG nguyên văn`, () => {
      const json = charaFromPng(path)!;
      const texts = textsOf(json);
      expect(texts.length).toBeGreaterThan(0);

      let checked = 0;
      for (const t of texts.slice(0, 40)) {
        for (const size of [8_000, 15_000, 40_000]) {
          const chunks = chunkText(t, size);
          expect(chunks.join('')).toBe(t);      // không sót, không thừa, không đổi thứ tự
          expect(chunks.every(c => c.length > 0)).toBe(true);
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(0);
    }, 120_000);

    it(`${name}: chỉ mục mốc khớp CHÍNH XÁC cách đếm cũ trên dữ liệu thật`, () => {
      const json = charaFromPng(path)!;
      const texts = textsOf(json).slice(0, 6);
      for (const t of texts) {
        const idx = buildMarkerIndex(t);
        // lấy mẫu 200 vị trí rải đều thay vì quét từng ký tự (văn bản hàng chục nghìn ký tự)
        for (let i = 0; i <= 200; i++) {
          const pos = Math.floor((t.length * i) / 200);
          const before = t.slice(0, pos);
          expect(countMarkersBefore(idx.ejsOpen, pos)).toBe((before.match(/<%/g) || []).length);
          expect(countMarkersBefore(idx.ejsClose, pos)).toBe((before.match(/%>/g) || []).length);
          expect(countMarkersBefore(idx.fence, pos)).toBe((before.match(/```/g) || []).length);
          expect(countMarkersBefore(idx.scriptOpen, pos)).toBe((before.match(/<script[\s>]/gi) || []).length);
          expect(countMarkersBefore(idx.styleClose, pos)).toBe((before.match(/<\/style>/gi) || []).length);
        }
      }
    }, 120_000);

    it(`${name}: chunk toàn bộ card xong trong thời gian hợp lý (main thread)`, () => {
      const json = charaFromPng(path)!;
      const texts = textsOf(json);
      const t0 = Date.now();
      let totalChunks = 0;
      for (const t of texts) totalChunks += chunkText(t, 15_000).length;
      const ms = Date.now() - t0;
      expect(totalChunks).toBeGreaterThan(0);
      expect(ms).toBeLessThan(20_000);
    }, 120_000);

    it(`${name}: hasEjsBlocks ổn định khi gọi lặp trên nhiều đoạn thật (bẫy lastIndex)`, () => {
      const json = charaFromPng(path)!;
      const texts = textsOf(json).slice(0, 30);
      // Gọi hai lượt trên CÙNG tập dữ liệu — bản dính bẫy /g sẽ cho kết quả khác nhau giữa 2 lượt.
      const pass1 = texts.map(hasEjsBlocks);
      const pass2 = texts.map(hasEjsBlocks);
      expect(pass2).toEqual(pass1);
    });

    it(`${name}: isJsonPatchContent không nhận nhầm nội dung thật nào`, () => {
      const json = charaFromPng(path)!;
      for (const t of textsOf(json)) {
        if (!isJsonPatchContent(t)) continue;
        // Nếu có nhận thì phải là JSON Patch THẬT — parse lại được và đủ op/path.
        const parsed = JSON.parse(t.trim()) as unknown;
        const ops = Array.isArray(parsed) ? parsed : [parsed];
        expect(ops.every((o) => typeof (o as { op?: unknown }).op === 'string')).toBe(true);
      }
    });
  }
});
