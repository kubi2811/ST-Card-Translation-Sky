/**
 * (bug 211) Bộ gom "mục chưa đạt" — thứ mà bảng đếm cũ giấu sau chữ "Xong".
 * Ảnh bằng chứng của user: bảng đếm ghi "27 Xong · 5 Bỏ qua · 0 Lỗi" trong khi một entry
 * "XONG" vẫn đỏ lòm "còn 4427 chữ Hán" vì chốt an toàn đã lặng lẽ giữ nguyên bản gốc.
 */
import { describe, it, expect } from 'vitest';
import { collectProblemFields, type ProblemScanField } from '../problemFields';

const f = (over: Partial<ProblemScanField>): ProblemScanField => ({
  path: over.path ?? 'p',
  label: over.label ?? over.path ?? 'p',
  group: 'lorebook',
  status: 'done',
  original: '中文原文内容很多字',
  translated: 'Bản dịch sạch.',
  ...over,
});

describe('(bug 211) collectProblemFields', () => {
  /**
   * (bug 237) HỢP ĐỒNG ĐỔI: field 'skipped' chỉ vào danh sách khi CÒN chữ nguồn.
   * Field bị bỏ qua thì bản "dịch" của nó CHÍNH LÀ bản gốc — nên fixture cũ ("bỏ qua" mà lại có
   * bản dịch tiếng Việt sạch) là một trạng thái không tồn tại ngoài đời. Bản mới dựng đúng thực tế:
   * `skipSach` = tên riêng "Counterfeit" (không có gì để dịch), `skipBan` = còn nguyên tiếng Trung.
   */
  it('gom đủ ba loại: lỗi + bỏ-qua-còn-chữ-Hán + done-còn-chữ-Hán; mục sạch không bị lôi vào', () => {
    const { problems, counts } = collectProblemFields([
      f({ path: 'err', status: 'error' }),
      f({ path: 'skipBan', status: 'skipped', original: '这是一段中文', translated: '这是一段中文' }),
      f({ path: 'sot', translated: 'Dịch dở: 还有中文没翻译 nằm giữa câu.' }),
      f({ path: 'sach' }),
      f({ path: 'pending', status: 'pending' }),
      f({ path: 'ignored', status: 'ignored' }),
    ]);
    expect(problems.map(p => `${p.kind}:${p.path}`).sort()).toEqual([
      'error:err', 'residual:sot', 'skipped:skipBan',
    ]);
    expect(counts).toEqual({ error: 1, skipped: 1, residual: 1, total: 3 });
  });

  /**
   * (bug 237) Chạy thật thẻ 237: `data.name` = "Counterfeit" và `tavernHelper[0].content` =
   * `import 'https://…/bundle.js'` bị đẩy vào danh sách sửa, mỗi cái đốt 5 lượt gọi AI rồi in
   * dòng đỏ "✗ vẫn chưa đạt sau 5 lượt" — trong khi ba entry còn nguyên 2.975 chữ Hán phải chờ.
   * Hại thật nằm ở chỗ dấu ✗ mất nghĩa, chứ không phải mấy lượt gọi phí.
   */
  it('bỏ qua mà KHÔNG còn chữ nguồn thì KHÔNG phải "chưa đạt" — không đốt lượt gọi, không báo ✗', () => {
    const { problems, counts } = collectProblemFields([
      f({ path: 'data.name', status: 'skipped', original: 'Counterfeit', translated: 'Counterfeit' }),
      f({
        path: 'tavernHelper[0].content', group: 'tavern_helper', status: 'skipped',
        original: "import 'https://testingcf.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate/artifact/bundle.js'",
        translated: "import 'https://testingcf.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate/artifact/bundle.js'",
      }),
    ]);
    expect(problems).toHaveLength(0);
    expect(counts.total).toBe(0);
  });

  it('ĐÚNG CA TRONG ẢNH: chốt an toàn giữ nguyên gốc (translated === original toàn chữ Hán, status done) vẫn bị tóm', () => {
    const kept = f({
      path: 'tavernHelper[1].content',
      group: 'tavern_helper',
      original: '// 本文件由 scripts 自动生成，请勿手动修改。\nconst 配置 = { 名字: "值" };',
      translated: '// 本文件由 scripts 自动生成，请勿手动修改。\nconst 配置 = { 名字: "值" };',
      keptOriginalOnPurpose: true,
    });
    const { problems } = collectProblemFields([kept]);
    expect(problems).toHaveLength(1);
    expect(problems[0].kind).toBe('residual');
    expect(problems[0].residual!.count).toBeGreaterThan(10);
    expect(problems[0].residual!.samples.length).toBeGreaterThan(0);
  });

  it('chữ Hán trong URL không tính là sót (định nghĩa dùng chung với việc 80)', () => {
    const { problems } = collectProblemFields([
      f({ path: 'url', translated: "Bản dịch sạch, chỉ còn import('https://cdn.com/骰子系统/stable.js').", }),
    ]);
    expect(problems).toHaveLength(0);
  });

  it('lorebook_keys ở chế độ gộp giữ key gốc CÓ CHỦ Ý — không bị coi là chưa đạt', () => {
    const { problems } = collectProblemFields([
      f({ path: 'keys', group: 'lorebook_keys', translated: '灵气, Linh khí' }),
    ]);
    expect(problems).toHaveLength(0);
  });

  it('nguồn vốn không có chữ Hán thì bản dịch có vài chữ Hán cũng không phải "sót"', () => {
    const { problems } = collectProblemFields([
      f({ path: 'en', original: 'English only source.', translated: 'Bản dịch nhắc tên 灵气 trong chú thích.' }),
    ]);
    expect(problems).toHaveLength(0);
  });
});
