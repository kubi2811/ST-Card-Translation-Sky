/**
 * (bug 207) Sáu lỗ khiến "21/21 xong mà treo vô hạn, bấm dừng là mất trắng":
 *   L1 — retry của cổng cú pháp/CJK dịch lại CẢ 21 chunk → nay khoanh vùng, chỉ dịch lại cell hỏng;
 *   L2 — prepareFields thay field đang dở bằng bản trắng → nay mang tiến trình chunk sang;
 *   L3 — ChunkError mang mảng thưa toàn '' đè lên 21 ô tốt → nay gộp theo chỉ số;
 *   L4 — UI ước lượng 15000 trong khi engine dùng 12000 (16 vs 21) + totalChunks chỉ có sau
 *        chunk đầu → nay chunkCharsForField + onChunksReady set ngay;
 *   L5 — repairObjectKeys 400 vòng acorn trên 340k khoá main thread → ngân sách thời gian;
 *   L6 — chunkDoctor ngưỡng CJK tuyệt đối bắt oan chunk code → ngưỡng theo loại chunk.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  findSyntaxBrokenChunks, findCjkHeavyChunks, planTargetedChunkRetry, mergeChunkProgress,
} from '../chunkRetryPlan';
import { chunkCharsForField } from '../chunking';
import { diagnoseChunk, applyDictCasing } from '../chunkDoctor';

const JS_OK = 'const a = 1;\nconst b = fn(a);\nexport const c = a + b;';
const JS_BROKEN = 'const a = 1;\nconst b = fn(a;\nexport const c = a + b;';
const HAN = '这是一个漫长的故事，主角在森林里冒险。'.repeat(5);
const VI = 'Đây là một câu chuyện dài, nhân vật chính phiêu lưu trong rừng. '.repeat(5);

describe('(L1) khoanh vùng chunk hỏng — dịch lại nhắm đích thay vì cả 21 chunk', () => {
  it('cell gốc parse sạch mà cell dịch vỡ → chính nó là thủ phạm', () => {
    expect(findSyntaxBrokenChunks([JS_OK, JS_OK, JS_OK], [JS_OK, JS_BROKEN, JS_OK])).toEqual([1]);
  });

  it('cell gốc KHÔNG tự đứng được (cắt giữa hàm) → không kết luận, không báo oan', () => {
    const rawHalf = 'function f() {\n  const x = 1;';
    expect(findSyntaxBrokenChunks([rawHalf], ['bản dịch gì đó {'])).toEqual([]);
  });

  it('cell còn nguyên tiếng Trung / bị trả về gốc → cell chưa dịch', () => {
    expect(findCjkHeavyChunks([HAN, HAN, HAN], [VI, HAN, VI])).toEqual([1]);
  });

  it('planTargetedChunkRetry: có kế hoạch khi khoanh được; null khi còn ô trống / hỏng quá nửa / lệch nhịp', () => {
    const okPlan = planTargetedChunkRetry({ rawChunks: [HAN, HAN, HAN, HAN], completedChunks: [VI, HAN, VI, VI] }, 'cjk');
    expect(okPlan?.suspects).toEqual([1]);
    // còn ô trống → đường resume sẵn có tự lo
    expect(planTargetedChunkRetry({ rawChunks: [HAN, HAN], completedChunks: [VI, ''] }, 'cjk')).toBeNull();
    // hỏng cả loạt → thà dịch lại cả field
    expect(planTargetedChunkRetry({ rawChunks: [HAN, HAN, HAN, HAN], completedChunks: [HAN, HAN, HAN, HAN] }, 'cjk')).toBeNull();
    // lệch nhịp (số cell khác nhau) → không dám khoanh
    expect(planTargetedChunkRetry({ rawChunks: [HAN, HAN, HAN], completedChunks: [VI, HAN] }, 'cjk')).toBeNull();
  });
});

describe('(L3) mergeChunkProgress — mảng thưa không được đè mảng đầy', () => {
  it('ô mới rỗng thì GIỮ ô cũ; ô mới có chữ thì lấy mới', () => {
    expect(mergeChunkProgress(['a', 'b', 'c'], ['', 'B', ''])).toEqual(['a', 'B', 'c']);
  });
  it('lệch nhịp (độ dài khác) → bản mới thắng (ô cũ không còn ứng đúng đoạn văn)', () => {
    expect(mergeChunkProgress(['a', 'b', 'c'], ['x', 'y'])).toEqual(['x', 'y']);
  });
  it('không có bản mới → giữ bản cũ; không có bản cũ → lấy bản mới', () => {
    expect(mergeChunkProgress(['a'], undefined)).toEqual(['a']);
    expect(mergeChunkProgress(undefined, ['x'])).toEqual(['x']);
  });
});

describe('(L4) ước lượng số phần khớp engine', () => {
  it('field code-heavy (tavernHelper/regex/script) → 12000; văn xuôi → 15000; user đặt thì theo user', () => {
    expect(chunkCharsForField('tavernHelper[2].content (幽囚之塔·核心运行时)')).toBe(12000);
    expect(chunkCharsForField('lorebook[3].content (Thành phố)')).toBe(15000);
    expect(chunkCharsForField('tavernHelper[2].content', 10000)).toBe(10000);
    // 236.599 ký tự: trước đây UI báo ~16 (15000) trong khi engine chạy 12000 → ~20-21. Nay khớp.
    expect(Math.ceil(236599 / chunkCharsForField('tavernHelper[2].content (幽囚之塔·核心运行时)'))).toBe(20);
  });
});

describe('(L6) chunkDoctor hết bắt oan chunk code còn vài chữ Hán hợp lệ', () => {
  const codeRaw = Array.from({ length: 40 }, (_, i) => `const v${i} = getvar('变量${i}');`).join('\n'); // 80 Hán, code
  it('chunk CODE dịch xong còn ~20 chữ Hán hợp lệ (khoá getvar giữ nguyên) → KHÔNG bị chẩn cjk', () => {
    const done = Array.from({ length: 40 }, (_, i) => `const v${i} = getvar('${i < 10 ? `变量${i}` : `Biến ${i}`}');`).join('\n'); // còn 20 Hán / 80
    expect(diagnoseChunk(codeRaw, done, {}).some(p => p.kind === 'cjk')).toBe(false);
  });
  it('chunk code giữ nguyên cả mảng (survival 100%) thì VẪN bị chẩn — nới không có nghĩa là mù', () => {
    expect(diagnoseChunk(codeRaw, codeRaw, {}).some(p => p.kind === 'cjk')).toBe(true);
  });
  it('chunk VĂN XUÔI sót 12 chữ Hán rải rác vẫn bị bắt (giữ độ nhạy cho văn bản)', () => {
    const raw = HAN.repeat(4);
    const out = `${VI.repeat(4)} 漫长的故事主角在森林里冒险`; // 12 Hán / ~380 gốc
    expect(diagnoseChunk(raw, out, {}).some(p => p.kind === 'cjk')).toBe(true);
  });
  it('applyDictCasing KHÔNG đụng từ ngắn thường gặp trong văn xuôi ("Cấp")', () => {
    const { text, fixes } = applyDictCasing('nâng cấp vũ khí lên cấp cao hơn', { '等级': 'Cấp' });
    expect(text).toBe('nâng cấp vũ khí lên cấp cao hơn');
    expect(fixes).toBe(0);
  });
});

describe('nối dây (L1/L2/L3/L4/L5)', () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

  it('useTranslation: 3 cổng retry đều khoanh vùng trước khi trả retry; mọi chỗ ChunkError đều gộp theo chỉ số', () => {
    const SRC = read('../../hooks/useTranslation.ts');
    expect((SRC.match(/clearSuspectChunksForRetry\('cjk'\)/g) ?? []).length).toBe(2);
    expect((SRC.match(/clearSuspectChunksForRetry\('syntax'\)/g) ?? []).length).toBe(1);
    // (bug 211) 5 → 3: đường bulk không còn BẢN SAO translateText riêng nữa — nó gọi thẳng
    // retranslateField nên hai call-site trùng lặp (merge lúc retry + merge lúc fail) biến mất.
    // Ba chỗ còn lại: 2 của vòng dịch chính + 1 của retranslateField (mà bulk nay dùng chung).
    expect((SRC.match(/mergeChunkProgress\(/g) ?? []).length).toBe(3);
    // (L2) prepareFields mang tiến trình chunk sang field mới thay vì bản trắng
    expect(SRC).toContain('completedChunks: existing.completedChunks');
    // (L4) totalChunks có NGAY khi cắt xong — (bug 211) 4 → 3, lý do như trên.
    expect((SRC.match(/totalChunks: rawChunks\.length/g) ?? []).length).toBe(3);
    // (bug 211) và chốt kiến trúc mới: bulk phải đi qua retranslateField, không tự gọi API.
    expect(SRC).toContain('await retranslateField(field.path, resume, extra)');
  });

  it('repairObjectKeys có ngân sách thời gian + trần vòng co theo độ dài (L5)', () => {
    const SRC = read('../repairObjectKeys.ts');
    expect(SRC).toContain('TIME_BUDGET_MS');
    expect(SRC).toContain('roundsCapForLength');
  });

  it('verifySeams + postTranslationResidualCheck tôn trọng nút Dừng (không nuốt abort)', () => {
    const SRC = read('../apiClient.ts');
    expect((SRC.match(/if \(signal\?\.aborted\) throw new Error\('Cancelled'\);\s*\n\s*console\.warn\(`?\[(ResidualCheck|verifySeams)/g) ?? []).length).toBeGreaterThanOrEqual(1);
    expect(SRC).toContain("if (signal?.aborted) throw new Error('Cancelled');\n    // Verification failed");
  });
});
