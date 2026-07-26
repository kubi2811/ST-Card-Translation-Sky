// (Goal 104) Auto v4 — DAG phụ thuộc + final_check harness đủ vòng + EJS parse.
import { describe, it, expect } from 'vitest';
import { STEP_DEPS, buildFinalCheckReport } from '../autoCreatorPipeline';
import type { AutoCreatorStep } from '../../../types';

// ═══ 104.2 — DAG ═══

describe('STEP_DEPS — DAG phụ thuộc', () => {
  const steps = Object.keys(STEP_DEPS) as AutoCreatorStep[];

  it('không có chu trình (topological sort được hết)', () => {
    const done = new Set<string>();
    let remaining = [...steps];
    let guard = 0;
    while (remaining.length && guard++ < 20) {
      const ready = remaining.filter(s => STEP_DEPS[s].every(d => done.has(d)));
      expect(ready.length).toBeGreaterThan(0); // kẹt = có chu trình
      ready.forEach(s => done.add(s));
      remaining = remaining.filter(s => !done.has(s));
    }
    expect(remaining).toEqual([]);
  });

  it('mô phỏng wave: basic_info một mình → 3 bước song song → …; final_check CUỐI CÙNG', () => {
    // Mô phỏng đúng thuật toán wave trong pipeline (dep không được chọn thì bỏ qua).
    const selected = new Set<AutoCreatorStep>(steps);
    const finished = new Set<AutoCreatorStep>();
    const pending = new Set<AutoCreatorStep>(selected);
    const waves: AutoCreatorStep[][] = [];
    let guard = 0;
    while (pending.size && guard++ < 20) {
      let wave = [...pending].filter(s => STEP_DEPS[s].every(d => !pending.has(d) || finished.has(d)));
      wave = wave.filter((s, _i, arr) => s !== 'final_check' || arr.length === 1);
      expect(wave.length).toBeGreaterThan(0);
      waves.push(wave);
      wave.forEach(s => { pending.delete(s); finished.add(s); });
    }
    expect(waves[0]).toEqual(['basic_info']);
    // Đợt 2 phải chạy ĐƯỢC NHIỀU BƯỚC song song (lorebook ∥ system_prompt ∥ mes_example)
    expect(waves[1].length).toBeGreaterThanOrEqual(3);
    expect(waves[1]).toContain('lorebook');
    expect(waves[1]).toContain('system_prompt');
    // final_check là wave cuối và đứng MỘT MÌNH
    const last = waves[waves.length - 1];
    expect(last).toEqual(['final_check']);
    // regex/game_ui phải chạy SAU mvuzod
    const waveOf = (s: AutoCreatorStep) => waves.findIndex(w => w.includes(s));
    expect(waveOf('regex')).toBeGreaterThan(waveOf('mvuzod'));
    expect(waveOf('game_ui')).toBeGreaterThan(waveOf('mvuzod'));
    expect(waveOf('mvuzod')).toBeGreaterThan(waveOf('lorebook'));
  });

  it('bước bỏ chọn không chặn bước sau (dep chỉ tính khi được chọn)', () => {
    // User chỉ chọn regex + final_check (mvuzod đã chạy từ trước) → regex phải chạy được ngay.
    const pending = new Set<AutoCreatorStep>(['regex', 'final_check']);
    const finished = new Set<AutoCreatorStep>();
    const wave = [...pending].filter(s => STEP_DEPS[s].every(d => !pending.has(d) || finished.has(d)))
      .filter((s, _i, arr) => s !== 'final_check' || arr.length === 1);
    expect(wave).toEqual(['regex']);
  });
});

// ═══ 104.4 — final_check v2: harness đủ vòng + EJS ═══

type FakeStore = Parameters<typeof buildFinalCheckReport>[0];

function makeCard(over: {
  entries?: Array<Record<string, unknown>>;
  schema?: unknown;
  regexScripts?: Array<Record<string, unknown>>;
}): FakeStore {
  return {
    card: {
      data: {
        name: 'Test', description: 'mô tả', first_mes: 'chào',
        character_book: { name: 'wb', entries: over.entries ?? [] },
        extensions: {
          regex_scripts: over.regexScripts ?? [],
          ...(over.schema ? { mvuzod: { schema: over.schema } } : {}),
        },
      },
    },
  } as unknown as FakeStore;
}

const SCHEMA = {
  version: '1.0',
  fields: [
    { path: '/Người Chơi', type: 'object', label: 'NC', constraints: {}, defaultValue: {},
      children: [
        { path: '/Người Chơi/HP', type: 'number', label: 'HP', constraints: {}, defaultValue: 100 },
        { path: '/Người Chơi/Tên', type: 'string', label: 'Tên', constraints: {}, defaultValue: 'x' },
      ] },
  ],
};

const UPDATE_ENTRY = {
  comment: '[mvu_update] Định dạng', enabled: true,
  content: '<UpdateVariable>\n<Analysis>a</Analysis>\n<JSONPatch>[]</JSONPatch>\n</UpdateVariable>',
};

describe('buildFinalCheckReport — harness đủ vòng (104.4)', () => {
  it('initvar JSON KHỚP schema → dòng ✅ Harness, không tính lỗi harness', async () => {
    const initvar = {
      comment: '[InitVar]', enabled: false,
      content: JSON.stringify({ 'Người Chơi': { HP: [100, 'máu'], 'Tên': ['x', 'tên'] } }),
    };
    const r = await buildFinalCheckReport(makeCard({ entries: [initvar, UPDATE_ENTRY], schema: SCHEMA }));
    expect(r.lines.some(l => l.includes('✅ Harness đủ vòng'))).toBe(true);
    expect(r.lines.some(l => l.includes('❌ Harness'))).toBe(false);
  });

  it('CHÍNH LỚP LỖI 4-HỆ-TÊN-BIẾN: initvar dùng cây tên KHÁC schema → ❌ Harness FAIL', async () => {
    const initvar = {
      comment: '[InitVar]', enabled: false,
      // Cây initvar là "Player" trong khi schema là "Người Chơi" — mọi kiểm tĩnh cũ đều lọt.
      content: JSON.stringify({ Player: { HP: [100, 'máu'] } }),
    };
    const r = await buildFinalCheckReport(makeCard({ entries: [initvar, UPDATE_ENTRY], schema: SCHEMA }));
    expect(r.lines.some(l => l.includes('❌ Harness đủ vòng FAIL'))).toBe(true);
  });

  it('initvar YAML (không phải JSON) → bỏ qua harness với ghi chú, KHÔNG báo lỗi oan', async () => {
    const initvar = {
      comment: '[InitVar]', enabled: false,
      content: 'Người Chơi:\n  HP: [100, "máu"]',
    };
    const r = await buildFinalCheckReport(makeCard({ entries: [initvar, UPDATE_ENTRY], schema: SCHEMA }));
    expect(r.lines.some(l => l.includes('harness đủ vòng bỏ qua'))).toBe(true);
    expect(r.lines.some(l => l.includes('❌ Harness'))).toBe(false);
  });
});

// ═══ 3 FALSE POSITIVE bắt được khi CHẠY THẬT bằng API (goal 104) ═══

describe('buildFinalCheckReport — hết báo đỏ oan (bằng chứng từ lượt chạy thật)', () => {
  it('data-var viết JSON-pointer "/A/B" hoặc dot-path "A.B" → KHÔNG báo lệch schema nữa', async () => {
    const initvar = { comment: '[InitVar]', enabled: false, content: JSON.stringify({ 'Người Chơi': { HP: [100, 'm'] } }) };
    const scripts = [
      { scriptName: 'Bar', findRegex: '<X/>', replaceString: '<span data-var="/Người Chơi/HP"></span>' },
      { scriptName: 'Bar2', findRegex: '<Y/>', replaceString: '<span data-var="Người Chơi.HP"></span>' },
    ];
    const r = await buildFinalCheckReport(makeCard({ entries: [initvar, UPDATE_ENTRY], schema: SCHEMA, regexScripts: scripts }));
    expect(r.lines.some(l => l.includes('data-var trong regex KHÔNG khớp'))).toBe(false);
    expect(r.lines.some(l => l.includes('✅ Mọi data-var trong regex khớp tên biến schema'))).toBe(true);
  });

  it('data-var bịa thật vẫn phải bị bắt (không nới lỏng quá tay)', async () => {
    const scripts = [{ scriptName: 'Bar', findRegex: '<X/>', replaceString: '<span data-var="/Không Có/Biến Này"></span>' }];
    const initvar = { comment: '[InitVar]', enabled: false, content: JSON.stringify({ 'Người Chơi': { HP: [100, 'm'] } }) };
    const r = await buildFinalCheckReport(makeCard({ entries: [initvar, UPDATE_ENTRY], schema: SCHEMA, regexScripts: scripts }));
    expect(r.lines.some(l => l.includes('data-var trong regex KHÔNG khớp'))).toBe(true);
  });

  it('fence ``` chưa đóng NẰM GIỮA nội dung → vẫn bắt được (không chỉ khi ở đầu/cuối)', async () => {
    const F = '`'.repeat(3);
    const scripts = [{ scriptName: 'Form', findRegex: '<X/>', replaceString: `Lời dẫn\n${F}html\n<div>x</div>\n(quên đóng fence)` }];
    const r = await buildFinalCheckReport(makeCard({ regexScripts: scripts }));
    expect(r.lines.some(l => l.includes('THIẾU') && l.includes('đóng ở cuối'))).toBe(true);
  });

  it('fence mở+đóng đủ cặp → không báo lỗi', async () => {
    const F = '`'.repeat(3);
    const scripts = [{ scriptName: 'Form', findRegex: '<X/>', replaceString: `${F}html\n<div>x</div>\n${F}\nĐuôi` }];
    const r = await buildFinalCheckReport(makeCard({ regexScripts: scripts }));
    expect(r.lines.some(l => l.includes('đóng ở cuối'))).toBe(false);
  });

  it('handler đưa ra global bằng Object.assign(window,{…}) hoặc window["fn"] → KHÔNG báo "bấm không chạy"', async () => {
    const scripts = [
      { scriptName: 'Form A', findRegex: '<X/>', replaceString:
        `<button onclick="goToPage(1)">x</button><script type="module">function goToPage(n){}\nObject.assign(window, { goToPage, other });</script>` },
      { scriptName: 'Form B', findRegex: '<Y/>', replaceString:
        `<button onclick="onConfirm()">x</button><script type="module">function onConfirm(){}\nwindow['onConfirm'] = onConfirm;</script>` },
    ];
    const r = await buildFinalCheckReport(makeCard({ regexScripts: scripts }));
    expect(r.lines.some(l => l.includes('BẤM KHÔNG CHẠY'))).toBe(false);
    expect(r.lines.some(l => l.includes('✅ Mọi handler gọi từ onclick='))).toBe(true);
  });

  it('handler THẬT SỰ kẹt trong module (không gán global) vẫn bị bắt', async () => {
    const scripts = [{ scriptName: 'Form', findRegex: '<X/>', replaceString:
      `<button onclick="goToPage(1)">x</button><script type="module">function goToPage(n){}</script>` }];
    const r = await buildFinalCheckReport(makeCard({ regexScripts: scripts }));
    expect(r.lines.some(l => l.includes('BẤM KHÔNG CHẠY'))).toBe(true);
  });
});

describe('buildFinalCheckReport — EJS parse (104.4)', () => {
  it('entry @@preprocessing vỡ cú pháp (tag không cân / this.variables) → ❌ đích danh', async () => {
    const badEjs = {
      comment: 'EJS: Controller', enabled: true,
      content: '@@preprocessing\n<%_ var x = this.variables.hp;', // this.variables + thiếu _%>
    };
    const r = await buildFinalCheckReport(makeCard({ entries: [badEjs] }));
    expect(r.lines.some(l => l.startsWith('❌ EJS'))).toBe(true);
    expect(r.problems).toBeGreaterThan(0);
  });

  it('entry EJS sạch → dòng ✅ parse sạch', async () => {
    const okEjs = {
      comment: 'EJS: Controller', enabled: true,
      content: `@@preprocessing\n<%_ var hp = getvar('stat_data.HP', { defaults: 100 }); _%>`,
    };
    const r = await buildFinalCheckReport(makeCard({ entries: [okEjs] }));
    expect(r.lines.some(l => l.includes('entry EJS (@@preprocessing) parse sạch'))).toBe(true);
  });
});
