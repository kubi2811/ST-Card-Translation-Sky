/**
 * src/lib/ai/cardAutoRepair.ts — TỰ VÁ LỖI SAU KHI KIỂM TRA TỔNG THỂ.
 * ─────────────────────────────────────────────────────────────────────────
 * (User 22/07 — việc 82) "Auto Creator sau khi kiểm tra tổng thể xong hiện ra 1 đống lỗi
 * → thêm 1 nút / 1 tiến trình vá lại hết lỗi để card hoàn thiện."
 *
 * Phần lớn lỗi mà `buildFinalCheckReport` bắt được là lỗi CƠ HỌC — biết chính xác phải sửa
 * thế nào, không cần hỏi AI. Bắt user tự đi sửa tay từng cái là vô lý khi máy tự làm được.
 *
 * File này chỉ chứa các phép vá TẤT ĐỊNH (thuần hàm, không gọi mạng) để test được và để
 * chạy lại bao nhiêu lần cũng ra cùng kết quả. Những lỗi cần SÁNG TÁC nội dung (thiếu mô tả,
 * thiếu first message, script render rỗng) không thuộc phạm vi ở đây — chúng được trả về
 * trong `needsAi` để tầng trên gọi AI xử lý.
 *
 * NGUYÊN TẮC: không bịa. Chỉ sửa khi biết chắc đích đến; không chắc thì để yên và báo ra.
 */

import type { CharacterCardV3, LorebookEntry, MVUZODSchema } from '../../types';

import { collectSchemaVarNames } from '../mvuzod/gameUiValidator';
import { stripInitVarPreamble } from '../mvuzod/simulateCard';
import { quoteAmbiguousInitVarScalars } from '../mvuzod/yamlScalars';
import { generateWorldbookEntries, applyGeneratedEntries, findExistingMVUZODEntries } from '../export/worldbookGenerator';
import { OPENING_FORM_ANCHOR, STATUS_BAR_ANCHOR } from '../mvuzod/regexAnchors';
import { checkMvuOutputContract } from '../mvuzod/mvuReference';
import { buildProgrammaticRegex } from '../mvuzod/programmaticRegexBuilder';
import { auditCardQuality, collectLeafFields, extractEnumComparisons, foldVi, nearestEnumValue } from '../mvuzod/cardQualityAudit';

const FENCE = '`'.repeat(3);

export interface RepairAction {
  /** Mã lỗi — trùng với thứ báo cáo kiểm tra tổng thể nêu ra. */
  id: string;
  /** Mô tả việc đã làm, viết cho user đọc. */
  description: string;
}

export interface RepairResult {
  card: CharacterCardV3;
  /** Những chỗ đã tự vá xong. */
  fixed: RepairAction[];
  /** Lỗi cần AI sáng tác nội dung — tầng trên lo. */
  needsAi: string[];
}

type RegexScript = {
  scriptName?: string;
  findRegex?: string;
  replaceString?: string;
  promptOnly?: boolean;
  markdownOnly?: boolean;
  disabled?: boolean;
};

/** Nhân bản nông đủ sâu để không sửa vào object gốc của store. */
function cloneCard(card: CharacterCardV3): CharacterCardV3 {
  return JSON.parse(JSON.stringify(card)) as CharacterCardV3;
}

/* ══════════════════════ CÁC PHÉP VÁ RIÊNG LẺ ══════════════════════ */

/**
 * Entry [initvar] đang BẬT phải TẮT.
 * Đây là lỗi im lặng nguy hiểm nhất: card nhìn đủ thứ, nhưng MVU không nhận entry đang bật làm
 * template khởi tạo biến → vào game báo "变量更新失败".
 */
export function repairInitvarEnabled(entries: LorebookEntry[]): { entries: LorebookEntry[]; fixed: RepairAction[] } {
  const fixed: RepairAction[] = [];
  const out = entries.map(e => {
    const isInit = String(e.content || '').includes('[initvar]')
      || String(e.comment || '').toLowerCase().includes('initvar');
    if (!isInit) return e;
    const rec = e as LorebookEntry & { enabled?: boolean; disable?: boolean };
    const isOn = rec.enabled !== false && rec.disable !== true;
    if (!isOn) return e;
    fixed.push({
      id: 'initvar_enabled',
      description: `Tắt entry khởi tạo biến "${e.comment || '[initvar]'}" — đang bật thì MVU không đọc nó làm template, vào game lỗi "变量更新失败"`,
    });
    return { ...e, enabled: false, disable: true } as LorebookEntry;
  });
  return { entries: out, fixed };
}

/**
 * (bugNeedFix/111) Dòng nhãn/lời dặn nằm TRƯỚC cây biến trong entry [initvar].
 *
 * MVU đọc TRỌN nội dung entry bằng `parseString` (YAML/JSON). Một dòng chữ ở đầu vì thế bị hiểu
 * thành một biến và nuốt luôn biến lớn đầu tiên — trong trình quản lý biến hiện ra cái tên lạ
 * "[ InitVar ]" ôm hết biến con của "Thế Giới". Nặng hơn: nội dung bắt đầu bằng "[" khiến
 * parseString bỏ qua YAML hoàn toàn (`/^[[{]/` → nhánh JSON) rồi chạy `jsonrepair`, băm nát cả cây.
 *
 * Vá: xoá các dòng đó. Lời dặn vốn thuộc về TÊN entry, không phải nội dung.
 */
/**
 * (bug 155) THIẾU BIẾN CẤP CAO NHẤT TRONG [initvar] → tự thêm với giá trị mặc định.
 *
 * User: "ở tiến trình Vá lỗi cũng nên cho AI xử lý các vấn đề cần phải xử lý tay… từ giờ chỉ
 * cần AI sửa là được". Ca họ gặp còn dễ hơn thế: `sim-missing-in-initvar` được simulateCard
 * SINH RA nhưng KHÔNG NƠI NÀO vá — nên báo cáo luôn kết thúc bằng "không có lỗi nào tự vá được
 * bằng máy", dù thiếu một dòng `Kho Đồ: []` thì máy thừa sức tự điền.
 *
 * Chỉ xử lý biến CẤP CAO NHẤT và chỉ THÊM VÀO CUỐI: initvar mang cặp `[giá trị, "mô tả"]` của
 * MVU, dựng lại cả cây là nguy cơ xoá sạch phần mô tả người dùng đã viết. Biến lồng sâu thiếu
 * thì vẫn để AI xử lý — thà vá ít mà chắc.
 */
export function repairMissingInitvarLeaves(
  entries: LorebookEntry[],
  schema: MVUZODSchema | null,
): { entries: LorebookEntry[]; fixed: RepairAction[] } {
  const fixed: RepairAction[] = [];
  if (!schema?.fields?.length) return { entries, fixed };

  const out = entries.map(e => {
    const isInit = String(e.content || '').includes('[initvar]')
      || String(e.comment || '').toLowerCase().includes('initvar');
    if (!isInit) return e;
    const raw = String(e.content || '');

    // Khoá cấp cao nhất đã khai = dòng KHÔNG thụt đầu dòng, dạng `Tên:`.
    const have = new Set<string>();
    for (const line of raw.split(/\r?\n/)) {
      const m = /^([^\s#<][^:]*):/.exec(line);
      if (m) have.add(m[1].trim());
    }

    const add: string[] = [];
    for (const f of schema.fields) {
      const name = String(f.path || '').split('/').filter(Boolean).pop() ?? '';
      if (!name || have.has(name)) continue;
      // record là túi khoá động — hợp đồng sẵn có là KHÔNG đòi khai; đừng tự ý thêm.
      if (f.type === 'record') continue;
      const val = f.type === 'array' ? '[]'
        : f.type === 'object' ? null            // nhóm lồng: để AI dựng, máy không đoán cây con
        : f.type === 'number' ? String(Number(f.defaultValue ?? 0) || 0)
        : f.type === 'boolean' ? String(f.defaultValue === true)
        : '""';
      if (val === null) continue;
      add.push(`${name}: ${val}`);
    }
    if (!add.length) return e;

    fixed.push({
      id: 'sim-missing-in-initvar',
      description: `Thêm ${add.length} biến schema còn thiếu vào [initvar]: ${add.map(a => a.split(':')[0]).join(', ')}`,
    });
    // Chèn TRƯỚC thẻ đóng nếu có, không thì nối vào cuối — luôn nằm trong cây biến.
    const close = raw.lastIndexOf('</initvar>');
    return close >= 0
      ? { ...e, content: `${raw.slice(0, close).replace(/\s*$/, '')}\n${add.join('\n')}\n${raw.slice(close)}` }
      : { ...e, content: `${raw.replace(/\s*$/, '')}\n${add.join('\n')}\n` };
  });

  return { entries: out, fixed };
}

export function repairInitvarPreamble(entries: LorebookEntry[]): { entries: LorebookEntry[]; fixed: RepairAction[] } {
  const fixed: RepairAction[] = [];
  const out = entries.map(e => {
    const isInit = String(e.content || '').includes('[initvar]')
      || String(e.comment || '').toLowerCase().includes('initvar');
    if (!isInit) return e;
    const raw = String(e.content || '');
    // Giữ nguyên nhãn [initvar] nếu nó đứng riêng — chỉ soi phần sau khi bỏ nhãn.
    const noLabel = raw.replace(/\[initvar\]/gi, '');
    const pre = stripInitVarPreamble(noLabel);
    if (pre.removed.length === 0) return e;
    fixed.push({
      id: 'initvar_preamble',
      description: `Xoá ${pre.removed.length} dòng chữ nằm trước cây biến trong "${e.comment || '[initvar]'}" `
        + `("${pre.removed[0].slice(0, 40)}…") — MVU đọc nội dung như YAML nên dòng đó bị hiểu thành một biến `
        + 'và nuốt mất biến lớn đầu tiên',
    });
    return { ...e, content: pre.content } as LorebookEntry;
  });
  return { entries: out, fixed };
}

/**
 * (bug 174) GIÁ TRỊ [initvar] ĐỂ TRẦN MÀ YAML ĐỌC SAI → nhập thẻ vào SillyTavern là đỏ ngay.
 *
 * Thẻ user gửi khai `'Phả Hệ': Null` để khớp enum Zod `['…','Null']`. Nhìn thì khớp, nhưng MVU
 * nạp initvar bằng YAML, mà YAML coi `Null`/`null`/`NULL`/`~` để trần là GIÁ TRỊ RỖNG. Zod nhận
 * null trong khi enum chỉ có chuỗi "Null" ⇒ "[MVU zod] 变量初始化失败", cả bộ biến không nạp
 * được — mà cũng chẳng có cách nào đoán ra từ thông báo đó.
 * Vá bằng cách bọc nháy đúng những ô schema khai là chuỗi. Có schema thì chính xác; không có
 * thì chỉ cứu ca null, không đụng số/boolean (xem yamlScalars.ts).
 */
export function repairInitvarAmbiguousScalars(
  entries: LorebookEntry[],
  schema?: MVUZODSchema | null,
): { entries: LorebookEntry[]; fixed: RepairAction[] } {
  const fixed: RepairAction[] = [];
  const out = entries.map(e => {
    const isInit = String(e.content || '').includes('[initvar]')
      || String(e.comment || '').toLowerCase().includes('initvar');
    if (!isInit) return e;
    const raw = String(e.content || '');
    const res = quoteAmbiguousInitVarScalars(raw, schema ?? null);
    if (res.fixed.length === 0) return e;
    fixed.push({
      id: 'initvar_ambiguous_scalar',
      description: `Bọc nháy ${res.fixed.length} giá trị trong "${e.comment || '[initvar]'}" `
        + `(${res.fixed.slice(0, 3).join(', ')}${res.fixed.length > 3 ? '…' : ''}) — để trần thì YAML đọc `
        + 'thành rỗng/số/boolean chứ không phải chữ, Zod chặn ngay lúc nhập thẻ vào SillyTavern',
    });
    return { ...e, content: res.content } as LorebookEntry;
  });
  return { entries: out, fixed };
}

/**
 * Khối HTML mở fence ```html mà thiếu fence đóng → SillyTavern không render, màn hình trắng.
 * Vá bằng cách đóng fence ở cuối.
 */
export function repairUnclosedFence(scripts: RegexScript[]): { scripts: RegexScript[]; fixed: RepairAction[] } {
  const fixed: RepairAction[] = [];
  const closedAtEnd = new RegExp('\\n' + FENCE + '\\s*$');
  const out = scripts.map(s => {
    const rep = String(s.replaceString || '');
    if (!rep.startsWith(FENCE + 'html') || closedAtEnd.test(rep)) return s;
    fixed.push({
      id: 'unclosed_fence',
      description: `Đóng fence ${FENCE} còn thiếu ở cuối script "${s.scriptName || s.findRegex || '?'}" — thiếu nó thì ST không render giao diện`,
    });
    return { ...s, replaceString: rep.replace(/\s*$/, '') + '\n' + FENCE };
  });
  return { scripts: out, fixed };
}

/**
 * Nút gọi từ `onclick=` nhưng hàm khai báo trong <script type="module"> → hàm chỉ sống trong
 * scope module, `onclick=` chạy ở global ⇒ ReferenceError, giao diện hiện mà bấm không chạy.
 * Vá bằng cách gán `window.<hàm> = <hàm>;` trước thẻ đóng </script>.
 */
export function repairModuleHandlers(scripts: RegexScript[]): { scripts: RegexScript[]; fixed: RepairAction[] } {
  const fixed: RepairAction[] = [];
  const out = scripts.map(s => {
    const rep = String(s.replaceString || '');
    if (s.promptOnly && !s.markdownOnly) return s;
    if (!/<script[^>]*type\s*=\s*["']module["']/i.test(rep)) return s;

    const missing: string[] = [];
    for (const m of rep.matchAll(/\son(?:click|change|input|submit|blur|focus)\s*=\s*["']([A-Za-z_$][\w$]*)\s*\(/g)) {
      const fn = m[1];
      if (missing.includes(fn)) continue;
      // Chỉ vá khi hàm THỰC SỰ được khai báo trong script này — không thì gán window.x = x
      // sẽ tạo ra ReferenceError mới, tệ hơn lỗi đang có.
      const declared = new RegExp(`(?:function\\s+${fn}\\s*\\(|(?:const|let|var)\\s+${fn}\\s*=)`).test(rep);
      const exported = new RegExp(`(?:window|globalThis)\\s*\\.\\s*${fn}\\s*=`).test(rep);
      if (declared && !exported) missing.push(fn);
    }
    if (missing.length === 0) return s;

    const glue = '\n' + missing.map(fn => `window.${fn} = ${fn};`).join('\n') + '\n';
    // Chèn trước thẻ </script> CUỐI CÙNG để nằm trong đúng khối module.
    const idx = rep.toLowerCase().lastIndexOf('</script>');
    if (idx < 0) return s;
    fixed.push({
      id: 'module_handler',
      description: `Đưa ${missing.length} hàm ra global cho script "${s.scriptName || '?'}" (${missing.join(', ')}) — gọi từ onclick= mà nằm trong <script type="module"> thì bấm không chạy`,
    });
    return { ...s, replaceString: rep.slice(0, idx) + glue + rep.slice(idx) };
  });
  return { scripts: out, fixed };
}

/** So tên biến bỏ qua hoa/thường, khoảng trắng, `_`, `-` — để dò `data-var` viết lệch vỏ. */
function looseVar(s: string): string {
  return s.toLowerCase().normalize('NFC').replace(/[\s_-]+/g, '');
}

/**
 * `data-var` trong regex không khớp tên biến schema ⇒ ô hiển thị trống.
 * CHỈ vá khi lệch vỏ (hoa/thường, `_` vs khoảng trắng) và khớp duy nhất một biến — đó là ca
 * thường gặp nhất và là ca chắc chắn đúng. Tên sai hẳn thì để nguyên và báo cho AI xử lý,
 * vì đoán bừa sẽ trỏ vào biến khác.
 */
export function repairDataVarCasing(
  scripts: RegexScript[],
  schemaVarNames: string[],
): { scripts: RegexScript[]; fixed: RepairAction[]; unresolved: string[] } {
  const fixed: RepairAction[] = [];
  const unresolved: string[] = [];
  const known = new Set(schemaVarNames);

  // Bảng tra theo dạng lỏng; tên nào lỏng-trùng nhau thì bỏ (không dám đoán).
  const byLoose = new Map<string, string | null>();
  for (const n of schemaVarNames) {
    const k = looseVar(n);
    byLoose.set(k, byLoose.has(k) ? null : n);
  }

  const out = scripts.map(s => {
    const rep = String(s.replaceString || '');
    if (!rep) return s;
    let changed = false;
    const next = rep.replace(/(data-var\s*=\s*)(["'])([^"']+)\2/g, (whole, prefix, quote, name) => {
      if (known.has(name)) return whole;
      const target = byLoose.get(looseVar(name));
      if (!target) {
        if (!unresolved.includes(name)) unresolved.push(name);
        return whole;
      }
      changed = true;
      fixed.push({
        id: 'data_var_mismatch',
        description: `Sửa data-var "${name}" → "${target}" ở script "${s.scriptName || '?'}" (lệch hoa/thường nên UI hiện trống)`,
      });
      return `${prefix}${quote}${target}${quote}`;
    });
    return changed ? { ...s, replaceString: next } : s;
  });

  return { scripts: out, fixed, unresolved };
}

/**
 * Mỏ neo giao diện không có trong first_mes ⇒ không có chỗ nào để giao diện bám vào.
 * Chèn mỏ neo còn thiếu vào cuối first_mes (và cả alternate_greetings để mọi lời mở đầu
 * đều có bảng).
 */
export function repairMissingAnchors(
  card: CharacterCardV3,
  neededAnchors: string[],
): { card: CharacterCardV3; fixed: RepairAction[] } {
  const fixed: RepairAction[] = [];
  if (neededAnchors.length === 0) return { card, fixed };

  const out = cloneCard(card);
  const addTo = (text: string): string => {
    let t = text || '';
    for (const a of neededAnchors) {
      if (!t.includes(a)) t = t.replace(/\s*$/, '') + '\n\n' + a;
    }
    return t;
  };

  const before = out.data.first_mes || '';
  const after = addTo(before);
  if (after !== before) {
    out.data.first_mes = after;
    fixed.push({
      id: 'missing_anchor',
      description: `Chèn ${neededAnchors.join(', ')} vào first message — thiếu mỏ neo thì giao diện không có chỗ bám`,
    });
  }

  const greetings = out.data.alternate_greetings;
  if (Array.isArray(greetings) && greetings.length > 0) {
    let touched = 0;
    out.data.alternate_greetings = greetings.map(g => {
      const ng = addTo(String(g || ''));
      if (ng !== g) touched++;
      return ng;
    });
    if (touched > 0) {
      fixed.push({
        id: 'missing_anchor',
        description: `Chèn mỏ neo vào ${touched} lời chào phụ — để lời mở đầu nào cũng có giao diện`,
      });
    }
  }

  return { card: out, fixed };
}

/**
 * Nhiều script render cùng bám MỘT mỏ neo ⇒ chỉ cái đầu chạy, các giao diện còn lại biến mất.
 * Vá bằng cách TẮT các script render trùng phía sau (giữ cái đầu) — tắt là hành động đảo ngược
 * được, an toàn hơn xoá, và user thấy ngay cái nào bị tắt để tự chọn lại nếu muốn.
 */
export function repairAnchorClash(scripts: RegexScript[]): { scripts: RegexScript[]; fixed: RepairAction[] } {
  const fixed: RepairAction[] = [];
  const seen = new Set<string>();
  const out = scripts.map(s => {
    if (s.disabled) return s;
    if (s.promptOnly && !s.markdownOnly) return s; // vế ẩn, không tranh chỗ render
    if (!s.findRegex) return s;
    if (!seen.has(s.findRegex)) { seen.add(s.findRegex); return s; }
    fixed.push({
      id: 'anchor_clash',
      description: `Tắt script render trùng mỏ neo "${s.findRegex}" (${s.scriptName || '?'}) — hai script cùng bám một chỗ thì chỉ cái đầu chạy`,
    });
    return { ...s, disabled: true };
  });
  return { scripts: out, fixed };
}

/**
 * Thiếu entry hệ thống MVUZOD ([initvar] / quy tắc cập nhật / định dạng đầu ra…).
 * Dựng lại từ schema bằng đúng bộ sinh mà Export Wizard dùng — không bịa nội dung mới.
 */
export function repairMissingMvuzodEntries(
  card: CharacterCardV3,
  schema: MVUZODSchema | null,
): { card: CharacterCardV3; fixed: RepairAction[] } {
  const fixed: RepairAction[] = [];
  if (!schema || !Array.isArray(schema.fields) || schema.fields.length === 0) return { card, fixed };

  const entries = card.data.character_book?.entries ?? [];
  const existing = findExistingMVUZODEntries(entries);
  const expected = ['initvar', 'varlist', 'update_rules', 'output_format', 'emphasis'];
  const missing = expected.filter(e => !existing[e] || existing[e].length === 0);
  if (missing.length === 0) return { card, fixed };

  const out = cloneCard(card);
  const generated = generateWorldbookEntries(schema, entries, { include: missing, replaceExisting: false });
  const merged = applyGeneratedEntries(entries, generated);
  if (!out.data.character_book) {
    out.data.character_book = { name: out.data.name || 'Lorebook', entries: merged } as never;
  } else {
    out.data.character_book.entries = merged;
  }
  fixed.push({
    id: 'missing_mvuzod_entries',
    description: `Dựng lại ${missing.length} entry hệ thống MVU còn thiếu (${missing.join(', ')}) từ schema`,
  });
  return { card: out, fixed };
}

/**
 * ═══ (bug 115) TỰ VÁ TOÀN BỘ HỆ BIẾN MVU ═══
 *
 * "Cần thêm mục tự fix lại toàn bộ biến mvu như zod, quy tắc, định dạng đầu ra và bảng
 * thanh trạng thái." — `repairMissingMvuzodEntries` chỉ dựng entry THIẾU HẲN; entry tồn tại
 * nhưng HỎNG (rỗng, mất khối <UpdateVariable>, zod không build nổi, status bar trống) thì
 * trước giờ không ai đụng. Toàn bộ đều tái sinh TẤT ĐỊNH từ schema — không bịa nội dung,
 * dùng đúng bộ sinh mà Export Wizard/pipeline dùng.
 */
export function repairMvuSystemIntegrity(
  card: CharacterCardV3,
  schema: MVUZODSchema | null,
): { card: CharacterCardV3; fixed: RepairAction[] } {
  const fixed: RepairAction[] = [];
  if (!schema || !Array.isArray(schema.fields) || schema.fields.length === 0) return { card, fixed };

  const out = cloneCard(card);
  const entries = out.data.character_book?.entries ?? [];
  const existing = findExistingMVUZODEntries(entries);

  // 1. Entry hệ thống TỒN TẠI nhưng HỎNG → tái sinh từ schema.
  //    Hỏng = nội dung rỗng/quá ngắn, hoặc (update_rules/output_format) mất hợp đồng
  //    <UpdateVariable> + <Analysis> + <JSONPatch> mà engine MVU bắt buộc.
  const broken: string[] = [];
  for (const [systemId, ids] of Object.entries(existing)) {
    const ent = entries.find(e => ids.includes(e.id));
    if (!ent) continue;
    const content = String(ent.content || '').trim();
    if (content.length < 10) { broken.push(systemId); continue; }
    if ((systemId === 'update_rules' || systemId === 'output_format')
      && !checkMvuOutputContract(content).ok
      // Hợp đồng chỉ cần xuất hiện Ở MỘT entry — kiểm gộp cả hai trước khi kết tội.
      && !checkMvuOutputContract(
        entries.filter(e => (existing.update_rules ?? []).concat(existing.output_format ?? []).includes(e.id))
          .map(e => String(e.content || '')).join('\n'),
      ).ok) {
      broken.push(systemId);
    }
  }
  if (broken.length > 0) {
    const regen = generateWorldbookEntries(schema, entries, { include: broken, replaceExisting: true });
    if (out.data.character_book) out.data.character_book.entries = applyGeneratedEntries(entries, regen);
    fixed.push({
      id: 'mvu_system_broken',
      description: `Tái sinh ${broken.length} entry hệ thống MVU bị hỏng (${broken.join(', ')}) từ schema — entry có tên đúng nhưng nội dung rỗng/mất khối <UpdateVariable> thì vào game vẫn lỗi "变量更新失败"`,
    });
  }

  // 2. BẢNG TRẠNG THÁI: không có script render nào bám mỏ neo, hoặc script bám mà nội dung
  //    rỗng → dựng lại tất định từ schema (đúng bộ sinh của bước Game UI).
  const ext = out.data.extensions as unknown as Record<string, unknown>;
  const scripts = (ext?.regex_scripts as RegexScript[] | undefined) ?? [];
  const statusRender = scripts.find(s =>
    s.findRegex === STATUS_BAR_ANCHOR && !(s.promptOnly && !s.markdownOnly)
    && String(s.replaceString || '').trim() !== '');
  if (!statusRender) {
    try {
      const built = buildProgrammaticRegex({ schema, component: 'status_bar', gameName: out.data.name || 'Game' });
      // Bỏ script cũ hỏng bám cùng mỏ neo (rỗng) rồi thêm bộ mới.
      const cleaned = scripts.filter(s => !(s.findRegex === STATUS_BAR_ANCHOR
        && !(s.promptOnly && !s.markdownOnly) && String(s.replaceString || '').trim() === ''));
      (ext as Record<string, unknown>).regex_scripts = [...cleaned, ...built.scripts];
      fixed.push({
        id: 'status_bar_rebuilt',
        description: 'Dựng lại bảng thanh trạng thái từ schema — card không có script render nào bám mỏ neo (hoặc script rỗng), bảng không bao giờ hiện',
      });
    } catch { /* schema không dựng được UI thì để nguyên — đừng phá regex đang có */ }
  }

  return { card: out, fixed };
}

/* ══════════════════════ CHẠY CẢ LƯỢT ══════════════════════ */

/**
 * ═══ (bug 135) VÁ CÁC LỖI CHẤT LƯỢNG mà cardQualityAudit bắt được ═══
 * Chỉ vá 4 lớp máy CHẮC TAY; lớp cần sáng tác (bảng biến chứa ví dụ) đẩy sang needsAi.
 * Nguyên tắc bug 140 áp cả ở đây: SỬA cấu hình/giá trị, TUYỆT ĐỐI không xoá nội dung.
 */
export function repairQualityIssues(
  card: CharacterCardV3,
  schema: MVUZODSchema | null,
): RepairResult {
  const out = cloneCard(card);
  const fixed: RepairAction[] = [];
  const needsAi: string[] = [];
  const entries = out.data.character_book?.entries ?? [];
  const issues = auditCardQuality({ entries, schema });
  if (issues.length === 0) return { card: out, fixed, needsAi };

  const enumLeaves = collectLeafFields(schema).filter(f => (f.constraints?.enumValues?.length ?? 0) > 0);

  // 1. EJS so sai giá trị enum → thay đúng chuỗi trong ĐÚNG entry (chỉ khi đoán được duy nhất).
  for (const e of entries) {
    const code = String(e.content ?? '');
    if (!code.includes('<%') && !code.includes('@@preprocessing')) continue;
    let next = code;
    for (const [f, compared] of extractEnumComparisons(code, enumLeaves)) {
      const values = f.constraints!.enumValues!;
      const folded = new Set(values.map(foldVi));
      for (const bad of new Set(compared.filter(s => !folded.has(foldVi(s))))) {
        const near = nearestEnumValue(bad, values);
        if (!near) continue;
        const esc = bad.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        next = next.replace(new RegExp(`(['"\`])${esc}\\1`, 'g'), (_m, q: string) => q + near + q);
        fixed.push({
          id: 'ejs-enum-mismatch',
          description: `EJS "${e.comment}": đổi so sánh "${bad}" → "${near}" cho khớp enum của biến — nhánh này trước đây không bao giờ đúng.`,
        });
      }
    }
    if (next !== code) e.content = next;
  }

  // 1b. (bug 148) getvar thiếu tiền tố `stat_data.` → thêm vào. Đây là lỗi im lặng: khối vẫn
  //     chạy, chỉ là luôn trả giá trị mặc định nên mọi lượt chat nhận cùng một thông tin sai.
  //     Chỉ sửa đúng những path mà audit đã xác nhận trỏ tới biến CÓ THẬT trong schema.
  {
    const missing = issues.filter(i => i.code === 'ejs-missing-statdata');
    for (const iss of missing) {
      const e = entries.find(x => String(x.comment || `#${x.id}`) === iss.where);
      if (!e) continue;
      const path = /"([^"]+)"/.exec(iss.message)?.[1];
      if (!path) continue;
      const esc = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const before = String(e.content ?? '');
      const after = before.replace(
        new RegExp(`(getvar\\s*\\(\\s*)(['"\`])${esc}\\2`, 'g'),
        (_m, head: string, q: string) => `${head}${q}stat_data.${path}${q}`,
      );
      if (after !== before) {
        e.content = after;
        fixed.push({
          id: 'ejs-missing-statdata',
          description: `EJS "${e.comment}": thêm tiền tố thiếu — getvar('${path}') → getvar('stat_data.${path}'), khối này trước đây luôn đọc ra giá trị mặc định.`,
        });
      }
    }
  }

  // 1c. (bug 148) Tên biến JS có dấu tiếng Việt → chuyển sang ASCII (bỏ dấu), đổi ĐỒNG BỘ mọi
  //     chỗ dùng trong CÙNG khối. Không đụng chuỗi/đường dẫn biến MVU (chỉ đổi định danh JS).
  for (const iss of issues.filter(i => i.code === 'ejs-nonascii-var')) {
    const e = entries.find(x => String(x.comment || `#${x.id}`) === iss.where);
    if (!e) continue;
    const name = /"([^"]+)"/.exec(iss.message)?.[1];
    if (!name) continue;
    const ascii = '_' + foldVi(name).replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || '_v';
    if (ascii === name) continue;
    const before = String(e.content ?? '');
    const after = before.replace(new RegExp(`(?<![\\w$])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w$])`, 'g'), ascii);
    if (after !== before) {
      e.content = after;
      fixed.push({ id: 'ejs-nonascii-var', description: `EJS "${e.comment}": đổi tên biến "${name}" → "${ascii}" cho đúng quy ước ASCII.` });
    }
  }

  // 2. Entry CHẾT (tắt + không key + không constant + không EJS bật) → CỨU bằng cách đặt
  //    từ khoá từ chính tên entry và bật lại. Không xoá gì cả.
  for (const iss of issues.filter(i => i.code === 'dead-entry')) {
    const e = entries.find(x => String(x.comment || `#${x.id}`) === iss.where);
    if (!e) continue;
    const baseName = String(e.comment ?? '').replace(/^[\d.\s]+/, '').split(':').pop()?.trim() || String(e.comment ?? '');
    e.keys = [...new Set([baseName, String(e.comment ?? '').trim()].filter(k => k.length >= 2))];
    e.enabled = true;
    (e as { disable?: boolean }).disable = false;
    fixed.push({
      id: 'dead-entry',
      description: `Entry "${e.comment}" không có đường nào kích hoạt — đã bật lại và đặt từ khoá "${e.keys.join('", "')}" từ chính tên nó (nội dung giữ nguyên).`,
    });
  }

  // 3. Biến số defaultValue kiểu chuỗi → ép về số (chỉ khi parse được).
  if (schema) {
    const ext = out.data.extensions as unknown as Record<string, any>;
    const schemaInCard = ext?.mvuzod?.schema as MVUZODSchema | undefined;
    if (schemaInCard) {
      const walk = (fs: Array<{ type?: string; defaultValue?: unknown; path?: string; children?: unknown[] }>) => {
        for (const f of fs ?? []) {
          if (Array.isArray(f.children) && f.children.length) walk(f.children as never);
          else if (f.type === 'number' && typeof f.defaultValue === 'string' && f.defaultValue.trim() !== '') {
            const n = Number(f.defaultValue);
            if (Number.isFinite(n)) {
              fixed.push({ id: 'number-default-string', description: `Biến số "${f.path}": đổi giá trị mặc định "${f.defaultValue}" (chuỗi) → ${n} (số) để phép so sánh không so theo chữ.` });
              f.defaultValue = n;
            }
          }
        }
      };
      walk(schemaInCard.fields as never);
    }
  }

  // 3b. (bug 148-2) defaultValue của array/record sai kiểu, hoặc record khai sẵn tên khoá →
  //     đưa về đúng khuôn ([] / {}). Record khai sẵn khoá là lỗi đặc thù: mỗi lần khởi tạo lại
  //     đè lên quan hệ/dữ liệu người chơi đã tích luỹ.
  if (schema) {
    const ext = out.data.extensions as unknown as Record<string, any>;
    const schemaInCard = ext?.mvuzod?.schema as MVUZODSchema | undefined;
    if (schemaInCard) {
      const walk = (fs: Array<Record<string, any>> | undefined) => {
        for (const f of fs ?? []) {
          if (f.type === 'array' && f.defaultValue !== undefined && !Array.isArray(f.defaultValue)) {
            fixed.push({ id: 'struct-bad-default', description: `Biến "${f.path}" kiểu array: đưa giá trị mặc định về danh sách rỗng [].` });
            f.defaultValue = [];
          } else if (f.type === 'record') {
            const dv = f.defaultValue;
            if (dv !== undefined && (Array.isArray(dv) || typeof dv !== 'object')) {
              fixed.push({ id: 'struct-bad-default', description: `Biến "${f.path}" kiểu record: đưa giá trị mặc định về từ điển rỗng {}.` });
              f.defaultValue = {};
            } else if (dv && typeof dv === 'object' && Object.keys(dv).length > 0) {
              fixed.push({ id: 'record-duplicate-key', description: `Biến "${f.path}" kiểu record: bỏ ${Object.keys(dv).length} tên khoá khai sẵn trong mặc định — khoá phải sinh khi chơi, khai sẵn sẽ đè dữ liệu thật mỗi lần khởi tạo.` });
              f.defaultValue = {};
            }
          }
          walk(f.children as never);
        }
      };
      walk(schemaInCard.fields as never);
    }
  }

  // 4. Nhiều entry cùng (order, position) → giãn order cho thứ tự xác định. Giữ entry đầu,
  //    các entry sau nhích dần sang số order CHƯA AI DÙNG tại cùng vị trí.
  {
    const posOf = (e: LorebookEntry) => (e as { extensions?: { position?: number } }).extensions?.position ?? e.position;
    const used = new Map<string, Set<number>>();
    for (const e of entries) {
      const k = String(posOf(e));
      if (!used.has(k)) used.set(k, new Set());
      used.get(k)!.add(e.insertion_order ?? 100);
    }
    const seen = new Map<string, LorebookEntry>();
    for (const e of entries) {
      if (e.enabled === false) continue;
      const k = `${e.insertion_order ?? 100}|${posOf(e)}`;
      if (!seen.has(k)) { seen.set(k, e); continue; }
      const posKey = String(posOf(e));
      let next = (e.insertion_order ?? 100) + 1;
      while (used.get(posKey)!.has(next)) next++;
      used.get(posKey)!.add(next);
      fixed.push({ id: 'order-position-clash', description: `Entry "${e.comment}": đổi thứ tự nạp ${e.insertion_order} → ${next} để hết trùng chỗ với "${seen.get(k)!.comment}" (thứ tự hiển thị thành xác định).` });
      e.insertion_order = next;
    }
  }

  // Lỗi cần sáng tác nội dung → AI.
  for (const iss of issues.filter(i => i.code === 'varlist-example-content')) {
    needsAi.push(iss.message);
  }

  return { card: out, fixed, needsAi };
}

/**
 * Chạy TẤT CẢ phép vá tất định trên card. Thuần hàm: không đụng store, không gọi mạng.
 * Thứ tự có chủ ý — dựng entry thiếu TRƯỚC rồi mới tắt [initvar], để entry vừa dựng cũng
 * được tắt đúng chuẩn.
 */
export function autoRepairCard(
  card: CharacterCardV3,
  schema: MVUZODSchema | null,
): RepairResult {
  let out = cloneCard(card);
  const fixed: RepairAction[] = [];
  const needsAi: string[] = [];

  // 0. (bug 135) Lỗi chất lượng: EJS so sai enum, entry chết, default sai kiểu, order trùng.
  const qualityRes = repairQualityIssues(out, schema);
  out = qualityRes.card;
  fixed.push(...qualityRes.fixed);
  needsAi.push(...qualityRes.needsAi);

  // 1. Dựng lại entry hệ thống MVU còn thiếu.
  const mvuRes = repairMissingMvuzodEntries(out, schema);
  out = mvuRes.card;
  fixed.push(...mvuRes.fixed);

  // 1b. (bug 115) Entry hệ thống TỒN TẠI nhưng HỎNG + bảng trạng thái trống → tái sinh từ schema.
  const integrityRes = repairMvuSystemIntegrity(out, schema);
  out = integrityRes.card;
  fixed.push(...integrityRes.fixed);

  // 2. Tắt [initvar] (gồm cả entry vừa dựng ở bước 1).
  const entries = out.data.character_book?.entries ?? [];
  if (entries.length > 0) {
    const initRes = repairInitvarEnabled(entries);
    if (initRes.fixed.length > 0 && out.data.character_book) {
      out.data.character_book.entries = initRes.entries;
      fixed.push(...initRes.fixed);
    }
    // (bugNeedFix/111) Dòng chữ nằm trước cây biến — xoá đi, nếu không MVU nuốt mất biến lớn đầu tiên.
    const preRes = repairInitvarPreamble(out.data.character_book?.entries ?? []);
    if (preRes.fixed.length > 0 && out.data.character_book) {
      out.data.character_book.entries = preRes.entries;
      fixed.push(...preRes.fixed);
    }
    // (bug 155) Biến schema thiếu hẳn trong [initvar] → tự điền. Trước đây simulateCard báo lỗi
    // này mà KHÔNG ai vá, nên báo cáo luôn kết thúc bằng "không có lỗi nào tự vá được bằng máy".
    const missRes = repairMissingInitvarLeaves(out.data.character_book?.entries ?? [], schema);
    if (missRes.fixed.length > 0 && out.data.character_book) {
      out.data.character_book.entries = missRes.entries;
      fixed.push(...missRes.fixed);
    }
    // (bug 174) …rồi bọc nháy giá trị trần mà YAML đọc sai. Đặt SAU bước điền thiếu để giá trị
    // vừa điền cũng đi qua bộ lọc này.
    const scalarRes = repairInitvarAmbiguousScalars(out.data.character_book?.entries ?? [], schema);
    if (scalarRes.fixed.length > 0 && out.data.character_book) {
      out.data.character_book.entries = scalarRes.entries;
      fixed.push(...scalarRes.fixed);
    }
  }

  // 3. Nhóm phép vá trên regex scripts.
  const ext = out.data.extensions as unknown as Record<string, unknown>;
  let scripts = (ext?.regex_scripts as RegexScript[] | undefined) ?? [];
  if (scripts.length > 0) {
    const fenceRes = repairUnclosedFence(scripts);
    scripts = fenceRes.scripts; fixed.push(...fenceRes.fixed);

    const handlerRes = repairModuleHandlers(scripts);
    scripts = handlerRes.scripts; fixed.push(...handlerRes.fixed);

    const clashRes = repairAnchorClash(scripts);
    scripts = clashRes.scripts; fixed.push(...clashRes.fixed);

    if (schema) {
      const varRes = repairDataVarCasing(scripts, collectSchemaVarNames(schema));
      scripts = varRes.scripts; fixed.push(...varRes.fixed);
      for (const bad of varRes.unresolved) {
        needsAi.push(`data-var "${bad}" không khớp biến nào trong schema và không đoán được — cần đặt lại tên biến hoặc thêm field vào schema`);
      }
    }

    // Script render rỗng: không thể bịa nội dung, đẩy sang AI.
    for (const s of scripts) {
      if (s.promptOnly && !s.markdownOnly) continue;
      const isAnchor = !!s.findRegex && [OPENING_FORM_ANCHOR, STATUS_BAR_ANCHOR].includes(s.findRegex);
      if (isAnchor && String(s.replaceString || '').trim() === '') {
        needsAi.push(`Script render "${s.scriptName || s.findRegex}" có nội dung RỖNG — cần sinh lại giao diện`);
      }
    }
    (ext as Record<string, unknown>).regex_scripts = scripts;
  }

  // 4. Mỏ neo còn thiếu trong first_mes — chỉ chèn mỏ neo mà THẬT SỰ có script bám vào.
  const anchorsInUse = new Set(
    scripts.filter(s => !s.disabled && !!s.findRegex).map(s => s.findRegex as string),
  );
  const needAnchors = [OPENING_FORM_ANCHOR, STATUS_BAR_ANCHOR]
    .filter(a => anchorsInUse.has(a) && !String(out.data.first_mes || '').includes(a));
  if (needAnchors.length > 0) {
    const anchorRes = repairMissingAnchors(out, needAnchors);
    out = anchorRes.card;
    fixed.push(...anchorRes.fixed);
  }

  // 5. Những gì buộc phải sáng tác nội dung.
  if (!out.data.name?.trim()) needsAi.push('Thiếu tên nhân vật');
  if (!out.data.description?.trim()) needsAi.push('Thiếu mô tả nhân vật');
  if (!out.data.first_mes?.trim()) needsAi.push('Thiếu first message (lời mở đầu)');
  if ((out.data.character_book?.entries ?? []).length === 0) needsAi.push('Lorebook chưa có entry nào');

  return { card: out, fixed, needsAi };
}
