/**
 * (bug 165) CHỐT CHẶN CHO ĐỢT ĐẠI TU GIAO DIỆN.
 * ─────────────────────────────────────────────────────────────────────────────
 * Bug 165 đặt ra mấy "yêu cầu kỹ thuật bắt buộc" mà nếu vi phạm thì app vẫn build, vẫn chạy, chỉ là
 * hỏng ngầm: mất cơ chế chống nghẽn HTTP/1.1, mất lệnh nhảy tới panel, hoặc hardcode chữ làm vỡ đa
 * ngôn ngữ. Không có test thì mấy thứ đó rất dễ bị đợt refactor sau xoá mất mà không ai biết.
 * Nên đây là test đọc CHÍNH mã nguồn App.tsx — thô nhưng đúng thứ cần canh.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const APP = readFileSync(resolve(__dirname, '../../../App.tsx'), 'utf-8');
const VI = readFileSync(resolve(__dirname, '../../../i18n/ui/vi.ts'), 'utf-8');
const EN = readFileSync(resolve(__dirname, '../../../i18n/ui/en.ts'), 'utf-8');
const ZH = readFileSync(resolve(__dirname, '../../../i18n/ui/zh.ts'), 'utf-8');

describe('(bug 165) giữ nguyên cơ chế lazy + warmup', () => {
  it('warmupLazyChunks vẫn còn và vẫn được gọi', () => {
    // Comment trong App.tsx giải thích rõ: đây là cơ chế chống nghẽn 6 kết nối HTTP/1.1 khi đang
    // dịch — xoá đi thì mở Regex Manager lúc đang dịch sẽ quay vô tận (bug thật đã gặp).
    expect(APP).toContain('function warmupLazyChunks');
    expect(APP).toMatch(/useEffect\(\(\)\s*=>\s*\{\s*warmupLazyChunks\(\);\s*\}/);
  });

  it('vẫn dùng lazy() cho đủ 8 panel nặng', () => {
    for (const name of ['FieldEditor', 'ExportPanel', 'VerifyPanel', 'EjsCreatorPanel',
      'RegexManagerPanel', 'AiCompanionPanel', 'PresetPromptViewer', 'CompareCardsPanel']) {
      expect(APP, `${name} không còn lazy`).toContain(`const ${name} = lazy(import${name})`);
    }
  });

  it('mỗi panel lazy trong tab vẫn được bọc Suspense', () => {
    // Số lượng Suspense phải >= số panel lazy được render; bọc thiếu là màn trắng khi chunk chưa về.
    const count = (APP.match(/<Suspense/g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(6);
  });
});

describe('(bug 165) giữ nguyên điểm neo để "nhảy tới panel" còn chạy', () => {
  it('id neo verify + export vẫn tồn tại nguyên văn', () => {
    expect(APP).toContain('id="verify-panel-anchor"');
    expect(APP).toContain('id="export-panel-anchor"');
  });

  it('App có đăng ký onPanelRequest để đổi tab trước khi cuộn', () => {
    expect(APP).toContain('onPanelRequest');
    expect(APP).toMatch(/verify-panel-anchor'\)\s*setMainTab\('verify'\)|setMainTab\('verify'\)/);
    expect(APP).toMatch(/setMainTab\('export'\)/);
  });

  it('tín hiệu nhảy tới TRƯỜNG THƯỜNG bật tab fields (FieldEditor nằm trong tab)', () => {
    expect(APP).toMatch(/setMainTab\('fields'\)/);
  });

  it('nhảy tới trường REGEX vẫn mở Regex Manager như cũ', () => {
    expect(APP).toMatch(/regex_scripts\[.*\n?.*setShowRegexManager\(true\)/);
  });
});

describe('(bug 165) không hardcode chữ — mọi nhãn mới đi qua i18n', () => {
  const keys = ['grpSetup', 'grpSetupDone', 'grpLoad', 'grpTranslate', 'grpTranslateNeedCard',
    'grpTools', 'grpToolsHint', 'tabFields', 'tabVerify', 'tabExport', 'tabGlossary'];

  for (const k of keys) {
    it(`khoá ${k} có ở cả vi/en/zh`, () => {
      expect(VI, `vi thiếu ${k}`).toContain(`${k}:`);
      expect(EN, `en thiếu ${k}`).toContain(`${k}:`);
      expect(ZH, `zh thiếu ${k}`).toContain(`${k}:`);
    });
  }

  it('nhãn nhóm/tab trong App đều lấy từ ui.*, không phải chuỗi thẳng', () => {
    for (const k of keys) expect(APP, `App không dùng ui.${k}`).toContain(`ui.${k}`);
  });
});

describe('(bug 165) dọn đúng thứ cần dọn', () => {
  it('không còn nút tự viết onMouseOver/onMouseOut trong App', () => {
    // Đây là thứ bug 165 nêu đích danh: mỗi nút copy-paste style + hover handler riêng, sửa một nút
    // là lệch các nút kia. Nay dồn hết vào ToolButton.
    expect(APP).not.toContain('onMouseOver');
    expect(APP).not.toContain('onMouseOut');
  });

  it('dùng 3 component dùng chung thay vì tự dựng lại', () => {
    expect(APP).toContain("from './components/ui/CollapsibleSection'");
    expect(APP).toContain("from './components/ui/TabGroup'");
    expect(APP).toContain("from './components/ui/ToolButton'");
  });

  it('CardPreview + TranslationProgress vẫn ở ngoài tab (nội dung mặc định)', () => {
    const tabIdx = APP.indexOf('<TabGroup');
    expect(tabIdx).toBeGreaterThan(0);
    expect(APP.indexOf('<CardPreview />'), 'CardPreview phải nằm TRƯỚC TabGroup').toBeLessThan(tabIdx);
    expect(APP.indexOf('<TranslationProgress />')).toBeLessThan(tabIdx);
  });
});
