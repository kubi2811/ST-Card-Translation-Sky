/**
 * (bug 218) KHO KỸ NĂNG CHO AGENT — theo mẫu oh-my-claudecode.
 * ─────────────────────────────────────────────────────────────────────────────
 * User: "làm một nơi để người dùng có thể tải và dùng các repo skill cho agent."
 *
 * Ba thứ phải đúng thì tính năng mới dùng được thật:
 *   • ĐỌC file người ta viết tay — frontmatter viết mấy kiểu đều phải nhận;
 *   • CHỈ chèn kỹ năng khớp câu đang hỏi, và kỹ năng khớp sát phải được ưu tiên;
 *   • NẠP LẠI repo không được đẻ bản sao.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  _resetSkillDbForTest, parseSkillMarkdown, normalizeTriggers, matchSkills, buildSkillBlock,
  installSkillFiles, listSkills, deletePack, setSkillEnabled, newSkillId,
  parseRepoUrl, packNameOf, apiListUrl, fetchSkillFilesFromRepo,
  type SkillRecord,
} from '../skillStore';

let db: ReturnType<typeof _resetSkillDbForTest>;
beforeEach(() => { db = _resetSkillDbForTest(); });

function skill(over: Partial<SkillRecord> = {}): SkillRecord {
  const now = Date.now();
  return {
    id: newSkillId(), name: 'Sửa lỗi biến MVU', description: 'khi báo 变量更新失败',
    triggers: ['mvu', '变量更新失败'], body: 'Kiểm [initvar] trước.', pack: 'thu-cong',
    enabled: true, createdAt: now, updatedAt: now, ...over,
  };
}

describe('(bug 218) đọc file kỹ năng người dùng viết tay', () => {
  it('frontmatter đủ ba khoá, triggers kiểu mảng JSON', () => {
    const p = parseSkillMarkdown(`---
name: Sửa lỗi biến MVU
description: Biến MVU báo lỗi khi nhập Opening Form
triggers: ["mvu", "biến", "变量更新失败"]
---
Kiểm [initvar] trước, đối chiếu tên biến với stat_data.`);
    expect(p.name).toBe('Sửa lỗi biến MVU');
    expect(p.triggers).toEqual(['mvu', 'biến', '变量更新失败']);
    expect(p.body).toContain('stat_data');
    expect(p.body).not.toContain('---');
  });

  it('triggers liệt kê bằng dấu phẩy', () => {
    expect(parseSkillMarkdown('---\nname: A\ntriggers: ejs, lorebook , Regex\n---\nthân').triggers)
      .toEqual(['ejs', 'lorebook', 'regex']);
  });

  it('triggers kiểu gạch đầu dòng YAML', () => {
    const p = parseSkillMarkdown(`---
name: B
triggers:
  - dịch card
  - glossary
---
thân B`);
    expect(p.triggers).toEqual(['dịch card', 'glossary']);
  });

  it('KHÔNG có frontmatter thì vẫn dùng được — lấy tiêu đề # làm tên', () => {
    const p = parseSkillMarkdown('# Ghi chú về EJS\n\nnội dung ghi chú');
    expect(p.name).toBe('Ghi chú về EJS');
    expect(p.body).toContain('nội dung ghi chú');
    expect(p.triggers).toEqual([]);
  });

  it('không frontmatter, không tiêu đề ⇒ dùng tên file làm tên', () => {
    expect(parseSkillMarkdown('chỉ có văn bản', 'ghi-chu').name).toBe('ghi-chu');
  });

  it('chịu được CRLF và BOM — file tải từ Windows/GitHub hay dính', () => {
    const p = parseSkillMarkdown('﻿---\r\nname: C\r\ntriggers: x\r\n---\r\nthân C');
    expect(p.name).toBe('C');
    expect(p.body).toBe('thân C');
  });

  it('thường hoá từ khoá: bỏ nháy, gộp khoảng trắng, bỏ trùng và rỗng', () => {
    expect(normalizeTriggers(['"MVU"', 'mvu', '  dịch   card ', '', undefined])).toEqual(['mvu', 'dịch card']);
  });
});

describe('(bug 218) chỉ chèn kỹ năng KHỚP câu đang hỏi', () => {
  it('khớp theo từ khoá, không khớp thì không vào prompt', () => {
    const s = [skill(), skill({ name: 'Khác', triggers: ['preset'] })];
    const m = matchSkills('sao thẻ này báo 变量更新失败 vậy', s);
    expect(m).toHaveLength(1);
    expect(m[0].skill.name).toBe('Sửa lỗi biến MVU');
    expect(m[0].hits).toContain('变量更新失败');
  });

  it('từ khoá DÀI hơn thắng — bắt trúng cụm cụ thể đáng tin hơn bắt trúng một chữ', () => {
    const chung = skill({ name: 'Chung', triggers: ['mvu'] });
    const sat = skill({ name: 'Sát', triggers: ['变量更新失败'] });
    const m = matchSkills('lỗi mvu: 变量更新失败', [chung, sat]);
    expect(m[0].skill.name).toBe('Sát');
  });

  it('kỹ năng KHÔNG có từ khoá thì không bao giờ tự chèn', () => {
    expect(matchSkills('bất kỳ câu gì', [skill({ triggers: [] })])).toHaveLength(0);
  });

  it('kỹ năng đã tắt thì bỏ qua', () => {
    expect(matchSkills('mvu', [skill({ enabled: false })])).toHaveLength(0);
  });

  it('kỹ năng gắn thẻ khác thì không chen vào', () => {
    expect(matchSkills('mvu', [skill({ cardKey: 'the-A' })], { cardKey: 'the-B' })).toHaveLength(0);
    expect(matchSkills('mvu', [skill({ cardKey: '' })], { cardKey: 'the-B' })).toHaveLength(1);
  });

  it('có trần số kỹ năng', () => {
    const many = Array.from({ length: 9 }, (_, i) => skill({ name: `K${i}`, triggers: ['mvu'] }));
    expect(matchSkills('mvu', many, { max: 2 })).toHaveLength(2);
  });

  it('câu rỗng ⇒ không khớp gì', () => {
    expect(matchSkills('   ', [skill()])).toHaveLength(0);
  });
});

describe('(bug 218) khối kỹ năng nhét vào prompt', () => {
  it('rỗng khi không khớp gì', () => {
    expect(buildSkillBlock([])).toBe('');
  });

  it('có tên + mô tả + thân', () => {
    const s = buildSkillBlock(matchSkills('mvu', [skill()]));
    expect(s).toContain('Sửa lỗi biến MVU');
    expect(s).toContain('变量更新失败');
    expect(s).toContain('Kiểm [initvar] trước.');
  });

  it('vượt trần thì bỏ NGUYÊN kỹ năng, không cắt cụt giữa thân', () => {
    const dai = skill({ name: 'Dài', triggers: ['mvu'], body: 'x'.repeat(500) });
    const ngan = skill({ name: 'Ngắn', triggers: ['mvu', '变量更新失败'], body: 'ngắn gọn' });
    const s = buildSkillBlock(matchSkills('mvu 变量更新失败', [dai, ngan]), 200);
    expect(s).toContain('Ngắn');
    expect(s).not.toContain('x'.repeat(50));
    expect(s).toContain('đã lược');
  });
});

describe('(bug 218) nạp gói kỹ năng', () => {
  const files = [
    { fileName: 'mvu.md', content: '---\nname: MVU\ntriggers: mvu\n---\nthân MVU' },
    { fileName: 'ejs.md', content: '---\nname: EJS\ntriggers: ejs\n---\nthân EJS' },
  ];

  it('nạp lần đầu thì thêm mới', async () => {
    expect(await installSkillFiles(files, 'chu/repo', {}, db)).toEqual({ added: 2, updated: 0, skipped: 0 });
    expect(await listSkills({}, db)).toHaveLength(2);
  });

  it('NẠP LẠI cùng gói thì GHI ĐÈ, không đẻ bản sao', async () => {
    await installSkillFiles(files, 'chu/repo', {}, db);
    const moi = [{ fileName: 'mvu.md', content: '---\nname: MVU\ntriggers: mvu\n---\nthân MVU ĐÃ SỬA' }];
    expect(await installSkillFiles(moi, 'chu/repo', {}, db)).toEqual({ added: 0, updated: 1, skipped: 0 });
    const rows = await listSkills({}, db);
    expect(rows).toHaveLength(2);
    expect(rows.find(r => r.name === 'MVU')!.body).toContain('ĐÃ SỬA');
  });

  it('ghi đè GIỮ trạng thái bật/tắt người dùng đã đặt', async () => {
    await installSkillFiles(files, 'chu/repo', {}, db);
    const mvu = (await listSkills({}, db)).find(r => r.name === 'MVU')!;
    await setSkillEnabled(mvu.id, false, db);
    await installSkillFiles(files, 'chu/repo', {}, db);
    expect((await listSkills({}, db)).find(r => r.name === 'MVU')!.enabled).toBe(false);
  });

  it('file rỗng thân thì bỏ qua, không tạo kỹ năng ma', async () => {
    const r = await installSkillFiles([{ fileName: 'trong.md', content: '---\nname: Trống\n---\n' }], 'p', {}, db);
    expect(r.skipped).toBe(1);
    expect(await listSkills({}, db)).toHaveLength(0);
  });

  it('gỡ cả gói bằng một nút', async () => {
    await installSkillFiles(files, 'chu/repo', {}, db);
    await installSkillFiles([{ fileName: 'a.md', content: '---\nname: A\ntriggers: a\n---\nA' }], 'goi-khac', {}, db);
    expect(await deletePack('chu/repo', db)).toBe(2);
    expect((await listSkills({}, db)).map(s => s.name)).toEqual(['A']);
  });
});

describe('(bug 218) nhận địa chỉ repo người dùng dán vào', () => {
  it('link trang repo', () => {
    expect(parseRepoUrl('https://github.com/yeachan-heo/oh-my-claudecode'))
      .toEqual({ owner: 'yeachan-heo', repo: 'oh-my-claudecode', branch: undefined, dir: undefined });
  });

  it('link THƯ MỤC CON — người dùng hay copy thẳng thanh địa chỉ', () => {
    expect(parseRepoUrl('https://github.com/chu/repo/tree/main/skills/vi'))
      .toEqual({ owner: 'chu', repo: 'repo', branch: 'main', dir: 'skills/vi' });
  });

  it('dạng rút gọn chu/repo và đuôi .git / dấu / thừa', () => {
    expect(parseRepoUrl('chu/repo')).toEqual({ owner: 'chu', repo: 'repo' });
    expect(parseRepoUrl('https://github.com/chu/repo.git/')?.repo).toBe('repo');
  });

  it('không phải repo thì trả null, không đoán bừa', () => {
    expect(parseRepoUrl('')).toBeNull();
    expect(parseRepoUrl('https://example.com/abc')).toBeNull();
  });

  it('tên gói phân biệt được hai thư mục trong cùng repo', () => {
    expect(packNameOf({ owner: 'c', repo: 'r', dir: 'skills/vi' })).toBe('c/r/skills/vi');
    expect(packNameOf({ owner: 'c', repo: 'r' })).toBe('c/r');
  });

  it('dựng đúng URL API, có nhánh thì kèm ref', () => {
    expect(apiListUrl({ owner: 'c', repo: 'r', dir: 'skills', branch: 'dev' }))
      .toBe('https://api.github.com/repos/c/r/contents/skills?ref=dev');
  });
});

describe('(bug 218) tải file từ repo', () => {
  const ok = (body: any, isText = false) => ({
    ok: true, status: 200,
    json: async () => body,
    text: async () => (isText ? body : JSON.stringify(body)),
  }) as any;

  it('chỉ lấy file .md, bỏ README của thư mục cha và file khác', async () => {
    const fake = (async (url: string) => {
      if (String(url).includes('api.github.com')) {
        return ok([
          { name: 'a.md', type: 'file', download_url: 'https://raw/a' },
          { name: 'logo.png', type: 'file', download_url: 'https://raw/logo' },
          { name: 'con', type: 'dir', download_url: null },
        ]);
      }
      return ok('---\nname: A\ntriggers: a\n---\nthân A', true);
    }) as unknown as typeof fetch;
    const files = await fetchSkillFilesFromRepo({ owner: 'c', repo: 'r' }, fake);
    expect(files).toHaveLength(1);
    expect(files[0].fileName).toBe('a.md');
  });

  it('một file tải hỏng không làm hỏng cả lượt nạp', async () => {
    let n = 0;
    const fake = (async (url: string) => {
      if (String(url).includes('api.github.com')) {
        return ok([
          { name: 'a.md', type: 'file', download_url: 'https://raw/a' },
          { name: 'b.md', type: 'file', download_url: 'https://raw/b' },
        ]);
      }
      if (++n === 1) throw new Error('mạng đứt');
      return ok('---\nname: B\n---\nthân B', true);
    }) as unknown as typeof fetch;
    expect(await fetchSkillFilesFromRepo({ owner: 'c', repo: 'r' }, fake)).toHaveLength(1);
  });

  it('lỗi 404 / 403 nói bằng tiếng Việt cho người dùng hiểu phải làm gì', async () => {
    const mk = (status: number) => (async () => ({ ok: false, status, json: async () => ({}), text: async () => '' })) as unknown as typeof fetch;
    await expect(fetchSkillFilesFromRepo({ owner: 'c', repo: 'r' }, mk(404))).rejects.toThrow(/Không tìm thấy/);
    await expect(fetchSkillFilesFromRepo({ owner: 'c', repo: 'r' }, mk(403))).rejects.toThrow(/quá nhiều/);
  });

  it('dán nhầm link FILE thay vì thư mục ⇒ nói rõ', async () => {
    const fake = (async () => ok({ name: 'a.md', type: 'file' })) as unknown as typeof fetch;
    await expect(fetchSkillFilesFromRepo({ owner: 'c', repo: 'r' }, fake)).rejects.toThrow(/là một FILE/);
  });

  it('thư mục không có .md nào ⇒ nói rõ', async () => {
    const fake = (async () => ok([{ name: 'x.png', type: 'file', download_url: 'u' }])) as unknown as typeof fetch;
    await expect(fetchSkillFilesFromRepo({ owner: 'c', repo: 'r' }, fake)).rejects.toThrow(/không có file \.md/);
  });
});
