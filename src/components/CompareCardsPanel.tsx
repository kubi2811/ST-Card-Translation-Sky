/**
 * CompareCardsPanel — So Sánh Card: mở 3 phiên bản cùng 1 card cạnh nhau, sửa & xuất.
 * ──────────────────────────────────────────────────────────────────────────────
 * 3 cột: Card Raw / Card Đã Dịch / Card Final. Mỗi entry gióng thẳng hàng theo `path`,
 * nhóm theo loại (core, lorebook, mở đầu, regex, MVU…). Sửa từng ô → Lưu ghi thẳng vào card
 * (trong bộ nhớ) → Xuất JSON/PNG. Hoàn toàn tách biệt với phiên dịch chính (không đụng store card).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useUi } from '../i18n/useLocale';
import { fmt } from '../i18n';
import {
  X, Upload, Save, Download, Trash2, ChevronDown, ChevronRight,
  Search, AlertTriangle, FileJson, Image as ImageIcon, Columns3,
} from 'lucide-react';
import { useStore } from '../store';
import { parseCardFile, parseCardJsonText, type ParsedCard } from '../utils/parseCardFile';
import {
  buildCompareGroups, valuesDiffer, planMerge, planMergeTwoCard, promoteSuspects, type MergePlan,
} from '../utils/compareCards';
import { extractTranslatableFields, setNestedValue, DEFAULT_FIELD_GROUPS } from '../utils/cardFields';
import { syncEmbeddedWorldLink } from '../utils/worldLink';
import { embedCharaToPNG } from '../utils/pngHandler';
// (bugNeedFix/184) AI soi khác biệt từng mục Dịch ↔ Final + vá bản dịch thay vì dịch lại cả entry.
import {
  buildCompareDiffMessages, parseCompareDiffResponse, verifyPatched, type CompareDiffInput,
} from '../utils/aiCompareDiff';
import { callProvider, computePoolConcurrency } from '../utils/apiClient';
// (bug 235) Ghép entry bằng TÊN do AI đối chiếu — thay cho ghép bằng chỗ ngồi entries[i].
import {
  collectMatchUnits, matchUnitsByRule, buildNameMatchMessages, parseNameMatchResponse,
  buildContentVerdictMessages, parseContentVerdictResponse, batchContentJobs,
  buildFieldReusePlan, defaultReuse,
  type MatchUnit, type MatchRow, type ContentJob, type ContentAnswer,
} from '../utils/aiEntryMatch';
import { runWorkerPool } from '../utils/runWorkerPool';
import type { CompareEntry } from '../utils/compareCards';
import type { CharacterCard, FieldGroup, TranslationField } from '../types/card';

export default function CompareCardsPanelDefault(props: Props) {
  return <CompareCardsPanel {...props} />;
}

interface Props { onClose: () => void; }

type SlotId = 'raw' | 'translated' | 'final';
/** Tên cột ở module scope nên chỉ giữ KEY, tra `ui` lúc render. */
const SLOT_ORDER: { id: SlotId; nameKey: 'ccSlotRaw' | 'ccSlotTranslated' | 'ccSlotFinal'; color: string }[] = [
  { id: 'raw', nameKey: 'ccSlotRaw', color: '#9ca3af' },
  { id: 'translated', nameKey: 'ccSlotTranslated', color: 'var(--accent-primary)' },
  { id: 'final', nameKey: 'ccSlotFinal', color: '#22c55e' },
];

interface Slot {
  parsed: ParsedCard | null;
  fields: TranslationField[];
  valueByPath: Map<string, string>;
  edits: Record<string, string>;
}
const emptySlot = (): Slot => ({ parsed: null, fields: [], valueByPath: new Map(), edits: {} });

const ALL_GROUP_IDS: FieldGroup[] = DEFAULT_FIELD_GROUPS.map((g) => g.id);
const stem = (name: string) => name.replace(/\.(json|png)$/i, '');

function triggerDownload(href: string, filename: string, revoke = false) {
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  a.click();
  if (revoke) setTimeout(() => URL.revokeObjectURL(href), 1500);
}

export function CompareCardsPanel({ onClose }: Props) {
  const addToast = useStore((s) => s.addToast);
  const proxy = useStore((s) => s.proxy);   // (bug 184) cấu hình API cho lượt "AI soi khác"
  const ui = useUi();
  const [slots, setSlots] = useState<Record<SlotId, Slot>>({
    raw: emptySlot(), translated: emptySlot(), final: emptySlot(),
  });
  const [collapsed, setCollapsed] = useState<Set<FieldGroup>>(new Set());
  const [diffOnly, setDiffOnly] = useState(false);
  const [query, setQuery] = useState('');
  const [merge, setMerge] = useState<MergePlan | null>(null); // kết quả "Gộp thông minh" (xem trước)

  const patchSlot = useCallback((id: SlotId, patch: Partial<Slot>) => {
    setSlots((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }, []);

  // ─── Import 1 card vào 1 slot ───
  const importFile = useCallback(async (id: SlotId, file: File) => {
    setMerge(null); // đổi card → xoá kết quả gộp cũ (đã lỗi thời)
    try {
      const parsed = await parseCardFile(file);
      const fields = extractTranslatableFields(parsed.card, ALL_GROUP_IDS);
      const valueByPath = new Map(fields.map((f) => [f.path, f.original]));
      patchSlot(id, { parsed, fields, valueByPath, edits: {} });
      const slotDef = SLOT_ORDER.find((s) => s.id === id);
      addToast('success', fmt(ui.ccToastLoaded, { name: slotDef ? ui[slotDef.nameKey] : '', count: fields.length }));
    } catch (e) {
      addToast('error', e instanceof Error ? e.message : String(e));
    }
  }, [addToast, patchSlot]);

  // ─── Nạp 1 slot từ JSON DÁN trực tiếp (không cần file — dùng khi tạo card từ WB) ───
  const importJsonText = useCallback((id: SlotId, text: string) => {
    setMerge(null);
    try {
      const parsed = parseCardJsonText(text);
      const fields = extractTranslatableFields(parsed.card, ALL_GROUP_IDS);
      const valueByPath = new Map(fields.map((f) => [f.path, f.original]));
      patchSlot(id, { parsed, fields, valueByPath, edits: {} });
      const slotDef = SLOT_ORDER.find((s) => s.id === id);
      addToast('success', fmt(ui.ccToastLoaded, { name: slotDef ? ui[slotDef.nameKey] : '', count: fields.length }));
      return true;
    } catch (e) {
      addToast('error', e instanceof Error ? e.message : String(e));
      return false;
    }
  }, [addToast, patchSlot, ui]);

  const removeSlot = useCallback((id: SlotId) => {
    const dirty = Object.keys(slots[id].edits).length;
    if (dirty > 0 && !window.confirm(fmt(ui.ccConfirmRemove, { count: dirty }))) return;
    patchSlot(id, { ...emptySlot() });
    setMerge(null);
  }, [slots, patchSlot]);

  // ─── Sửa 1 ô ───
  const editCell = useCallback((id: SlotId, path: string, value: string) => {
    setSlots((prev) => ({ ...prev, [id]: { ...prev[id], edits: { ...prev[id].edits, [path]: value } } }));
  }, []);

  // ─── Lưu 1 ô (ghi thẳng vào card) ───
  const saveCell = useCallback((id: SlotId, path: string) => {
    setSlots((prev) => {
      const slot = prev[id];
      if (!slot.parsed || !(path in slot.edits)) return prev;
      const val = slot.edits[path];
      setNestedValue(slot.parsed.card as unknown as Record<string, unknown>, path, val);
      const valueByPath = new Map(slot.valueByPath); valueByPath.set(path, val);
      const edits = { ...slot.edits }; delete edits[path];
      return { ...prev, [id]: { ...slot, valueByPath, edits } };
    });
  }, []);

  // ─── Lưu tất cả ô của 1 cột ───
  const saveAll = useCallback((id: SlotId) => {
    setSlots((prev) => {
      const slot = prev[id];
      if (!slot.parsed) return prev;
      const valueByPath = new Map(slot.valueByPath);
      for (const [p, v] of Object.entries(slot.edits)) {
        setNestedValue(slot.parsed.card as unknown as Record<string, unknown>, p, v);
        valueByPath.set(p, v);
      }
      return { ...prev, [id]: { ...slot, valueByPath, edits: {} } };
    });
    addToast('success', ui.ccToastSavedAll);
  }, [addToast]);

  // Áp mọi edit còn lại thẳng vào card object (đồng bộ, cho export) rồi dọn state.
  const flushEdits = useCallback((slot: Slot): CharacterCard | null => {
    if (!slot.parsed) return null;
    for (const [p, v] of Object.entries(slot.edits)) {
      setNestedValue(slot.parsed.card as unknown as Record<string, unknown>, p, v);
    }
    // (bug 73) Đây là điểm hội tụ của cả nút xuất JSON lẫn PNG ở panel này — nếu bỏ qua thì
    // card xuất từ So Sánh Thẻ vẫn đứt sợi dây lorebook↔nhân vật, dù đường xuất chính đã vá.
    syncEmbeddedWorldLink(slot.parsed.card, slot.parsed.card);
    return slot.parsed.card;
  }, []);

  const exportJson = useCallback((id: SlotId) => {
    const slot = slots[id];
    const card = flushEdits(slot);
    if (!card || !slot.parsed) return;
    const blob = new Blob([JSON.stringify(card, null, 2)], { type: 'application/json' });
    triggerDownload(URL.createObjectURL(blob), `${stem(slot.parsed.fileName)}.json`, true);
    saveAll(id);
  }, [slots, flushEdits, saveAll]);

  const exportPng = useCallback(async (id: SlotId) => {
    const slot = slots[id];
    if (!slot.parsed?.dataUrl) return;
    const card = flushEdits(slot);
    if (!card) return;
    try {
      const dataUrl = await embedCharaToPNG(slot.parsed.dataUrl, JSON.stringify(card));
      triggerDownload(dataUrl, `${stem(slot.parsed.fileName)}.png`);
      saveAll(id);
    } catch (e) {
      addToast('error', fmt(ui.ccToastPngErr, { msg: e instanceof Error ? e.message : String(e) }));
    }
  }, [slots, flushEdits, saveAll, addToast]);

  // ─── Gộp thông minh (tái dùng bản dịch cũ cho entry không đổi) ───
  // (User 24/07) Trước đây BẮT BUỘC đủ 3 card. Thực tế user thường chỉ còn bản đã dịch cũ + bản gốc
  // mới của tác giả — thiếu bản gốc CŨ. Nay cho chạy 2 card, nhưng nói thẳng đó là chế độ SUY ĐOÁN:
  // entry mới thì chắc chắn, còn entry tác giả SỬA nội dung thì không thể biết chắc.
  const allThree = SLOT_ORDER.every((s) => slots[s.id].parsed);
  const canMerge2 = !!slots.translated.parsed && !!slots.final.parsed;
  const canMerge = allThree || canMerge2;

  const runMerge = useCallback(() => {
    if (!allThree && !canMerge2) return;
    const plan = allThree
      ? planMerge(slots.raw.valueByPath, slots.translated.valueByPath, slots.final.valueByPath)
      : planMergeTwoCard(slots.translated.valueByPath, slots.final.valueByPath);
    setMerge(plan);
    setDiffOnly(false);
    addToast('success', fmt(ui.ccToastMerged, { reused: plan.counts.reused, changed: plan.counts.changed }));
  }, [allThree, canMerge2, slots, addToast]);

  /** Chuyển mọi mục "nghi tác giả đã sửa" sang diện cần dịch. */
  const promoteAllSuspects = useCallback(() => {
    setMerge((prev) => {
      if (!prev || prev.suspect.size === 0) return prev;
      const n = prev.suspect.size;
      const next = promoteSuspects(prev);
      addToast('success', fmt(ui.ccToastPromoted, { count: n }));
      return next;
    });
  }, [addToast]);

  // Đưa Card Final sang Dịch Card: reused = "đã dịch" (khoá), phần mới = "chờ dịch".
  // (Bug 39b — 2026) THỨ TỰ QUAN TRỌNG: trước đây setCard/setFields chạy NGAY trong click khi
  // overlay So Sánh còn mount → React commit MỘT LẦN vừa dựng toàn bộ UI dịch (605 field) vừa
  // re-render overlay ⇒ main thread nghẽn chục giây, Chrome báo "Trang không phản hồi" ngay tại
  // nút bấm. Nay: (1) đóng overlay TRƯỚC (unmount cây nặng, trình duyệt kịp vẽ), (2) việc nặng
  // dời sang setTimeout để chạy ở commit sau — dữ liệu đã chụp vào closure nên không đổi hành vi.
  const sendToTranslate = useCallback(() => {
    const finalSlot = slots.final;
    if (!finalSlot.parsed || !merge) return;
    if (!window.confirm(fmt(ui.ccConfirmSend, { reused: merge.counts.reused, changed: merge.counts.changed }))) return;
    const { card, fileName, dataUrl } = finalSlot.parsed;
    const reused = merge.reused;
    const changedCount = merge.counts.changed;
    onClose();
    setTimeout(() => {
      const st = useStore.getState();
      st.setCard(card, fileName, dataUrl, 'card', null);
      const enabled = st.translationConfig.fieldGroups.filter((g) => g.enabled).map((g) => g.id);
      const fields = extractTranslatableFields(card, enabled);
      const mergedFields = fields.map((f) => reused.has(f.path)
        ? { ...f, translated: reused.get(f.path)!, status: 'done' as const, error: undefined }
        : f);
      st.setFields(mergedFields);
      addToast('success', fmt(ui.ccToastSent, { count: changedCount }));
    }, 60);
  }, [slots, merge, addToast, onClose]);

  // ═══ (bugNeedFix/184) AI SOI KHÁC BIỆT TỪNG MỤC ═══
  // "đôi khi khác có tí xíu nhưng phải dịch lại toàn bộ entry thì không ổn lắm" — gộp thông minh
  // chỉ biết chia hai loại "y hệt / khác", còn KHÁC GÌ thì nó chịu. Nút này gọi AI cho ĐÚNG MỘT
  // entry: liệt kê đích danh tác giả đổi gì + trả bản dịch đã vá (giữ nguyên tối đa bản dịch cũ,
  // chỉ đắp phần thay đổi). Bản vá qua chốt máy (macro/ngoặc/JS) rồi mới cho áp.
  interface AiDiffState {
    entry: CompareEntry;
    status: 'running' | 'done' | 'error';
    error?: string;
    differences: string[];
    patched: string;
    problems: string[];
  }
  const [aiDiff, setAiDiff] = useState<AiDiffState | null>(null);
  const aiDiffAbortRef = useRef<AbortController | null>(null);
  // `effective` khai báo phía dưới (cần slots mới nhất) — đọc qua ref để useCallback này không
  // ôm closure cũ (stale slots) mà cũng không phải re-create theo từng phím gõ.
  const effectiveRef = useRef<(id: SlotId, path: string) => string | undefined>(() => undefined);

  const runAiDiff = useCallback(async (entry: CompareEntry) => {
    const translated = effectiveRef.current('translated', entry.path) ?? '';
    const final = effectiveRef.current('final', entry.path) ?? '';
    if (!translated.trim() || !final.trim()) { addToast('error', 'Cần cả ô Dịch lẫn ô Final có nội dung.'); return; }
    aiDiffAbortRef.current?.abort();
    const ac = new AbortController();
    aiDiffAbortRef.current = ac;
    setAiDiff({ entry, status: 'running', differences: [], patched: '', problems: [] });
    try {
      const input: CompareDiffInput = {
        label: entry.label, path: entry.path,
        raw: effectiveRef.current('raw', entry.path),
        translated, final,
      };
      const { system, user } = buildCompareDiffMessages(input);
      const rawText = await callProvider(proxy, system, user, ac.signal, undefined,
        { label: `So khác: ${entry.label}`, charCount: user.length });
      const parsed = parseCompareDiffResponse(rawText);
      const verdict = verifyPatched(input, parsed.patched);
      setAiDiff({
        entry, status: 'done',
        differences: parsed.differences,
        patched: verdict.patched,
        problems: verdict.problems,
      });
    } catch (e) {
      if (ac.signal.aborted) { setAiDiff(null); return; }
      setAiDiff({
        entry, status: 'error', error: e instanceof Error ? e.message : String(e),
        differences: [], patched: '', problems: [],
      });
    }
  }, [proxy, addToast]);

  /* ═══ (bug 235) GHÉP ENTRY BẰNG TÊN — AI ĐỐI CHIẾU, KHÔNG ĐI THEO CHỖ NGỒI ═══
   * User: "so bằng UID nó sai bét nhè… Đầu tiên là so sánh xem các entry có tên gốc tiếng Trung
   * của bản raw nếu dịch ra sẽ giống các tên entry nào của bản đã dịch. Sau đó tới khâu so sánh
   * nội dung… AI tự phát hiện entry lorebook/schema/regex/script nào có thể tái sử dụng."
   *
   * Ba tầng, rẻ trước đắt sau (xem aiEntryMatch.ts để biết vì sao lối cũ gãy):
   *   0. Luật máy — key Hán / tên trùng / nội dung trùng. Miễn phí, chắc chắn, không tốn call.
   *   1. AI ghép TÊN — MỘT lượt gọi cho cả danh sách còn lại.
   *   2. AI so NỘI DUNG từng cặp — chia lô, chạy song song qua pool như vòng dịch chính.
   * Kết quả ra BẢNG DUYỆT: người dùng thấy từng cặp ghép với ai, độ tin, kết luận, rồi tự tick.
   */
  interface AiMatchState {
    status: 'running' | 'done' | 'error';
    phase: string;
    error?: string;
    rows: MatchRow[];
    /** Đơn vị bên bản mới không ghép được với ai — entry tác giả mới thêm. */
    unmatchedNew: MatchUnit[];
    done: number;
    total: number;
  }
  const [aiMatch, setAiMatch] = useState<AiMatchState | null>(null);
  const aiMatchAbortRef = useRef<AbortController | null>(null);

  const runAiMatch = useCallback(async () => {
    const oldFields = slots.translated.fields;
    const newFields = slots.final.fields;
    if (!oldFields.length || !newFields.length) {
      addToast('error', 'Cần nạp cả cột "Card Đã Dịch" (bản cũ) lẫn "Card Final" (bản raw mới).');
      return;
    }
    aiMatchAbortRef.current?.abort();
    const ac = new AbortController();
    aiMatchAbortRef.current = ac;

    const oldUnits = collectMatchUnits(oldFields);
    const newUnits = collectMatchUnits(newFields);
    if (!newUnits.length) {
      addToast('error', 'Bản Final không có entry lorebook / regex / script nào để ghép.');
      return;
    }
    setAiMatch({ status: 'running', phase: `Đang ghép bằng luật (${newUnits.length} mục)…`, rows: [], unmatchedNew: [], done: 0, total: 0 });

    try {
      // ── Tầng 0: luật máy ──
      const rule = matchUnitsByRule(oldUnits, newUnits);
      const pairs = [...rule.pairs];

      // ── Tầng 1: AI ghép tên cho phần còn lại ──
      if (rule.restNew.length > 0 && rule.restOld.length > 0) {
        setAiMatch((s) => s && { ...s, phase: `Pha 1 — AI đối chiếu TÊN cho ${rule.restNew.length} mục còn lại…` });
        const { system, user } = buildNameMatchMessages(rule.restOld, rule.restNew);
        const text = await callProvider(proxy, system, user, ac.signal, undefined,
          { label: `Ghép tên entry (${rule.restNew.length} mục)`, charCount: user.length });
        pairs.push(...parseNameMatchResponse(text, rule.restOld, rule.restNew));
      }

      const oldById = new Map(oldUnits.map((u) => [u.id, u]));
      const newById = new Map(newUnits.map((u) => [u.id, u]));

      // ── Tầng 2: AI so nội dung từng cặp ──
      // Cặp ghép bằng luật "nội dung trùng y hệt" thì KHỎI hỏi AI — máy đã biết chắc là giống.
      const needVerdict = pairs.filter((p) => p.method !== 'noi-dung-trung');
      const jobs: ContentJob[] = needVerdict.map((p) => ({
        newId: p.newId,
        name: newById.get(p.newId)?.name || p.newId,
        rawContent: newById.get(p.newId)?.content || '',
        oldTranslated: oldById.get(p.oldId)?.content || '',
      })).filter((j) => j.rawContent.trim() && j.oldTranslated.trim());

      const batches = batchContentJobs(jobs);
      const answers = new Map<string, ContentAnswer>();
      if (batches.length > 0) {
        setAiMatch((s) => s && { ...s, phase: `Pha 2 — AI so NỘI DUNG ${jobs.length} cặp (${batches.length} lô)…`, total: batches.length, done: 0 });
        await runWorkerPool({
          total: batches.length,
          concurrency: Math.max(1, Math.min(computePoolConcurrency(proxy), batches.length)),
          shouldStop: () => ac.signal.aborted,
          runOne: async (i: number) => {
            const batch = batches[i];
            try {
              const { system, user } = buildContentVerdictMessages(batch);
              const text = await callProvider(proxy, system, user, ac.signal, undefined,
                { label: `So nội dung lô ${i + 1}/${batches.length}`, charCount: user.length });
              for (const a of parseContentVerdictResponse(text, batch)) answers.set(a.newId, a);
            } catch (e) {
              // Lô hỏng KHÔNG được kéo cả lượt xuống — mọi cặp trong lô về "chưa chắc" (⇒ dịch lại).
              const why = e instanceof Error ? e.message : String(e);
              for (const j of batch) {
                answers.set(j.newId, { newId: j.newId, verdict: 'khong-chac', note: `Lô so nội dung lỗi (${why.slice(0, 60)}) — coi là chưa chắc.` });
              }
            }
            setAiMatch((s) => s && { ...s, done: s.done + 1 });
          },
        });
      }
      if (ac.signal.aborted) { setAiMatch(null); return; }

      // ── Dựng bảng duyệt ──
      const rows: MatchRow[] = pairs.map((p) => {
        const a = answers.get(p.newId);
        const verdict = p.method === 'noi-dung-trung' ? 'giong' as const : (a?.verdict ?? 'khong-chac');
        const note = p.method === 'noi-dung-trung'
          ? 'Nội dung hai bên trùng y hệt — máy đối chiếu, không cần AI.'
          : (a?.note || '');
        return {
          pair: p,
          newName: newById.get(p.newId)?.name || p.newId,
          oldName: oldById.get(p.oldId)?.name || p.oldId,
          verdict, note, reuse: defaultReuse(verdict),
        };
      }).sort((a, b) => a.pair.newId.localeCompare(b.pair.newId, undefined, { numeric: true }));

      const matchedNew = new Set(rows.map((r) => r.pair.newId));
      setAiMatch({
        status: 'done', phase: '', rows,
        unmatchedNew: newUnits.filter((u) => !matchedNew.has(u.id)),
        done: batches.length, total: batches.length,
      });
      addToast('success', `Ghép xong: ${rows.length}/${newUnits.length} mục tìm được bản dịch cũ.`);
    } catch (e) {
      if (ac.signal.aborted) { setAiMatch(null); return; }
      setAiMatch({
        status: 'error', phase: '', error: e instanceof Error ? e.message : String(e),
        rows: [], unmatchedNew: [], done: 0, total: 0,
      });
    }
  }, [slots, proxy, addToast]);

  /**
   * Áp bảng ghép vào kế hoạch gộp.
   *
   * KHÔNG vứt bỏ kế hoạch cũ: `planMergeTwoCard` vẫn lo phần field ĐƠN LẺ (mô tả, lời mở đầu,
   * system prompt) — những chỗ khớp theo path là ĐÚNG vì chúng không nằm trong mảng. Bản đồ AI
   * chỉ ĐÈ LÊN phần entry/script, tức đúng chỗ lối cũ sai.
   */
  const applyAiMatch = useCallback(() => {
    if (!aiMatch || aiMatch.status !== 'done') return;
    const base = planMergeTwoCard(slots.translated.valueByPath, slots.final.valueByPath);
    const fieldPlan = buildFieldReusePlan(aiMatch.rows, slots.translated.fields, slots.final.fields);

    // Mọi path thuộc một đơn vị bên bản mới — vùng do AI quản.
    const newUnits = collectMatchUnits(slots.final.fields);
    const pathsById = new Map(newUnits.map((u) => [u.id, u.paths]));
    const unitPaths = new Set<string>(newUnits.flatMap((u) => u.paths));

    const reused = new Map(base.reused);
    const changed = new Set(base.changed);
    for (const p of unitPaths) { reused.delete(p); changed.add(p); }   // xoá phán quyết cũ trong vùng
    for (const [p, v] of fieldPlan.reused) { reused.set(p, v); changed.delete(p); }

    // Cặp "chưa chắc"/"khác" mà người dùng VẪN tick tái dùng → tô vàng để họ còn nhìn lại.
    const suspect = new Set<string>();
    for (const r of aiMatch.rows) {
      if (!r.reuse || r.verdict === 'giong') continue;
      for (const p of pathsById.get(r.pair.newId) ?? []) if (reused.has(p)) suspect.add(p);
    }

    setMerge({
      reused, changed, suspect, mode: '2card',
      counts: { reused: reused.size, changed: changed.size, suspect: suspect.size, total: slots.final.valueByPath.size },
    });
    setAiMatch(null);
    setDiffOnly(false);
    addToast('success', `Đã áp: tái dùng ${fieldPlan.counts.units} mục (${fieldPlan.counts.fields} ô), ${fieldPlan.counts.skipped} mục bỏ qua.`);
  }, [aiMatch, slots, addToast]);

  /** Bật/tắt tái dùng cho MỘT dòng trong bảng duyệt. */
  const toggleMatchRow = useCallback((newId: string) => {
    setAiMatch((s) => s && ({
      ...s,
      rows: s.rows.map((r) => (r.pair.newId === newId ? { ...r, reuse: !r.reuse } : r)),
    }));
  }, []);

  /** Áp bản vá vào một cột (thường là Final — chính là card sẽ xuất ra). */
  const applyAiPatch = useCallback((target: SlotId) => {
    if (!aiDiff || aiDiff.status !== 'done' || !aiDiff.patched) return;
    editCell(target, aiDiff.entry.path, aiDiff.patched);
    saveCell(target, aiDiff.entry.path);
    addToast('success', `Đã áp bản vá vào cột ${target === 'final' ? 'Final' : 'Dịch'} — ${aiDiff.entry.label}.`);
    setAiDiff(null);
  }, [aiDiff, editCell, saveCell, addToast]);

  // Xuất Card Final đã gộp (đắp bản dịch cũ vào entry không đổi, phần mới giữ nguyên ngữ).
  const exportFinalMerged = useCallback(() => {
    const finalSlot = slots.final;
    if (!finalSlot.parsed || !merge) return;
    for (const [p, v] of merge.reused) setNestedValue(finalSlot.parsed.card as unknown as Record<string, unknown>, p, v);
    // (bug 73) Đường này KHÔNG đi qua flushEdits nên phải nối sợi dây riêng ở đây.
    syncEmbeddedWorldLink(finalSlot.parsed.card, finalSlot.parsed.card);
    const blob = new Blob([JSON.stringify(finalSlot.parsed.card, null, 2)], { type: 'application/json' });
    triggerDownload(URL.createObjectURL(blob), `${stem(finalSlot.parsed.fileName)}_final.json`, true);
    addToast('success', fmt(ui.ccToastExported, { reused: merge.counts.reused, changed: merge.counts.changed }));
  }, [slots, merge, addToast]);

  // ─── Dữ liệu hiển thị ───
  const loadedSlots = SLOT_ORDER.filter((s) => slots[s.id].parsed);
  const groups = useMemo(
    () => buildCompareGroups(loadedSlots.map((s) => slots[s.id].fields)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slots.raw.fields, slots.translated.fields, slots.final.fields],
  );

  const effective = (id: SlotId, path: string): string | undefined => {
    const slot = slots[id];
    if (path in slot.edits) return slot.edits[path];
    return slot.valueByPath.has(path) ? slot.valueByPath.get(path) : undefined;
  };
  effectiveRef.current = effective;   // (bug 184) cho runAiDiff đọc state mới nhất
  const isDirty = (id: SlotId, path: string) =>
    path in slots[id].edits && slots[id].edits[path] !== slots[id].valueByPath.get(path);

  const q = query.trim().toLowerCase();
  const visibleGroups = useMemo(() => {
    return groups.map((g) => ({
      ...g,
      entries: g.entries.filter((e) => {
        if (q && !e.label.toLowerCase().includes(q) && !e.path.toLowerCase().includes(q)) return false;
        if (diffOnly && !valuesDiffer(SLOT_ORDER.map((s) => effective(s.id, e.path)))) return false;
        return true;
      }),
    })).filter((g) => g.entries.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, q, diffOnly, slots]);

  const totalDirty = SLOT_ORDER.reduce((n, s) => n + Object.keys(slots[s.id].edits).length, 0);
  const handleClose = () => {
    if (totalDirty > 0 && !window.confirm(fmt(ui.ccConfirmClose, { count: totalDirty }))) return;
    onClose();
  };

  const gridCols = '200px repeat(3, minmax(0, 1fr))';

  // ─── (Bug 39b — 2026) ẢO HOÁ bảng so sánh ───
  // Trước đây render THẲNG 605 hàng × 3 ô textarea (~1.815 textarea thật trong DOM) → mount/re-render
  // nào cũng nghẽn main thread hàng giây; cộng với cú setCard khi "Đưa sang Dịch Card" là đủ
  // "Trang không phản hồi". Nay làm phẳng (header nhóm + hàng) thành 1 danh sách rồi chỉ render
  // phần đang nhìn thấy — cùng kỹ thuật bảng chính FieldEditor đang dùng.
  type FlatItem =
    | { kind: 'header'; group: (typeof visibleGroups)[number]['group']; label: string; count: number }
    | { kind: 'row'; entry: (typeof visibleGroups)[number]['entries'][number] };
  const flatItems = useMemo<FlatItem[]>(() => {
    const out: FlatItem[] = [];
    for (const g of visibleGroups) {
      out.push({ kind: 'header', group: g.group, label: g.label, count: g.entries.length });
      if (!collapsed.has(g.group)) for (const e of g.entries) out.push({ kind: 'row', entry: e });
    }
    return out;
  }, [visibleGroups, collapsed]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: flatItems.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (flatItems[i]?.kind === 'header' ? 34 : 96),
    overscan: 10,
  });
  // Đổi độ dài danh sách (lọc/gộp/đóng mở nhóm) → đo lại, tránh tổng chiều cao lệch (như FieldEditor).
  const prevFlatLenRef = useRef(flatItems.length);
  useEffect(() => {
    if (prevFlatLenRef.current !== flatItems.length) {
      prevFlatLenRef.current = flatItems.length;
      rowVirtualizer.measure();
    }
  }, [flatItems.length, rowVirtualizer]);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'var(--bg-primary)', display: 'flex', flexDirection: 'column' }}>
      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 18px', borderBottom: '1px solid var(--border-default)', background: 'var(--bg-secondary)' }}>
        <Columns3 size={18} color="var(--accent-primary)" />
        <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>{ui.ccTitle}</span>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{ui.ccSubtitle}</span>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ position: 'relative' }}>
            <Search size={13} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={ui.ccSearchPh}
              style={{ padding: '5px 8px 5px 26px', fontSize: '0.72rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)', background: 'var(--bg-primary)', color: 'var(--text-primary)', width: '150px' }} />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.72rem', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <input type="checkbox" checked={diffOnly} onChange={(e) => setDiffOnly(e.target.checked)} />
            {ui.ccDiffOnly}
          </label>
          {totalDirty > 0 && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.72rem', color: 'var(--accent-warning)' }}>
              <AlertTriangle size={13} /> {fmt(ui.ccUnsavedCount, { count: totalDirty })}
            </span>
          )}
          <button onClick={handleClose} style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '6px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)', background: 'var(--bg-primary)', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '0.75rem' }}>
            <X size={14} /> {ui.ccClose}
          </button>
        </div>
      </div>

      {/* Merge bar — Gộp thông minh */}
      {loadedSlots.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 18px', borderBottom: '1px solid var(--border-default)', background: 'rgba(56,189,248,0.06)', flexWrap: 'wrap' }}>
          {!merge ? (
            <>
              <button onClick={runMerge} disabled={!canMerge}
                title={allThree ? ui.ccMergeTitleOk : canMerge2 ? ui.ccMergeMode2Tip : ui.ccMergeTitleNeed}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 14px', borderRadius: 'var(--radius-sm)', border: 'none', background: canMerge ? '#38bdf8' : 'var(--bg-elevated)', color: canMerge ? '#04263a' : 'var(--text-muted)', fontWeight: 700, fontSize: '0.78rem', cursor: canMerge ? 'pointer' : 'default' }}>
                {ui.ccMergeBtn}{canMerge ? '' : ui.ccMergeBtnNeed2}
              </button>
              {/* Nói rõ đang chạy chế độ nào — chính xác (3 card) hay suy đoán (2 card). */}
              {canMerge && (
                <span title={allThree ? ui.ccMergeMode3Tip : ui.ccMergeMode2Tip}
                  style={{ fontSize: '0.68rem', fontWeight: 700, padding: '3px 9px', borderRadius: '99px', cursor: 'help',
                    background: allThree ? 'rgba(34,197,94,0.12)' : 'rgba(251,191,36,0.14)',
                    color: allThree ? '#22c55e' : 'var(--accent-warning)',
                    border: `1px solid ${allThree ? 'rgba(34,197,94,0.35)' : 'rgba(251,191,36,0.4)'}` }}>
                  {allThree ? ui.ccMergeMode3 : ui.ccMergeMode2}
                </span>
              )}
              {/* (bug 235) Ghép bằng TÊN do AI — lối đúng khi tác giả đảo/chèn/bỏ entry, lúc đó
                  ghép theo chỗ ngồi entries[i] là sai bét. Chỉ cần bản dịch cũ + bản raw mới. */}
              <button onClick={() => void runAiMatch()} disabled={!canMerge2 || aiMatch?.status === 'running'}
                title={canMerge2
                  ? 'AI đối chiếu TÊN entry hai bản (tên tiếng Trung của bản raw ứng với tên tiếng Việt nào), rồi so NỘI DUNG từng cặp để chỉ ra entry nào tái dùng được. Dùng khi tác giả đã đảo thứ tự / thêm / bớt entry — lúc đó ghép theo vị trí là sai.'
                  : 'Cần nạp "Card Đã Dịch" (bản cũ) và "Card Final" (bản raw mới).'}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 14px', borderRadius: 'var(--radius-sm)',
                  border: '1px solid rgba(124,106,240,0.5)', background: canMerge2 ? 'rgba(124,106,240,0.12)' : 'var(--bg-elevated)',
                  color: canMerge2 ? 'var(--accent-primary)' : 'var(--text-muted)', fontWeight: 700, fontSize: '0.78rem',
                  cursor: canMerge2 && aiMatch?.status !== 'running' ? 'pointer' : 'default' }}>
                🤖 Ghép entry bằng TÊN (AI)
              </button>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                {ui.ccMergeHint}
              </span>
            </>
          ) : (
            <>
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', fontWeight: 700 }}>
                <span style={{ color: '#22c55e' }}>{fmt(ui.ccMergeReused, { count: merge.counts.reused })}</span>
                <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>·</span>
                <span style={{ color: 'var(--accent-warning)' }}>{fmt(ui.ccMergeChanged, { count: merge.counts.changed })}</span>
                <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>{fmt(ui.ccMergeTotal, { count: merge.counts.total })}</span>
              </span>
              {/* Chế độ 2 card: mục nghi tác giả đã sửa — VẪN đang tái dùng, tô vàng để user tự quyết. */}
              {merge.counts.suspect > 0 && (
                <span style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                  <span title={ui.ccSuspectTip}
                    style={{ fontSize: '0.72rem', fontWeight: 700, padding: '3px 9px', borderRadius: '99px', cursor: 'help',
                      background: 'rgba(251,191,36,0.14)', color: 'var(--accent-warning)', border: '1px solid rgba(251,191,36,0.4)' }}>
                    {fmt(ui.ccSuspectChip, { count: merge.counts.suspect })}
                  </span>
                  <button onClick={promoteAllSuspects} title={ui.ccSuspectTip}
                    style={{ padding: '5px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(251,191,36,0.5)', background: 'transparent', color: 'var(--accent-warning)', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer' }}>
                    {ui.ccSuspectPromote}
                  </button>
                </span>
              )}
              <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button onClick={sendToTranslate}
                  style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '7px 14px', borderRadius: 'var(--radius-sm)', border: 'none', background: 'var(--accent-primary)', color: '#fff', fontWeight: 700, fontSize: '0.78rem', cursor: 'pointer' }}>
                  {fmt(ui.ccSendBtn, { count: merge.counts.changed })}
                </button>
                <button onClick={exportFinalMerged}
                  style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '7px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '0.75rem', cursor: 'pointer' }}>
                  {ui.ccExportFinal}
                </button>
                <button onClick={() => setMerge(null)}
                  style={{ padding: '7px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)', background: 'transparent', color: 'var(--text-muted)', fontSize: '0.75rem', cursor: 'pointer' }}>
                  {ui.ccCancelMerge}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Column headers (sticky) */}
      <div style={{ display: 'grid', gridTemplateColumns: gridCols, borderBottom: '1px solid var(--border-default)', background: 'var(--bg-secondary)' }}>
        <div style={{ padding: '10px 12px', fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 600, alignSelf: 'center' }}>ENTRY</div>
        {SLOT_ORDER.map((s) => (
          <SlotHeader key={s.id} slotDef={s} slot={slots[s.id]}
            onImport={(f) => importFile(s.id, f)} onPasteJson={(txt) => importJsonText(s.id, txt)} onRemove={() => removeSlot(s.id)}
            onSaveAll={() => saveAll(s.id)} onExportJson={() => exportJson(s.id)} onExportPng={() => exportPng(s.id)} />
        ))}
      </div>

      {/* Grid body */}
      <div ref={scrollRef} style={{ flex: 1, overflow: 'auto' }}>
        {loadedSlots.length === 0 ? (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '20px' }}>
            {ui.ccEmpty1}<br />
            <span style={{ fontSize: '0.72rem' }}>{ui.ccEmpty2}</span>
          </div>
        ) : flatItems.length === 0 ? (
          <div style={{ padding: '30px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>{ui.ccNoMatch}</div>
        ) : (
          <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
            {rowVirtualizer.getVirtualItems().map((vRow) => {
              const item = flatItems[vRow.index];
              const inner = item.kind === 'header' ? (() => {
                const isCollapsed = collapsed.has(item.group);
                return (
                  <div onClick={() => setCollapsed((prev) => { const n = new Set(prev); n.has(item.group) ? n.delete(item.group) : n.add(item.group); return n; })}
                    style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 12px', background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer' }}>
                    {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                    <span style={{ fontWeight: 600, fontSize: '0.78rem' }}>{item.label}</span>
                    <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>({item.count})</span>
                  </div>
                );
              })() : (() => {
                const e = item.entry;
                return (
                  <div style={{ display: 'grid', gridTemplateColumns: gridCols, borderBottom: '1px solid var(--border-subtle)' }}>
                    <div style={{ padding: '8px 12px', fontSize: '0.7rem', color: 'var(--text-secondary)', wordBreak: 'break-word', borderRight: '1px solid var(--border-subtle)' }}>
                      <div style={{ fontWeight: 600 }}>{e.label}</div>
                      <div style={{ fontSize: '0.58rem', color: 'var(--text-muted)', marginTop: '2px' }}>{e.path}</div>
                      {/* (bugNeedFix/184) Chỉ hiện khi có cả Dịch lẫn Final và hai bên THẬT SỰ khác —
                          giống nhau thì không có gì để soi, đỡ tốn call. */}
                      {(() => {
                        const tv = effective('translated', e.path);
                        const fv = effective('final', e.path);
                        if (!tv?.trim() || !fv?.trim() || tv === fv) return null;
                        return (
                          <button
                            onClick={() => void runAiDiff(e)}
                            disabled={aiDiff?.status === 'running'}
                            title="Gọi AI so đúng mục này: liệt kê tác giả đã đổi gì giữa bản Dịch và bản Final, và trả bản dịch ĐÃ VÁ (giữ nguyên tối đa bản dịch cũ, chỉ đắp phần thay đổi) — khỏi dịch lại cả entry vì một câu sửa."
                            style={{ marginTop: '5px', display: 'flex', alignItems: 'center', gap: '4px', padding: '3px 7px', fontSize: '0.62rem', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(124,106,240,0.45)', background: 'rgba(124,106,240,0.08)', color: 'var(--accent-primary)', cursor: aiDiff?.status === 'running' ? 'default' : 'pointer', opacity: aiDiff?.status === 'running' ? 0.5 : 1 }}
                          >🤖 AI soi khác</button>
                        );
                      })()}
                    </div>
                    {SLOT_ORDER.map((s) => {
                      const isFinal = s.id === 'final';
                      // 'suspect' = vẫn tái dùng nhưng nghi tác giả đã sửa (chỉ có ở chế độ 2 card).
                      const tag: 'reused' | 'changed' | 'suspect' | undefined = merge && isFinal
                        ? (merge.suspect.has(e.path) ? 'suspect'
                          : merge.reused.has(e.path) ? 'reused'
                          : merge.changed.has(e.path) ? 'changed' : undefined)
                        : undefined;
                      const shownValue = tag === 'reused' ? (merge!.reused.get(e.path) ?? '') : (effective(s.id, e.path) ?? '');
                      return (
                        <CompareCell key={s.id}
                          loaded={!!slots[s.id].parsed}
                          present={slots[s.id].valueByPath.has(e.path) || (e.path in slots[s.id].edits)}
                          value={shownValue}
                          dirty={!merge && isDirty(s.id, e.path)}
                          readOnly={!!merge}
                          mergeTag={tag}
                          onChange={(v) => editCell(s.id, e.path, v)}
                          onSave={() => saveCell(s.id, e.path)}
                        />
                      );
                    })}
                  </div>
                );
              })();
              return (
                <div
                  // key kèm index — chống trùng path làm React vứt row (cùng bài học bảng FieldEditor).
                  key={item.kind === 'header' ? `h:${item.group}` : `${vRow.index}:${item.entry.path}`}
                  ref={rowVirtualizer.measureElement}
                  data-index={vRow.index}
                  style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vRow.start}px)` }}
                >
                  {inner}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ═══ (bugNeedFix/184) Modal kết quả "AI soi khác" ═══
          Làm MODAL chứ không xoè inline trong hàng: bảng đang ảo hoá theo chiều cao ước lượng,
          hàng tự phình to giữa chừng là các hàng dưới đè lên nhau. */}
      {/* ═══ (bug 235) BẢNG DUYỆT CẶP GHÉP ═══
          Không áp thẳng kết quả AI vào thẻ: người dùng phải nhìn được "entry nào của bản mới đang
          định lấy bản dịch của entry nào bên bản cũ", vì ghép sai là dán nhầm bản dịch của người
          khác — hỏng âm thầm, khó phát hiện hơn nhiều so với dịch lại thừa. */}
      {aiMatch && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}
          onClick={() => { if (aiMatch.status !== 'running') setAiMatch(null); }}>
          <div onClick={(ev) => ev.stopPropagation()}
            style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: '1000px', maxHeight: '86vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', borderBottom: '1px solid var(--border-default)' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>🤖 Ghép entry bằng TÊN — kết quả AI đối chiếu</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                  Bên trái là mục của bản RAW MỚI, bên phải là mục của bản ĐÃ DỊCH CŨ sẽ được lấy bản dịch.
                </div>
              </div>
              <button onClick={() => { aiMatchAbortRef.current?.abort(); setAiMatch(null); }}
                style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '6px 11px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)', background: 'var(--bg-primary)', color: 'var(--text-secondary)', fontSize: '0.75rem', cursor: 'pointer' }}>
                <X size={13} /> {aiMatch.status === 'running' ? 'Dừng' : 'Đóng'}
              </button>
            </div>

            {aiMatch.status === 'running' && (
              <div style={{ padding: '28px 18px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.82rem' }}>
                {aiMatch.phase}
                {aiMatch.total > 0 && (
                  <div style={{ marginTop: '10px', fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                    Đã xong {aiMatch.done}/{aiMatch.total} lô
                  </div>
                )}
              </div>
            )}

            {aiMatch.status === 'error' && (
              <div style={{ padding: '20px 18px', color: 'var(--accent-danger)', fontSize: '0.8rem' }}>
                Lỗi gọi AI: {aiMatch.error}
              </div>
            )}

            {aiMatch.status === 'done' && (
              <>
                <div style={{ display: 'flex', gap: '10px', padding: '9px 16px', borderBottom: '1px solid var(--border-default)', flexWrap: 'wrap', alignItems: 'center', fontSize: '0.74rem' }}>
                  <span style={{ color: '#22c55e', fontWeight: 700 }}>
                    ✅ {aiMatch.rows.filter((r) => r.verdict === 'giong').length} giống — tái dùng được
                  </span>
                  <span style={{ color: 'var(--accent-warning)', fontWeight: 700 }}>
                    ✏️ {aiMatch.rows.filter((r) => r.verdict === 'khac').length} tác giả đã sửa
                  </span>
                  <span style={{ color: 'var(--text-muted)', fontWeight: 700 }}>
                    ❓ {aiMatch.rows.filter((r) => r.verdict === 'khong-chac').length} chưa chắc
                  </span>
                  <span style={{ color: 'var(--accent-primary)', fontWeight: 700 }}>
                    ➕ {aiMatch.unmatchedNew.length} mục mới (không có bản dịch cũ)
                  </span>
                  <span style={{ marginLeft: 'auto', display: 'flex', gap: '6px' }}>
                    <button onClick={() => setAiMatch((s) => s && ({ ...s, rows: s.rows.map((r) => ({ ...r, reuse: true })) }))}
                      style={{ padding: '4px 9px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)', background: 'transparent', color: 'var(--text-secondary)', fontSize: '0.7rem', cursor: 'pointer' }}>
                      Tick hết
                    </button>
                    <button onClick={() => setAiMatch((s) => s && ({ ...s, rows: s.rows.map((r) => ({ ...r, reuse: defaultReuse(r.verdict) })) }))}
                      title="Chỉ tick những mục AI kết luận GIỐNG — đây là lựa chọn an toàn."
                      style={{ padding: '4px 9px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)', background: 'transparent', color: 'var(--text-secondary)', fontSize: '0.7rem', cursor: 'pointer' }}>
                      Về mặc định an toàn
                    </button>
                  </span>
                </div>

                <div style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}>
                  {aiMatch.rows.length === 0 && (
                    <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                      Không ghép được mục nào — hai thẻ này gần như không có entry chung.
                    </div>
                  )}
                  {aiMatch.rows.map((r) => {
                    const color = r.verdict === 'giong' ? '#22c55e' : r.verdict === 'khac' ? 'var(--accent-warning)' : 'var(--text-muted)';
                    const kl = r.verdict === 'giong' ? 'GIỐNG' : r.verdict === 'khac' ? 'ĐÃ SỬA' : 'CHƯA CHẮC';
                    return (
                      <label key={r.pair.newId}
                        style={{ display: 'grid', gridTemplateColumns: '26px 1fr 1fr 110px', gap: '8px', alignItems: 'start', padding: '8px 16px', borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer', background: r.reuse ? 'rgba(34,197,94,0.05)' : 'transparent' }}>
                        <input type="checkbox" checked={r.reuse} onChange={() => toggleMatchRow(r.pair.newId)} style={{ marginTop: '3px' }} />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>{r.pair.newId} · bản RAW MỚI</div>
                          <div style={{ fontSize: '0.78rem', color: 'var(--text-primary)', wordBreak: 'break-word' }}>{r.newName || '(không tên)'}</div>
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>{r.pair.oldId} · bản ĐÃ DỊCH</div>
                          <div style={{ fontSize: '0.78rem', color: 'var(--accent-primary)', wordBreak: 'break-word' }}>{r.oldName || '(không tên)'}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '0.66rem', fontWeight: 700, color }}>{kl}</div>
                          <div style={{ fontSize: '0.58rem', color: 'var(--text-muted)' }}>
                            {r.pair.method === 'ai-ten' ? `AI · tin ${r.pair.confidence}` : r.pair.method}
                          </div>
                        </div>
                        {(r.note || r.pair.why) && (
                          <div style={{ gridColumn: '2 / -1', fontSize: '0.64rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                            {r.note || r.pair.why}
                          </div>
                        )}
                      </label>
                    );
                  })}
                </div>

                <div style={{ display: 'flex', gap: '8px', padding: '11px 16px', borderTop: '1px solid var(--border-default)', flexWrap: 'wrap' }}>
                  <button onClick={applyAiMatch} disabled={aiMatch.rows.every((r) => !r.reuse)}
                    title="Đắp bản dịch cũ của các mục đã tick vào bản Final, phần còn lại để dịch mới."
                    style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '8px 15px', borderRadius: 'var(--radius-sm)', border: 'none',
                      background: aiMatch.rows.some((r) => r.reuse) ? '#22c55e' : 'var(--bg-elevated)',
                      color: aiMatch.rows.some((r) => r.reuse) ? '#052e12' : 'var(--text-muted)',
                      fontWeight: 700, fontSize: '0.78rem', cursor: aiMatch.rows.some((r) => r.reuse) ? 'pointer' : 'default' }}>
                    Áp {aiMatch.rows.filter((r) => r.reuse).length} mục vào kế hoạch gộp
                  </button>
                  <button onClick={() => void runAiMatch()}
                    style={{ padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)', background: 'var(--bg-primary)', color: 'var(--text-secondary)', fontSize: '0.75rem', cursor: 'pointer' }}>
                    Chạy lại
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {aiDiff && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}
          onClick={() => { if (aiDiff.status !== 'running') setAiDiff(null); }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ width: 'min(860px, 96vw)', maxHeight: '88vh', overflowY: 'auto', background: 'var(--bg-primary)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '1rem' }}>🤖</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: '0.85rem' }}>AI soi khác: {aiDiff.entry.label}</div>
                <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>{aiDiff.entry.path}</div>
              </div>
              <button
                onClick={() => { aiDiffAbortRef.current?.abort(); setAiDiff(null); }}
                style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '4px', padding: '5px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)', background: 'var(--bg-primary)', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '0.72rem' }}>
                <X size={13} /> {aiDiff.status === 'running' ? 'Dừng' : 'Đóng'}
              </button>
            </div>

            {aiDiff.status === 'running' && (
              <div style={{ padding: '20px', textAlign: 'center', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                Đang so bản Dịch với bản Final của mục này…
              </div>
            )}

            {aiDiff.status === 'error' && (
              <div style={{ padding: '10px 12px', borderRadius: 'var(--radius-sm)', background: 'rgba(255,82,82,0.08)', border: '1px solid rgba(255,82,82,0.25)', color: 'var(--accent-danger)', fontSize: '0.74rem' }}>
                Lỗi gọi AI: {aiDiff.error}
              </div>
            )}

            {aiDiff.status === 'done' && (
              <>
                <div>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                    Tác giả đã đổi gì ({aiDiff.differences.length})
                  </div>
                  {aiDiff.differences.length === 0 ? (
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                      AI không thấy khác biệt NỘI DUNG nào — hai bên có thể chỉ lệch định dạng/khoảng trắng.
                    </div>
                  ) : (
                    <ul style={{ margin: 0, paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                      {aiDiff.differences.map((d, i) => (
                        <li key={i} style={{ fontSize: '0.72rem', lineHeight: 1.55, color: 'var(--text-primary)' }}>{d}</li>
                      ))}
                    </ul>
                  )}
                </div>

                {aiDiff.problems.length > 0 && (
                  <div style={{ padding: '8px 10px', borderRadius: 'var(--radius-sm)', background: 'rgba(240,196,106,0.08)', border: '1px solid rgba(240,196,106,0.35)', fontSize: '0.7rem', color: 'var(--accent-warning)' }}>
                    ⚠️ Bản vá KHÔNG qua được chốt máy — chỉ nên dùng để tham khảo, đừng áp thẳng:
                    <ul style={{ margin: '4px 0 0', paddingLeft: '16px' }}>
                      {aiDiff.problems.map((p, i) => <li key={i}>{p}</li>)}
                    </ul>
                  </div>
                )}

                <div>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--accent-success)', marginBottom: '4px' }}>
                    Bản dịch đã vá (giữ nguyên tối đa bản dịch cũ, chỉ đắp phần tác giả đổi)
                  </div>
                  <textarea readOnly value={aiDiff.patched}
                    style={{ width: '100%', height: '180px', resize: 'vertical', fontSize: '0.7rem', fontFamily: 'monospace', padding: '8px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }} />
                </div>

                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button onClick={() => applyAiPatch('final')} disabled={aiDiff.problems.length > 0}
                    title={aiDiff.problems.length > 0 ? 'Bản vá chưa qua chốt máy — sửa tay hoặc chạy lại.' : 'Ghi bản vá vào ô Final (card sẽ xuất ra) của mục này.'}
                    style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '7px 14px', borderRadius: 'var(--radius-sm)', border: 'none', background: aiDiff.problems.length > 0 ? 'var(--bg-elevated)' : '#22c55e', color: aiDiff.problems.length > 0 ? 'var(--text-muted)' : '#052e12', fontWeight: 700, fontSize: '0.74rem', cursor: aiDiff.problems.length > 0 ? 'default' : 'pointer' }}>
                    <Save size={13} /> Áp vào cột Final
                  </button>
                  <button onClick={() => applyAiPatch('translated')} disabled={aiDiff.problems.length > 0}
                    title="Ghi bản vá vào ô Dịch (giữ Final nguyên ngữ)."
                    style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '7px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)', background: 'var(--bg-primary)', color: aiDiff.problems.length > 0 ? 'var(--text-muted)' : 'var(--text-primary)', fontSize: '0.74rem', cursor: aiDiff.problems.length > 0 ? 'default' : 'pointer' }}>
                    Áp vào cột Dịch
                  </button>
                  <button onClick={() => { void navigator.clipboard.writeText(aiDiff.patched); addToast('success', 'Đã copy bản vá.'); }}
                    style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '7px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '0.74rem', cursor: 'pointer' }}>
                    Copy
                  </button>
                  <button onClick={() => void runAiDiff(aiDiff.entry)}
                    style={{ marginLeft: 'auto', padding: '7px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)', background: 'var(--bg-primary)', color: 'var(--text-secondary)', fontSize: '0.74rem', cursor: 'pointer' }}>
                    Chạy lại
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Column header with import + actions ───
function SlotHeader({ slotDef, slot, onImport, onPasteJson, onRemove, onSaveAll, onExportJson, onExportPng }: {
  slotDef: { id: SlotId; nameKey: 'ccSlotRaw' | 'ccSlotTranslated' | 'ccSlotFinal'; color: string };
  slot: Slot;
  onImport: (f: File) => void; onPasteJson: (text: string) => boolean; onRemove: () => void;
  onSaveAll: () => void; onExportJson: () => void; onExportPng: () => void;
}) {
  const ui = useUi();
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [pasting, setPasting] = useState(false); // đang mở ô dán JSON
  const [pasteText, setPasteText] = useState('');
  const dirty = Object.keys(slot.edits).length;

  if (!slot.parsed) {
    if (pasting) {
      // (User 2026) Dán JSON trực tiếp — dùng khi tạo card từ worldbook / copy JSON, không có file.
      return (
        <div style={{ margin: '8px', padding: '8px', border: `1.5px solid ${slotDef.color}`, borderRadius: 'var(--radius-md)' }}>
          <div style={{ fontWeight: 700, fontSize: '0.72rem', color: slotDef.color, marginBottom: 4 }}>{ui.ccPasteTitle}</div>
          <textarea
            autoFocus value={pasteText} onChange={(e) => setPasteText(e.target.value)}
            placeholder={ui.ccPastePh}
            style={{ width: '100%', height: 120, fontSize: '0.66rem', fontFamily: 'monospace', resize: 'vertical', padding: '6px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}
          />
          <div style={{ display: 'flex', gap: 5, marginTop: 6 }}>
            <button
              onClick={() => { if (onPasteJson(pasteText)) { setPasting(false); setPasteText(''); } }}
              disabled={!pasteText.trim()}
              style={{ flex: 1, padding: '4px', fontSize: '0.66rem', borderRadius: 'var(--radius-sm)', border: 'none', background: pasteText.trim() ? slotDef.color : 'var(--bg-elevated)', color: pasteText.trim() ? '#fff' : 'var(--text-muted)', cursor: pasteText.trim() ? 'pointer' : 'default', fontWeight: 600 }}>
              {ui.ccPasteLoad}
            </button>
            <button onClick={() => { setPasting(false); setPasteText(''); }}
              style={{ padding: '4px 8px', fontSize: '0.66rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)', background: 'var(--bg-primary)', color: 'var(--text-muted)', cursor: 'pointer' }}>
              {ui.ccPasteCancel}
            </button>
          </div>
        </div>
      );
    }
    return (
      <div style={{ margin: '8px' }}>
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) onImport(f); }}
          style={{ padding: '14px 10px', border: `1.5px dashed ${drag ? slotDef.color : 'var(--border-default)'}`, borderRadius: 'var(--radius-md)', textAlign: 'center', cursor: 'pointer', background: drag ? 'rgba(124,106,240,0.06)' : 'transparent' }}>
          <Upload size={16} color={slotDef.color} />
          <div style={{ fontWeight: 700, fontSize: '0.76rem', marginTop: '4px', color: slotDef.color }}>{ui[slotDef.nameKey]}</div>
          <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>{ui.ccDropHint}</div>
          <input ref={inputRef} type="file" accept=".json,.png" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onImport(f); e.currentTarget.value = ''; }} />
        </div>
        <button onClick={() => setPasting(true)} title={ui.ccPasteTip}
          style={{ width: '100%', marginTop: 5, padding: '5px', fontSize: '0.64rem', borderRadius: 'var(--radius-sm)', border: '1px dashed var(--border-default)', background: 'var(--bg-primary)', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
          <FileJson size={11} /> {ui.ccPasteJsonBtn}
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding: '8px 10px', borderLeft: '1px solid var(--border-subtle)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: slotDef.color, flexShrink: 0 }} />
        <span style={{ fontWeight: 700, fontSize: '0.76rem', color: slotDef.color }}>{ui[slotDef.nameKey]}</span>
        <button onClick={onRemove} title={ui.ccRemoveCard} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2 }}>
          <Trash2 size={13} />
        </button>
      </div>
      <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', margin: '2px 0 6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        title={slot.parsed.fileName}>
        {slot.parsed.fileName}{dirty > 0 ? fmt(ui.ccDirtySuffix, { count: dirty }) : ''}
      </div>
      <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
        <button onClick={onSaveAll} disabled={dirty === 0} title={ui.ccSaveAllTitle}
          style={{ display: 'flex', alignItems: 'center', gap: '3px', padding: '3px 7px', fontSize: '0.63rem', borderRadius: 'var(--radius-sm)', border: 'none', background: dirty > 0 ? 'var(--accent-primary)' : 'var(--bg-elevated)', color: dirty > 0 ? '#fff' : 'var(--text-muted)', cursor: dirty > 0 ? 'pointer' : 'default' }}>
          <Save size={11} /> {ui.ccSaveAll}
        </button>
        <button onClick={onExportJson} title={ui.ccExportJsonTitle}
          style={{ display: 'flex', alignItems: 'center', gap: '3px', padding: '3px 7px', fontSize: '0.63rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)', background: 'var(--bg-primary)', color: 'var(--text-primary)', cursor: 'pointer' }}>
          <FileJson size={11} /> JSON
        </button>
        {slot.parsed.isPng && (
          <button onClick={onExportPng} title={ui.ccExportPngTitle}
            style={{ display: 'flex', alignItems: 'center', gap: '3px', padding: '3px 7px', fontSize: '0.63rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)', background: 'var(--bg-primary)', color: 'var(--text-primary)', cursor: 'pointer' }}>
            <ImageIcon size={11} /> PNG
          </button>
        )}
      </div>
    </div>
  );
}

// ─── One editable cell ───
function CompareCell({ loaded, present, value, dirty, readOnly, mergeTag, onChange, onSave }: {
  loaded: boolean; present: boolean; value: string; dirty: boolean;
  readOnly?: boolean; mergeTag?: 'reused' | 'changed' | 'suspect';
  onChange: (v: string) => void; onSave: () => void;
}) {
  const ui = useUi();
  if (!loaded) {
    return <div style={{ padding: '8px 12px', fontSize: '0.66rem', color: 'var(--text-muted)', fontStyle: 'italic', borderLeft: '1px solid var(--border-subtle)' }}>{ui.ccNoCard}</div>;
  }
  if (!present) {
    return <div style={{ padding: '8px 12px', fontSize: '0.66rem', color: 'var(--text-muted)', fontStyle: 'italic', borderLeft: '1px solid var(--border-subtle)', background: mergeTag === 'changed' ? 'rgba(240,196,106,0.05)' : 'transparent' }}>{ui.ccNoEntry}</div>;
  }
  const bg = mergeTag === 'reused' ? 'rgba(34,197,94,0.07)'
    : mergeTag === 'suspect' ? 'rgba(251,191,36,0.13)'
    : mergeTag === 'changed' ? 'rgba(240,196,106,0.08)'
    : dirty ? 'rgba(240,196,106,0.06)' : 'transparent';
  const borderColor = mergeTag === 'reused' ? 'rgba(34,197,94,0.5)'
    : mergeTag === 'suspect' ? 'rgba(251,191,36,0.85)'
    : mergeTag === 'changed' ? 'var(--accent-warning)'
    : dirty ? 'var(--accent-warning)' : 'var(--border-subtle)';
  return (
    <div style={{ padding: '6px 8px', borderLeft: '1px solid var(--border-subtle)', position: 'relative', background: bg }}>
      {mergeTag && (
        <div title={mergeTag === 'suspect' ? ui.ccSuspectTip : undefined}
          style={{ fontSize: '0.6rem', fontWeight: 700, marginBottom: '3px', cursor: mergeTag === 'suspect' ? 'help' : 'default',
            color: mergeTag === 'reused' ? '#16a34a' : 'var(--accent-warning)' }}>
          {mergeTag === 'reused' ? ui.ccTagReused
            : mergeTag === 'suspect' ? `${ui.ccTagReused} · ⚠️`
            : ui.ccTagChanged}
        </div>
      )}
      <textarea
        value={value}
        readOnly={readOnly}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (!readOnly && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onSave(); } }}
        spellCheck={false}
        style={{
          width: '100%', minHeight: '58px', maxHeight: '320px', resize: 'vertical',
          padding: '6px 8px', fontSize: '0.7rem', lineHeight: 1.45, fontFamily: 'var(--font-mono, monospace)',
          borderRadius: 'var(--radius-sm)', border: `1px solid ${borderColor}`,
          background: readOnly ? 'var(--bg-secondary)' : 'var(--bg-primary)', color: 'var(--text-primary)', outline: 'none',
          cursor: readOnly ? 'default' : 'text',
        }}
      />
      {dirty && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '3px' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '0.6rem', color: 'var(--accent-warning)' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent-warning)' }} /> {ui.ccUnsavedDot}
          </span>
          <button onClick={onSave} title={ui.ccSaveTitle}
            style={{ display: 'flex', alignItems: 'center', gap: '3px', marginLeft: 'auto', padding: '2px 8px', fontSize: '0.6rem', borderRadius: 'var(--radius-sm)', border: 'none', background: 'var(--accent-success, #22c55e)', color: '#fff', cursor: 'pointer' }}>
            <Save size={10} /> {ui.ccSave}
          </button>
        </div>
      )}
    </div>
  );
}
