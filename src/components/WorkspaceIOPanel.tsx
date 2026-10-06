/**
 * (bug 251) Nút XUẤT / NHẬP WORKSPACE — chia sẻ nguyên phiên dịch dở cho người khác, KHÔNG kèm
 * kết nối/API. Lõi (dựng file, gỡ khoá, soát bí mật, kiểm file) nằm ở utils/workspaceIO — ở đây
 * chỉ là nút bấm + đổ dữ liệu vào store.
 */
import { useRef, useState } from 'react';
import { useStore } from '../store';
import { APP_VERSION } from '../version';
import {
  buildWorkspace, parseWorkspace, collectSecrets, workspaceFileName, type WorkspaceFile,
  isSameCardWorkspace, mergeWorkspaceInto,
} from '../utils/workspaceIO';
import type { GlossaryEntry } from '../types/card';
import {
  loadVault, saveVault, upsertLink, vaultCodeForCard, extractCardExternalUrls, type ExternalLinkEntry,
} from '../utils/externalLinkVault';
import { PackageOpen, Package, Loader2, ShieldCheck } from 'lucide-react';
import { useUi } from '../i18n/useLocale';
import { fmt } from '../i18n';

/** Mục kho link ngoài thuộc thẻ đang mở (cùng luật với bộ quét key MVU). */
async function vaultEntriesForCard(cardName: string | undefined, fields: Array<{ label: string; original?: string; translated?: string }>): Promise<ExternalLinkEntry[]> {
  let vault: ExternalLinkEntry[] = [];
  try { vault = await loadVault(); } catch { return []; }
  const urls = extractCardExternalUrls(fields);
  const codes = new Set(vaultCodeForCard(vault, cardName, urls));
  return vault.filter(e => (!!cardName && e.cardName === cardName) || codes.has(e.original));
}

/** (bug 255) Ảnh thẻ đang mở → data URL để đi kèm file workspace. */
async function currentImageDataUrl(): Promise<string | null> {
  const st = useStore.getState();
  try {
    let blob: Blob | null = null;
    if (st._pngArrayBuffer) blob = new Blob([st._pngArrayBuffer], { type: 'image/png' });
    else if (st.originalImage?.startsWith('data:image/')) return st.originalImage;
    else if (st.originalImage?.startsWith('blob:')) blob = await (await fetch(st.originalImage)).blob();
    if (!blob) return null;
    return await new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.onerror = () => rej(r.error);
      r.readAsDataURL(blob!);
    });
  } catch { return null; }
}

function dataUrlToArrayBuffer(url: string): ArrayBuffer | null {
  try {
    const bin = atob(url.slice(url.indexOf(',') + 1));
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return buf.buffer;
  } catch { return null; }
}

const DICT_NAMES = ['mvuDictionary', 'ejsEntryNameDict', 'ejsKeywordDict'] as const;

/** Đổ workspace vào app. Kết nối/API của người nhận GIỮ NGUYÊN — file không chạm tới chúng. */
export async function applyWorkspace(ws: WorkspaceFile): Promise<{ links: number }> {
  const st = useStore.getState();
  const prevBlob = st._blobUrl;
  // (bug 255) Ảnh đi theo thẻ — không có thì xoá ảnh cũ, đừng để thẻ mới dính ảnh thẻ trước.
  const pngBuf = ws.image && /^data:image\/png/i.test(ws.image) ? dataUrlToArrayBuffer(ws.image) : null;
  useStore.setState({
    card: ws.card,
    cardFileName: ws.cardFileName || workspaceFileName(ws),
    contentType: (ws.contentType || 'card') as never,
    fields: ws.fields,
    phase: (ws.phase === 'translating' ? 'paused' : (ws.phase || 'idle')) as never,
    currentFieldIndex: ws.currentFieldIndex || 0,
    mvuKeyMetadata: (ws.mvuKeyMetadata || {}) as never,
    originalImage: ws.image || null,
    _pngArrayBuffer: pngBuf,
    _blobUrl: null,
  } as never);
  if (prevBlob) { try { URL.revokeObjectURL(prevBlob); } catch { /* đã thu hồi */ } }
  // (bug 255) Từ điển: file chỉ mang mục CỦA THẺ NÀY. Máy nhận đang khoá 🔒 từ điển ⇒ giữ mục
  // của họ, thêm/ghi mục của thẻ; không khoá ⇒ như mở thẻ mới: chỉ còn mục của thẻ. Trước đây
  // file ghi đè NGUYÊN từ điển (kèm mọi thẻ khác của người gửi) ⇒ chuyền mấy lần là phình.
  // Thuật ngữ: gộp, mục trùng nguồn lấy theo file — không xoá thuật ngữ riêng của người nhận.
  const tc = { ...(ws.translationConfig as Record<string, unknown>) };
  const mine = st.translationConfig;
  if (mine.mvuDictLocked) tc.mvuDictionary = { ...(mine.mvuDictionary || {}), ...((tc.mvuDictionary as object) || {}) };
  if (Array.isArray(tc.glossary)) {
    const theirs = tc.glossary as GlossaryEntry[];
    const src = new Set(theirs.map(g => g.source));
    tc.glossary = [...(mine.glossary || []).filter(g => !src.has(g.source)), ...theirs];
  }
  // Qua setter để cấu hình được lưu xuống trình duyệt như khi người dùng tự chỉnh.
  st.setTranslationConfig(tc as never);
  if (ws.activePreset) st.setActivePreset(ws.activePreset);

  let links = 0;
  if (ws.externalLinks?.length) {
    try {
      let vault = await loadVault();
      for (const e of ws.externalLinks) { vault = upsertLink(vault, e); links++; }
      await saveVault(vault);
    } catch { /* kho hỏng thì thôi, thẻ + bản dịch vẫn vào */ }
  }
  useStore.getState().saveTranslationCache();
  return { links };
}

export default function WorkspaceIOPanel({ compact }: { compact?: boolean }) {
  const ui = useUi();
  const card = useStore((s) => s.card);
  const addToast = useStore((s) => s.addToast);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const doExport = async () => {
    const st = useStore.getState();
    if (!st.card) { addToast('error', ui.wsNoCard); return; }
    setBusy(true);
    try {
      const cardName = st.card.data?.name || st.card.name;
      const links = await vaultEntriesForCard(cardName, st.fields);
      // GitHub token của tab Link ngoài (lưu thô trong trình duyệt) — cũng là bí mật phải soát.
      let gh = '';
      try { gh = localStorage.getItem('gh-token') || ''; } catch { /* chế độ riêng tư */ }
      const secrets = collectSecrets(st, gh ? [gh] : []);
      const image = await currentImageDataUrl();
      const { json, removedKeys, scrubbedHits, droppedForeign, file } = buildWorkspace({
        card: st.card, cardFileName: st.cardFileName, contentType: st.contentType,
        fields: st.fields, phase: st.phase, currentFieldIndex: st.currentFieldIndex,
        mvuKeyMetadata: st.mvuKeyMetadata as Record<string, unknown>,
        translationConfig: st.translationConfig, activePreset: st.activePreset,
        image,
      }, links, secrets, APP_VERSION);
      if (droppedForeign > 0) {
        st.addLog('info', fmt(ui.wsDroppedForeign, { n: droppedForeign }));
      }

      const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = workspaceFileName(file);
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);

      const s = file.stats;
      addToast('success',
        fmt(ui.wsExported, { done: s.done, fields: s.fields, mvu: s.dictMvu, ejs: s.dictEjs, glossary: s.glossary, links: s.externalLinks })
        + (removedKeys.length || scrubbedHits ? fmt(ui.wsScrubbed, { n: removedKeys.length + scrubbedHits }) : ''));
    } catch (e) {
      addToast('error', fmt(ui.wsExportErr, { msg: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  };

  const onPick = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try {
      const ws = parseWorkspace(await f.text());
      const st0 = useStore.getState();
      const cur = st0.card;
      const name = ws.card?.data?.name || ws.card?.name || ws.cardFileName;
      // (bug 255) CHIA VIỆC: file là của CHÍNH thẻ đang mở ⇒ cho GỘP tiến độ thay vì thay cả thẻ.
      if (cur && isSameCardWorkspace(st0.fields, ws) && window.confirm(fmt(ui.wsConfirmMerge, { name: String(name) }))) {
        const dicts = Object.fromEntries(DICT_NAMES.map(n => [n, { ...(st0.translationConfig[n] || {}) }]));
        const m = mergeWorkspaceInto({ fields: st0.fields, dicts }, ws);
        useStore.setState({
          fields: m.fields as never,
          mvuKeyMetadata: { ...(ws.mvuKeyMetadata || {}), ...st0.mvuKeyMetadata } as never,
        });
        st0.setTranslationConfig(m.dicts as never);
        useStore.getState().saveTranslationCache();
        const r = m.report;
        addToast('success', fmt(ui.wsMerged, { taken: r.taken, dict: r.dictAdded, conflicts: r.conflicts.length }));
        if (r.conflicts.length) {
          st0.addLog('warning', fmt(ui.wsMergeConflicts, { n: r.conflicts.length, list: r.conflicts.slice(0, 8).join(', ') + (r.conflicts.length > 8 ? '…' : '') }));
        }
        if (r.mismatched) st0.addLog('warning', fmt(ui.wsMergeMismatch, { n: r.mismatched }));
        return;
      }
      if (cur && !window.confirm(fmt(ui.wsConfirmReplace, { name: String(name) }))) return;
      const { links } = await applyWorkspace(ws);
      const s = ws.stats || { done: ws.fields.filter(x => x.status === 'done').length, fields: ws.fields.length };
      addToast('success', fmt(ui.wsImported, { name: String(name), done: s.done, fields: s.fields })
        + (links ? fmt(ui.wsImportedLinks, { n: links }) : '') + ui.wsImportedTail);
    } catch (e) {
      addToast('error', fmt(ui.wsImportErr, { msg: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: compact ? 10 : 0 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
        {card && (
          <button className="btn btn-ghost btn-sm" onClick={doExport} disabled={busy}
            style={{ fontSize: '0.75rem', whiteSpace: 'normal', lineHeight: 1.25, border: '1px solid var(--border-subtle)' }}
            title={ui.wsExportTip}>
            {busy ? <Loader2 size={12} className="spin" /> : <Package size={12} />} {ui.wsExportBtn}
          </button>
        )}
        <button className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()} disabled={busy}
          style={{ fontSize: '0.75rem', whiteSpace: 'normal', lineHeight: 1.25, border: '1px dashed var(--border-subtle)' }}
          title={ui.wsImportTip}>
          <PackageOpen size={12} /> {ui.wsImportBtn}
        </button>
        <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: 'none' }}
          onChange={e => void onPick(e.target.files?.[0])} />
      </div>
      {!compact && (
        <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <ShieldCheck size={11} /> {ui.wsSafeNote}
        </div>
      )}
    </div>
  );
}
