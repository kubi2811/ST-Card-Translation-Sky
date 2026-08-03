/**
 * (bug 193) Bác sĩ chunk — kiểm theo đúng cách nó được ép trong pipeline:
 *   1. diagnoseChunk phân loại được chunk 100% sạch vs còn Hán / mất ký tự / lặp / EJS-code vỡ
 *      / vi phạm từ điển MVU (biến chưa dịch + SAI HOA/THƯỜNG);
 *   2. lượt sửa là SỬA CÓ CHẨN ĐOÁN: prompt phải mang danh sách lỗi đích danh + raw + bản dịch
 *      lỗi + ngữ cảnh RAW LỚN, và lệnh "không dịch lại từ đầu";
 *   3. từ điển LỌC THEO CHUNK — chỉ biến thật sự xuất hiện;
 *   4. máy ép hoa/thường ngay từng chunk (đồng biến 100% không chờ vòng cuối).
 * Kèm nối dây: apiClient phải gọi qua chunkDoctor ở CẢ hai nhánh; retranslateField phải truyền
 * rawChunks (vá lỗ chốt "nhịp cắt đổi" bugNeedFix/144 trên đường dịch lại/resume).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  diagnoseChunk, buildChunkRepairInstruction, filterDictForChunk, applyDictCasing,
  mvuChunkViolations, hasStructuralProblem, summarizeChunkProblems,
  ejsBlocksIntact, codeStructureBroken, extractHanSamples,
} from '../chunkDoctor';

const DICT = { '好感度': 'Hảo Cảm', '魔力值': 'Ma Lực', '体力': 'Thể Lực' };

describe('diagnoseChunk — phân loại chunk sau lượt dịch đầu', () => {
  it('chunk dịch 100% sạch → không lỗi nào', () => {
    const raw = '她的好感度提升了。这是一个漫长的故事，主角在森林里冒险。'.repeat(20);
    const out = 'Hảo Cảm của cô ấy tăng lên. Đây là một câu chuyện dài, nhân vật chính phiêu lưu trong rừng. '.repeat(20);
    expect(diagnoseChunk(raw, out, { dict: filterDictForChunk(DICT, raw) })).toEqual([]);
  });

  it('chunk bị giữ nguyên tiếng Trung → cjk, kèm mẫu vị trí sót', () => {
    const raw = '这是一个漫长的故事。'.repeat(30);
    const problems = diagnoseChunk(raw, raw, {});
    expect(problems.some(p => p.kind === 'cjk')).toBe(true);
    const cjk = problems.find(p => p.kind === 'cjk')!;
    expect(cjk.samples?.length ?? 0).toBeGreaterThan(0);
  });

  it('CJK trong URL là cố ý — KHÔNG bị tính là sót', () => {
    const raw = '故事很长。'.repeat(30);
    const out = `Câu chuyện rất dài. ${'Nội dung tiếng Việt đầy đủ chi tiết. '.repeat(28)}import("https://cdn.com/骰子系统/stable.js")`;
    expect(diagnoseChunk(raw, out, {}).some(p => p.kind === 'cjk')).toBe(false);
  });

  it('bản dịch rỗng → missing; teo còn 10% → truncated (mất ký tự)', () => {
    const raw = 'The quick brown fox jumps over the lazy dog. '.repeat(60);
    expect(diagnoseChunk(raw, '   ', {})[0].kind).toBe('missing');
    expect(diagnoseChunk(raw, raw.slice(0, Math.floor(raw.length * 0.1)), {}).some(p => p.kind === 'truncated')).toBe(true);
  });

  it('EJS rơi khối / code lệch ngoặc → lỗi CẤU TRÚC (hasStructuralProblem)', () => {
    const rawEjs = 'Trước <% if (getvar("hp") > 0) { %> giữa <% } %> sau.';
    expect(ejsBlocksIntact(rawEjs, 'Trước giữa sau.')).toBe(false);
    const p1 = diagnoseChunk(rawEjs, 'Trước giữa sau.', {});
    expect(p1.some(p => p.kind === 'ejs')).toBe(true);
    expect(hasStructuralProblem(p1)).toBe(true);

    const rawCode = Array.from({ length: 8 }, (_, i) => `const a${i} = fn(${i});`).join('\n');
    expect(codeStructureBroken(rawCode, rawCode.replace(/\)/g, ''))).toContain('lệch cân bằng');
  });

  it('vi phạm từ điển MVU: biến còn nguyên Hán + biến SAI HOA/THƯỜNG đều bị điểm mặt', () => {
    const raw = '角色的好感度和魔力值都上升了。'.repeat(5);
    const outHanLeft = 'Chỉ số 好感度 và Ma Lực của nhân vật đều tăng. '.repeat(5);
    const v1 = mvuChunkViolations(raw, outHanLeft, DICT);
    expect(v1.some(p => p.kind === 'mvu-han')).toBe(true);

    const outWrongCase = 'Chỉ số hảo cảm và ma lực của nhân vật đều tăng. '.repeat(5);
    const v2 = mvuChunkViolations(raw, outWrongCase, DICT);
    expect(v2.some(p => p.kind === 'mvu-case')).toBe(true);
    expect(v2.find(p => p.kind === 'mvu-case')!.samples!.join(' ')).toContain('Hảo Cảm');
  });
});

describe('từ điển theo chunk + máy ép hoa/thường', () => {
  it('filterDictForChunk chỉ giữ biến THẬT SỰ có trong chunk; không còn gì → undefined', () => {
    expect(filterDictForChunk(DICT, '好感度出现了')).toEqual({ '好感度': 'Hảo Cảm' });
    expect(filterDictForChunk(DICT, 'không có biến nào ở đây')).toBeUndefined();
    expect(filterDictForChunk(undefined, 'x')).toBeUndefined();
  });

  it('applyDictCasing ép đúng từng ký tự — getvar("hảo cảm") thành getvar("Hảo Cảm")', () => {
    const { text, fixes } = applyDictCasing('setvar("hảo cảm", 5); mô tả HẢO CẢM tăng.', DICT);
    expect(text).toBe('setvar("Hảo Cảm", 5); mô tả Hảo Cảm tăng.');
    expect(fixes).toBe(2);
  });
});

describe('lượt SỬA có chẩn đoán — không dịch lại máy móc', () => {
  it('prompt sửa mang đủ: lỗi đích danh, raw, bản dịch lỗi, ngữ cảnh raw lớn, từ điển, lệnh SỬA', () => {
    const raw = '她的好感度提升了。';
    const flawed = 'Hảo cảm của cô ấy tăng.';
    const prompt = buildChunkRepairInstruction({
      rawChunk: raw, flawed,
      problems: mvuChunkViolations(raw, flawed, DICT),
      partLabel: 'Entry Thế Giới [part 3/7]',
      entryHead: '【世界观】这个世界的设定如下…',
      prevRawTail: '…上一段的结尾',
      nextRawHead: '下一段的开头…',
      dict: filterDictForChunk(DICT, raw),
    });
    expect(prompt).toContain('SỬA BẢN DỊCH BỊ LỖI');
    expect(prompt).toContain('KHÔNG dịch lại từ đầu');
    expect(prompt).toContain('[part 3/7]');
    expect(prompt).toContain('mvu-case');
    expect(prompt).toContain(raw);
    expect(prompt).toContain(flawed);
    expect(prompt).toContain('上一段的结尾');   // ngữ cảnh raw lớn — hiểu mảng phụ trách
    expect(prompt).toContain('下一段的开头');
    expect(prompt).toContain('"好感度" → "Hảo Cảm"');
    expect(prompt).toContain('GIỮ NGUYÊN mọi phần bản dịch đã đúng');
  });

  it('summarize nói được tiếng người', () => {
    expect(summarizeChunkProblems([])).toContain('sạch 100%');
    expect(summarizeChunkProblems([{ kind: 'cjk', detail: 'x' }, { kind: 'mvu-case', detail: 'y' }]))
      .toBe('còn chữ Hán + biến MVU sai hoa/thường');
  });

  it('extractHanSamples gom cụm Hán liền kề thành một mẫu, cụm xa nhau thành mẫu riêng', () => {
    const near = extractHanSamples('aaa 好感度提升 bbb 魔力值 ccc');
    expect(near.length).toBe(1); // hai cụm nằm trong cùng cửa sổ pad → gộp một mẫu
    const far = extractHanSamples(`aaa 好感度提升 ${'x'.repeat(80)} 魔力值 ddd`);
    expect(far.length).toBe(2);
    expect(far[0]).toContain('好感度提升');
    expect(far[1]).toContain('魔力值');
  });
});

describe('nối dây', () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

  it('apiClient: cả 2 nhánh chunk đều đi qua bác sĩ (diagnose + sửa có chẩn đoán + ép dict)', () => {
    const SRC = read('../apiClient.ts');
    expect(SRC).toContain("from './chunkDoctor'");
    // 2 nhánh (song song + tuần tự) — mỗi nhánh một lần gọi (định nghĩa là `= async (` nên không tính)
    expect((SRC.match(/repairChunkWithDiagnosis\(\s*\n?\s*idx/g) ?? []).length).toBe(2);
    expect((SRC.match(/enforceChunkDict\(idx, chunkCleaned\)/g) ?? []).length).toBe(2);
    expect((SRC.match(/dictForChunk\(idx\)/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it('useTranslation: retranslateField truyền rawChunks — chốt "nhịp cắt đổi" sống trên đường dịch lại', () => {
    const SRC = read('../../hooks/useTranslation.ts');
    // đường dịch lại phải có comment vá bug 193 + truyền field.rawChunks làm tham số cuối
    expect(SRC).toContain('(bug 193, vá lỗ bugNeedFix/144)');
    expect((SRC.match(/field\.rawChunks,?\s*\n\s*\);/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});
