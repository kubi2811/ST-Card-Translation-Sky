/**
 * (bug 215) Auto Creator — ba yêu cầu của user:
 *   1. "phần auto ở các bước cần cho chỉnh chi tiết hơn cũng như không hạn chế max là bao nhiêu
 *      giống hiện tại" → mọi tham số phải gõ được số tuỳ ý, không bị thanh trượt chặn.
 *   2. "game ui và regex có thể hợp lại thành một" → một thẻ cấu hình, một dòng tiến trình.
 *   3. "lorebook thì cho chỉnh mỗi entries bao nhiêu token" → ngân sách token mỗi entry.
 *
 * Cạm bẫy quan trọng nhất khi thêm field vào stepConfig: `applyPreset` THAY NGUYÊN object của
 * từng bước, nên preset nào thiếu field mới là field đó BIẾN MẤT ngay khi user bấm preset.
 * Test dưới đây khoá đúng cái bẫy đó lại.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { AUTO_CREATOR_PRESETS } from '../autoCreatorPresets';
import { STEP_DEPS } from '../autoCreatorPipeline';

const pageSrc = readFileSync(new URL('../../../pages/AutoCreatorPage.tsx', import.meta.url), 'utf-8');
const storeSrc = readFileSync(new URL('../../../store/autoCreatorStore.ts', import.meta.url), 'utf-8');
const pipelineSrc = readFileSync(new URL('../autoCreatorPipeline.ts', import.meta.url), 'utf-8');

/* ═══════ 3. Ngân sách token mỗi entry ═══════ */

describe('tokensPerEntry — chỉnh được số token mỗi entry lorebook', () => {
  it('có mặt trong mặc định của store', () => {
    expect(storeSrc).toMatch(/lorebook: \{ totalEntries: 20, minEntries: 0, tokensPerEntry: 0,/);
  });

  it('MỌI preset CÓ ĐỊNH NGHĨA lorebook đều phải kèm field này', () => {
    // applyPreset thay NGUYÊN object stepConfigs của từng bước, nên preset nào định nghĩa
    // `lorebook` mà thiếu field mới là bấm preset xong field đó biến mất.
    // (Preset Minh Nguyệt không có stepConfigs — spread bỏ qua, không ảnh hưởng.)
    const withLorebook = AUTO_CREATOR_PRESETS.filter(p => p.config.stepConfigs?.lorebook);
    expect(withLorebook.length).toBeGreaterThan(0);
    for (const p of withLorebook) {
      const lb = p.config.stepConfigs!.lorebook as { tokensPerEntry?: number };
      expect(`${p.id}: ${typeof lb.tokensPerEntry}`).toBe(`${p.id}: number`);
    }
  });

  it('được TRUYỀN XUỐNG engine sinh batch (trước đây engine có nhận, pipeline không gửi)', () => {
    expect(pipelineSrc).toMatch(/tokensPerEntry: lbConfig\.tokensPerEntry \?\? 0,/);
  });

  it('có ô chỉnh trên UI, kèm gợi ý khoảng dùng', () => {
    expect(pageSrc).toMatch(/label="Token mỗi entry \(0 = để AI tự quyết\)"/);
    expect(pageSrc).toMatch(/tokensPerEntry: v/);
    expect(pageSrc).toMatch(/150–400.*800–1500/s);
  });

  it('0 = không ràng buộc (giữ nguyên hành vi cũ)', () => {
    // Engine coi 0 là "không giới hạn" — xem BatchGenConfig.tokensPerEntry.
    const batchSrc = readFileSync(new URL('../batchGenerator.ts', import.meta.url), 'utf-8');
    expect(batchSrc).toMatch(/tokensPerEntry\?: number;\s*\/\/ Số token mục tiêu cho mỗi entry \(0 = không giới hạn\)/);
    expect(batchSrc).toMatch(/if \(config\.tokensPerEntry && config\.tokensPerEntry > 0\)/);
  });
});

/* ═══════ 1. Bỏ trần cứng ═══════ */

describe('không còn trần cứng — gõ được số tuỳ ý', () => {
  it('SliderControl có ô nhập tay bên cạnh thanh trượt', () => {
    expect(pageSrc).toMatch(/type="number"[\s\S]{0,400}Gõ thẳng số bạn muốn/);
  });

  it('thanh trượt tự nới trần khi giá trị vượt khoảng khuyến nghị', () => {
    expect(pageSrc).toMatch(/const sliderMax = Math\.max\(max, value\)/);
  });

  it('vẫn có trần AN TOÀN để gõ nhầm không treo máy', () => {
    expect(pageSrc).toMatch(/hardMax = 100_000/);
    expect(pageSrc).toMatch(/Math\.max\(min, Math\.min\(hardMax, Math\.round\(raw\)\)\)/);
  });

  it('pipeline bỏ trần 100 entry, giữ trần an toàn rất rộng', () => {
    expect(pipelineSrc).not.toMatch(/Math\.min\(100, Math\.max\(lbConfig\.totalEntries/);
    expect(pipelineSrc).toMatch(/Math\.min\(2000, Math\.max\(lbConfig\.totalEntries/);
  });

  it('các tham số từng bị chặn thấp nay đều có hardMax rộng hơn', () => {
    const expected: [string, string][] = [
      ['totalEntries', 'hardMax={2000}'],
      ['entriesPerBatch', 'hardMax={50}'],
      ['concurrentBatches', 'hardMax={24}'],
      ['tokensPerEntry', 'hardMax={20000}'],
    ];
    for (const [name, want] of expected) {
      // SliderControl có cái viết một dòng, có cái xuống nhiều dòng → soi cả khối quanh tên field.
      const at = pageSrc.indexOf(name);
      expect(`${name} có mặt: ${at > -1}`).toBe(`${name} có mặt: true`);
      const block = pageSrc.slice(Math.max(0, at - 400), at + 600);
      expect(`${name}: ${block.includes(want)}`).toBe(`${name}: true`);
    }
  });

  it('Depth prompt hết bị chặn ở 10', () => {
    expect(pageSrc).not.toMatch(/min="0" max="10"[\s\S]{0,80}depthValue/);
    expect(pageSrc).toMatch(/không còn bị chặn ở 10/);
  });

  it('"Áp dụng vào Auto Creator" của panel Batch không bóp số user nữa', () => {
    const bgSrc = readFileSync(new URL('../../../components/lorebook/BatchGeneratorPanel.tsx', import.meta.url), 'utf-8');
    expect(bgSrc).toMatch(/const total = clamp\(totalEntries, 1, 2000\)/);
    expect(bgSrc).toMatch(/tokensPerEntry: clamp\(tokensPerEntry \?\? 0, 0, 20000\)/);
    expect(bgSrc).not.toMatch(/clamp\(totalEntries, 5, 100\)/);
  });
});

/* ═══════ 2. Gộp Game UI + Regex ═══════ */

describe('gộp Game UI + Regex thành MỘT ở lớp trình bày', () => {
  it('khai báo cụm gộp rõ ràng', () => {
    expect(pageSrc).toMatch(/const MERGED_STEPS: Partial<Record<AutoCreatorStep, AutoCreatorStep\[\]>> = \{\s*game_ui: \['regex'\],/);
    expect(pageSrc).toMatch(/const MERGED_CHILDREN = new Set<AutoCreatorStep>/);
  });

  it('bước con KHÔNG có thẻ cấu hình riêng', () => {
    expect(pageSrc).toMatch(/if \(MERGED_CHILDREN\.has\(step\)\) return null;/);
  });

  it('bước con KHÔNG có dòng tiến trình riêng', () => {
    expect(pageSrc).toMatch(/selectedSteps\.filter\(s => !MERGED_CHILDREN\.has\(s\)\)\.map/);
  });

  it('tick một lần áp cho cả cụm', () => {
    expect(pageSrc).toMatch(/const toggleGroup = \(\) => \{[\s\S]{0,300}for \(const s of group\)/);
    expect(pageSrc).toMatch(/onClick=\{toggleGroup\}/);
  });

  it('trạng thái cụm: lỗi thắng, xong hết mới là xong', () => {
    expect(pageSrc).toMatch(/groupStatuses\.includes\('error'\) \? 'error'/);
    expect(pageSrc).toMatch(/groupStatuses\.every\(st => st === 'done'\) \? 'done'/);
  });

  it('thẻ gộp có nhãn mới và chứa CẢ hai phần cấu hình', () => {
    expect(pageSrc).toMatch(/label: 'Giao diện & Regex'/);
    const block = pageSrc.slice(pageSrc.indexOf("{step === 'game_ui' && ("), pageSrc.indexOf("{step === 'final_check'"));
    expect(block).toContain('acGameUiComponent');   // phần giao diện
    expect(block).toContain('acRegexCount');        // phần regex
  });

  it('KHÔNG đụng pipeline: hai bước vẫn độc lập và giữ nguyên phụ thuộc', () => {
    // Gộp chỉ ở lớp trình bày — DAG, thứ tự chạy, config đã lưu của user đều còn nguyên.
    expect(STEP_DEPS.game_ui).toEqual(['mvuzod']);
    expect(STEP_DEPS.regex).toEqual(['mvuzod']);
    expect(STEP_DEPS.final_check).toContain('game_ui');
    expect(STEP_DEPS.final_check).toContain('regex');
  });

  it('cả hai bước vẫn tồn tại trong ALL_STEPS (không xoá = không vỡ dữ liệu đã lưu)', () => {
    expect(storeSrc).toMatch(/'mvuzod', 'game_ui', 'regex'/);
  });
});
