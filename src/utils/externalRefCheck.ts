/**
 * src/utils/externalRefCheck.ts — (bugNeedFix/181) KIỂM TRA THAM CHIẾU CHÉO CHO LINK NGOÀI.
 * ─────────────────────────────────────────────────────────────────────────────
 * User: "nếu có lỗi biến số (variable error) trong các link đó, tool phải có dữ liệu đã lưu để
 * quét và phát hiện lỗi."
 *
 * Thẻ dùng 4-5 link ngoài là một CHƯƠNG TRÌNH BỊ XÉ RA NHIỀU FILE: file schema khai biến, file
 * script đọc/ghi biến, file regex render biến ra màn hình. Dịch từng file riêng lẻ thì trong
 * phạm vi một file nhìn đâu cũng đúng — chỉ khi ráp lại mới lòi ra: file A đổi tên biến, file B
 * vẫn gọi tên cũ, thế là chỉ số đứng im hoặc hiện "undefined" lúc chơi. Không có lỗi cú pháp,
 * không có chữ Hán sót, nên MỌI bộ kiểm hiện có đều thấy sạch.
 *
 * NGUYÊN TẮC BÁO LỖI Ở ĐÂY (giống bug 178/180): CHỈ báo khi có BẰNG CHỨNG Ở BẢN GỐC.
 * Một cái tên chỉ bị coi là "gãy" khi bản GỐC từng có nó mà bản DỊCH không còn — lúc đó chắc
 * chắn do dịch. Tên lạ chưa từng thấy ở gốc thì im, vì đó có thể là API của SillyTavern, của
 * lodash, của trình duyệt — báo bừa mấy thứ đó là biến bộ kiểm thành máy kêu oan, mà máy kêu oan
 * thì lần sau không ai đọc nữa.
 */
import { extractInitvarDefinitions } from './mvuValidator';
import type { ExternalLinkEntry, CardExternalUrl } from './externalLinkVault';

/* ─────────────────────────── Bóc tham chiếu ─────────────────────────── */

export interface CodeRefs {
  /** Tên biến MVU/ST bị ĐỌC. */
  varReads: Set<string>;
  /** Tên biến MVU/ST bị GHI. */
  varWrites: Set<string>;
  /** id/class do chính file này tạo ra trong HTML. */
  domDefs: Set<string>;
  /** id/class file này đi tìm (getElementById, querySelector…). */
  domUses: Set<string>;
  /** Hàm/biến toàn cục file này công bố ra cho file khác dùng. */
  globalDefs: Set<string>;
  /** Tên toàn cục file này gọi. */
  globalUses: Set<string>;
}

/** Mảnh tên vô nghĩa để đối chiếu: từ khoá JS, chỗ nối của MVU, tên quá chung. */
const NOISE = new Set([
  'value', 'values', 'data', 'stat_data', 'variables', 'display', 'length', 'name', 'type', 'key',
  'id', 'index', 'item', 'list', 'text', 'html', 'style', 'class', 'className', 'push', 'map',
  'filter', 'forEach', 'join', 'split', 'slice', 'toString', 'valueOf', 'constructor', 'prototype',
  'undefined', 'null', 'true', 'false', 'this', 'window', 'document', 'console', 'json', 'JSON',
  'get', 'set', 'add', 'remove', 'update', 'init', 'main', 'run', 'now', 'max', 'min',
]);

const isNoise = (s: string) => !s || s.length < 2 || /^\d+$/.test(s) || NOISE.has(s);

function addPath(into: Set<string>, path: string): void {
  for (const seg of String(path).split(/[.[\]'"]+/)) {
    const s = seg.trim();
    if (!isNoise(s)) into.add(s);
  }
}

/**
 * Bóc mọi tham chiếu ra khỏi một file code.
 * Quét bằng regex chứ không dựng AST: nguồn ở đây là hổ lốn JS + HTML + CSS + macro {{…}} trong
 * cùng một file, parser JS sẽ chết ngay dòng đầu. Regex thì bao được cả mớ, và vì luật báo lỗi
 * đã buộc phải có bằng chứng ở bản gốc nên bóc thừa vài cái cũng không đẻ ra cảnh báo oan.
 */
export function collectCodeRefs(code: string): CodeRefs {
  const refs: CodeRefs = {
    varReads: new Set(), varWrites: new Set(),
    domDefs: new Set(), domUses: new Set(),
    globalDefs: new Set(), globalUses: new Set(),
  };
  if (!code) return refs;

  // ── Biến MVU/ST ──
  // 1. stat_data.a.b / stat_data['a']['b'] / variables.stat_data.a
  for (const m of code.matchAll(/stat_data((?:\s*\.\s*[\w一-鿿$]+|\s*\[\s*['"][^'"]+['"]\s*\])+)/g)) {
    addPath(refs.varReads, m[1]);
  }
  // 2. _.get(x, 'a.b') đọc — _.set(x, 'a.b', v) ghi
  for (const m of code.matchAll(/_\s*\.\s*(get|set|has|update|unset)\s*\(\s*[^,()]+,\s*['"]([^'"]+)['"]/g)) {
    addPath(m[1] === 'get' || m[1] === 'has' ? refs.varReads : refs.varWrites, m[2]);
  }
  // 3. macro {{getvar::X}} / {{setvar::X::v}}
  for (const m of code.matchAll(/\{\{(get|set|add)(?:global)?var::([^:}]+)/g)) {
    addPath(m[1] === 'get' ? refs.varReads : refs.varWrites, m[2]);
  }
  // 4. getvar('X') / setVariable("X") / Mvu.getMvuVariable('a.b')
  for (const m of code.matchAll(/\b(get|set|add)(?:global)?[Vv]ar(?:iable)?s?\s*\(\s*['"]([^'"]+)['"]/g)) {
    addPath(m[1] === 'get' ? refs.varReads : refs.varWrites, m[2]);
  }
  for (const m of code.matchAll(/\bMvu\s*\.\s*(get|set)MvuVariable\s*\(\s*[^,()]*,?\s*['"]([^'"]+)['"]/g)) {
    addPath(m[1] === 'get' ? refs.varReads : refs.varWrites, m[2]);
  }
  // 5. data-var="X" trong HTML render
  for (const m of code.matchAll(/data-var\s*=\s*["']([^"']+)["']/g)) {
    addPath(refs.varReads, m[1]);
  }

  // ── id/class trong HTML ──
  for (const m of code.matchAll(/\bid\s*=\s*["']([\w-]{2,})["']/g)) refs.domDefs.add(m[1]);
  for (const m of code.matchAll(/\bclass\s*=\s*["']([^"']+)["']/g)) {
    for (const cls of m[1].split(/\s+/)) if (cls.length >= 2) refs.domDefs.add(cls);
  }
  for (const m of code.matchAll(/getElementById\s*\(\s*['"]([\w-]{2,})['"]/g)) refs.domUses.add(m[1]);
  for (const m of code.matchAll(/getElementsByClassName\s*\(\s*['"]([\w-]{2,})['"]/g)) refs.domUses.add(m[1]);
  // querySelector('#x') / $('.y') — lấy đúng một mã định danh đơn, khỏi dính selector phức tạp
  for (const m of code.matchAll(/(?:querySelector(?:All)?|\$)\s*\(\s*['"]([#.])([\w-]{2,})['"]\s*\)/g)) {
    refs.domUses.add(m[2]);
  }

  // ── Tên toàn cục công bố / gọi ──
  for (const m of code.matchAll(/\b(?:window|globalThis)\s*\.\s*([A-Za-z_$][\w$]*)\s*=(?!=)/g)) {
    refs.globalDefs.add(m[1]);
  }
  for (const m of code.matchAll(/^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) {
    refs.globalDefs.add(m[1]);
  }
  for (const m of code.matchAll(/\b([A-Za-z_$][\w$]{2,})\s*\(/g)) {
    if (!isNoise(m[1])) refs.globalUses.add(m[1]);
  }

  return refs;
}

/**
 * Bóc những biến mà một file KHAI BÁO (chứ không phải đọc/ghi).
 * File schema có hai lối viết phổ biến và chúng khác hẳn nhau về hình dạng, nên phải bắt cả hai:
 *   • YAML/[initvar]:  `修为:` — tái dùng đúng bộ bóc mà thẻ vẫn dùng, khỏi lệch chuẩn;
 *   • zod:             `TuVi: z.number()`.
 * Không có bước này thì file schema đóng góp con số 0 vào danh sách "biến có thật", và mọi link
 * đọc biến đều bị vu là mồ côi.
 */
export function collectDeclaredVars(code: string): Set<string> {
  const out = new Set<string>();
  if (!code) return out;
  for (const d of extractInitvarDefinitions(code)) if (!isNoise(d)) out.add(d);
  for (const m of code.matchAll(/(['"]?)([\w一-鿿$]+)\1\s*:\s*z\s*\./g)) {
    if (!isNoise(m[2])) out.add(m[2]);
  }
  return out;
}

/* ─────────────────────────── Báo cáo ─────────────────────────── */

export type RefIssueKind =
  | 'var_orphan'        // link đọc một biến mà không nơi nào khai
  | 'var_lost'          // biến có ở bản GỐC của link, bản dịch không còn
  | 'global_lost'       // hàm toàn cục có ở gốc, bản dịch không còn, mà link khác vẫn gọi
  | 'dom_lost'          // id/class có ở gốc, bản dịch không còn, mà link khác vẫn tìm
  | 'link_missing'      // thẻ nạp link này nhưng kho chưa có bản dịch ⇒ vùng mù
  | 'link_untranslated';// mục trong kho chưa có bản dịch

export type RefSeverity = 'error' | 'warning' | 'info';

export interface RefIssue {
  severity: RefSeverity;
  kind: RefIssueKind;
  /** Tên link liên quan (hoặc URL với link_missing). */
  link: string;
  detail: string;
  /** Tên gần giống nhất trong số tên đang có — gợi ý sửa. */
  suggestion?: string;
}

export interface RefCheckReport {
  issues: RefIssue[];
  stats: {
    links: number;
    translatedLinks: number;
    knownVars: number;
    checkedRefs: number;
    /** Link của thẻ chưa có trong kho — số này >0 nghĩa là kiểm tra CÒN VÙNG MÙ. */
    blindSpots: number;
  };
  /** true = không còn vấn đề mức 'error'. */
  ok: boolean;
  summary: string;
}

/** Độ giống bigram (Dice) — để gợi ý "ý bạn là biến này?". */
function dice(a: string, b: string): number {
  const la = a.toLowerCase(), lb = b.toLowerCase();
  if (la === lb) return 1;
  if (la.length < 2 || lb.length < 2) return 0;
  const grams = new Map<string, number>();
  for (let i = 0; i < la.length - 1; i++) {
    const g = la.slice(i, i + 2);
    grams.set(g, (grams.get(g) || 0) + 1);
  }
  let hit = 0;
  for (let i = 0; i < lb.length - 1; i++) {
    const g = lb.slice(i, i + 2);
    const n = grams.get(g) || 0;
    if (n > 0) { hit++; grams.set(g, n - 1); }
  }
  return (2 * hit) / (la.length - 1 + lb.length - 1);
}

function closest(name: string, pool: Iterable<string>): string | undefined {
  let best = '', score = 0;
  for (const cand of pool) {
    const s = dice(name, cand);
    if (s > score && s >= 0.45) { score = s; best = cand; }
  }
  return best || undefined;
}

/**
 * Đoán "cái tên biến mất này đã thành cái nào".
 *
 * Độ giống chuỗi KHÔNG dùng được cho việc dịch: renderPanel → veBang giống nhau 13%, 修为 → TuVi
 * giống nhau 0%. Nên hỏi bằng phép đếm thay vì bằng hình dạng: trong cùng một file, nếu đúng MỘT
 * cái tên mất đi và đúng MỘT cái tên mới xuất hiện thì cặp đó gần như chắc chắn là một, dù mặt
 * chữ chẳng liên quan gì nhau. Nhiều hơn một thì thôi, quay về so hình dạng để bắt lỗi gõ sai —
 * và không tìm được thì không gợi ý, chứ không bịa.
 */
function renameGuess(lost: string[], added: string[], name: string): string | undefined {
  if (lost.length === 1 && added.length === 1) return added[0];
  return closest(name, added);
}

const diff = (a: Set<string>, b: Set<string>) => [...a].filter(x => !b.has(x));

export interface CardRefContext {
  /**
   * RỘNG — mọi tên còn coi là hợp lệ: biến thẻ khai + cả hai đầu của từ điển MVU.
   * Dùng cho phép bắt "biến mồ côi": mục tiêu là tóm tên KHÔNG THUỘC BÊN NÀO, nên trong lúc dịch
   * dở thì tên cũ lẫn tên mới đều phải được tha, bằng không cứ dịch nửa chừng là báo loạn.
   */
  knownVars: Set<string>;
  /**
   * HẸP — thẻ HIỆN GIỜ đang dùng tên gì (đọc [initvar] đã dịch).
   * Dùng cho phép bắt "link đổi tên một mình": phải biết chắc thẻ CÒN dùng tên cũ thì mới kết luận
   * được là hai bên lệch nhau.
   */
  cardVarsNow: Set<string>;
  /** Link ngoài mà thẻ đang nạp. */
  cardUrls: CardExternalUrl[];
}

/**
 * Dựng ngữ cảnh của thẻ để đối chiếu.
 *
 * Vì sao phải tách hai tập: đổi tên biến khi dịch là chuyện BÌNH THƯỜNG và đúng đắn (修为 → TuVi),
 * miễn là ĐỔI ĐỒNG BỘ ở mọi nơi. Cái sai chỉ nằm ở chỗ lệch pha. Mà 修为 với TuVi thì giống nhau
 * 0% — không thể dùng độ giống chuỗi để đoán "cái này đổi thành cái kia". Nên thay vì đoán, hỏi
 * thẳng dữ liệu: thẻ giờ đang dùng tên nào (`cardVarsNow`), link đang dùng tên nào. Hai bên chỏi
 * nhau mới là lỗi.
 */
export function buildCardRefContext(
  fields: Array<{ label: string; entryType?: string; original?: string; translated?: string }>,
  mvuDictionary: Record<string, string>,
  cardUrls: CardExternalUrl[] = [],
): CardRefContext {
  const knownVars = new Set<string>();
  const cardVarsNow = new Set<string>();

  for (const f of fields) {
    if (f.entryType !== 'initvar') continue;
    // Bản dịch là bộ mặt hiện tại của thẻ; chưa dịch thì bản gốc vẫn đang là bộ mặt đó.
    const current = f.translated?.trim() ? f.translated : (f.original || '');
    for (const d of extractInitvarDefinitions(current)) {
      if (!isNoise(d)) { cardVarsNow.add(d); knownVars.add(d); }
    }
    if (f.original) {
      for (const d of extractInitvarDefinitions(f.original)) if (!isNoise(d)) knownVars.add(d);
    }
  }
  for (const [k, v] of Object.entries(mvuDictionary || {})) {
    if (k && !isNoise(k)) knownVars.add(k);
    if (v && !isNoise(v)) knownVars.add(v);
  }

  return { knownVars, cardVarsNow, cardUrls };
}

/**
 * Đối chiếu toàn kho link ngoài với nhau và với thẻ.
 *
 * Bốn phép kiểm, tất cả đều đòi bằng chứng ở bản gốc trước khi mở miệng:
 *  1. `var_lost`   — biến có trong bản GỐC của link, bản dịch không còn ⇒ đã bị đổi tên khi dịch.
 *                     Nếu tên mới nằm trong danh sách biến thẻ biết thì im (đổi ĐỒNG BỘ, hợp lệ).
 *  2. `var_orphan` — link ĐỌC một biến mà cả thẻ lẫn các link khác đều không khai ⇒ lúc chơi ra
 *                     undefined. Chỉ báo khi thẻ có khai biến (bằng không thì chưa đủ dữ liệu).
 *  3. `global_lost`— hàm toàn cục biến mất khỏi bản dịch của link A trong khi link B vẫn gọi.
 *  4. `dom_lost`   — id/class biến mất khỏi bản dịch của link A trong khi link B vẫn đi tìm.
 * Cộng thêm phần đếm VÙNG MÙ: link thẻ đang nạp mà kho chưa có, kiểm tới đâu cũng không thấy.
 */
export function checkExternalRefs(
  vault: ExternalLinkEntry[],
  ctx: CardRefContext,
): RefCheckReport {
  const issues: RefIssue[] = [];
  const translated = vault.filter(e => e.translated?.trim());

  // Gom mặt bằng chung của TOÀN BỘ kho (bản dịch) — cái mà lúc chơi thật sự tồn tại.
  const allVarsNow = new Set<string>(ctx.knownVars);
  const allGlobalsNow = new Set<string>();
  const allDomNow = new Set<string>();
  const perLink = new Map<string, { now: CodeRefs; before: CodeRefs }>();

  for (const e of translated) {
    const now = collectCodeRefs(e.translated);
    const before = collectCodeRefs(e.original || '');
    perLink.set(e.id, { now, before });
    for (const v of now.varWrites) allVarsNow.add(v);
    for (const g of now.globalDefs) allGlobalsNow.add(g);
    for (const d of now.domDefs) allDomNow.add(d);
    // File schema là NGUỒN khai biến — cả thứ nó đọc lẫn thứ nó khai đều tính là "có thật".
    if (e.kind === 'schema') {
      for (const v of now.varReads) allVarsNow.add(v);
      for (const v of collectDeclaredVars(e.translated)) allVarsNow.add(v);
    }
  }

  let checkedRefs = 0;

  for (const e of translated) {
    const pair = perLink.get(e.id)!;
    const { now, before } = pair;

    // ── 1. Link đổi tên biến MỘT MÌNH, thẻ vẫn giữ tên cũ ──
    // Bằng chứng phải đủ HAI đầu: (a) bản gốc của link có tên đó, bản dịch thì không → link đã
    // đổi; (b) thẻ HIỆN GIỜ vẫn đang dùng đúng tên đó → thẻ chưa đổi. Thiếu vế (b) thì im, vì
    // rất có thể cả thẻ lẫn link đã đổi đồng bộ sang tên mới — đó là dịch đúng, không phải lỗi.
    if (e.original?.trim() && ctx.cardVarsNow.size > 0) {
      const beforeVars = new Set([...before.varReads, ...before.varWrites]);
      const nowVars = new Set([...now.varReads, ...now.varWrites]);
      const lostVars = diff(beforeVars, nowVars);
      const newVars = diff(nowVars, beforeVars);
      for (const v of lostVars) {
        if (!ctx.cardVarsNow.has(v)) continue;
        issues.push({
          severity: 'error', kind: 'var_lost', link: e.name,
          detail: `Thẻ vẫn khai biến "${v}" nhưng bản dịch của link này không còn nhắc tới nó nữa `
            + '(bản gốc của link thì có) — link đã đổi tên biến một mình, thẻ thì chưa. '
            + 'Lúc chơi, chỉ số này sẽ đứng im vì hai bên gọi hai tên khác nhau.',
          suggestion: renameGuess(lostVars, newVars, v),
        });
      }
    }

    // ── 2. Biến link ĐỌC mà không ai khai ──
    if (ctx.knownVars.size > 0 && e.kind !== 'schema') {
      for (const v of now.varReads) {
        checkedRefs++;
        if (allVarsNow.has(v)) continue;
        issues.push({
          severity: 'error', kind: 'var_orphan', link: e.name,
          detail: `Link đọc biến "${v}" nhưng không thẻ nào và không link nào khai biến này — lúc chơi sẽ ra undefined.`,
          suggestion: closest(v, allVarsNow),
        });
      }
    }

    // ── 3/4. Tên toàn cục & id/class biến mất khỏi bản dịch, nơi khác vẫn gọi ──
    if (e.original?.trim()) {
      const lostGlobals = diff(before.globalDefs, now.globalDefs);
      const newGlobals = diff(now.globalDefs, before.globalDefs);
      for (const g of lostGlobals) {
        if (allGlobalsNow.has(g)) continue;   // file khác còn định nghĩa ⇒ vẫn gọi được
        const callers = translated.filter(o => o.id !== e.id && perLink.get(o.id)!.now.globalUses.has(g));
        if (callers.length === 0) continue;
        issues.push({
          severity: 'error', kind: 'global_lost', link: e.name,
          detail: `Hàm "${g}" bị mất/đổi tên trong bản dịch của link này, nhưng ${callers.map(c => `"${c.name}"`).join(', ')} vẫn gọi nó — bấm nút bên kia sẽ lỗi.`,
          suggestion: renameGuess(lostGlobals, newGlobals, g),
        });
      }
      const lostDom = diff(before.domDefs, now.domDefs);
      const newDom = diff(now.domDefs, before.domDefs);
      for (const d of lostDom) {
        if (allDomNow.has(d)) continue;
        const seekers = translated.filter(o => o.id !== e.id && perLink.get(o.id)!.now.domUses.has(d));
        if (seekers.length === 0) continue;
        issues.push({
          severity: 'warning', kind: 'dom_lost', link: e.name,
          detail: `id/class "${d}" bị mất/đổi tên trong bản dịch của link này, nhưng ${seekers.map(s => `"${s.name}"`).join(', ')} vẫn đi tìm nó — phần giao diện đó sẽ trống.`,
          suggestion: renameGuess(lostDom, newDom, d),
        });
      }
    }
  }

  // ── Vùng mù: link thẻ đang nạp mà kho chưa có ──
  const savedFiles = new Set(
    vault.map(e => (e.url || '').split(/[?#]/)[0].split('/').filter(Boolean).pop()?.toLowerCase())
      .filter(Boolean) as string[],
  );
  const savedNames = new Set(vault.map(e => e.name.toLowerCase()));
  let blindSpots = 0;
  for (const u of ctx.cardUrls) {
    const file = (u.url.split(/[?#]/)[0].split('/').filter(Boolean).pop() || '').toLowerCase();
    if (savedFiles.has(file) || savedNames.has(file)) continue;
    blindSpots++;
    issues.push({
      severity: 'warning', kind: 'link_missing', link: u.url,
      detail: `Thẻ nạp link này (ở ${u.foundIn}) nhưng kho chưa có bản dịch của nó — mọi phép kiểm bên dưới đều KHÔNG nhìn thấy code trong đó.`,
    });
  }

  for (const e of vault) {
    if (e.translated?.trim()) continue;
    issues.push({
      severity: 'info', kind: 'link_untranslated', link: e.name,
      detail: 'Mục này chưa có bản dịch nên chưa đối chiếu được.',
    });
  }

  const rank: Record<RefSeverity, number> = { error: 0, warning: 1, info: 2 };
  issues.sort((a, b) => rank[a.severity] - rank[b.severity]);

  const errors = issues.filter(i => i.severity === 'error').length;
  // Vùng mù phải xuất hiện trong MỌI trường hợp, kể cả khi kho rỗng: đó là lúc dễ hiểu nhầm
  // "không báo gì = không sao" nhất, mà thật ra là "không nhìn thấy gì để mà báo".
  const blindNote = blindSpots > 0 ? ` · CÒN ${blindSpots} link thẻ đang nạp chưa lưu (vùng mù)` : '';
  const summary = (translated.length === 0
    ? 'Kho chưa có bản dịch nào — chưa đối chiếu được gì.'
    : `${translated.length} link đã dịch · ${checkedRefs} tham chiếu đã soi · `
      + (errors === 0 ? 'không thấy lỗi biến' : `${errors} lỗi biến`)) + blindNote;

  return {
    issues,
    stats: {
      links: vault.length,
      translatedLinks: translated.length,
      knownVars: ctx.knownVars.size,
      checkedRefs,
      blindSpots,
    },
    ok: errors === 0,
    summary,
  };
}

/** Báo cáo Markdown để tải về / gửi kèm khi nhờ người khác xem. */
export function buildRefCheckReport(rep: RefCheckReport, cardName: string): string {
  const lines: string[] = [];
  lines.push(`# Kiểm tra tham chiếu link ngoài — ${cardName}`);
  lines.push('');
  lines.push(`- Link trong kho: **${rep.stats.links}** (đã dịch: **${rep.stats.translatedLinks}**)`);
  lines.push(`- Biến thẻ khai: **${rep.stats.knownVars}** · Tham chiếu đã soi: **${rep.stats.checkedRefs}**`);
  if (rep.stats.blindSpots > 0) {
    lines.push(`- ⚠️ **${rep.stats.blindSpots} link thẻ đang nạp nhưng kho chưa có** — phần đó chưa được kiểm.`);
  }
  lines.push(`- Kết luận: ${rep.ok ? '✅ Không thấy lỗi tham chiếu' : '❌ Có lỗi cần sửa'}`);

  const sec = (title: string, sev: RefSeverity) => {
    const arr = rep.issues.filter(i => i.severity === sev);
    if (!arr.length) return;
    lines.push('', `## ${title} (${arr.length})`);
    for (const i of arr) {
      lines.push(`- **${i.link}** — ${i.detail}${i.suggestion ? ` _(gợi ý: \`${i.suggestion}\`)_` : ''}`);
    }
  };
  sec('❌ Lỗi', 'error');
  sec('⚠️ Cảnh báo', 'warning');
  sec('ℹ️ Ghi chú', 'info');
  return lines.join('\n');
}
