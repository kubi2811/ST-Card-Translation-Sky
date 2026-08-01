/**
 * (bugNeedFix/183) "song song sẽ dễ dẫn tới tình trạng một nhân vật lại có tới 7-8 entry
 * lorebook y hệt nhau" — nút 1 luồng phải khoá được MỌI công cụ sinh.
 *
 * Van nằm ở computePoolConcurrency vì mọi đường song song (storyToCard, storyDeepScan,
 * documentChunker, batchGenerator, lorebookRefiner, wikiImport) đều hỏi số luồng qua đó.
 * Test giữ hai điều: (1) bật là ra đúng 1 bất kể ngân sách RPM; (2) không caller nào
 * đi cửa sau tự tính số luồng.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  computePoolConcurrency, isSingleThreadMode, setSingleThreadMode, onSingleThreadChange,
} from '../client';
import type { ProxyProfile } from '../../../types';

const profile = (over: Partial<ProxyProfile> = {}): ProxyProfile => ({
  id: 'p1', label: 'test', providerType: 'openai', baseUrl: 'https://x.test/v1',
  apiKey: 'k1\nk2\nk3', customHeaders: [], selectedModel: 'm', cachedModels: [],
  cachedModelsAt: null, supportsNativeToolCalling: null,
  primaryRpm: 10, ...over,
} as ProxyProfile);

afterEach(() => setSingleThreadMode(false));

describe('chế độ 1 luồng (bug 183)', () => {
  it('mặc định TẮT: số luồng theo ngân sách RPM (3 key × 10 RPM = 30)', () => {
    setSingleThreadMode(false);
    expect(computePoolConcurrency(profile())).toBe(30);
  });

  it('BẬT là 1 luồng, bất kể pool giàu tới đâu', () => {
    setSingleThreadMode(true);
    expect(isSingleThreadMode()).toBe(true);
    expect(computePoolConcurrency(profile())).toBe(1);
    expect(computePoolConcurrency(profile({ primaryRpm: 100, enableSecondaryModel: true, secondaryRpm: 100 }))).toBe(1);
  });

  it('nhiều panel cùng hiện toggle: đổi ở một nơi, nơi khác được báo', () => {
    const seen: boolean[] = [];
    const off = onSingleThreadChange(v => seen.push(v));
    setSingleThreadMode(true);
    setSingleThreadMode(false);
    off();
    setSingleThreadMode(true);   // đã unsubscribe — không được ghi thêm
    expect(seen).toEqual([true, false]);
  });
});

describe('không caller nào đi cửa sau', () => {
  // Đường song song mới thêm vào sau này mà tự bịa số luồng là toggle thành trang trí.
  // Mọi runPool(...) ngoài chỗ định nghĩa phải lấy limit bắt nguồn từ computePoolConcurrency.
  const read = (rel: string) =>
    readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

  it.each(['storyToCard.ts', 'storyDeepScan.ts', 'documentChunker.ts', 'lorebookRefiner.ts'])(
    '%s lấy số luồng từ computePoolConcurrency', (f) => {
      expect(read(f)).toContain('computePoolConcurrency');
    },
  );
});
