// Bug: "tạo card xong xuất ra PNG không import vào SillyTavern được".
// Gốc rễ: buildTextChunk ghi loại chunk là "tExt" (chữ X viết THƯỜNG, mã 120) thay vì "tEXt" (88).
// SillyTavern đọc thẻ bằng png-chunks-extract rồi LỌC `chunk.name === 'tEXt'` → không thấy chunk nào
// ⇒ ném "No PNG metadata" ⇒ thẻ không import được, dù ảnh vẫn mở xem bình thường.
// Test này khoá lại đúng 4 byte đó + vòng ghi/đọc, để lỗi không quay lại.
import { describe, it, expect } from 'vitest';
import { writeCharaToPng, extractCharaFromPng } from './pngMetadata';

/** PNG hợp lệ tối thiểu: signature + IHDR + IDAT + IEND (1×1 px). */
function makeTinyPng(): ArrayBuffer {
  const b64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8.buffer;
}

/** Liệt kê tên các chunk trong PNG, đúng cách SillyTavern/png-chunks-extract đọc. */
function listChunkNames(buf: ArrayBuffer): string[] {
  const u8 = new Uint8Array(buf);
  const view = new DataView(buf);
  const td = new TextDecoder('utf-8');
  const names: string[] = [];
  let offset = 8;
  while (offset + 8 <= u8.length) {
    const length = view.getUint32(offset);
    names.push(td.decode(u8.subarray(offset + 4, offset + 8)));
    offset += 12 + length;
  }
  return names;
}

const CARD = JSON.stringify({
  spec: 'chara_card_v3',
  spec_version: '3.0',
  data: { name: 'Thử Nghiệm', description: 'Mô tả tiếng Việt có 中文', first_mes: 'Xin chào' },
});

describe('pngMetadata — chunk phải là tEXt (chữ X HOA) để SillyTavern import được', () => {
  it('chunk ghi ra mang đúng tên "tEXt", không phải "tExt"', () => {
    const out = writeCharaToPng(makeTinyPng(), CARD);
    const names = listChunkNames(out);
    expect(names).toContain('tEXt');
    expect(names).not.toContain('tExt'); // ← đúng lỗi cũ
  });

  it('có đủ 2 chunk ccv3 + chara và đọc lại ra đúng JSON (kể cả tiếng Việt/Hán)', () => {
    const v2 = JSON.stringify({ spec: 'chara_card_v2', spec_version: '2.0', data: { name: 'Thử Nghiệm' } });
    const out = writeCharaToPng(makeTinyPng(), CARD, v2);

    expect(listChunkNames(out).filter((n) => n === 'tEXt')).toHaveLength(2);
    expect(extractCharaFromPng(out)).toBe(CARD); // ưu tiên ccv3
  });

  it('CRC của chunk mới phải khớp (png-chunks-extract kiểm CRC, sai là báo "PNG file is likely corrupted")', () => {
    const out = writeCharaToPng(makeTinyPng(), CARD);
    const u8 = new Uint8Array(out);
    const view = new DataView(out);

    // Bảng CRC32 chuẩn PNG
    const table: number[] = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
    const crc32 = (buf: Uint8Array) => {
      let crc = -1;
      for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
      return (crc ^ -1) >>> 0;
    };

    let offset = 8;
    let checked = 0;
    while (offset + 8 <= u8.length) {
      const length = view.getUint32(offset);
      const expected = crc32(u8.subarray(offset + 4, offset + 8 + length));
      expect(view.getUint32(offset + 8 + length)).toBe(expected);
      checked++;
      offset += 12 + length;
    }
    expect(checked).toBeGreaterThan(3); // IHDR + 2×tEXt + IDAT + IEND
  });

  it('xuất lại lần 2 KHÔNG để sót chunk cũ (vẫn chỉ 2 chunk tEXt)', () => {
    const once = writeCharaToPng(makeTinyPng(), CARD);
    const twice = writeCharaToPng(once, CARD);
    expect(listChunkNames(twice).filter((n) => n === 'tEXt')).toHaveLength(2);
  });
});
