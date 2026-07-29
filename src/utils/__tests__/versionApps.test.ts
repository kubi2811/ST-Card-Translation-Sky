// (bug 148-1) Phân loại mỗi phiên bản thuộc app nào — dữ liệu là scope trong tiêu đề commit.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  classifyCommitApps, countByApp, filterByApp, stripConventionalPrefix, APP_TAGS,
} from '../versionApps';

describe('(bug 148-1) classifyCommitApps', () => {
  it('đọc scope conventional commit → đúng app', () => {
    expect(classifyCommitApps('fix(tao-card): bug 140 …')).toEqual(['tao-card']);
    expect(classifyCommitApps('feat(preset-tool): bug 139 …')).toEqual(['tao-preset']);
    expect(classifyCommitApps('fix(dich-card): bug 143 …')).toEqual(['dich-card']);
    expect(classifyCommitApps('fix(hub): bug 146 …')).toEqual(['hub']);
  });

  it('commit đụng NHIỀU app → trả về tất cả, không ép về một', () => {
    const ids = classifyCommitApps('feat(hub+tao-card): bug 146 — mot nut danh sach phien ban');
    expect(ids).toContain('hub');
    expect(ids).toContain('tao-card');
  });

  it('không có scope → đoán theo từ khoá rõ ràng', () => {
    expect(classifyCommitApps('Sửa Auto Creator sinh lorebook trùng')).toEqual(['tao-card']);
    expect(classifyCommitApps('cải thiện bộ cào wiki')).toEqual(['crawler']);
  });

  it('không đủ căn cứ → "chung", KHÔNG gán bừa cho một app', () => {
    expect(classifyCommitApps('chore: dọn dẹp')).toEqual(['chung']);
    expect(classifyCommitApps('')).toEqual(['chung']);
  });

  it('mọi id trả về đều có nhãn hiển thị', () => {
    for (const s of ['fix(tao-card): x', 'chore: y', 'feat(crawler): z']) {
      for (const id of classifyCommitApps(s)) expect(APP_TAGS[id]).toBeTruthy();
    }
  });
});

describe('(bug 148-1) lọc + đếm + rút gọn tiêu đề', () => {
  const rows = [
    { subject: 'fix(tao-card): a' },
    { subject: 'fix(tao-card): b' },
    { subject: 'feat(preset-tool): c' },
  ];

  it('countByApp đếm đúng; filterByApp lọc đúng; null = tất cả', () => {
    const c = countByApp(rows);
    expect(c.get('tao-card')).toBe(2);
    expect(c.get('tao-preset')).toBe(1);
    expect(filterByApp(rows, 'tao-card')).toHaveLength(2);
    expect(filterByApp(rows, null)).toHaveLength(3);
  });

  it('stripConventionalPrefix bỏ "type(scope):" cho gọn', () => {
    expect(stripConventionalPrefix('fix(tao-card): bug 140 — abc')).toBe('bug 140 — abc');
    expect(stripConventionalPrefix('không có tiền tố')).toBe('không có tiền tố');
  });
});

/* Đối chiếu trên LỊCH SỬ THẬT của repo — phân loại phải phủ được phần lớn commit gần đây,
   nếu không thì bộ lọc theo app chỉ là trang trí. */
describe('(bug 148-1) chạy trên lịch sử commit thật', () => {
  let subjects: string[] = [];
  try {
    subjects = execFileSync('git', ['log', '-n', '40', '--format=%s'], { cwd: process.cwd() })
      .toString().split('\n').map(s => s.trim()).filter(Boolean);
  } catch { /* không phải git clone — bỏ qua */ }

  it.skipIf(subjects.length === 0)('≥ 80% commit gần đây được gán vào một app cụ thể (không rơi vào "chung")', () => {
    const classified = subjects.filter(s => !classifyCommitApps(s).includes('chung'));
    const ratio = classified.length / subjects.length;
    expect(ratio, `chỉ phân loại được ${classified.length}/${subjects.length}`).toBeGreaterThanOrEqual(0.8);
  });
});
