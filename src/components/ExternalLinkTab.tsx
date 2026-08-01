import React, { useState, useEffect, useMemo } from 'react';
import { useStore } from '../store';
import { useThrottledStore } from '../hooks/useThrottledStore';
import { useTranslation } from '../hooks/useTranslation';
import { Code2, Play, Loader2, Trash2, CheckCircle2, Copy, Check, X, Globe, Archive, Search, Download, FolderOpen, AlertTriangle } from 'lucide-react';
import { publishToGithub } from '../utils/githubApi';
import { safeSetItem } from '../utils/safeStorage';
import { useUi } from '../i18n/useLocale';
import HeavyScriptMode from './HeavyScriptMode';
// (bugNeedFix/181) Kho link ngoài + kiểm tra tham chiếu chéo.
import {
  loadVault, saveVault, upsertLink, removeLink, classifyExternalLink, suggestNameFromUrl,
  extractCardExternalUrls, matchVaultToCard, KIND_LABEL,
  type ExternalLinkEntry, type ExternalLinkKind,
} from '../utils/externalLinkVault';
import {
  buildCardRefContext, checkExternalRefs, buildRefCheckReport, type RefCheckReport,
} from '../utils/externalRefCheck';

const renderSafeHtml = (htmlContent: string) => {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <script src="https://code.jquery.com/jquery-3.6.0.min.js"></script>
        <style>
          body { margin: 0; padding: 12px; background: #0f0f12; color: #e8e6f0; font-family: -apple-system, sans-serif; font-size: 0.9rem; }
        </style>
      </head>
      <body>${htmlContent}</body>
    </html>
  `;
};

export default function ExternalLinkTab() {
  // (bugNeedFix/39) selector hẹp + throttle fields — trước đây subscribe toàn store lúc dịch.
  const fields = useThrottledStore((s) => s.fields, 200);
  const setFields = useStore((s) => s.setFields);
  const updateField = useStore((s) => s.updateField);
  const phase = useStore((s) => s.phase);
  const addToast = useStore((s) => s.addToast);
  const ui = useUi();
  const { retranslateField, cancelFieldTranslation } = useTranslation();
  
  const [input, setInput] = useState(() => localStorage.getItem('custom-external-input') || '');
  const [copied, setCopied] = useState(false);
  const [heavyOutput, setHeavyOutput] = useState(''); // bản ghép của chế độ Script Nặng

  // GitHub state
  const [ghToken, setGhToken] = useState(() => localStorage.getItem('gh-token') || '');
  const [ghRepo, setGhRepo] = useState(() => localStorage.getItem('gh-repo') || '');
  const [ghBranch, setGhBranch] = useState(() => localStorage.getItem('gh-branch') || 'main');
  
  const [ghPath, setGhPath] = useState('scripts/custom-script.js');
  const [ghMessage, setGhMessage] = useState('Update translated external link');
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishUrl, setPublishUrl] = useState('');
  const [cdnUrl, setCdnUrl] = useState('');

  // ═══ (bugNeedFix/181) KHO LINK NGOÀI ═══
  // Tab này trước đây chỉ có ĐÚNG MỘT ô nháp ghi vào một field duy nhất: dịch link thứ hai là
  // đè mất link thứ nhất. Thẻ 4-5 link ngoài thì chẳng còn gì để đối chiếu, mà code lại nằm
  // trên GitHub chứ không nằm trong thẻ — nên mọi phép kiểm chéo đều rơi vào nhánh "không có
  // dữ liệu" và tắt im lặng. Kho này là chỗ giữ lại từng link một.
  const card = useStore((s) => s.card);
  const translationConfig = useStore((s) => s.translationConfig);
  const [vault, setVault] = useState<ExternalLinkEntry[]>([]);
  const [vaultLoaded, setVaultLoaded] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saveName, setSaveName] = useState('');
  const [refReport, setRefReport] = useState<RefCheckReport | null>(null);

  useEffect(() => {
    let alive = true;
    void loadVault().then(v => { if (alive) { setVault(v); setVaultLoaded(true); } });
    return () => { alive = false; };
  }, []);

  const commitVault = (next: ExternalLinkEntry[]) => { setVault(next); void saveVault(next); };

  /** Link ngoài mà THẺ đang nạp — dò từ chính các field, để biết kho còn thiếu cái nào. */
  const cardUrls = useMemo(() => extractCardExternalUrls(fields), [fields]);
  const coverage = useMemo(() => matchVaultToCard(cardUrls, vault), [cardUrls, vault]);

  useEffect(() => { safeSetItem('custom-external-input', input); }, [input]);
  useEffect(() => { safeSetItem('gh-token', ghToken); }, [ghToken]);
  useEffect(() => { safeSetItem('gh-repo', ghRepo); }, [ghRepo]);
  useEffect(() => { safeSetItem('gh-branch', ghBranch); }, [ghBranch]);

  const fieldPath = 'custom_external_link';
  const field = fields.find(f => f.path === fieldPath);
  
  const isTranslating = field?.status === 'translating';
  const hasError = field?.status === 'error';
  // Ưu tiên bản ghép của chế độ Script Nặng (nếu có) — dùng cho preview/publish/output.
  const output = heavyOutput || field?.translated || '';

  const handleTranslate = async () => {
    if (!input.trim()) return;
    if (field) {
      updateField(fieldPath, { original: input, translated: '', status: 'pending', error: undefined, retries: 0 });
    } else {
      setFields([...fields, { path: fieldPath, label: ui.eltFieldLabel, group: 'regex', entryType: 'replaceString', original: input, translated: '', status: 'pending', retries: 0 }]);
    }
    setTimeout(async () => {
      try { await retranslateField(fieldPath); } catch (err) {}
    }, 50);
  };

  const handlePublish = async () => {
    if (!ghToken || !ghRepo || !ghPath || !output) {
      addToast('error', ui.eltToastMissing);
      return;
    }
    setIsPublishing(true);
    setPublishUrl('');
    setCdnUrl('');
    try {
      const result = await publishToGithub({ token: ghToken, repo: ghRepo, branch: ghBranch }, ghPath, output, ghMessage);
      if (result.success) {
        addToast('success', ui.eltToastPublished);
        setPublishUrl(result.contentUrl || '');
        const cdn = `https://cdn.jsdelivr.net/gh/${ghRepo}@${ghBranch}/${ghPath}`;
        setCdnUrl(cdn);
        // (bugNeedFix/181) Đăng xong là lúc DUY NHẤT ta biết chắc URL của file — lưu luôn vào kho,
        // vì đúng cảnh user mô tả là "dịch xong 4-5 link rồi tải lên Git", tới lúc cần kiểm thì
        // chẳng còn gì trong máy để đối chiếu.
        saveCurrentToVault(cdn, ghPath.split('/').pop() || '');
      } else {
        addToast('error', ui.eltToastPushErr + result.message);
      }
    } catch (err: any) {
      addToast('error', ui.eltToastNetErr + err.message);
    } finally {
      setIsPublishing(false);
    }
  };

  /* ═══════════ (bugNeedFix/181) Thao tác với kho ═══════════ */

  /** Cất nội dung đang có trong ô nháp thành một mục của kho (hoặc cập nhật mục đang mở). */
  function saveCurrentToVault(url = '', nameHint = ''): void {
    const code = output || input;
    if (!code.trim()) { addToast('error', 'Chưa có nội dung nào để lưu.'); return; }

    const existing = editingId ? vault.find(e => e.id === editingId) : undefined;
    const name = (saveName.trim() || nameHint || existing?.name
      || (url ? suggestNameFromUrl(url) : '') || `link-ngoai-${vault.length + 1}`);
    // Phân loại theo code GỐC: bản dịch có thể đã đổi chữ tới mức mất dấu hiệu nhận dạng.
    const auto = classifyExternalLink(name, url || existing?.url || '', input || code);
    const keepKind = existing?.kindLocked;

    const next = upsertLink(vault, {
      id: existing?.id,
      name,
      url: url || existing?.url || '',
      kind: keepKind ? existing!.kind : auto.kind,
      kindReason: keepKind ? existing!.kindReason : auto.reason,
      kindLocked: existing?.kindLocked,
      original: input || existing?.original || '',
      translated: output || existing?.translated || '',
      cardName: card?.data?.name || card?.name || undefined,
    });
    commitVault(next);
    setEditingId(next.find(e => e.name === name)?.id ?? null);
    setSaveName('');
    addToast('success', `Đã lưu "${name}" vào kho (${next.length} link).`);
  }

  /** Mở một mục ra sửa: đổ lại vào ô nháp để dịch tiếp / dịch lại. */
  const openEntry = (e: ExternalLinkEntry) => {
    setInput(e.original || e.translated);
    setHeavyOutput('');
    if (e.translated) updateField(fieldPath, { original: e.original, translated: e.translated, status: 'done', error: undefined });
    setEditingId(e.id);
    setSaveName(e.name);
    addToast('info', `Đang mở "${e.name}". Sửa xong bấm Lưu vào kho để cập nhật.`);
  };

  const setEntryKind = (id: string, kind: ExternalLinkKind) => {
    commitVault(vault.map(e => e.id === id
      ? { ...e, kind, kindReason: 'bạn tự chọn', kindLocked: true, updatedAt: Date.now() }
      : e));
  };

  /** Chạy kiểm tra tham chiếu chéo trên toàn kho + thẻ đang mở. */
  const runRefCheck = () => {
    const ctx = buildCardRefContext(fields, translationConfig?.mvuDictionary || {}, cardUrls);
    const rep = checkExternalRefs(vault, ctx);
    setRefReport(rep);
    addToast(rep.ok ? 'success' : 'error', rep.summary);
  };

  const downloadRefReport = () => {
    if (!refReport) return;
    const md = buildRefCheckReport(refReport, card?.data?.name || card?.name || 'Thẻ');
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'kiem-tra-link-ngoai.md';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  const CopyBtn = ({ text, label }: { text: string, label: string }) => {
    const [c, setC] = useState(false);
    return (
      <button
        onClick={() => { navigator.clipboard.writeText(text); setC(true); setTimeout(()=>setC(false), 2000); }}
        style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 8px', background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: '4px', cursor: 'pointer', fontSize: '0.7rem', color: c ? 'var(--accent-success)' : 'var(--text-secondary)' }}
      >
        {c ? <Check size={12} /> : <Copy size={12} />} {label}
      </button>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '0 12px 12px' }}>
      <div style={{ padding: '16px 20px', background: 'var(--bg-primary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--accent-primary)', boxShadow: '0 4px 20px rgba(124, 106, 240, 0.1)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
          <div style={{ width: '28px', height: '28px', borderRadius: 'var(--radius-sm)', background: 'linear-gradient(135deg, #7c6af0, #c084fc)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Code2 size={14} color="white" />
          </div>
          <div>
            <h3 style={{ fontSize: '0.95rem', fontWeight: 600, margin: 0, color: 'var(--accent-primary)' }}>{ui.eltTitle}</h3>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{ui.eltSubtitle}</div>
          </div>
        </div>
      </div>

      {/* ═══════════ (bugNeedFix/181) KHO LINK NGOÀI + KIỂM TRA THAM CHIẾU ═══════════
          User: "card có link ngoài nên chức năng liên quan đến kiểm tra lại đều bị phế vì ko đọc
          được code đã dịch… thêm chức năng lưu trữ đoạn code đó để check tham chiếu."
          Ô nháp bên dưới chỉ giữ được MỘT link; thẻ 4-5 link thì link sau đè link trước, và code
          thật thì nằm trên GitHub chứ không nằm trong thẻ — nên bộ kiểm chéo gom field của thẻ ra
          rỗng và tự tắt trong im lặng, màn hình sạch trơn như thể không có lỗi. */}
      <div style={{ padding: '16px 20px', background: 'var(--bg-primary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <Archive size={16} color="var(--accent-primary)" />
          <h4 style={{ margin: 0, fontSize: '0.85rem' }}>Kho link ngoài ({vault.length})</h4>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px' }}>
            <button className="btn btn-ghost" onClick={runRefCheck} disabled={vault.length === 0}
              title="Đối chiếu biến/hàm/id giữa các link ngoài với nhau và với thẻ đang mở. Không gọi API, chạy cục bộ.">
              <Search size={12} /> Kiểm tra tham chiếu
            </button>
            {refReport && (
              <button className="btn btn-ghost" onClick={downloadRefReport} title="Tải báo cáo Markdown để lưu hoặc gửi kèm.">
                <Download size={12} /> Tải báo cáo
              </button>
            )}
          </div>
        </div>

        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', lineHeight: 1.6, background: 'rgba(0,0,0,0.2)', padding: '8px 10px', borderRadius: '6px', borderLeft: '3px solid var(--accent-primary)' }}>
          Mỗi link ngoài lưu ở đây một mục riêng (gốc + bản dịch + phân loại), nên dịch link thứ hai
          không còn đè mất link thứ nhất. Có kho thì bộ kiểm mới đọc được code đã dịch để soi lệch
          tên biến giữa các file — thứ mà dịch từng file riêng lẻ không bao giờ thấy.
        </div>

        {/* Thẻ đang nạp bao nhiêu link, kho đã có bao nhiêu — phần thiếu chính là VÙNG MÙ. */}
        {cardUrls.length > 0 && (
          <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
            Thẻ đang nạp <b>{cardUrls.length}</b> link ngoài · kho đã có <b>{coverage.covered.length}</b>
            {coverage.missing.length > 0 && (
              <span style={{ color: 'var(--accent-warning)' }}> · thiếu {coverage.missing.length} (kiểm tra sẽ không nhìn thấy code trong đó)</span>
            )}
            {coverage.missing.length > 0 && (
              <ul style={{ margin: '4px 0 0', paddingLeft: '18px', color: 'var(--text-muted)', fontSize: '0.68rem' }}>
                {coverage.missing.slice(0, 6).map(m => <li key={m.url}><code>{m.url}</code> <span style={{ opacity: 0.7 }}>({m.foundIn})</span></li>)}
              </ul>
            )}
          </div>
        )}

        {/* Danh sách — có trần chiều cao để 10 link không đẩy cả trang đi. */}
        {vault.length > 0 && (
          <div style={{ maxHeight: '240px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {vault.map(e => (
              <div key={e.id} style={{
                display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap',
                padding: '6px 8px', borderRadius: '6px', background: 'var(--bg-secondary)',
                border: `1px solid ${e.id === editingId ? 'var(--accent-primary)' : 'var(--border-subtle)'}`,
              }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 600, flex: '1 1 160px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  title={e.url || 'chưa đăng lên Git'}>{e.name}</span>

                <select
                  value={e.kind}
                  onChange={ev => setEntryKind(e.id, ev.target.value as ExternalLinkKind)}
                  title={e.kindLocked ? 'Loại do bạn tự chọn.' : `Máy đoán: ${e.kindReason}. Sai thì đổi ở đây.`}
                  style={{ fontSize: '0.68rem', padding: '2px 4px', borderRadius: '4px', background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}
                >
                  {(Object.keys(KIND_LABEL) as ExternalLinkKind[]).map(k => (
                    <option key={k} value={k}>{KIND_LABEL[k]}</option>
                  ))}
                </select>
                {!e.kindLocked && <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>máy đoán</span>}

                <span style={{ fontSize: '0.65rem', color: e.translated ? 'var(--accent-success)' : 'var(--accent-warning)' }}>
                  {e.translated ? `đã dịch · ${e.translated.length.toLocaleString()} ký tự` : 'chưa dịch'}
                </span>

                <button className="btn btn-ghost" onClick={() => openEntry(e)} title="Đổ lại vào ô nháp bên dưới để sửa/dịch tiếp.">
                  <FolderOpen size={12} /> Mở
                </button>
                <button className="btn btn-ghost" onClick={() => { commitVault(removeLink(vault, e.id)); if (editingId === e.id) setEditingId(null); }} title="Xoá khỏi kho.">
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        {vaultLoaded && vault.length === 0 && (
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            Kho đang trống. Dịch một link ở ô bên dưới rồi bấm “Lưu vào kho” — hoặc đăng lên GitHub,
            lúc đó tool tự lưu kèm URL.
          </div>
        )}

        {/* Lưu nội dung đang có trong ô nháp */}
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            value={saveName}
            onChange={ev => setSaveName(ev.target.value)}
            placeholder={editingId ? 'tên mục đang mở' : 'tên cho link này (vd: status-bar.js)'}
            style={{ flex: '1 1 200px', padding: '6px 8px', fontSize: '0.75rem', borderRadius: '4px', border: '1px solid var(--border-default)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}
          />
          <button className="btn btn-ghost" onClick={() => saveCurrentToVault()} disabled={!input.trim() && !output.trim()}
            title="Cất nội dung đang có ở ô nháp thành một mục trong kho (tự phân loại theo nội dung).">
            <Archive size={12} /> {editingId ? 'Cập nhật mục đang mở' : 'Lưu vào kho'}
          </button>
          {editingId && (
            <button className="btn btn-ghost" onClick={() => { setEditingId(null); setSaveName(''); }} title="Thôi sửa mục này (không xoá gì).">
              <X size={12} /> Bỏ chọn
            </button>
          )}
        </div>

        {/* ─── Kết quả kiểm tra tham chiếu ─── */}
        {refReport && (
          <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '10px' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: refReport.ok ? 'var(--accent-success)' : 'var(--accent-danger)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              {refReport.ok ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />} {refReport.summary}
            </div>
            {refReport.issues.length === 0 && (
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '6px' }}>
                Không thấy tham chiếu nào lệch giữa các link và thẻ.
              </div>
            )}
            <div style={{ maxHeight: '260px', overflowY: 'auto', marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {refReport.issues.map((iss, i) => {
                const color = iss.severity === 'error' ? 'var(--accent-danger)'
                  : iss.severity === 'warning' ? 'var(--accent-warning)' : 'var(--text-muted)';
                return (
                  <div key={i} style={{ fontSize: '0.7rem', lineHeight: 1.5, padding: '6px 8px', borderRadius: '4px', background: 'var(--bg-secondary)', borderLeft: `3px solid ${color}` }}>
                    <b style={{ color }}>{iss.link}</b> — {iss.detail}
                    {iss.suggestion && <> <span style={{ color: 'var(--text-muted)' }}>(gợi ý: <code>{iss.suggestion}</code>)</span></>}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div style={{ padding: '16px 20px', background: 'var(--bg-primary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ position: 'relative' }}>
          <label style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '4px', display: 'block' }}>{ui.eltSourceLabel}</label>
          <textarea value={input} onChange={e => setInput(e.target.value)} disabled={isTranslating} rows={10} style={{ width: '100%', resize: 'vertical', fontFamily: 'monospace', fontSize: '0.78rem', padding: '10px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-default)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', outline: 'none' }} />
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button className="btn btn-primary" onClick={isTranslating ? () => cancelFieldTranslation(fieldPath) : handleTranslate} disabled={!input.trim() && !isTranslating}>
            {isTranslating ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> {ui.eltCancelTranslate}</> : <><Play size={14} /> {ui.eltTranslate}</>}
          </button>
          {input && !isTranslating && <button className="btn btn-ghost" onClick={() => setInput('')}><Trash2 size={12} /> {ui.eltClear}</button>}
        </div>
        {hasError && <div style={{ padding: '8px 12px', borderRadius: 'var(--radius-md)', background: 'rgba(255,82,82,0.08)', border: '1px solid rgba(255,82,82,0.2)', color: 'var(--accent-danger)', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '6px' }}><X size={14} /> {ui.eltErrPrefix} {field?.error}</div>}

        {/* (User 2026) Script Nặng (Chia Phần) — tự hiện khi script vượt ngưỡng an toàn */}
        <HeavyScriptMode source={input} onMerged={setHeavyOutput} />

        {output && (
          <div style={{ position: 'relative', marginTop: '8px' }}>
            <label style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--accent-success)', textTransform: 'uppercase', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}><Check size={12} /> {ui.eltResultLabel}</label>
            <textarea value={output} onChange={(e) => { if (field) updateField(fieldPath, { translated: e.target.value }); }} disabled={isTranslating} rows={12} style={{ width: '100%', resize: 'vertical', fontFamily: 'monospace', fontSize: '0.78rem', padding: '10px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--accent-success)', background: 'rgba(76,175,80,0.03)', color: 'var(--text-primary)', outline: 'none' }} />
          </div>
        )}
      </div>

      {output && (
        <div style={{ padding: '16px 20px', background: 'rgba(36, 41, 46, 0.3)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(255,255,255,0.1)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <Globe size={16} />
            <h4 style={{ margin: 0, fontSize: '0.85rem' }}>{ui.eltPublishTitle}</h4>
          </div>
          
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '16px', background: 'rgba(0,0,0,0.2)', padding: '10px', borderRadius: '6px', borderLeft: '3px solid var(--accent-primary)', lineHeight: 1.6 }}>
            <strong style={{ color: 'var(--text-secondary)' }}>{ui.eltGuideTitle}</strong><br/>
            • <strong>{ui.eltGuidePat1}</strong> {ui.eltGuidePat2} <a href="https://github.com/settings/tokens/new" target="_blank" rel="noreferrer" style={{ color: 'var(--accent-primary)', textDecoration: 'underline' }}>{ui.eltGuidePatLink}</a>{ui.eltGuidePat3} <strong>{ui.eltGuidePat4}<code>repo</code></strong>{ui.eltGuidePat5}<br/>
            • <strong>{ui.eltGuideRepo1}</strong> {ui.eltGuideRepo2} <code>github.com/nguyenvana/my-cards</code> {ui.eltGuideRepo3} <code>nguyenvana/my-cards</code>{ui.eltGuidePeriod}<br/>
            • <strong>{ui.eltGuideBranch1}</strong> {ui.eltGuideBranch2} <code>main</code> {ui.eltGuideBranchOr} <code>master</code>{ui.eltGuidePeriod}
          </div>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
            <div>
              <label style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{ui.eltPatLabel}</label>
              <input type="password" value={ghToken} onChange={e => setGhToken(e.target.value)} placeholder="ghp_..." style={{ width: '100%', padding: '6px 8px', fontSize: '0.75rem', borderRadius: '4px', border: '1px solid var(--border-default)', background: 'var(--bg-primary)' }} />
            </div>
            <div>
              <label style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Repository (user/repo)</label>
              <input value={ghRepo} onChange={e => setGhRepo(e.target.value)} placeholder="username/my-repo" style={{ width: '100%', padding: '6px 8px', fontSize: '0.75rem', borderRadius: '4px', border: '1px solid var(--border-default)', background: 'var(--bg-primary)' }} />
            </div>
            <div>
              <label style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Branch</label>
              <input value={ghBranch} onChange={e => setGhBranch(e.target.value)} placeholder="main" style={{ width: '100%', padding: '6px 8px', fontSize: '0.75rem', borderRadius: '4px', border: '1px solid var(--border-default)', background: 'var(--bg-primary)' }} />
            </div>
            <div>
              <label style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{ui.eltFileLabel}</label>
              <input value={ghPath} onChange={e => setGhPath(e.target.value)} placeholder="scripts/custom.js" style={{ width: '100%', padding: '6px 8px', fontSize: '0.75rem', borderRadius: '4px', border: '1px solid var(--border-default)', background: 'var(--bg-primary)' }} />
            </div>
          </div>

          <div style={{ marginBottom: '12px' }}>
            <label style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{ui.eltCommitLabel}</label>
            <input value={ghMessage} onChange={e => setGhMessage(e.target.value)} style={{ width: '100%', padding: '6px 8px', fontSize: '0.75rem', borderRadius: '4px', border: '1px solid var(--border-default)', background: 'var(--bg-primary)' }} />
          </div>

          <button onClick={handlePublish} disabled={isPublishing} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}>
            {isPublishing ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Globe size={14} />} {ui.eltPublishBtn}
          </button>

          {cdnUrl && (
            <div style={{ marginTop: '16px', padding: '12px', background: 'var(--bg-primary)', borderRadius: '6px', border: '1px solid var(--accent-success)' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--accent-success)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '4px' }}><CheckCircle2 size={14} /> {ui.eltCdnReady}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{ui.eltJsTag}</div>
                  <CopyBtn text={`<script src="${cdnUrl}"></script>`} label="Copy Script" />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{ui.eltCssTag}</div>
                  <CopyBtn text={`<link rel="stylesheet" href="${cdnUrl}">`} label="Copy CSS" />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Markdown:</div>
                  <CopyBtn text={`[Load Script](${cdnUrl})`} label="Copy Markdown" />
                </div>

              </div>
            </div>
          )}
        </div>
      )}

      {/* HTML Preview */}
      {(input || output) && (
        <div style={{ padding: '16px 20px', background: 'var(--bg-primary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '10px' }}>{ui.eltPreviewTitle}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: '4px' }}>Original Preview:</div>
              <iframe title="Original Preview" srcDoc={renderSafeHtml((input || '').replace(/\$[0-9&]+/g, ui.eltSampleContent))} sandbox="allow-scripts" style={{ width: '100%', height: '300px', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', background: '#0f0f12' }} />
            </div>
            <div>
              <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: '4px' }}>Translated Preview:</div>
              <iframe title="Translated Preview" srcDoc={renderSafeHtml((output || input || '').replace(/\$[0-9&]+/g, ui.eltSampleContent))} sandbox="allow-scripts" style={{ width: '100%', height: '300px', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', background: '#0f0f12' }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
