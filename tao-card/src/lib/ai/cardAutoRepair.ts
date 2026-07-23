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
import { generateWorldbookEntries, applyGeneratedEntries, findExistingMVUZODEntries } from '../export/worldbookGenerator';
import { OPENING_FORM_ANCHOR, STATUS_BAR_ANCHOR } from '../mvuzod/regexAnchors';

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

/* ══════════════════════ CHẠY CẢ LƯỢT ══════════════════════ */

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

  // 1. Dựng lại entry hệ thống MVU còn thiếu.
  const mvuRes = repairMissingMvuzodEntries(out, schema);
  out = mvuRes.card;
  fixed.push(...mvuRes.fixed);

  // 2. Tắt [initvar] (gồm cả entry vừa dựng ở bước 1).
  const entries = out.data.character_book?.entries ?? [];
  if (entries.length > 0) {
    const initRes = repairInitvarEnabled(entries);
    if (initRes.fixed.length > 0 && out.data.character_book) {
      out.data.character_book.entries = initRes.entries;
      fixed.push(...initRes.fixed);
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
