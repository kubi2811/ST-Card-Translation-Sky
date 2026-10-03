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
} from '../utils/workspaceIO';
import {
  loadVault, saveVault, upsertLink, vaultCodeForCard, extractCardExternalUrls, type ExternalLinkEntry,
} from '../utils/externalLinkVault';
import { PackageOpen, Package, Loader2, ShieldCheck } from 'lucide-react';

/** Mục kho link ngoài thuộc thẻ đang mở (cùng luật với bộ quét key MVU). */
async function vaultEntriesForCard(cardName: string | undefined, fields: Array<{ label: string; original?: string; translated?: string }>): Promise<ExternalLinkEntry[]> {
  let vault: ExternalLinkEntry[] = [];
  try { vault = await loadVault(); } catch { return []; }
  const urls = extractCardExternalUrls(fields);
  const codes = new Set(vaultCodeForCard(vault, cardName, urls));
  return vault.filter(e => (!!cardName && e.cardName === cardName) || codes.has(e.original));
}

/** Đổ workspace vào app. Kết nối/API của người nhận GIỮ NGUYÊN — file không chạm tới chúng. */
export async function applyWorkspace(ws: WorkspaceFile): Promise<{ links: number }> {
  const st = useStore.getState();
  useStore.setState({
    card: ws.card,
    cardFileName: ws.cardFileName || workspaceFileName(ws),
    contentType: (ws.contentType || 'card') as never,
    fields: ws.fields,
    phase: (ws.phase === 'translating' ? 'paused' : (ws.phase || 'idle')) as never,
    currentFieldIndex: ws.currentFieldIndex || 0,
    mvuKeyMetadata: (ws.mvuKeyMetadata || {}) as never,
  });
  // Qua setter để cấu hình được lưu xuống trình duyệt như khi người dùng tự chỉnh.
  st.setTranslationConfig(ws.translationConfig as never);
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
  const card = useStore((s) => s.card);
  const addToast = useStore((s) => s.addToast);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const doExport = async () => {
    const st = useStore.getState();
    if (!st.card) { addToast('error', 'Chưa nạp thẻ nào để xuất workspace.'); return; }
    setBusy(true);
    try {
      const cardName = st.card.data?.name || st.card.name;
      const links = await vaultEntriesForCard(cardName, st.fields);
      // GitHub token của tab Link ngoài (lưu thô trong trình duyệt) — cũng là bí mật phải soát.
      let gh = '';
      try { gh = localStorage.getItem('gh-token') || ''; } catch { /* chế độ riêng tư */ }
      const secrets = collectSecrets(st, gh ? [gh] : []);
      const { json, removedKeys, scrubbedHits, file } = buildWorkspace({
        card: st.card, cardFileName: st.cardFileName, contentType: st.contentType,
        fields: st.fields, phase: st.phase, currentFieldIndex: st.currentFieldIndex,
        mvuKeyMetadata: st.mvuKeyMetadata as Record<string, unknown>,
        translationConfig: st.translationConfig, activePreset: st.activePreset,
      }, links, secrets, APP_VERSION);

      const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = workspaceFileName(file);
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);

      const s = file.stats;
      addToast('success',
        `Đã xuất workspace: ${s.done}/${s.fields} field đã dịch, ${s.dictMvu} biến MVU, ${s.dictEjs} mục EJS, `
        + `${s.glossary} thuật ngữ, ${s.externalLinks} link ngoài. KHÔNG kèm kết nối/API.`
        + (removedKeys.length || scrubbedHits ? ` Đã gỡ ${removedKeys.length + scrubbedHits} chỗ trông như key/kết nối.` : ''));
    } catch (e) {
      addToast('error', `Xuất workspace lỗi: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const onPick = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try {
      const ws = parseWorkspace(await f.text());
      const cur = useStore.getState().card;
      const name = ws.card?.data?.name || ws.card?.name || ws.cardFileName;
      if (cur && !window.confirm(`Nạp workspace "${name}" sẽ THAY thẻ đang mở và tiến độ dịch hiện tại. Tiếp tục?`)) return;
      const { links } = await applyWorkspace(ws);
      const s = ws.stats || { done: ws.fields.filter(x => x.status === 'done').length, fields: ws.fields.length };
      addToast('success', `Đã nạp workspace "${name}": ${s.done}/${s.fields} field đã dịch`
        + (links ? `, ${links} link ngoài vào kho` : '') + '. Kết nối/API của bạn giữ nguyên.');
    } catch (e) {
      addToast('error', `Không nạp được workspace: ${e instanceof Error ? e.message : String(e)}`);
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
            title="Xuất toàn bộ phiên dịch của thẻ này (thẻ, bản gốc + bản dịch, tiến độ chunk, từ điển, thuật ngữ, prompt, link ngoài) thành 1 file để chia sẻ. KHÔNG kèm kết nối/API.">
            {busy ? <Loader2 size={12} className="spin" /> : <Package size={12} />} Xuất workspace
          </button>
        )}
        <button className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()} disabled={busy}
          style={{ fontSize: '0.75rem', whiteSpace: 'normal', lineHeight: 1.25, border: '1px dashed var(--border-subtle)' }}
          title="Nạp file .workspace.json người khác chia sẻ — làm tiếp đúng chỗ họ dịch dở. Kết nối/API của bạn giữ nguyên.">
          <PackageOpen size={12} /> Nhập workspace
        </button>
        <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: 'none' }}
          onChange={e => void onPick(e.target.files?.[0])} />
      </div>
      {!compact && (
        <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <ShieldCheck size={11} /> File workspace không bao giờ chứa key, URL proxy hay cấu hình provider.
        </div>
      )}
    </div>
  );
}
