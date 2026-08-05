/**
 * (bug 213 — Đợt 4: HIỆU NĂNG)
 *
 * Bốn đường nghẽn main thread + một đường bão re-render. Điểm chung: các bản vá trước đã cắt SỐ
 * LẦN chạy nhưng không cắt CHI PHÍ mỗi lần, hoặc sửa từng component bị báo lỗi thay vì quét sạch
 * cả pattern.
 *
 *  · chunking: mỗi lần dò ranh giới lại `slice(0, pos)` rồi regex quét TOÀN BỘ tiền tố.
 *  · enforceInitvarCovariance: mỗi khoá lệch dict = một lượt Levenshtein quét trọn từ điển.
 *  · nameGlossary: khử cụm con O(n²) chạy TRƯỚC khi cắt trần số ứng viên.
 *  · useStore() trần: subscribe toàn store, và nếu nằm trong component memo() thì vô hiệu luôn memo.
 *  · từ điển tên entry EJS ghi theo TỪNG FIELD vào object translationConfig mà 19 chỗ đang subscribe.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { chunkText } from '../chunking';
import { buildMarkerIndex, countMarkersBefore, markerIndexFor } from '../chunking';
import { extractNameCandidates } from '../nameGlossary';
import { enforceInitvarCovariance } from '../mvuSync';

/* ═══════ chỉ mục mốc — đúng trước, rồi mới nhanh ═══════ */

describe('chỉ mục mốc thay cho quét lại tiền tố', () => {
  it('đếm mốc trước vị trí khớp CHÍNH XÁC cách đếm cũ', () => {
    const text = 'a<%x%>b```c<script>d</script>e<%y%>f```g<style>h</style>';
    const idx = buildMarkerIndex(text);
    for (let pos = 0; pos <= text.length; pos++) {
      const before = text.slice(0, pos);
      expect(countMarkersBefore(idx.ejsOpen, pos)).toBe((before.match(/<%/g) || []).length);
      expect(countMarkersBefore(idx.ejsClose, pos)).toBe((before.match(/%>/g) || []).length);
      expect(countMarkersBefore(idx.fence, pos)).toBe((before.match(/```/g) || []).length);
      expect(countMarkersBefore(idx.scriptOpen, pos)).toBe((before.match(/<script[\s>]/gi) || []).length);
      expect(countMarkersBefore(idx.scriptClose, pos)).toBe((before.match(/<\/script>/gi) || []).length);
      expect(countMarkersBefore(idx.styleOpen, pos)).toBe((before.match(/<style[\s>]/gi) || []).length);
      expect(countMarkersBefore(idx.styleClose, pos)).toBe((before.match(/<\/style>/gi) || []).length);
    }
  });

  it('văn bản rỗng / không có mốc nào vẫn đúng', () => {
    const idx = buildMarkerIndex('');
    expect(countMarkersBefore(idx.ejsOpen, 0)).toBe(0);
    expect(countMarkersBefore(buildMarkerIndex('không có gì').fence, 5)).toBe(0);
  });

  it('cache dùng lại đúng chỉ mục cho cùng một chuỗi', () => {
    const t = 'x<%a%>y';
    expect(markerIndexFor(t)).toBe(markerIndexFor(t));
  });

  it('chunk field code lớn xong nhanh và GHÉP LẠI ĐÚNG nguyên văn', () => {
    // Dựng field code 150K ký tự nhiều thẻ EJS/script — đúng dạng từng làm nghẽn 1.123ms/field.
    const block = [
      '<script>',
      'function tinh(x) { return x * 2; }',
      '</script>',
      '<% if (getvar("Hảo Cảm") > 5) { %>',
      '  <div class="box">Nội dung dài dòng để nở kích thước lên cho giống thật.</div>',
      '<% } %>',
      'Một đoạn văn xuôi bình thường, có dấu chấm. Và câu nữa.',
      '',
    ].join('\n');
    const text = block.repeat(900);
    expect(text.length).toBeGreaterThan(150_000);

    const t0 = Date.now();
    const chunks = chunkText(text, 20_000);
    const ms = Date.now() - t0;

    expect(chunks.join('')).toBe(text);   // bất biến quan trọng nhất: không mất/thêm ký tự
    expect(chunks.length).toBeGreaterThan(1);
    expect(ms).toBeLessThan(3000);
  });
});

/* ═══════ memo cho covariance ═══════ */

describe('enforceInitvarCovariance — memo findClosestDictValue', () => {
  it('memo không đổi kết quả: khoá lệch dạng vẫn được ép về đúng tên từ điển', () => {
    const dict = { '好感度': 'Hảo Cảm', '魔力值': 'Ma Lực' };
    const out = enforceInitvarCovariance('hảo_cảm: 10\n', dict, false);
    expect(out.text).toContain('Hảo Cảm');
    expect(out.fixes).toEqual([{ found: 'hảo_cảm', replaced: 'Hảo Cảm' }]);
  });

  it('khoá lặp lại nhiều lần cho ra cùng một kết quả (cache đúng theo khoá)', () => {
    const dict = { '好感度': 'Hảo Cảm' };
    const many = Array.from({ length: 50 }, () => '  hảo_cảm: 1').join('\n');
    const out = enforceInitvarCovariance(many, dict, false);
    expect(out.text.split('Hảo Cảm').length - 1).toBe(50);
  });

  it('initvar nghìn dòng + dict vài trăm mục vẫn xong nhanh', () => {
    const dict: Record<string, string> = {};
    for (let i = 0; i < 300; i++) dict[`原始变量${i}`] = `Biến Số ${i}`;
    // Khoá lặp đi lặp lại (map lồng dùng chung bộ khoá) — đúng ca memo phát huy.
    const lines: string[] = [];
    for (let i = 0; i < 1200; i++) lines.push(`  biến số ${i % 40}: ${i}`);
    const text = lines.join('\n');

    const t0 = Date.now();
    enforceInitvarCovariance(text, dict, false);
    expect(Date.now() - t0).toBeLessThan(4000);
  });
});

/* ═══════ nameGlossary — khử cụm con không còn O(n²) ═══════ */

describe('extractNameCandidates — khử cụm con bằng chỉ mục ngược', () => {
  const mkField = (original: string) => ([{
    path: 'data.description', label: 'description', group: 'core',
    original, translated: '', status: 'pending',
  }] as unknown as Parameters<typeof extractNameCandidates>[0]);

  it('giữ nguyên luật: cụm ngắn bị nuốt khi nằm trong cụm dài có tần suất tương đương', () => {
    // 青云宗 xuất hiện riêng rất nhiều → giữ; 云宗弟 chỉ sống trong 青云宗弟子 → loại.
    const corpus = '青云宗弟子来了。'.repeat(10) + '青云宗很强大。'.repeat(30);
    const terms = extractNameCandidates(mkField(corpus), { minCount: 3, maxCandidates: 60 }).map(c => c.term);
    expect(terms).toContain('青云宗');
    expect(terms).not.toContain('云宗弟');
  });

  it('corpus lớn không còn đứng hình ở Pha 0', () => {
    const names = ['青云宗', '天玄门', '紫霄殿', '万法阁', '归元境', '筑基期'];
    let corpus = '';
    for (let i = 0; i < 9000; i++) corpus += `${names[i % names.length]}弟子在${names[(i + 1) % names.length]}修炼。`;
    expect(corpus.length).toBeGreaterThan(100_000);

    const t0 = Date.now();
    const out = extractNameCandidates(mkField(corpus), { minCount: 3, maxCandidates: 60 });
    const ms = Date.now() - t0;

    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThanOrEqual(60);
    expect(ms).toBeLessThan(5000);
  });
});

/* ═══════ quét sạch pattern useStore() trần ═══════ */

describe('không còn component nào subscribe TOÀN store', () => {
  const FILES = [
    'components/AiCompanionPanel.tsx', 'components/RegexManagerPanel.tsx',
    'components/TranslationProgress.tsx', 'components/CardRenamePanel.tsx',
    'components/EjsCreatorPanel.tsx', 'components/HeavyScriptMode.tsx',
    'components/PresetPromptViewer.tsx', 'components/ProviderPoolConfig.tsx',
    'components/RAGDebugPanel.tsx', 'components/StPreviewModal.tsx',
    'hooks/useCardParser.ts', 'hooks/usePresetApply.ts',
  ];

  it('không file nào còn `= useStore();` (destructure trần)', () => {
    for (const f of FILES) {
      const src = readFileSync(new URL(`../../${f}`, import.meta.url), 'utf-8');
      expect(`${f}: ${/= useStore\(\);/.test(src)}`).toBe(`${f}: false`);
    }
  });

  it('không còn `useStore()` gọi thẳng trong JSX (phá throttle của chính component)', () => {
    const src = readFileSync(new URL('../../components/TranslationProgress.tsx', import.meta.url), 'utf-8');
    expect(src).not.toMatch(/\{useStore\(\)\./);
  });

  it('component bọc memo() phải subscribe bằng selector, không thì memo vô nghĩa', () => {
    const src = readFileSync(new URL('../../components/AiCompanionPanel.tsx', import.meta.url), 'utf-8');
    const codeSection = src.slice(src.indexOf('const CodeSection = memo('), src.indexOf('const CodeSection = memo(') + 1500);
    expect(codeSection).toMatch(/useStore\(\(s\) => s\.card\)/);
    expect(codeSection).not.toMatch(/= useStore\(\);/);
  });

  it('panel Trợ Lý AI không ôm `fields` (đọc tươi trong callback thay vì subscribe)', () => {
    const src = readFileSync(new URL('../../components/AiCompanionPanel.tsx', import.meta.url), 'utf-8');
    expect(src).toMatch(/useStore\.getState\(\)\.fields \|\| \[\]/);
    expect(src).toMatch(/\}, \[card, attachedFiles\]\);/);
  });
});

/* ═══════ từ điển nóng không còn ghi theo từng field ═══════ */

describe('từ điển tên entry EJS — gom rồi ghi một lần', () => {
  const src = readFileSync(new URL('../../hooks/useTranslation.ts', import.meta.url), 'utf-8');

  it('hai đường (single-field + batch) đều đi qua hàng đợi', () => {
    expect((src.match(/queueEjsNameMapping\(trimOrig, trimTrans\)/g) || []).length).toBe(2);
  });

  it('không còn ghi thẳng setTranslationConfig cho từng entry name', () => {
    expect(src).not.toMatch(/store\.setTranslationConfig\(\{ ejsEntryNameDict: updatedEjsDict \}\)/);
  });

  it('có ngưỡng gom và có flush chốt cuối lượt dịch', () => {
    expect(src).toMatch(/EJS_NAME_FLUSH_AT = 8/);
    expect(src).toMatch(/flushEjsNameMappings\(\);\s+\/\/ \(bug 213\)/);
  });

  it('hàng đợi không bao giờ ghi đè cặp đã có trong từ điển', () => {
    expect(src).toMatch(/if \(orig in fresh \|\| orig in pendingEjsNames\.current\) return;/);
    expect(src).toMatch(/if \(!\(o in merged\)\) \{ merged\[o\] = t; added\+\+; \}/);
  });
});
