import { describe, it, expect } from 'vitest';
import { planInstallTargets, toolsNeedingRestart, describeInstallPlan } from '../updatePlan';

/**
 * (User 22/07) Nút "Cập nhật" trong app chỉ chạy `npm install` ở thư mục GỐC. Repo là monorepo,
 * mỗi tool con có package.json riêng — thêm `jszip` vào tao-card xong bấm Cập nhật thì Tạo Card
 * nổ "Failed to resolve import jszip", trắng màn hình.
 */

const TOOLS = ['tao-card', 'preset-tool', 'mod-card', 'crawler'];
const allHavePkg = () => true;
const allHaveModules = () => true;

const plan = (changedFiles: string[] | null, over: Partial<Parameters<typeof planInstallTargets>[0]> = {}) =>
  planInstallTargets({
    changedFiles, toolDirs: TOOLS, hasPackageJson: allHavePkg, hasNodeModules: allHaveModules, ...over,
  });

describe('planInstallTargets — chỉ cài lại nơi thật sự cần', () => {
  it('CHÍNH CA BUG: chỉ tao-card/package.json đổi → phải cài ở tao-card', () => {
    const t = plan(['tao-card/package.json', 'tao-card/src/lib/ai/epubParser.ts']);
    expect(t.map(x => x.dir)).toEqual(['tao-card']);
  });

  it('package-lock của tool con đổi cũng phải cài', () => {
    expect(plan(['mod-card/package-lock.json']).map(x => x.dir)).toEqual(['mod-card']);
  });

  it('chỉ file nguồn đổi, không đụng package.json → KHÔNG cài lại (khỏi chờ vô ích)', () => {
    expect(plan(['src/utils/a.ts', 'tao-card/src/b.tsx', 'README.md'])).toEqual([]);
  });

  it('package.json gốc đổi → cài ở gốc, thư mục gốc luôn đứng đầu', () => {
    const t = plan(['package.json', 'tao-card/package.json']);
    expect(t.map(x => x.dir)).toEqual(['.', 'tao-card']);
  });

  it('nhiều tool cùng đổi → cài hết những tool đó', () => {
    const t = plan(['tao-card/package.json', 'crawler/package.json']);
    expect(t.map(x => x.dir)).toEqual(['tao-card', 'crawler']);
  });

  it('thiếu node_modules → luôn cài, kể cả khi package.json không đổi', () => {
    const t = plan(['README.md'], { hasNodeModules: (d) => d !== 'tao-card' });
    expect(t.map(x => x.dir)).toEqual(['tao-card']);
    expect(t[0].reason).toMatch(/node_modules/);
  });

  it('không diff được (null) → cài hết cho chắc, thà chậm còn hơn app hỏng', () => {
    expect(plan(null).map(x => x.dir)).toEqual(['.', ...TOOLS]);
  });

  it('thư mục không có package.json → bỏ qua (crawler có thể chưa được cài)', () => {
    const t = plan(null, { hasPackageJson: (d) => d !== 'crawler' });
    expect(t.map(x => x.dir)).not.toContain('crawler');
  });

  it('không có gì đổi → không cài gì', () => {
    expect(plan([])).toEqual([]);
  });

  it('đường dẫn kiểu Windows (dấu \\) vẫn khớp', () => {
    expect(plan(['tao-card\\package.json']).map(x => x.dir)).toEqual(['tao-card']);
  });

  it('KHÔNG nhầm package.json nằm sâu bên trong (node_modules, con của tool)', () => {
    expect(plan(['tao-card/src/foo/package.json'])).toEqual([]);
  });
});

describe('toolsNeedingRestart — Windows khoá file khi dev server đang chạy', () => {
  const tools = [
    { id: 'card-creator', dir: 'tao-card' },
    { id: 'preset', dir: 'preset-tool' },
    { id: 'mod-card', dir: 'mod-card' },
  ];

  it('tool nào bị cài lại thì phải dừng server tool đó', () => {
    expect(toolsNeedingRestart([{ dir: 'tao-card', reason: 'x' }], tools)).toEqual(['card-creator']);
  });

  it('chỉ cài ở gốc → không cần dừng tool nào', () => {
    expect(toolsNeedingRestart([{ dir: '.', reason: 'x' }], tools)).toEqual([]);
  });

  it('không cài gì → không dừng gì', () => {
    expect(toolsNeedingRestart([], tools)).toEqual([]);
  });
});

describe('describeInstallPlan — nói cho user biết đang chờ cái gì', () => {
  it('có việc → liệt kê nơi và lý do', () => {
    const s = describeInstallPlan([{ dir: 'tao-card', reason: 'package.json/package-lock.json vừa đổi' }]);
    expect(s).toContain('tao-card');
    expect(s).toContain('package.json');
  });

  it('không có việc → nói rõ là bỏ qua', () => {
    expect(describeInstallPlan([])).toMatch(/bỏ qua/i);
  });

  it('thư mục gốc hiện là "(gốc)" chứ không phải dấu chấm khó hiểu', () => {
    expect(describeInstallPlan([{ dir: '.', reason: 'x' }])).toContain('(gốc)');
  });
});
