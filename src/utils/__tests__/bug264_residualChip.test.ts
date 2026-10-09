/**
 * (bug 264) Chip lọc "Còn sót chữ Hán" ngay trên bảng Chỉnh sửa trường — khỏi phải sang tab Kiểm tra.
 * Luật đếm phải trùng bộ quét "mục chưa đạt" (scanFieldsForResidualCjk) để hai con số không lệch.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { scanFieldsForResidualCjk, countResidualHan } from '../residualCjkScan';

const FE = readFileSync(join(__dirname, '../../components/FieldEditor.tsx'), 'utf8');

describe('bug 264 — chip "Còn sót chữ Hán"', () => {
  it('có chip, có lọc, có vá nhanh / dịch lại khi quá nhiều, có nhảy entry kế', () => {
    expect(FE).toContain("{ id: 'residual', label: 'Còn sót chữ Hán'");
    expect(FE).toContain("statusFilter === 'residual' ? scopedFields.filter(f => residualCount(f) > 0)");
    expect(FE).toContain('requestResidualPatchMany(filteredFields.map(f => f.path))');
    expect(FE).toContain('if (residualTotalHan > 1000)');
    expect(FE).toContain("statusFilter === 'residual') && filteredFields.length > 1");
  });

  it('luật đếm của chip = luật của bộ quét (done/skipped, gốc có Hán, bỏ keys lorebook, link/tên file không tính)', () => {
    // chép luật residualCount trong FieldEditor
    const chip = (f: any) => (f.status !== 'done' && f.status !== 'skipped') || !f.translated || f.group === 'lorebook_keys'
      ? 0 : (countResidualHan(f.original) === 0 ? 0 : countResidualHan(f.translated));
    const fields = [
      { path: 'a', label: 'a', group: 'description', status: 'done', original: '你好世界', translated: 'Xin chào 世界' },
      { path: 'b', label: 'b', group: 'description', status: 'done', original: '你好', translated: 'Xin chào' },
      { path: 'c', label: 'c', group: 'lorebook_keys', status: 'done', original: '甲', translated: '甲' },
      { path: 'd', label: 'd', group: 'tavern_helper', status: 'done', original: '// 见 状态机.js', translated: '// xem 状态机.js' },
      { path: 'e', label: 'e', group: 'description', status: 'pending', original: '你好', translated: '' },
      { path: 'f', label: 'f', group: 'description', status: 'skipped', original: '你好', translated: '你好' },
    ];
    const scan = new Set(scanFieldsForResidualCjk(fields as any).map(h => h.path));
    const viaChip = new Set(fields.filter(f => chip(f) > 0).map(f => f.path));
    expect([...viaChip].sort()).toEqual([...scan].sort());
    expect([...viaChip].sort()).toEqual(['a', 'f']);
  });
});
