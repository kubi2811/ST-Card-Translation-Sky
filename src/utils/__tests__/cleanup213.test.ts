/**
 * (bug 213 — Đợt 5: DỌN DẸP + UI/UX)
 *
 *  · reset cấu hình đẩy user về đúng chế độ chậm mà Audit đã cố loại, và sót 8 key persist nên
 *    F5 là setting "hồi sinh" — UI hiện một đằng, hành vi thật một nẻo.
 *  · entryType 'json_patch' được kiểm ở 8+ nơi nhưng KHÔNG THỂ được gán: alias kiểu cục bộ thiếu
 *    hẳn nó ⇒ chốt bug 128 chưa từng chạy lần nào.
 *  · hasEjsBlocks dùng .test() trên regex /g — bẫy lastIndex mà chính file đó đã cảnh báo chỗ khác.
 *  · rate limiter: ngủ dậy push thẳng không kiểm lại ⇒ hàng chục luồng cùng dậy cùng push ⇒ burst 429.
 *  · popup hướng dẫn tái phát bug 143; timer "Đã chạy" nhảy số sau khi đã xong; chưa có key vẫn
 *    bắn request rồi "🎉 Dịch xong: 0 thành công".
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { isJsonPatchContent } from '../cardFields';
import { hasEjsBlocks } from '../chunkDoctor';

const storeSrc = readFileSync(new URL('../../store.ts', import.meta.url), 'utf-8');
const hookSrc = readFileSync(new URL('../../hooks/useTranslation.ts', import.meta.url), 'utf-8');
const apiSrc = readFileSync(new URL('../apiClient.ts', import.meta.url), 'utf-8');

/* ═══════ reset cấu hình ═══════ */

describe('resetTranslationConfig — "về như ban đầu" phải ĐÚNG là ban đầu', () => {
  // Neo vào PHẦN CÀI ĐẶT (`() => {`), không phải dòng khai báo kiểu (`() => void;`).
  const implAt = storeSrc.indexOf('resetTranslationConfig: () => {');
  const initBlock = storeSrc.slice(0, implAt);
  const resetBlock = storeSrc.slice(implAt);

  it('lorebookStrategy: reset khớp default khởi tạo (batch, không phải single)', () => {
    expect(initBlock).toMatch(/lorebookStrategy: LS\.get\('st-translator-lorebook-strategy', 'batch'\)/);
    expect(resetBlock).toMatch(/lorebookStrategy: 'batch' as const/);
    expect(resetBlock).not.toMatch(/lorebookStrategy: 'single' as const/);
  });

  it('enableMvuSync: reset khớp default khởi tạo (true)', () => {
    expect(initBlock).toMatch(/enableMvuSync: LS\.get\('st-translator-mvu-sync-enabled', true\)/);
    expect(resetBlock).toMatch(/enableMvuSync: true,/);
  });

  it('KHÔNG còn key nào đọc lúc khởi tạo mà reset quên ghi lại (F5 hồi sinh)', () => {
    const lines = storeSrc.split('\n');
    const start = lines.findIndex(l => /resetTranslationConfig:\s*\(\)\s*=>\s*\{/.test(l));
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      if (/^\s{4}set\(\(s\) => \{/.test(lines[i])) { end = i; break; }
    }
    const written = new Set<string>();
    for (let i = start; i < end; i++) {
      for (const m of lines[i].matchAll(/LS\.set\('([^']+)'/g)) written.add(m[1]);
    }
    const read = new Set<string>();
    for (let i = 0; i < start; i++) {
      for (const m of lines[i].matchAll(/LS\.get\('([^']+)'/g)) read.add(m[1]);
    }
    // Nhóm cấu hình API cố ý nằm ngoài phạm vi "đặt lại cấu hình DỊCH".
    const apiScope = /provider|proxy-url|api-key|-model$|advanced-settings|cors-proxy|use-stream|scanned-models|preset-active/;
    const missing = [...read].filter(k => !written.has(k) && !apiScope.test(k));
    expect(missing).toEqual([]);
  });
});

/* ═══════ json_patch — tính năng viết một nửa, nay nối xong dây ═══════ */

describe('isJsonPatchContent — nhận diện CHẶT, không kéo nhầm văn xuôi', () => {
  it('mảng JSON Patch chuẩn → đúng', () => {
    expect(isJsonPatchContent('[{"op":"add","path":"/a","value":1}]')).toBe(true);
    expect(isJsonPatchContent('  [ {"op": "replace", "path": "/x/y", "value": "z"} ]  ')).toBe(true);
  });

  it('một object patch đơn lẻ cũng tính', () => {
    expect(isJsonPatchContent('{"op":"remove","path":"/a"}')).toBe(true);
  });

  it('văn xuôi / YAML / JS KHÔNG bị nhận nhầm', () => {
    expect(isJsonPatchContent('Cô ấy nói: "op" là viết tắt của operation, "path" là đường dẫn.')).toBe(false);
    expect(isJsonPatchContent('好感度: 10\n魔力值: 5')).toBe(false);
    expect(isJsonPatchContent('function f(){ return {op:1, path:2}; }')).toBe(false);
    expect(isJsonPatchContent('')).toBe(false);
  });

  it('JSON hợp lệ nhưng KHÔNG phải patch → không nhận', () => {
    expect(isJsonPatchContent('[{"name":"a"},{"name":"b"}]')).toBe(false);
    expect(isJsonPatchContent('[]')).toBe(false);
    expect(isJsonPatchContent('[{"op":"add"}]')).toBe(false);          // thiếu path
    expect(isJsonPatchContent('[{"op":1,"path":"/a"}]')).toBe(false);  // op không phải chuỗi
  });

  it('JSON vỡ cú pháp → false, không ném', () => {
    expect(() => isJsonPatchContent('[{"op":"add","path":')).not.toThrow();
    expect(isJsonPatchContent('[{"op":"add","path":')).toBe(false);
  });

  it('alias kiểu ở CẢ HAI nơi đều có json_patch (lý do gốc khiến chốt bug 128 chết)', () => {
    for (const f of ['../cardFields.ts', '../../workers/cardParser.worker.ts']) {
      const src = readFileSync(new URL(f, import.meta.url), 'utf-8');
      expect(`${f}: ${/type LorebookEntryType =[^;]*'json_patch'/.test(src)}`).toBe(`${f}: true`);
      expect(`${f}: ${/if \(isJsonPatchContent\(content\)\) return 'json_patch';/.test(src)}`).toBe(`${f}: true`);
    }
  });
});

/* ═══════ hasEjsBlocks — bẫy lastIndex ═══════ */

describe('hasEjsBlocks — .test() không được dùng regex có cờ /g', () => {
  it('gọi NHIỀU LẦN liên tiếp vẫn trả kết quả ĐÚNG (bẫy lastIndex)', () => {
    const s = 'nội dung dài dòng rồi mới tới {{__ejs_5__}}';
    // Bản cũ: lần 1 true (lastIndex nhảy về cuối), lần 2 false — chunk mất kiểm toàn vẹn EJS.
    for (let i = 0; i < 5; i++) expect(hasEjsBlocks(s)).toBe(true);
  });

  it('nhiều chuỗi khác nhau xen kẽ vẫn đúng', () => {
    expect(hasEjsBlocks('{{__ejs_1__}}')).toBe(true);
    expect(hasEjsBlocks('không có gì')).toBe(false);
    expect(hasEjsBlocks('{{__ejs_2__}}')).toBe(true);
    expect(hasEjsBlocks('vẫn không có')).toBe(false);
    expect(hasEjsBlocks('<% code %>')).toBe(true);
  });

  it('bản dùng cho .match() vẫn giữ /g (cần bắt HẾT token)', () => {
    const src = readFileSync(new URL('../chunkDoctor.ts', import.meta.url), 'utf-8');
    expect(src).toMatch(/const EJS_TOKEN_TEST_RE = \/\\\{\\\{__ejs_\\d\+__\\\}\\\}\/;/);
    expect(src).toMatch(/const EJS_TOKEN_RE = \/\\\{\\\{__ejs_\\d\+__\\\}\\\}\/g;/);
  });
});

/* ═══════ rate limiter ═══════ */

describe('waitForRateLimitModel — hết thundering herd', () => {
  it('ngủ dậy phải KIỂM LẠI còn chỗ không, không push thẳng', () => {
    expect(apiSrc).toMatch(/for \(let attempt = 0; attempt < 60; attempt\+\+\) \{[\s\S]{0,400}if \(bucket\.length < rpm\) \{[\s\S]{0,80}bucket\.push\(now\);[\s\S]{0,40}return;/);
  });

  it('có jitter để các luồng không dậy cùng một mili-giây', () => {
    expect(apiSrc).toMatch(/const jitter = Math\.floor\(Math\.random\(\) \* 120\)/);
  });

  it('có trần vòng lặp — không bao giờ kẹt vĩnh viễn', () => {
    expect(apiSrc).toMatch(/Chạm trần vòng lặp/);
  });
});

/* ═══════ UI/UX ═══════ */

describe('UI/UX — các chỗ bất tiện đã nêu', () => {
  it('chưa có API key thì CHẶN TRƯỚC, không bắn request rồi mới báo lỗi', () => {
    const idxGuard = hookSrc.indexOf('CHẶN TRƯỚC KHI BẮN REQUEST');
    const idxPrepare = hookSrc.indexOf('const allFields = prepareFields(continueMode, freshStart)');
    expect(idxGuard).toBeGreaterThan(-1);
    expect(idxPrepare).toBeGreaterThan(idxGuard);   // guard đứng TRƯỚC mọi việc khác
    expect(hookSrc).toMatch(/Chưa có API key — mở mục 1/);
  });

  it('thất bại 100% không còn được "ăn mừng" bằng 🎉 và toast xanh', () => {
    expect(hookSrc).toMatch(/if \(doneCount === 0 && failCount > 0\) \{/);
    expect(hookSrc).toMatch(/store\.addToast\('error', `Không dịch được mục nào/);
  });

  it('đồng hồ "Đã chạy" đóng băng ở mốc kết thúc thật', () => {
    const tp = readFileSync(new URL('../../components/TranslationProgress.tsx', import.meta.url), 'utf-8');
    expect(tp).toMatch(/\(\(endTime \?\? Date\.now\(\)\) - startTime\)/);
    expect(storeSrc).toMatch(/endTime: s\.endTime \?\? Date\.now\(\)/);
    expect(storeSrc).toMatch(/setStartTime: \(t\) => set\(\{ startTime: t, endTime: null \}\)/);
  });

  it('popup hướng dẫn nhớ "đã đóng" ở STORE (thuốc của bug 143)', () => {
    const modal = readFileSync(new URL('../../components/PostTranslateGuideModal.tsx', import.meta.url), 'utf-8');
    expect(storeSrc).toMatch(/dismissTranslateGuide: \(\) => set\(\{ translateGuideSeed: 0 \}\)/);
    expect(modal).toMatch(/dismissTranslateGuide\(\);/);
  });

  it('đổi ngôn ngữ giữa lúc đang dịch phải hỏi lại trước khi reload', () => {
    const i18n = readFileSync(new URL('../../i18n/index.ts', import.meta.url), 'utf-8');
    expect(i18n).toMatch(/if \(phase === 'translating'\)/);
    expect(i18n).toMatch(/window\.confirm\(msg\)/);
    // và cả 3 ngôn ngữ đều có câu hỏi riêng
    expect(i18n).toMatch(/Đang dịch dở/);
    expect(i18n).toMatch(/正在翻译中/);
    expect(i18n).toMatch(/A translation is running/);
  });

  it('bộ lọc log không còn hứa hẹn "đang chạy" cho log lịch sử', () => {
    for (const [loc, want] of [['vi', 'Đã bắt đầu'], ['en', 'Started'], ['zh', '已开始']] as const) {
      const src = readFileSync(new URL(`../../i18n/locales/${loc}.ts`, import.meta.url), 'utf-8');
      expect(`${loc}: ${src.includes(`active: '${want}'`)}`).toBe(`${loc}: true`);
    }
  });

  it('toast khôi phục phiên đã i18n hoá (hết chen tiếng Việt vào UI EN/中文)', () => {
    const app = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf-8');
    expect(app).toMatch(/fmt\(ui\.appRestoredSession, \{ key \}\)/);
    for (const loc of ['en', 'vi', 'zh']) {
      const src = readFileSync(new URL(`../../i18n/ui/${loc}.ts`, import.meta.url), 'utf-8');
      expect(`${loc}: ${src.includes('appRestoredSession:')}`).toBe(`${loc}: true`);
    }
  });

  it('nhãn bộ nhớ đệm trong bản Việt đã là tiếng Việt', () => {
    const vi = readFileSync(new URL('../../i18n/ui/vi.ts', import.meta.url), 'utf-8');
    expect(vi).toMatch(/tcCacheTitle: 'Bộ nhớ đệm bản dịch'/);
    expect(vi).toMatch(/tcSettingsMgmt: 'Quản lý cấu hình'/);
    expect(vi).not.toMatch(/tcCacheResetBtn: 'Reset card & Clear this cache'/);
  });

  it('header API bỏ onClick rỗng (hết trông như bấm được mà không làm gì)', () => {
    const pc = readFileSync(new URL('../../components/ProxyConfig.tsx', import.meta.url), 'utf-8');
    expect(pc).not.toMatch(/className="section-header" onClick=\{\(\) => \{\}\}/);
  });

  it('hủy giữa chừng lượt dịch lại hàng loạt không in tổng kết như đã chạy trọn', () => {
    expect(hookSrc).toMatch(/Đã dừng giữa chừng theo yêu cầu/);
    expect(hookSrc).not.toMatch(/setPhase\(failCount > 0 \? 'done' : 'done'\)/);
  });
});
