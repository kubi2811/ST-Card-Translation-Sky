/**
 * (bug 164 · HM6) Translation Memory — băm toàn văn + không mất bản ghi khi ghi song song.
 * ─────────────────────────────────────────────────────────────────────────────
 * Tài liệu bug 164 ghi TM "match theo HASH CHÍNH XÁC (không match theo tiền tố — đã được đáp ứng
 * sẵn)". Kiểm lại thì KHÔNG đúng: simpleHash băm `text.slice(0, 200)`, tức đúng là khớp theo tiền
 * tố. Hai entry dài khác nhau mà giống 200 ký tự đầu (rất thường gặp — nhiều entry mở đầu bằng cùng
 * một khối quy tắc) sẽ cùng hash ⇒ lookup trả similarity 1.0 cho bản dịch của entry KHÁC.
 *
 * Và một lỗi nặng hơn: ensureLoaded() không chống gọi trùng, nên ghi đa luồng làm MẤT bản ghi.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// IDB giả: có độ trễ để tái hiện đúng khe xen kẽ của race.
const store = new Map<string, unknown>();
let getDelayMs = 0;
vi.mock('../idb', () => ({
  IDB: {
    get: vi.fn(async (k: string, d: unknown) => {
      if (getDelayMs) await new Promise((r) => setTimeout(r, getDelayMs));
      // Trả BẢN SAO — đúng như IndexedDB thật (structured clone), đây là điều kiện làm lộ race.
      const v = store.get(k);
      return v === undefined ? d : JSON.parse(JSON.stringify(v));
    }),
    set: vi.fn(async (k: string, v: unknown) => { store.set(k, v); }),
    setDebounced: vi.fn((k: string, v: unknown) => { store.set(k, v); }),
    remove: vi.fn(async (k: string) => { store.delete(k); }),
  },
}));

import {
  storeTranslation, lookupTranslationMemory, clearTranslationMemory, getTranslationMemoryStats,
} from '../translationMemory';
import type { TranslationField } from '../../types/card';

const field = (original: string, translated: string, path = 'p'): TranslationField => ({
  path, label: path, group: 'core', original, translated, status: 'done', retries: 0,
} as unknown as TranslationField);

/** Hai đoạn GIỐNG HỆT 200 ký tự đầu nhưng khác phần sau — ca sinh ra hash trùng ở bản cũ. */
const COMMON_PREFIX = 'Đây là khối quy tắc chung mà nhiều entry đều mở đầu bằng nó. '.repeat(5);
const textA = COMMON_PREFIX + 'PHẦN RIÊNG CỦA A: nhân vật A sống ở phương bắc.';
const textB = COMMON_PREFIX + 'PHẦN RIÊNG CỦA B: nhân vật B sống ở phương nam.';

describe('(bug 164 · HM6-A) băm toàn văn, không khớp theo tiền tố', () => {
  beforeEach(async () => { getDelayMs = 0; await clearTranslationMemory(); });

  it('hai đoạn giống 200 ký tự đầu KHÔNG được coi là một', async () => {
    expect(textA.slice(0, 200), 'tiền đề của bài test').toBe(textB.slice(0, 200));

    await storeTranslation(field(textA, 'BẢN DỊCH CỦA A'), 'card1');
    const hits = await lookupTranslationMemory(field(textB, ''));
    const exact = hits.filter((h) => h.similarity === 1.0);
    expect(exact, 'B không được nhận bản dịch của A như thể trùng khớp tuyệt đối').toEqual([]);
  });

  it('đúng cùng một đoạn thì vẫn khớp tuyệt đối (không siết quá tay)', async () => {
    await storeTranslation(field(textA, 'BẢN DỊCH CỦA A'), 'card1');
    const hits = await lookupTranslationMemory(field(textA, ''));
    expect(hits.some((h) => h.similarity === 1.0 && h.translatedExcerpt.includes('CỦA A'))).toBe(true);
  });

  it('khác nhau chỉ ở ĐỘ DÀI cũng phân biệt được', async () => {
    await storeTranslation(field(textA, 'DỊCH A'), 'c');
    const hits = await lookupTranslationMemory(field(textA + ' thêm một câu nữa.', ''));
    expect(hits.filter((h) => h.similarity === 1.0)).toEqual([]);
  });
});

describe('(bug 164 · HM6-B) ghi song song không được mất bản ghi', () => {
  beforeEach(async () => { getDelayMs = 0; await clearTranslationMemory(); });

  it('20 lượt ghi đồng thời từ cache TRỐNG → còn đủ 20', async () => {
    // Độ trễ IDB.get là điều kiện tái hiện: bản cũ để mỗi lượt tự nạp một mảng riêng rồi ghi đè nhau.
    getDelayMs = 5;
    const writes = Array.from({ length: 20 }, (_, i) =>
      storeTranslation(field(`Nội dung nguồn số ${i} `.repeat(3), `bản dịch ${i}`, `p${i}`), 'card'));
    await Promise.all(writes);
    const stats = await getTranslationMemoryStats();
    expect(stats.totalEntries, 'ghi song song bị mất bản ghi').toBe(20);
  });

  it('mỗi bản ghi vẫn tra lại đúng bản dịch của nó', async () => {
    getDelayMs = 3;
    await Promise.all([0, 1, 2].map((i) =>
      storeTranslation(field(`Đoạn nguồn riêng biệt số ${i} `.repeat(3), `dịch-${i}`, `p${i}`), 'card')));
    for (const i of [0, 1, 2]) {
      const hits = await lookupTranslationMemory(field(`Đoạn nguồn riêng biệt số ${i} `.repeat(3), ''));
      expect(hits.some((h) => h.similarity === 1.0 && h.translatedExcerpt === `dịch-${i}`), `mất bản ${i}`).toBe(true);
    }
  });

  it('xoá TM giữa lúc đang nạp thì không bị dữ liệu cũ ghi đè lại', async () => {
    await storeTranslation(field('Một đoạn nguồn đủ dài để được lưu vào TM.', 'X'), 'c');
    getDelayMs = 20;
    const reading = getTranslationMemoryStats();   // bắt đầu nạp, sẽ chờ 20ms
    await clearTranslationMemory();                 // xoá NGAY trong lúc chờ
    await reading;
    const after = await getTranslationMemoryStats();
    expect(after.totalEntries, 'lượt nạp đang bay đã hoàn tác việc xoá').toBe(0);
  });
});
