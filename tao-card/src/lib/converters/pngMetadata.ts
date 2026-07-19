/**
 * Utility to read and write SillyTavern character card metadata ('chara' tEXt chunk) in PNG files.
 */

// Helper to calculate CRC32 for PNG chunks
const makeCRCTable = () => {
  let c;
  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) {
      c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
    }
    crcTable[n] = c;
  }
  return crcTable;
};

const crcTable = makeCRCTable();

const crc32 = (buf: Uint8Array): number => {
  let crc = 0 ^ (-1);
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xFF];
  }
  return (crc ^ (-1)) >>> 0;
};

/**
 * Chunk có phải tEXt không.
 * Chấp nhận thêm 'tExt' (viết sai chữ X) để ĐỌC / DỌN được những file PNG do bản cũ của tool
 * xuất ra trước khi lỗi này được sửa — nhờ vậy xuất lại là thẻ sạch, không còn chunk hỏng sót lại.
 */
const isTextChunkType = (type: string) => type === 'tEXt' || type === 'tExt';

/**
 * Extracts character JSON string from PNG ArrayBuffer.
 * Checks for 'ccv3' keyword first (V3 cards), then falls back to 'chara' (V2).
 */
export function extractCharaFromPng(arrayBuffer: ArrayBuffer): string | null {
  const view = new DataView(arrayBuffer);
  const uint8 = new Uint8Array(arrayBuffer);

  // Check PNG signature
  if (
    uint8[0] !== 0x89 ||
    uint8[1] !== 0x50 ||
    uint8[2] !== 0x4E ||
    uint8[3] !== 0x47 ||
    uint8[4] !== 0x0D ||
    uint8[5] !== 0x0A ||
    uint8[6] !== 0x1A ||
    uint8[7] !== 0x0A
  ) {
    throw new Error('File không phải định dạng ảnh PNG hợp lệ.');
  }

  let offset = 8;
  const textDecoder = new TextDecoder('utf-8');

  // Collect all tEXt chunk data keyed by keyword
  let ccv3Data: string | null = null;
  let charaData: string | null = null;

  while (offset < uint8.length) {
    if (offset + 8 > uint8.length) break;

    const length = view.getUint32(offset);
    const type = textDecoder.decode(uint8.subarray(offset + 4, offset + 8));

    if (isTextChunkType(type)) {
      const dataStart = offset + 8;
      const dataEnd = dataStart + length;
      const chunkData = uint8.subarray(dataStart, dataEnd);

      // Find null separator
      let nullIndex = -1;
      for (let i = 0; i < chunkData.length; i++) {
        if (chunkData[i] === 0) {
          nullIndex = i;
          break;
        }
      }

      if (nullIndex !== -1) {
        const keyword = textDecoder.decode(chunkData.subarray(0, nullIndex));
        const base64Text = textDecoder.decode(chunkData.subarray(nullIndex + 1));

        if (keyword === 'ccv3' && !ccv3Data) {
          try {
            ccv3Data = decodeBase64(base64Text);
          } catch { /* ignore decode error, try next */ }
        } else if (keyword === 'chara' && !charaData) {
          try {
            charaData = decodeBase64(base64Text);
          } catch { /* ignore decode error, try next */ }
        }
      }
    }

    // Skip content + CRC (4 bytes)
    offset += 12 + length;
  }

  // Prefer V3 (ccv3) over V2 (chara)
  return ccv3Data ?? charaData ?? null;
}

/**
 * Build a PNG tEXt chunk with the given keyword and text data.
 */
function buildTextChunk(keyword: string, textData: string): Uint8Array {
  const textEncoder = new TextEncoder();
  const keywordBytes = textEncoder.encode(keyword);
  const textBytes = textEncoder.encode(textData);

  const chunkDataLength = keywordBytes.length + 1 + textBytes.length;
  const chunk = new Uint8Array(12 + chunkDataLength);
  const chunkView = new DataView(chunk.buffer);

  // Length (4 bytes)
  chunkView.setUint32(0, chunkDataLength);

  // Type 'tEXt' (4 bytes).
  // LƯU Ý: chữ X phải VIẾT HOA (88). Trước đây chỗ này ghi nhầm 120 ('x') → chunk ra "tExt",
  // SillyTavern lọc `chunk.name === 'tEXt'` nên KHÔNG thấy metadata ⇒ báo "No PNG metadata"
  // và không import được thẻ. (Theo chuẩn PNG, chữ thứ 3 viết thường còn có nghĩa là chunk
  // "reserved/không hợp lệ" — nên đây là lỗi thật, không chỉ là lệch tên.)
  chunk[4] = 116; // 't'
  chunk[5] = 69;  // 'E'
  chunk[6] = 88;  // 'X'  ← KHÔNG được là 120 ('x')
  chunk[7] = 116; // 't'

  // Data: keyword + null separator + text
  chunk.set(keywordBytes, 8);
  chunk[8 + keywordBytes.length] = 0;
  chunk.set(textBytes, 8 + keywordBytes.length + 1);

  // CRC (type + data)
  const crcInput = chunk.subarray(4, 8 + chunkDataLength);
  chunkView.setUint32(8 + chunkDataLength, crc32(crcInput));

  return chunk;
}

/**
 * Strip all tEXt chunks whose keyword matches any in the given set.
 * Returns a new Uint8Array without those chunks.
 */
function stripTextChunks(uint8: Uint8Array, keywords: Set<string>): Uint8Array {
  const textDecoder = new TextDecoder('utf-8');
  const pieces: Uint8Array[] = [];

  // PNG signature (8 bytes) is always kept
  pieces.push(uint8.subarray(0, 8));

  let offset = 8;
  const view = new DataView(uint8.buffer, uint8.byteOffset, uint8.byteLength);

  while (offset < uint8.length) {
    if (offset + 8 > uint8.length) break;

    const length = view.getUint32(offset);
    const type = textDecoder.decode(uint8.subarray(offset + 4, offset + 8));
    const totalChunkSize = 12 + length; // length(4) + type(4) + data(length) + crc(4)

    if (isTextChunkType(type)) {
      // Parse keyword from chunk data
      const dataStart = offset + 8;
      const dataEnd = dataStart + length;
      const chunkData = uint8.subarray(dataStart, dataEnd);
      let nullIdx = -1;
      for (let i = 0; i < chunkData.length; i++) {
        if (chunkData[i] === 0) { nullIdx = i; break; }
      }
      const keyword = nullIdx >= 0
        ? textDecoder.decode(chunkData.subarray(0, nullIdx))
        : textDecoder.decode(chunkData);

      if (keywords.has(keyword)) {
        // Skip this chunk (don't add to pieces)
        offset += totalChunkSize;
        continue;
      }
    }

    pieces.push(uint8.subarray(offset, offset + totalChunkSize));
    offset += totalChunkSize;
  }

  // Concatenate pieces
  const totalLen = pieces.reduce((sum, p) => sum + p.length, 0);
  const result = new Uint8Array(totalLen);
  let pos = 0;
  for (const piece of pieces) {
    result.set(piece, pos);
    pos += piece.length;
  }
  return result;
}

/**
 * Embeds character JSON into PNG ArrayBuffer.
 *
 * Writes two tEXt chunks for compatibility:
 *   - 'ccv3' — V3 card JSON (primary, SillyTavern reads this first)
 *   - 'chara' — same JSON for V2 backward compatibility
 *
 * Any existing 'chara'/'ccv3' tEXt chunks are stripped first
 * to prevent stale/duplicate data.
 *
 * @param v3Json - The V3 card JSON string (used for 'ccv3' chunk)
 * @param v2Json - Optional V2-compatible JSON for the 'chara' chunk.
 *                 If omitted, v3Json is used for both chunks.
 */
export function writeCharaToPng(
  pngArrayBuffer: ArrayBuffer,
  v3Json: string,
  v2Json?: string,
): ArrayBuffer {
  let uint8 = new Uint8Array(pngArrayBuffer);

  // Validate PNG signature
  if (
    uint8[0] !== 0x89 ||
    uint8[1] !== 0x50 ||
    uint8[2] !== 0x4E ||
    uint8[3] !== 0x47 ||
    uint8[4] !== 0x0D ||
    uint8[5] !== 0x0A ||
    uint8[6] !== 0x1A ||
    uint8[7] !== 0x0A
  ) {
    throw new Error('File nguồn không phải định dạng ảnh PNG hợp lệ.');
  }

  // Step 1: Strip any existing chara/ccv3 chunks
  uint8 = stripTextChunks(uint8, new Set(['chara', 'ccv3'])) as Uint8Array<ArrayBuffer>;

  // Step 2: Build new chunks
  const ccv3Chunk = buildTextChunk('ccv3', encodeBase64(v3Json));
  const charaChunk = buildTextChunk('chara', encodeBase64(v2Json ?? v3Json));

  // Step 3: Find insert point — right after IHDR chunk
  const view = new DataView(uint8.buffer, uint8.byteOffset, uint8.byteLength);
  const firstChunkLength = view.getUint32(8);
  const insertOffset = 8 + 12 + firstChunkLength;

  // Step 4: Assemble output: [signature + IHDR] + [ccv3] + [chara] + [rest]
  const outBuffer = new Uint8Array(
    uint8.length + ccv3Chunk.length + charaChunk.length,
  );
  outBuffer.set(uint8.subarray(0, insertOffset), 0);
  outBuffer.set(ccv3Chunk, insertOffset);
  outBuffer.set(charaChunk, insertOffset + ccv3Chunk.length);
  outBuffer.set(
    uint8.subarray(insertOffset),
    insertOffset + ccv3Chunk.length + charaChunk.length,
  );

  return outBuffer.buffer;
}

// Unicode-safe Base64 decode
function decodeBase64(str: string): string {
  const binary = atob(str.trim());
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder('utf-8').decode(bytes);
}

// Unicode-safe Base64 encode
function encodeBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Converts a data URL (base64) to ArrayBuffer.
 */
export async function dataUrlToArrayBuffer(dataUrl: string): Promise<ArrayBuffer> {
  if (dataUrl.startsWith('data:')) {
    const parts = dataUrl.split(',');
    if (parts.length !== 2) throw new Error('Invalid data URL');
    const base64 = parts[1];
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }
  // Fallback cho url thường hoặc blob url
  const res = await fetch(dataUrl);
  return res.arrayBuffer();
}

/**
 * Creates a default blank PNG canvas and returns its ArrayBuffer.
 */
export async function getDefaultCardPng(name: string): Promise<ArrayBuffer> {
  const canvas = document.createElement('canvas');
  canvas.width = 400;
  canvas.height = 600;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    // Fill background with gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, 600);
    gradient.addColorStop(0, '#2d1b4e');
    gradient.addColorStop(1, '#1c122c');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 400, 600);

    // Draw card border
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 10;
    ctx.strokeRect(10, 10, 380, 580);

    // Draw some stylized graphic
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.beginPath();
    ctx.arc(200, 200, 100, 0, Math.PI * 2);
    ctx.fill();

    // Draw character name
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 24px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(name || 'Unnamed Card', 200, 400);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.font = '14px sans-serif';
    ctx.fillText('Character Card', 200, 430);
  }

  // Convert to blob and then ArrayBuffer
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Canvas to Blob conversion failed'));
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        if (reader.result instanceof ArrayBuffer) {
          resolve(reader.result);
        } else {
          reject(new Error('Failed to read blob as array buffer'));
        }
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(blob);
    }, 'image/png');
  });
}

/**
 * Converts any image data URL (PNG, JPEG, etc.) into a PNG ArrayBuffer.
 */
export async function convertToPngBuffer(imgDataUrl: string): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }
      ctx.drawImage(img, 0, 0);
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('Failed to convert canvas to PNG blob'));
          return;
        }
        const reader = new FileReader();
        reader.onloadend = () => {
          if (reader.result instanceof ArrayBuffer) {
            resolve(reader.result);
          } else {
            reject(new Error('Failed to read PNG blob as ArrayBuffer'));
          }
        };
        reader.readAsArrayBuffer(blob);
      }, 'image/png');
    };
    img.onerror = () => reject(new Error('Failed to load image for PNG conversion'));
    img.src = imgDataUrl;
  });
}


