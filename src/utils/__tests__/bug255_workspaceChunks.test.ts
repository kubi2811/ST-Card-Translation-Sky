/**
 * (bug 255 — PhatSiz) Chia việc / chuyển máy:
 *   1. workspace chép NGUYÊN từ điển của máy (mọi thẻ) ⇒ chuyền vài lần là phình — giờ chỉ mục của thẻ;
 *   2. không gộp được tiến độ của hai người dịch cùng thẻ — giờ có mergeWorkspaceInto;
 *   3. tên file có chữ Hán (`状态机.js`) bị đếm là "còn chữ Hán" và bị đưa đi dịch.
 */
import { describe, it, expect } from 'vitest';
import {
  buildWorkspace, parseWorkspace, scopeDictToCard, mergeWorkspaceInto, isSameCardWorkspace,
} from '../workspaceIO';
import { countResidualHan } from '../residualCjkScan';
import { cjkFileNameRanges } from '../cjk';
import { extractCJKTokens } from '../surgical';

const F = (path: string, original: string, extra: Record<string, unknown> = {}) =>
  ({ path, label: path, group: 'lorebook', original, translated: '', status: 'pending', ...extra }) as any;

describe('bug 255 — workspace chỉ mang từ điển của thẻ', () => {
  it('scopeDictToCard bỏ mục không có trong văn bản gốc', () => {
    const r = scopeDictToCard({ 好感度: 'Độ Hảo Cảm', 别的卡: 'Thẻ Khác' }, 'stat_data.好感度 = 1');
    expect(r.dict).toEqual({ 好感度: 'Độ Hảo Cảm' });
    expect(r.dropped).toBe(1);
  });

  it('buildWorkspace: từ điển/thuật ngữ/metadata được lọc, ảnh đi kèm; parse lọc lại file cũ', () => {
    const fields = [F('a', '好感度: 10'), F('b', '名字是小明')];
    const { file, droppedForeign } = buildWorkspace({
      card: { data: { name: 'X' } } as any, cardFileName: 'x.png', fields, phase: 'paused', currentFieldIndex: 0,
      mvuKeyMetadata: { 好感度: { confidence: 'ai' }, 其他: { confidence: 'ai' } },
      translationConfig: {
        mvuDictionary: { 好感度: 'Độ Hảo Cảm', 其他卡变量: 'Biến Khác' },
        ejsEntryNameDict: { 不相关: 'Không Liên Quan' },
        glossary: [{ source: '小明', target: 'Tiểu Minh' }, { source: '张三', target: 'Trương Tam' }],
      },
      activePreset: null, image: 'data:image/png;base64,AAAA',
    }, [], [], 'test');
    expect(file.translationConfig.mvuDictionary).toEqual({ 好感度: 'Độ Hảo Cảm' });
    expect(file.translationConfig.ejsEntryNameDict).toEqual({});
    expect((file.translationConfig.glossary as any[]).map(g => g.source)).toEqual(['小明']);
    expect(Object.keys(file.mvuKeyMetadata)).toEqual(['好感度']);
    expect(file.image).toBe('data:image/png;base64,AAAA');
    expect(droppedForeign).toBe(3);

    // file kiểu cũ: từ điển đầy đủ của máy gửi ⇒ parse lọc lại; ảnh lạ bị bỏ
    const old = JSON.parse(JSON.stringify(file));
    old.translationConfig.mvuDictionary = { 好感度: 'Độ Hảo Cảm', 其他卡变量: 'Biến Khác' };
    old.image = 'https://evil.example/x.png';
    const parsed = parseWorkspace(JSON.stringify(old));
    expect(parsed.translationConfig.mvuDictionary).toEqual({ 好感度: 'Độ Hảo Cảm' });
    expect(parsed.image).toBeNull();
  });
});

describe('bug 255 — gộp tiến độ của hai người dịch cùng thẻ', () => {
  const mine = [
    F('a', '甲', { status: 'done', translated: 'Giáp' }),
    F('b', '乙'),
    F('c', '丙', { status: 'done', translated: 'Bính (của tôi)' }),
    F('d', '丁', { completedChunks: ['x', ''], totalChunks: 2 }),
    F('e', '戊'),
  ];
  const theirs = [
    F('a', '甲', { status: 'done', translated: 'Giáp' }),
    F('b', '乙', { status: 'done', translated: 'Ất' }),
    F('c', '丙', { status: 'done', translated: 'Bính (của bạn)' }),
    F('d', '丁', { completedChunks: ['x', 'y'], totalChunks: 2 }),
    F('e', '戊 (bản khác)', { status: 'done', translated: 'Mậu' }),
  ];
  it('lấy mục mình chưa có, giữ mục mình đã dịch, bỏ mục khác gốc', () => {
    const r = mergeWorkspaceInto(
      { fields: mine, dicts: { mvuDictionary: { 甲: 'Giáp' } } },
      { fields: theirs, translationConfig: { mvuDictionary: { 甲: 'KHÁC', 乙: 'Ất' } } },
    );
    const by = Object.fromEntries(r.fields.map(f => [f.path, f]));
    expect(by.b.translated).toBe('Ất');
    expect(by.b.status).toBe('done');
    expect(by.c.translated).toBe('Bính (của tôi)');
    expect(by.d.completedChunks).toEqual(['x', 'y']);
    expect(by.e.status).toBe('pending');
    expect(r.dicts.mvuDictionary).toEqual({ 甲: 'Giáp', 乙: 'Ất' });
    expect(r.report).toMatchObject({ taken: 2, mismatched: 1, dictAdded: 1 });
    expect(r.report.conflicts).toEqual(['c']);
  });
  it('isSameCardWorkspace', () => {
    expect(isSameCardWorkspace(mine, { fields: theirs })).toBe(true);
    expect(isSameCardWorkspace(mine, { fields: [F('z', '别的')] })).toBe(false);
  });
});

describe('bug 255 — tên file có chữ Hán không bị đếm, không bị dịch', () => {
  const C = "/**\n * 形态照抄外卡《大乾风华录 Ver2.0》的 `scripts/02_大乾风华录后台GM修改器.js`：\n * ⚠️ 本脚本**不改**状态机.js／状态栏面板.js／_build_card.js\n */\nconst a = 1;";
  it('không đếm chữ Hán trong tên file', () => {
    const all = (C.match(/[一-鿿]/g) || []).length;
    const counted = countResidualHan(C);
    // còn lại: 形态照抄外卡 / 大乾风华录 / 的 / 本脚本不改 (văn xuôi thật)
    expect(counted).toBeLessThan(all);
    expect(counted).toBe(countResidualHan("形态照抄外卡《大乾风华录 Ver2.0》的 ：\n本脚本不改"));
  });
  it('surgical không đưa tên file đi dịch', () => {
    expect(cjkFileNameRanges(C).length).toBe(3);
    const toks = extractCJKTokens(C).map(t => t.text);
    expect(toks.some(t => /修改器|状态机|状态栏面板/.test(t))).toBe(false);
    expect(toks.some(t => /形态照抄外卡/.test(t))).toBe(true);
  });
});
