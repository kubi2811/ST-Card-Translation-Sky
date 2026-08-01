/**
 * (bugNeedFix/181) Kho link ngoài + kiểm tra tham chiếu chéo.
 * ─────────────────────────────────────────────────────────────────────────────
 * Dựng đúng cảnh user mô tả: một thẻ nạp 4 link ngoài (schema, script trạng thái, giao diện,
 * regex). Mỗi file dịch riêng, trong phạm vi từng file nhìn đâu cũng đúng; chỉ khi ráp lại mới
 * lòi ra lệch tên biến. Đây chính là thứ mà trước đây KHÔNG bộ kiểm nào thấy, vì code nằm trên
 * GitHub chứ không nằm trong thẻ.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  classifyExternalLink, upsertLink, removeLink, extractCardExternalUrls,
  matchVaultToCard, suggestNameFromUrl, KIND_LABEL,
  type ExternalLinkEntry,
} from '../externalLinkVault';
import {
  collectCodeRefs, collectDeclaredVars, buildCardRefContext, checkExternalRefs,
  buildRefCheckReport,
} from '../externalRefCheck';

/* ───────────────────────── Dữ liệu dựng cảnh ───────────────────────── */

const SCHEMA_SRC = `
[initvar]
stat_data:
  修为:
    value: 0
  好感度:
    value: 50
`;
const SCHEMA_VI = `
[initvar]
stat_data:
  TuVi:
    value: 0
  DoHaoCam:
    value: 50
`;

/** Script đọc biến rồi vẽ thanh trạng thái; công bố hàm renderPanel cho file giao diện gọi. */
const STATUS_SRC = `
window.renderPanel = function () {
  const tv = _.get(stat_data, '修为.value');
  const hc = stat_data.好感度.value;
  document.getElementById('mvu-bar').innerHTML = '<div class="mvu-row">' + tv + '/' + hc + '</div>';
};
eventOn('MESSAGE_RECEIVED', renderPanel);
`;
const STATUS_VI_OK = `
window.renderPanel = function () {
  const tv = _.get(stat_data, 'TuVi.value');
  const hc = stat_data.DoHaoCam.value;
  document.getElementById('mvu-bar').innerHTML = '<div class="mvu-row">' + tv + '/' + hc + '</div>';
};
eventOn('MESSAGE_RECEIVED', renderPanel);
`;

const mk = (o: Partial<ExternalLinkEntry>): ExternalLinkEntry => ({
  id: o.name || 'x', name: 'link', url: '', kind: 'other', kindReason: '',
  original: '', translated: '', updatedAt: 0, ...o,
} as ExternalLinkEntry);

const cardFields = (initvarVi: string) => ([
  {
    label: 'lorebook[0].content', entryType: 'initvar',
    original: SCHEMA_SRC, translated: initvarVi,
  },
  {
    label: 'description', entryType: undefined,
    original: '<script src="https://cdn.jsdelivr.net/gh/me/cards@main/scripts/status-bar.js"></script>',
    translated: '<script src="https://cdn.jsdelivr.net/gh/me/cards@main/scripts/status-bar.js"></script>',
  },
]);

/* ───────────────────────── Phân loại ───────────────────────── */

describe('classifyExternalLink — phân loại link ngoài', () => {
  it('regex SillyTavern nhận theo cặp khoá đặc trưng', () => {
    const r = classifyExternalLink('x.json', '', '{"scriptName":"UI","findRegex":"/a/","replaceString":"<b>$1</b>"}');
    expect(r.kind).toBe('regex');
    expect(r.reason).toContain('findRegex');
  });

  it('schema: nhận cả lối [initvar] lẫn lối zod', () => {
    expect(classifyExternalLink('a.txt', '', SCHEMA_SRC).kind).toBe('schema');
    expect(classifyExternalLink('b.js', '', 'registerMvuSchema({ stat_data: {} })').kind).toBe('schema');
    expect(classifyExternalLink('c.js', '', 'const S = z.object({ TuVi: z.number() })').kind).toBe('schema');
  });

  it('script TavernHelper nhận theo API nó gọi', () => {
    const r = classifyExternalLink('s.js', '', STATUS_SRC);
    expect(r.kind).toBe('tavern_helper');
    expect(r.reason).toContain('eventOn');
  });

  it('EJS, CSS, HTML thuần', () => {
    expect(classifyExternalLink('t.ejs', '', 'Xin chào <%= name %> nhé').kind).toBe('ejs');
    expect(classifyExternalLink('t.css', '', '.mvu-row { color: red; font-size: 12px; }').kind).toBe('style');
    expect(classifyExternalLink('t.html', '', '<div class="box"><span>Hi</span></div>').kind).toBe('html_ui');
  });

  it('không rõ thì NÓI là không rõ, không đoán liều', () => {
    const r = classifyExternalLink('a.bin', '', 'zzz zzz');
    expect(r.kind).toBe('other');
    expect(r.reason).toContain('bạn tự chọn');
    expect(KIND_LABEL[r.kind]).toBe('Khác');
  });
});

/* ───────────────────────── Kho ───────────────────────── */

describe('Kho link ngoài — nhiều link cùng lúc, không đè nhau', () => {
  it('đây là thứ tab cũ KHÔNG làm được: giữ được 4 link riêng biệt', () => {
    let v: ExternalLinkEntry[] = [];
    for (const n of ['schema.txt', 'status-bar.js', 'ui.js', 'regex.json']) {
      v = upsertLink(v, {
        name: n, url: `https://cdn.jsdelivr.net/gh/me/c@main/${n}`,
        kind: 'other', kindReason: '', original: '', translated: `// ${n}`,
      });
    }
    expect(v).toHaveLength(4);
    expect(new Set(v.map(e => e.id)).size).toBe(4);
  });

  it('đăng lại cùng một URL thì CẬP NHẬT, không đẻ mục trùng', () => {
    let v = upsertLink([], { name: 'a.js', url: 'https://x/a.js', kind: 'other', kindReason: '', original: '1', translated: 'v1' });
    const id = v[0].id;
    v = upsertLink(v, { name: 'a.js (đổi tên)', url: 'https://x/a.js', kind: 'regex', kindReason: 'r', original: '1', translated: 'v2' });
    expect(v).toHaveLength(1);
    expect(v[0].id).toBe(id);
    expect(v[0].translated).toBe('v2');
    expect(v[0].kind).toBe('regex');
  });

  it('xoá theo id', () => {
    const v = upsertLink([], { name: 'a', url: '', kind: 'other', kindReason: '', original: '', translated: '' });
    expect(removeLink(v, v[0].id)).toHaveLength(0);
  });

  it('gợi ý tên từ URL (bỏ query/hash)', () => {
    expect(suggestNameFromUrl('https://cdn.jsdelivr.net/gh/me/c@main/scripts/status-bar.js?v=2')).toBe('status-bar.js');
  });
});

describe('Dò link ngoài mà THẺ đang nạp', () => {
  it('bắt link code, bỏ qua ảnh', () => {
    const urls = extractCardExternalUrls([
      { label: 'description', original: '<script src="https://cdn.jsdelivr.net/gh/me/c@main/a.js"></script>' },
      { label: 'first_mes', original: '<img src="https://i.imgur.com/abc.png">' },
      { label: 'lore[1]', translated: '<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/me/c@main/ui.css">' },
    ]);
    expect(urls.map(u => u.url)).toEqual([
      'https://cdn.jsdelivr.net/gh/me/c@main/a.js',
      'https://cdn.jsdelivr.net/gh/me/c@main/ui.css',
    ]);
    expect(urls[0].foundIn).toBe('description');
  });

  it('so kho với thẻ theo TÊN FILE — cùng file nhưng khác dạng URL vẫn khớp', () => {
    const cardUrls = extractCardExternalUrls([
      { label: 'd', original: '<script src="https://cdn.jsdelivr.net/gh/me/c@main/status-bar.js"></script>' },
      { label: 'd', original: '<script src="https://cdn.jsdelivr.net/gh/me/c@main/chua-luu.js"></script>' },
    ]);
    const vault = [mk({ name: 'status-bar.js', url: 'https://raw.githubusercontent.com/me/c/main/status-bar.js' })];
    const { covered, missing } = matchVaultToCard(cardUrls, vault);
    expect(covered).toHaveLength(1);
    expect(missing.map(m => m.url)).toEqual(['https://cdn.jsdelivr.net/gh/me/c@main/chua-luu.js']);
  });
});

/* ───────────────────────── Bóc tham chiếu ───────────────────────── */

describe('collectCodeRefs', () => {
  it('bóc biến MVU qua mọi lối viết thường gặp', () => {
    const r = collectCodeRefs(`
      const a = stat_data.修为.value;
      const b = _.get(stat_data, '好感度.value');
      _.set(stat_data, 'ThanhTuu.value', 1);
      const c = getvar('DiemDanh');
      const d = "{{getvar::NgayChoi}}";
      const e = '<span data-var="TuVi"></span>';
    `);
    expect([...r.varReads]).toEqual(expect.arrayContaining(['修为', '好感度', 'DiemDanh', 'NgayChoi', 'TuVi']));
    expect([...r.varWrites]).toContain('ThanhTuu');
  });

  it('bóc id/class và tên toàn cục', () => {
    const r = collectCodeRefs(STATUS_SRC);
    expect(r.globalDefs).toContain('renderPanel');
    expect(r.domUses).toContain('mvu-bar');
    expect(r.domDefs).toContain('mvu-row');
  });

  it('bỏ qua mảnh tên vô nghĩa (value, data, stat_data…)', () => {
    const r = collectCodeRefs(`stat_data.TuVi.value`);
    expect(r.varReads.has('value')).toBe(false);
    expect(r.varReads.has('stat_data')).toBe(false);
    expect(r.varReads.has('TuVi')).toBe(true);
  });

  it('collectDeclaredVars đọc được cả YAML lẫn zod', () => {
    expect([...collectDeclaredVars(SCHEMA_VI)]).toEqual(expect.arrayContaining(['TuVi', 'DoHaoCam']));
    expect([...collectDeclaredVars('z.object({ TuVi: z.number(), DoHaoCam: z.number() })')])
      .toEqual(expect.arrayContaining(['TuVi', 'DoHaoCam']));
  });
});

/* ───────────────────────── Kiểm tra chéo ───────────────────────── */

describe('checkExternalRefs — ca thật của user', () => {
  const ctxOf = (initvarVi: string, urls = []) =>
    buildCardRefContext(cardFields(initvarVi) as never, {}, urls);

  it('dịch ĐỒNG BỘ (thẻ và link cùng đổi 修为→TuVi) thì KHÔNG kêu oan', () => {
    const vault = [
      mk({ id: 's', name: 'schema.txt', kind: 'schema', original: SCHEMA_SRC, translated: SCHEMA_VI }),
      mk({ id: 'b', name: 'status-bar.js', kind: 'tavern_helper', original: STATUS_SRC, translated: STATUS_VI_OK }),
    ];
    const rep = checkExternalRefs(vault, ctxOf(SCHEMA_VI));
    expect(rep.issues.filter(i => i.severity === 'error')).toEqual([]);
    expect(rep.ok).toBe(true);
  });

  it('LINK đổi tên một mình, THẺ giữ tên cũ ⇒ báo lỗi đích danh', () => {
    // Thẻ chưa dịch xong: [initvar] vẫn là 修为/好感度. Link thì đã dịch sang TuVi/DoHaoCam.
    const vault = [
      mk({ id: 'b', name: 'status-bar.js', kind: 'tavern_helper', original: STATUS_SRC, translated: STATUS_VI_OK }),
    ];
    const rep = checkExternalRefs(vault, ctxOf(SCHEMA_SRC));
    const lost = rep.issues.filter(i => i.kind === 'var_lost');
    expect(lost.length).toBeGreaterThanOrEqual(2);
    expect(lost.map(i => i.detail).join(' ')).toContain('修为');
    expect(lost[0].link).toBe('status-bar.js');
    expect(lost[0].detail).toContain('đứng im');
    expect(rep.ok).toBe(false);
  });

  it('link đọc biến KHÔNG ai khai ⇒ biến mồ côi, kèm gợi ý tên gần nhất', () => {
    const typo = STATUS_VI_OK.replace("'TuVi.value'", "'TuVii.value'");
    const vault = [
      mk({ id: 's', name: 'schema.txt', kind: 'schema', original: SCHEMA_SRC, translated: SCHEMA_VI }),
      mk({ id: 'b', name: 'status-bar.js', kind: 'tavern_helper', original: STATUS_SRC, translated: typo }),
    ];
    const rep = checkExternalRefs(vault, ctxOf(SCHEMA_VI));
    const orphan = rep.issues.find(i => i.kind === 'var_orphan');
    expect(orphan?.detail).toContain('TuVii');
    expect(orphan?.detail).toContain('undefined');
    expect(orphan?.suggestion).toBe('TuVi');
  });

  it('hàm toàn cục bị đổi tên ở link này, link kia vẫn gọi ⇒ báo cả hai đầu', () => {
    const uiSrc = `document.getElementById('mvu-bar').onclick = () => renderPanel();`;
    const vault = [
      mk({ id: 'b', name: 'status-bar.js', kind: 'tavern_helper',
           original: STATUS_SRC, translated: STATUS_SRC.replace(/renderPanel/g, 'veBang') }),
      mk({ id: 'u', name: 'ui.js', kind: 'tavern_helper', original: uiSrc, translated: uiSrc }),
    ];
    const rep = checkExternalRefs(vault, ctxOf(SCHEMA_SRC));
    const g = rep.issues.find(i => i.kind === 'global_lost');
    expect(g?.detail).toContain('renderPanel');
    expect(g?.detail).toContain('ui.js');
    expect(g?.suggestion).toBe('veBang');
  });

  it('id/class bị đổi ở link này, link kia vẫn đi tìm ⇒ cảnh báo giao diện trống', () => {
    const uiSrc = `<div id="mvu-bar"></div>`;
    const vault = [
      mk({ id: 'u', name: 'ui.html', kind: 'html_ui', original: uiSrc, translated: `<div id="thanh-mvu"></div>` }),
      mk({ id: 'b', name: 'status-bar.js', kind: 'tavern_helper', original: STATUS_SRC, translated: STATUS_SRC }),
    ];
    const rep = checkExternalRefs(vault, ctxOf(SCHEMA_SRC));
    const d = rep.issues.find(i => i.kind === 'dom_lost');
    expect(d?.detail).toContain('mvu-bar');
    expect(d?.detail).toContain('status-bar.js');
    expect(d?.severity).toBe('warning');
  });

  it('VÙNG MÙ: thẻ nạp link mà kho chưa có thì phải NÓI RA, không im lặng báo sạch', () => {
    const ctx = buildCardRefContext(
      cardFields(SCHEMA_VI) as never, {},
      extractCardExternalUrls(cardFields(SCHEMA_VI) as never),
    );
    const rep = checkExternalRefs([], ctx);
    expect(rep.stats.blindSpots).toBe(1);
    const miss = rep.issues.find(i => i.kind === 'link_missing');
    expect(miss?.detail).toContain('KHÔNG nhìn thấy code');
    expect(rep.summary).toContain('vùng mù');
  });

  it('kho rỗng thì nói thẳng là chưa đối chiếu được gì (không giả vờ sạch)', () => {
    const rep = checkExternalRefs([], ctxOf(SCHEMA_VI));
    expect(rep.summary).toContain('chưa đối chiếu được');
  });

  it('mục chưa dịch được ghi nhận riêng, không lẫn vào lỗi', () => {
    const vault = [mk({ id: 'a', name: 'moi-them.js', original: STATUS_SRC, translated: '' })];
    const rep = checkExternalRefs(vault, ctxOf(SCHEMA_VI));
    expect(rep.issues.find(i => i.kind === 'link_untranslated')?.severity).toBe('info');
    expect(rep.ok).toBe(true);
  });

  it('kho phân biệt được file schema — thiếu bước này thì mọi biến đều bị vu là mồ côi', () => {
    // Trước khi có collectDeclaredVars, file schema viết bằng zod đóng góp 0 tên biến, nên link
    // đọc TuVi/DoHaoCam đều thành "không ai khai" — cả một màn hình lỗi giả.
    const zodSchema = `registerMvuSchema(z.object({ TuVi: z.number(), DoHaoCam: z.number() }))`;
    const vault = [
      mk({ id: 's', name: 'schema.js', kind: 'schema', original: zodSchema, translated: zodSchema }),
      mk({ id: 'b', name: 'status-bar.js', kind: 'tavern_helper', original: STATUS_VI_OK, translated: STATUS_VI_OK }),
    ];
    // Thẻ KHÔNG khai gì (biến nằm hết ở file schema ngoài) — vẫn không được kêu oan.
    const ctx = buildCardRefContext([], { TuVi: 'TuVi' }, []);
    const rep = checkExternalRefs(vault, ctx);
    expect(rep.issues.filter(i => i.kind === 'var_orphan')).toEqual([]);
  });

  it('báo cáo Markdown nêu đủ vùng mù + kết luận', () => {
    const ctx = buildCardRefContext(
      cardFields(SCHEMA_SRC) as never, {},
      extractCardExternalUrls(cardFields(SCHEMA_SRC) as never),
    );
    const vault = [mk({ id: 'b', name: 'status-bar.js', kind: 'tavern_helper', original: STATUS_SRC, translated: STATUS_VI_OK })];
    const md = buildRefCheckReport(checkExternalRefs(vault, ctx), 'Thẻ thử');
    expect(md).toContain('# Kiểm tra tham chiếu link ngoài — Thẻ thử');
    expect(md).toContain('❌ Lỗi');
    expect(md).toContain('修为');
  });
});

/* ─────────────────────────── Nối dây ───────────────────────────
   Đây là chỗ bug 181 THỰC SỰ nằm: VerifyPanel gom `regexFields` từ field của thẻ, thẻ dùng link
   ngoài thì tập đó rỗng và cả phép kiểm rơi vào `else { setCrossCheckResult(null) }` — tắt hẳn,
   tắt trong im lặng. Test này giữ cho cái dây vừa nối không bị ai gỡ ra lần nữa. */
const readSrc = (rel: string) =>
  readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

describe('VerifyPanel phải ĐỌC kho link ngoài', () => {
  const SRC = readSrc('../../components/VerifyPanel.tsx');

  it('bản dịch trong kho được nối vào chính tập regexFields của phép kiểm chéo', () => {
    expect(SRC).toContain('const vaultFields = externalVault');
    // Phải nằm TRONG regexFields thì điều kiện `regexFields.length > 0` mới thôi rơi vào else.
    const block = SRC.slice(SRC.indexOf('const regexFields'), SRC.indexOf('const initvarFields'));
    expect(block).toContain('.concat(vaultFields)');
  });

  it('có chạy thêm phép kiểm tham chiếu chéo giữa các link', () => {
    expect(SRC).toContain('checkExternalRefs(externalVault');
    expect(SRC).toContain('extractCardExternalUrls(fields)');
  });

  it('kho rỗng mà thẻ có link ngoài thì phải NÓI là chưa kiểm, không im', () => {
    expect(SRC).toContain('extRefReport.stats.translatedLinks === 0');
    expect(SRC).toContain('KHÔNG được kiểm');
  });
});

describe('Tab Link ngoài phải lưu được nhiều link', () => {
  const SRC = readSrc('../../components/ExternalLinkTab.tsx');

  it('có kho + nút kiểm tra, và tự lưu khi đăng lên GitHub', () => {
    expect(SRC).toContain('loadVault');
    expect(SRC).toContain('runRefCheck');
    // Đăng lên Git là lúc duy nhất biết chắc URL của file — bỏ lỡ là mất dấu.
    const publish = SRC.slice(SRC.indexOf('const handlePublish'), SRC.indexOf('/* ═══════════ (bugNeedFix/181)'));
    expect(publish).toContain('saveCurrentToVault(cdn');
  });
});
