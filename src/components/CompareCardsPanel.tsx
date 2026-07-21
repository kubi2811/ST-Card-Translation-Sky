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
import { buildCompareGroups, valuesDiffer, planMerge, type MergePlan } from '../utils/compareCards';
import { extractTranslatableFields, setNestedValue, DEFAULT_FIELD_GROUPS } from '../utils/cardFields';
import { syncEmbeddedWorldLink } from '../utils/worldLink';
import { embedCharaToPNG } from '../utils/pngHandler';
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
  const allThree = SLOT_ORDER.every((s) => slots[s.id].parsed);

  const runMerge = useCallback(() => {
    if (!allThree) return;
    const plan = planMerge(slots.raw.valueByPath, slots.translated.valueByPath, slots.final.valueByPath);
    setMerge(plan);
    setDiffOnly(false);
    addToast('success', fmt(ui.ccToastMerged, { reused: plan.counts.reused, changed: plan.counts.changed }));
  }, [allThree, slots, addToast]);

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
              <button onClick={runMerge} disabled={!allThree}
                title={allThree ? ui.ccMergeTitleOk : ui.ccMergeTitleNeed}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 14px', borderRadius: 'var(--radius-sm)', border: 'none', background: allThree ? '#38bdf8' : 'var(--bg-elevated)', color: allThree ? '#04263a' : 'var(--text-muted)', fontWeight: 700, fontSize: '0.78rem', cursor: allThree ? 'pointer' : 'default' }}>
                {ui.ccMergeBtn}{allThree ? '' : ui.ccMergeBtnNeed}
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
                    </div>
                    {SLOT_ORDER.map((s) => {
                      const isFinal = s.id === 'final';
                      const tag: 'reused' | 'changed' | undefined = merge && isFinal
                        ? (merge.reused.has(e.path) ? 'reused' : merge.changed.has(e.path) ? 'changed' : undefined)
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
  readOnly?: boolean; mergeTag?: 'reused' | 'changed';
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
    : mergeTag === 'changed' ? 'rgba(240,196,106,0.08)'
    : dirty ? 'rgba(240,196,106,0.06)' : 'transparent';
  const borderColor = mergeTag === 'reused' ? 'rgba(34,197,94,0.5)'
    : mergeTag === 'changed' ? 'var(--accent-warning)'
    : dirty ? 'var(--accent-warning)' : 'var(--border-subtle)';
  return (
    <div style={{ padding: '6px 8px', borderLeft: '1px solid var(--border-subtle)', position: 'relative', background: bg }}>
      {mergeTag && (
        <div style={{ fontSize: '0.6rem', fontWeight: 700, marginBottom: '3px', color: mergeTag === 'reused' ? '#16a34a' : 'var(--accent-warning)' }}>
          {mergeTag === 'reused' ? ui.ccTagReused : ui.ccTagChanged}
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
