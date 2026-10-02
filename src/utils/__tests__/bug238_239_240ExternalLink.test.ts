/**
 * (bug 238 + 239 + 240) Dịch link ngoài trong Regex Manager — gogopikachu.
 *
 *  238 — biến MVU dời hết ra script link ngoài: quét thẻ chỉ ra vài key, còn link ngoài thì không
 *        quét/không dịch key được; chế độ Script nặng còn không áp từ điển MVU.
 *  239 — thoát Regex Manager là lượt dịch "dừng": vòng dịch Script nặng sống trong component.
 *  240 — tiến độ/báo cáo chỉ có trong F12.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const translateCalls: { text: string; fieldName: string; mvuDict?: Record<string, string> }[] = [];
let translateImpl: (text: string) => Promise<string> = async (t) => t.replace(/好感度/g, 'Độ Hảo Cảm');

vi.mock('../apiClient', async (importOriginal) => {
  const real = await importOriginal<typeof import('../apiClient')>();
  return {
    ...real,
    setExtraProviders: vi.fn(),
    translateText: vi.fn(async (text: string, fieldName: string, ...rest: unknown[]) => {
      translateCalls.push({ text, fieldName, mvuDict: rest[10] as Record<string, string> | undefined });
      return translateImpl(text);
    }),
  };
});

import { extractPotentialMvuKeys, extractMvuKeysFromCode } from '../mvuSync';
import { vaultCodeForCard, type ExternalLinkEntry } from '../externalLinkVault';
import { useHeavyScriptJob, HEAVY_FIELD_PREFIX } from '../heavyScriptJob';
import { useTranslateActivity, noteActivity } from '../translateActivity';
import { useStore } from '../../store';
import type { CharacterCard } from '../../types/card';

/* ── Thẻ "đời mới": trong thẻ chỉ còn <script src>, biến nằm hết ở file ngoài ── */
const CARD = {
  data: {
    name: 'Thẻ Link Ngoài',
    character_book: { entries: [{ comment: 'mở đầu', content: '欢迎 {{getvar::姓名}}' }] },
    extensions: {
      regex_scripts: [{
        scriptName: 'giao diện',
        findRegex: '/<status>/g',
        replaceString: '<script src="https://cdn.jsdelivr.net/gh/u/r@main/status-bar.js"></script>',
      }],
    },
  },
} as unknown as CharacterCard;

const EXTERNAL_JS = `
const schema = z.object({
  好感度: z.number().describe('mức thiện cảm'),
  体力: z.number(),
  阶段: z.enum(['初识', '熟悉', '亲密']),
});
const v = _.get(stat_data, '好感度');
if (getvar('当前地点') === '学院') render();
el.dataset.k = data['心情'];
`;

describe('(bug 238) quét key MVU nằm trong LINK NGOÀI', () => {
  it('quét riêng thẻ thì KHÔNG thấy biến của file ngoài (đúng triệu chứng 9-14 key)', () => {
    const keys = extractPotentialMvuKeys(CARD).map(k => k.key);
    expect(keys).toContain('姓名');
    expect(keys).not.toContain('好感度');
  });

  it('extractMvuKeysFromCode thấy đủ: zod field, enum, lodash path, getvar, bracket', () => {
    const keys = extractMvuKeysFromCode(EXTERNAL_JS).map(k => k.key);
    for (const k of ['好感度', '体力', '阶段', '初识', '亲密', '当前地点', '心情']) expect(keys).toContain(k);
    // Mô tả .describe() đi kèm — AI dịch key cần nó.
    expect(extractMvuKeysFromCode(EXTERNAL_JS).find(k => k.key === '好感度')?.description).toBe('mức thiện cảm');
  });

  it('extractPotentialMvuKeys(card, externalCode) gộp key thẻ + key link ngoài', () => {
    const keys = extractPotentialMvuKeys(CARD, [EXTERNAL_JS]).map(k => k.key);
    expect(keys).toContain('姓名');
    expect(keys).toContain('好感度');
  });

  it('file giá trị khởi tạo [initvar] ở link ngoài: quét cả key YAML', () => {
    const keys = extractMvuKeysFromCode('[initvar]\nstat_data:\n  修为:\n    value: 0\n').map(k => k.key);
    expect(keys).toContain('修为');
  });

  it('vaultCodeForCard: chỉ lấy file của ĐÚNG thẻ, và chỉ bản GỐC', () => {
    const vault: ExternalLinkEntry[] = [
      { id: 'a', name: 'status-bar.js', url: 'https://raw.githubusercontent.com/u/r/main/status-bar.js', kind: 'tavern_helper', kindReason: '', original: 'GOC_A', translated: 'DICH_A', updatedAt: 1 },
      { id: 'b', name: 'khac.js', url: 'https://cdn.jsdelivr.net/gh/x/y@main/khac.js', kind: 'other', kindReason: '', original: 'GOC_B', translated: '', updatedAt: 1 },
      { id: 'c', name: 'nhap', url: '', kind: 'other', kindReason: '', original: 'GOC_C', translated: '', cardName: 'Thẻ Link Ngoài', updatedAt: 1 },
    ];
    const urls = [{ url: 'https://cdn.jsdelivr.net/gh/u/r@main/status-bar.js', foundIn: 'regex' }];
    expect(vaultCodeForCard(vault, 'Thẻ Link Ngoài', urls).sort()).toEqual(['GOC_A', 'GOC_C']);
  });
});

/* ── Script nặng: 3 phần ── */
function bigScript(): string {
  const line = 'const a = "好感度"; function f(){ return 1; }\n';
  return line.repeat(Math.ceil(200_000 / line.length));
}

describe('(bug 239) lượt Script nặng sống ngoài React — đóng panel không mất gì', () => {
  beforeEach(() => {
    translateCalls.length = 0;
    translateImpl = async (t) => t.replace(/好感度/g, 'Độ Hảo Cảm');
    useHeavyScriptJob.getState().reset();
    useTranslateActivity.setState({ byField: {} });
  });

  it('chạy hết các phần mà không cần component nào mount; bản ghép nằm trong store', async () => {
    const src = bigScript();
    const n = useHeavyScriptJob.getState().split(src);
    expect(n).toBeGreaterThan(1);
    await useHeavyScriptJob.getState().runAll();
    const st = useHeavyScriptJob.getState();
    expect(st.running).toBe(false);
    expect(st.results.every(Boolean)).toBe(true);
    expect(st.merged).toBe(src.replace(/好感度/g, 'Độ Hảo Cảm'));
    expect(translateCalls).toHaveLength(n);
    expect(translateCalls.every(c => c.fieldName.startsWith(HEAVY_FIELD_PREFIX))).toBe(true);
  });

  it('(bug 240) mỗi phần có số đo: chữ Hán còn sót + độ khớp độ dài', async () => {
    translateImpl = async (t) => t;   // AI trả nguyên văn ⇒ còn nguyên chữ Hán
    useHeavyScriptJob.getState().split(bigScript());
    await useHeavyScriptJob.getState().runAll();
    const info = useHeavyScriptJob.getState().info;
    expect(info.every(x => x.status === 'done')).toBe(true);
    expect(info[0].leftHan).toBeGreaterThan(0);
    expect(info[0].leftHan).toBe(info[0].srcHan);
    expect(info[0].ratio).toBeCloseTo(1, 5);
    expect(info[0].verdict).toMatch(/GIỐNG HỆT/);
  });

  it('Dừng giữa chừng rồi Dịch tiếp: chỉ dịch phần còn thiếu, không dịch lại phần đã xong', async () => {
    const src = bigScript();
    const n = useHeavyScriptJob.getState().split(src);
    let calls = 0;
    translateImpl = async (t) => {
      calls++;
      if (calls === 2) useHeavyScriptJob.getState().stop();   // người dùng bấm Dừng lúc phần 2 đang bay
      return t.replace(/好感度/g, 'Độ Hảo Cảm');
    };
    await useHeavyScriptJob.getState().runAll();
    const doneAfterStop = useHeavyScriptJob.getState().results.filter(Boolean).length;
    expect(doneAfterStop).toBe(1);
    expect(useHeavyScriptJob.getState().running).toBe(false);

    translateCalls.length = 0;
    translateImpl = async (t) => t.replace(/好感度/g, 'Độ Hảo Cảm');
    await useHeavyScriptJob.getState().runAll();
    expect(translateCalls).toHaveLength(n - 1);
    expect(useHeavyScriptJob.getState().merged).toBe(src.replace(/好感度/g, 'Độ Hảo Cảm'));
  });

  it('không cho hai vòng cùng chạy (trước đây mở lại panel rồi bấm Dịch tiếp là ra hai vòng)', async () => {
    const n = useHeavyScriptJob.getState().split(bigScript());
    const a = useHeavyScriptJob.getState().runAll();
    const b = useHeavyScriptJob.getState().runAll();   // bấm lần hai khi vòng một còn sống
    await Promise.all([a, b]);
    expect(translateCalls).toHaveLength(n);
  });

  it('(bug 238) bật đồng bộ MVU ⇒ từ điển MVU được truyền xuống từng phần', async () => {
    const before = useStore.getState().translationConfig;
    useStore.getState().setTranslationConfig({ enableMvuSync: true, mvuDictionary: { 好感度: 'Độ Hảo Cảm' } });
    try {
      useHeavyScriptJob.getState().split(bigScript());
      await useHeavyScriptJob.getState().runAll();
      expect(translateCalls[0].mvuDict).toEqual({ 好感度: 'Độ Hảo Cảm' });
    } finally {
      useStore.getState().setTranslationConfig({ enableMvuSync: before.enableMvuSync, mvuDictionary: before.mvuDictionary });
    }
  });

  it('(bug 240) nhật ký từng bước được ghi lại để panel vẽ', async () => {
    useHeavyScriptJob.getState().split(bigScript());
    await useHeavyScriptJob.getState().runAll();
    const log = useTranslateActivity.getState().byField[HEAVY_FIELD_PREFIX] || [];
    expect(log.some(e => /Bắt đầu phần 1\//.test(e.message))).toBe(true);
    expect(log.some(e => /Xong phần 1\//.test(e.message))).toBe(true);
    expect(log.some(e => /đã ghép/.test(e.message))).toBe(true);
  });
});

describe('(bug 240) nhật ký tiến độ — bộ đệm có trần', () => {
  it('giữ tối đa 300 dòng mỗi field, bỏ dòng cũ nhất', () => {
    useTranslateActivity.setState({ byField: {} });
    for (let i = 0; i < 350; i++) noteActivity('X', 'info', `dòng ${i}`);
    const list = useTranslateActivity.getState().byField.X;
    expect(list).toHaveLength(300);
    expect(list[0].message).toBe('dòng 50');
    expect(list[299].message).toBe('dòng 349');
  });
});
