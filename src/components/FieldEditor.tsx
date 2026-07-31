import { useState, useMemo, useRef, useCallback, useEffect, lazy, Suspense, memo } from 'react';
import { useStore } from '../store';
import { useThrottledStore } from '../hooks/useThrottledStore';
import { useTranslation } from '../hooks/useTranslation';
import { useT, useUi } from '../i18n/useLocale';
import { fmt } from '../i18n';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { FieldGroup, TranslationField, TranslationStatus } from '../types/card';
import { auditChunks, joinChunks, summarizeAudit } from '../utils/chunkAudit';
import { RotateCcw, AlertTriangle, CheckCircle2, Clock, ArrowLeftRight, BarChart3, Ban, Search, X, Copy, Check, Eye, Wand2, Zap, Brain, Download, Filter } from 'lucide-react';
import { countCjkText } from '../utils/cjk';
import { TranslatedTextarea } from './TranslatedTextarea';

const RAGDebugPanel = lazy(() => import('./RAGDebugPanel'));

const getFieldBaseKey = (path: string) => {
  const lastPart = path.split('.').pop() || '';
  return lastPart.replace(/\[\d+\]$/, '');
};

// (bugNeedFix/39) Đếm số field theo baseKey CACHE theo tham chiếu mảng fields: trước đây MỖI HÀNG
// ảo hoá filter cả 605 field ngay trong render (~28 hàng × 605 phép so mỗi lần render) — burst dịch
// khiến bảng render liên tục ⇒ cộng dồn đáng kể. WeakMap không giữ mảng sống; fields đổi identity
// (mỗi nhịp throttle 150ms) → tự build lại 1 lần (~0.5ms).
const _baseKeyCountCache = new WeakMap<object, Map<string, number>>();
function getBaseKeyCounts(allFields: { path: string }[]): Map<string, number> {
  let m = _baseKeyCountCache.get(allFields);
  if (!m) {
    m = new Map();
    for (const f of allFields) {
      const k = getFieldBaseKey(f.path);
      m.set(k, (m.get(k) || 0) + 1);
    }
    _baseKeyCountCache.set(allFields, m);
  }
  return m;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={handleCopy}
      className="btn btn-ghost btn-xs tooltip"
      data-tooltip={copied ? "Copied!" : "Copy"}
      style={{ padding: '2px 4px', height: 'auto', minHeight: 'auto', opacity: 0.6 }}
      title={copied ? "Copied!" : "Copy original text"}
    >
      {copied ? <Check size={12} color="var(--accent-success)" /> : <Copy size={12} />}
    </button>
  );
}

const TAB_IDS: (FieldGroup | 'all')[] = [
  'all', 'core', 'messages', 'lorebook', 'lorebook_keys', 'system', 'creator', 'depth_prompt', 'tavern_helper',
];

/**
 * (bugNeedFix/176) Dải lọc theo TRẠNG THÁI.
 * "Bỏ qua" (skipped) khác "Không dịch" (ignored): skipped là do bộ dò ngôn ngữ TỰ quyết — nó tưởng
 * nội dung đã ở ngôn ngữ đích nên bỏ; ignored là do chính user tắt. Chỉ cái đầu mới là thứ user
 * cần soi lại hàng loạt, nên hai cái phải là hai chip riêng, không gộp.
 */
const STATUS_CHIPS: Array<{ id: 'all' | TranslationStatus; label: string; icon: string; color: string; hint: string }> = [
  { id: 'all', label: 'Tất cả', icon: '☰', color: 'var(--accent-primary)', hint: 'Bỏ lọc trạng thái.' },
  { id: 'skipped', label: 'Bỏ qua', icon: '⏭', color: 'var(--accent-warning)',
    hint: 'Máy tự bỏ vì tưởng nội dung đã ở ngôn ngữ đích (hoặc sai ngôn ngữ nguồn). Đoán sai thì dịch lại hàng loạt ở đây.' },
  { id: 'error', label: 'Lỗi', icon: '✖', color: 'var(--accent-danger)', hint: 'Dịch thất bại.' },
  { id: 'pending', label: 'Chưa dịch', icon: '⏳', color: 'var(--text-muted)', hint: 'Chưa tới lượt hoặc chưa chạy.' },
  { id: 'done', label: 'Đã dịch', icon: '✓', color: 'var(--accent-success)', hint: 'Đã dịch xong.' },
  { id: 'ignored', label: 'Không dịch', icon: '🚫', color: 'var(--text-muted)', hint: 'Do BẠN tắt — máy không đụng tới.' },
];

/** Trạng thái nào thì việc "dịch lại cả tập" mới có nghĩa. */
const RETRANSLATABLE = new Set<string>(['skipped', 'error', 'pending']);

function useTabLabels() {
  const t = useT();
  const map: Record<string, string> = {
    all: t.all,
    core: 'Core',
    messages: t.groupMessages.split(' ')[0],
    lorebook: 'Lorebook',
    lorebook_keys: 'Keys',
    system: 'System',
    creator: 'Creator',
    regex: 'Regex',
    depth_prompt: 'Depth',
    tavern_helper: 'TavernHelper',
  };
  return map;
}

/** Compute char ratio indicator */
function CharRatio({ original, translated }: { original: string; translated: string }) {
  if (!translated) return null;
  const ratio = translated.length / Math.max(original.length, 1);
  const pct = Math.round(ratio * 100);

  // Color based on ratio health
  let color = 'var(--accent-success)';
  let label = 'OK';
  if (ratio < 0.3) { color = 'var(--accent-danger)'; label = 'Short'; }
  else if (ratio < 0.6) { color = 'var(--accent-warning)'; label = 'Low'; }
  else if (ratio > 2.5) { color = 'var(--accent-warning)'; label = 'Long'; }

  return (
    <span
      title={`${translated.length}/${original.length} chars (${pct}%)`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '3px',
        fontSize: '0.6rem',
        padding: '1px 5px',
        borderRadius: 'var(--radius-sm)',
        background: `${color}15`,
        color,
        fontWeight: 600,
        fontFamily: 'monospace',
      }}
    >
      <BarChart3 size={9} />
      {pct}%
      {ratio < 0.3 && <span style={{ fontSize: '0.55rem' }}>⚠ {label}</span>}
    </span>
  );
}

/**
 * (User 2026) Badge CẢNH BÁO TỰ ĐỘNG "còn chữ Hán chưa dịch" — hiện NGAY trên field đã DONE khi
 * bản dịch còn sót nhiều CJK (vd schema Zod báo done nhưng biến/nhãn vẫn tiếng Trung). Trước đây
 * chỉ nút "Kiểm Tra Field" mới bắt (không tự động), nên user tưởng đã dịch xong. Ngưỡng khớp
 * verifyFields: origCJK>3 và (tỉ lệ >15% HOẶC >10 ký tự CJK còn lại). Bấm badge = nhảy tới field.
 */
function ResidualCjkBadge({ original, translated, t }: { original: string; translated: string; t: Record<string, string> }) {
  const info = useMemo(() => {
    if (!translated) return null;
    const origCJK = countCjkText(original);
    const transCJK = countCjkText(translated);
    if (origCJK <= 3 || transCJK === 0) return null;
    const ratio = transCJK / origCJK;
    // Chỉ cảnh báo khi thật sự đáng ngờ (bỏ qua 1-2 ký tự lẻ như tên riêng giữ nguyên cố ý)
    if (ratio <= 0.15 && transCJK <= 10) return null;
    return { transCJK, pct: Math.round(ratio * 100) };
  }, [original, translated]);

  if (!info) return null;
  return (
    <span
      title={fmt(t.residualCjkTip, { n: info.transCJK, pct: info.pct })}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '3px',
        fontSize: '0.6rem', padding: '1px 5px', borderRadius: 'var(--radius-sm)',
        background: 'rgba(231,76,60,0.15)', color: 'var(--accent-danger)',
        fontWeight: 700, border: '1px solid rgba(231,76,60,0.35)',
      }}
    >
      <AlertTriangle size={9} /> {fmt(t.residualCjkBadge, { n: info.transCJK })}
    </span>
  );
}

/** Simple inline diff view — highlights additions/deletions */
function DiffView({ original, translated }: { original: string; translated: string }) {
  const t = useT();
  if (!translated) return <span style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '0.75rem' }}>{t.noTranslation}</span>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.78rem', lineHeight: 1.5 }}>
      <div style={{ position: 'relative' }}>
        <span style={{
          position: 'absolute', top: '-1px', left: 0,
          fontSize: '0.55rem', fontWeight: 700, color: 'var(--accent-danger)',
          textTransform: 'uppercase', letterSpacing: '0.05em',
        }}>
          {t.original}
        </span>
        <div style={{ position: 'absolute', top: '0px', right: '4px', zIndex: 10 }}>
          <CopyButton text={original} />
        </div>
        <div
          style={{
            padding: '14px 8px 6px',
            background: 'rgba(255,82,82,0.04)',
            borderLeft: '2px solid var(--accent-danger)',
            borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: '200px',
            overflowY: 'auto',
            color: 'var(--text-secondary)',
          }}
        >
          {original.length > 800 ? original.slice(0, 800) + '...' : original}
        </div>
      </div>
      <div style={{ position: 'relative' }}>
        <span style={{
          position: 'absolute', top: '-1px', left: 0,
          fontSize: '0.55rem', fontWeight: 700, color: 'var(--accent-success)',
          textTransform: 'uppercase', letterSpacing: '0.05em',
        }}>
          {t.translated}
        </span>
        <div
          style={{
            padding: '14px 8px 6px',
            background: 'rgba(76,175,80,0.04)',
            borderLeft: '2px solid var(--accent-success)',
            borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: '200px',
            overflowY: 'auto',
            color: 'var(--text-primary)',
          }}
        >
          {translated.length > 800 ? translated.slice(0, 800) + '...' : translated}
        </div>
      </div>
    </div>
  );
}

function SurgicalResultBadge({ result }: { result?: { type: 'success' | 'fallback', info?: string } }) {
  if (!result) return null;

  if (result.type === 'success') {
    return (
      <span style={{ 
        fontSize: '0.55rem', padding: '1px 4px', 
        background: 'rgba(76,175,80,0.15)', color: '#4caf50', 
        borderRadius: '3px', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '2px',
        border: '1px solid rgba(76,175,80,0.3)'
      }} title={result.info}>
        <Check size={9} /> SURGICAL
      </span>
    );
  }

  return (
    <span style={{ 
      fontSize: '0.55rem', padding: '1px 4px', 
      background: 'rgba(255,152,0,0.15)', color: '#ff9800', 
      borderRadius: '3px', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '2px',
      border: '1px solid rgba(255,152,0,0.3)'
    }} title={result.info || 'Structural check failed, used standard translation.'}>
      <AlertTriangle size={9} /> FALLBACK
    </span>
  );
}

/** Badge ♻ cho field được bê bản dịch từ cache phiên bản card cũ (nội dung không đổi). */
function ReusedBadge({ source }: { source?: string }) {
  if (!source) return null;
  return (
    <span style={{
      fontSize: '0.55rem', padding: '1px 4px',
      background: 'rgba(56,189,248,0.12)', color: 'var(--accent-secondary, #38bdf8)',
      borderRadius: '3px', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '2px',
      border: '1px solid rgba(56,189,248,0.3)',
    }} title={`Tái dùng bản dịch từ "${source}" — nội dung gốc không đổi giữa 2 phiên bản`}>
      ♻ {source.replace(/\.(png|json)$/i, '')}
    </span>
  );
}

function ChunkStatusAndResume({
  field,
  retranslateField,
  phase,
}: {
  field: any;
  retranslateField: (path: string, resume?: boolean) => void;
  phase: string;
}) {
  const proxy = useStore((s) => s.proxy);
  const translationConfig = useStore((s) => s.translationConfig);
  const ui = useUi();
  const t = useT();
  const [expanded, setExpanded] = useState(false);

  // Ngưỡng chia chunk THỰC TẾ = 15.000 ký tự (khớp chunkText ở apiClient). Nguồn tin cậy nhất là
  // field.totalChunks do engine báo qua onChunkComplete; nếu chưa có thì ước lượng theo độ dài.
  const CHUNK_CHARS = 15000;
  // completedChunks có thể là mảng thưa (song song hoàn thành lệch thứ tự) → đếm phần ĐÃ XONG (khác rỗng).
  const completedCount = field.completedChunks?.filter(Boolean).length || 0;
  const totalChunks = (field.totalChunks && field.totalChunks > 1)
    ? field.totalChunks
    : Math.max(1, Math.ceil(field.original.length / CHUNK_CHARS));
  const isChunked = totalChunks > 1 || completedCount > 0;
  if (!isChunked) return null;
  const failedIdx = field.failedChunkIndex !== undefined ? field.failedChunkIndex : (field.status === 'error' ? completedCount : undefined);

  const downloadChunk = (idx: number) => {
    const raw = field.rawChunks?.[idx] || '';
    const translated = field.completedChunks?.[idx] || '';
    const chunkData = {
      path: field.path,
      label: field.label,
      chunkIndex: idx + 1,
      totalChunks,
      raw,
      translated,
    };
    const json = JSON.stringify(chunkData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    // Clean label for file name
    const baseName = (field.label || 'chunk').replace(/[^a-zA-Z0-9_\u00C0-\u1EF9-]/g, '_');
    const fileName = `${baseName}_chunk_${idx + 1}.json`;
    
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  const renderDetailsButton = () => {
    if (completedCount === 0 && (!field.rawChunks || field.rawChunks.length === 0)) return null;
    return (
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--accent-primary)',
          fontSize: '0.65rem',
          fontWeight: 600,
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          padding: '2px 0',
          marginTop: '4px'
        }}
      >
        {expanded ? '▲ Hide Chunk Details' : `▼ View Chunk Details (${completedCount}/${totalChunks})`}
      </button>
    );
  };

  // ═══ (bugNeedFix/144) SOI CHUNK + GHÉP LẠI + DỊCH LẠI TỪNG CHUNK ═══
  // User: "10-20 chunk mà chỉ 1-2 cái lỗi thì phải có nút soi ra cái nào lỗi để dịch lại
  // riêng nó, và nút ghép lại — chứ dịch lại cả entry rất mất thời gian."
  const rawList: string[] = Array.from({ length: totalChunks }, (_, i) => field.rawChunks?.[i] || '');
  const doneList: (string | undefined)[] = Array.from({ length: totalChunks }, (_, i) => field.completedChunks?.[i]);
  const audit = auditChunks(rawList, doneList);
  const issueByIndex = new Map(audit.issues.map(x => [x.index, x]));

  const copyText = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      useStore.getState().addLog('info', `📋 Đã chép ${what}.`);
    } catch {
      useStore.getState().addLog('warning', `Không chép được ${what} (trình duyệt chặn clipboard).`);
    }
  };

  /**
   * Dịch lại ĐÚNG một chunk: xoá ô đó rồi chạy tiếp (resume). Engine vốn chỉ dịch những ô
   * còn trống, nên không phải thêm đường đi mới — và các chunk đã dịch giữ nguyên, không tốn
   * lượt gọi API nào cho chúng.
   */
  const retranslateOneChunk = (idx: number) => {
    const cur = [...(field.completedChunks || [])];
    while (cur.length <= idx) cur.push('');
    cur[idx] = '';
    useStore.getState().updateField(field.path, { completedChunks: cur, status: 'pending' });
    useStore.getState().addLog('info', `🔁 Dịch lại riêng chunk ${idx + 1}/${totalChunks} của ${field.label} — các chunk khác giữ nguyên.`);
    retranslateField(field.path, true);
  };

  /** Ghép lại từ các chunk đang có — đúng quy tắc engine dùng (HTML/code nối liền). */
  const rejoinFromChunks = () => {
    if (audit.suspectIndices.length > 0) {
      useStore.getState().addLog('warning',
        `⚠️ Chưa ghép: ${summarizeAudit(audit)} Ghép lúc này sẽ ra bản thiếu — dịch lại các chunk đó trước.`);
      return;
    }
    const joined = joinChunks(doneList.map(c => c || ''), field.original);
    useStore.getState().updateField(field.path, { translated: joined, status: 'done' });
    useStore.getState().addLog('success', `🧩 Đã ghép lại ${totalChunks} chunk của ${field.label} (${joined.length.toLocaleString()} ký tự).`);
  };

  const renderChunkToolbar = () => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '6px', alignItems: 'center' }}>
      <span style={{
        fontSize: '0.55rem', fontWeight: 600, padding: '2px 6px', borderRadius: 'var(--radius-xs)',
        background: audit.suspectIndices.length ? 'rgba(245,158,11,0.15)' : 'rgba(34,197,94,0.15)',
        color: audit.suspectIndices.length ? 'var(--warning, #f59e0b)' : 'var(--success, #22c55e)',
      }}>
        {summarizeAudit(audit)}
      </span>
      <button onClick={rejoinFromChunks} title="Ghép các chunk đã dịch thành entry hoàn chỉnh (đúng cách engine ghép)"
        style={{ padding: '2px 6px', fontSize: '0.55rem', fontWeight: 600, background: 'rgba(124,106,240,0.15)',
          color: 'var(--accent-primary)', border: '1px solid rgba(124,106,240,0.25)', borderRadius: 'var(--radius-xs)', cursor: 'pointer' }}>
        🧩 Ghép lại
      </button>
      {audit.suspectIndices.length > 0 && (
        <button
          onClick={() => {
            const cur = [...(field.completedChunks || [])];
            for (const i of audit.suspectIndices) { while (cur.length <= i) cur.push(''); cur[i] = ''; }
            useStore.getState().updateField(field.path, { completedChunks: cur, status: 'pending' });
            useStore.getState().addLog('info',
              `🔁 Dịch lại ${audit.suspectIndices.length} chunk có vấn đề (số ${audit.suspectIndices.map(i => i + 1).join(', ')}) — ${totalChunks - audit.suspectIndices.length} chunk còn lại giữ nguyên.`);
            retranslateField(field.path, true);
          }}
          title="Chỉ dịch lại những chunk bị đánh dấu — không đụng tới chunk đã tốt"
          style={{ padding: '2px 6px', fontSize: '0.55rem', fontWeight: 600, background: 'rgba(245,158,11,0.15)',
            color: 'var(--warning, #f59e0b)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 'var(--radius-xs)', cursor: 'pointer' }}>
          🔁 Dịch lại {audit.suspectIndices.length} chunk lỗi
        </button>
      )}
      <button onClick={() => copyText(joinChunks(doneList.map(c => c || ''), field.original), 'toàn bộ bản dịch đã ghép')}
        title="Chép bản GHÉP của các chunk đang có (đúng thứ sẽ ghi vào entry)"
        style={{ padding: '2px 6px', fontSize: '0.55rem', fontWeight: 600, background: 'rgba(255,255,255,0.06)',
          color: 'var(--text-secondary)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 'var(--radius-xs)', cursor: 'pointer' }}>
        📋 Chép bản ghép
      </button>
    </div>
  );

  const renderDetailsList = () => {
    if (!expanded) return null;
    return (
      <div style={{
        marginTop: '6px',
        padding: '8px',
        background: 'rgba(0,0,0,0.15)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-md)',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        maxHeight: '220px',
        overflowY: 'auto'
      }}>
        {Array.from({ length: totalChunks }).map((_, idx) => {
          const raw = field.rawChunks?.[idx] || '';
          const trans = field.completedChunks?.[idx] || '';
          const isDone = !!trans;
          
          return (
            <div key={idx} style={{
              padding: '6px',
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.05)',
              borderRadius: 'var(--radius-sm)',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  Chunk {idx + 1}
                  {issueByIndex.has(idx) && (
                    <span title={issueByIndex.get(idx)!.detail}
                      style={{ fontSize: '0.5rem', fontWeight: 700, padding: '1px 4px', borderRadius: '3px',
                        background: 'rgba(245,158,11,0.18)', color: 'var(--warning, #f59e0b)' }}>
                      ⚠️ {issueByIndex.get(idx)!.kind === 'missing' ? 'thiếu'
                        : issueByIndex.get(idx)!.kind === 'untranslated' ? 'chưa dịch'
                        : issueByIndex.get(idx)!.kind === 'too-short' ? 'nghi cụt' : 'nghi thừa'}
                    </span>
                  )}
                </span>
                <div style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
                  {/* (bugNeedFix/144) Chép riêng bản gốc / bản dịch của chunk — trước chỉ có tải JSON. */}
                  <button onClick={() => copyText(raw, `bản gốc chunk ${idx + 1}`)} disabled={!raw}
                    title="Chép bản GỐC của chunk này"
                    style={{ padding: '2px 5px', fontSize: '0.55rem', fontWeight: 600, background: 'rgba(255,255,255,0.06)',
                      color: 'var(--text-secondary)', border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 'var(--radius-xs)', cursor: raw ? 'pointer' : 'not-allowed', opacity: raw ? 1 : 0.4 }}>
                    📋 Gốc
                  </button>
                  <button onClick={() => copyText(trans, `bản dịch chunk ${idx + 1}`)} disabled={!trans}
                    title="Chép BẢN DỊCH của chunk này"
                    style={{ padding: '2px 5px', fontSize: '0.55rem', fontWeight: 600, background: 'rgba(34,197,94,0.12)',
                      color: 'var(--success, #22c55e)', border: '1px solid rgba(34,197,94,0.25)',
                      borderRadius: 'var(--radius-xs)', cursor: trans ? 'pointer' : 'not-allowed', opacity: trans ? 1 : 0.4 }}>
                    📋 Dịch
                  </button>
                  <button onClick={() => retranslateOneChunk(idx)}
                    title="Chỉ dịch lại RIÊNG chunk này — các chunk khác giữ nguyên"
                    style={{ padding: '2px 5px', fontSize: '0.55rem', fontWeight: 600, background: 'rgba(245,158,11,0.12)',
                      color: 'var(--warning, #f59e0b)', border: '1px solid rgba(245,158,11,0.25)',
                      borderRadius: 'var(--radius-xs)', cursor: 'pointer' }}>
                    🔁 Dịch lại
                  </button>
                  <button
                    onClick={() => downloadChunk(idx)}
                    style={{
                      padding: '2px 6px',
                      fontSize: '0.55rem',
                      fontWeight: 600,
                      background: 'rgba(124, 106, 240, 0.15)',
                      color: 'var(--accent-primary)',
                      border: '1px solid rgba(124, 106, 240, 0.25)',
                      borderRadius: 'var(--radius-xs)',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '3px'
                    }}
                    title="Download JSON for this chunk"
                  >
                    <Download size={10} /> JSON
                  </button>
                </div>
              </div>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <span style={{ fontSize: '0.52rem', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Raw</span>
                  <div style={{
                    padding: '4px',
                    background: 'rgba(0,0,0,0.2)',
                    borderRadius: '3px',
                    fontSize: '0.62rem',
                    fontFamily: 'monospace',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    maxHeight: '50px',
                    overflowY: 'auto',
                    color: 'var(--text-secondary)'
                  }}>
                    {raw || <span style={{ fontStyle: 'italic', color: 'var(--text-muted)' }}>{t.emptyField}</span>}
                  </div>
                </div>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <span style={{ fontSize: '0.52rem', textTransform: 'uppercase', color: isDone ? 'var(--accent-success)' : 'var(--text-muted)' }}>{t.translated}</span>
                  <div style={{
                    padding: '4px',
                    background: isDone ? 'rgba(76,175,80,0.04)' : 'rgba(0,0,0,0.2)',
                    borderLeft: isDone ? '1px solid var(--accent-success)' : 'none',
                    borderRadius: '3px',
                    fontSize: '0.62rem',
                    fontFamily: 'monospace',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    maxHeight: '50px',
                    overflowY: 'auto',
                    color: isDone ? 'var(--text-primary)' : 'var(--text-muted)'
                  }}>
                    {trans || <span style={{ fontStyle: 'italic' }}>Pending...</span>}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // If status is translating, show current progress
  if (field.status === 'translating') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
        <div style={{ fontSize: '0.62rem', color: 'var(--accent-info)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ padding: '1px 5px', background: 'rgba(124,106,240,0.12)', borderRadius: '3px', fontWeight: 600 }}>
            {fmt(ui.feChunkBig, { count: totalChunks })}
          </span>
          <span style={{ color: 'var(--text-muted)' }}>
            {fmt(ui.feChunkDone, { done: completedCount, total: totalChunks })}
          </span>
        </div>
        {renderDetailsButton()}
        {renderChunkToolbar()}
        {renderDetailsList()}
      </div>
    );
  }

  // If status is done, show chunk details browser
  if (field.status === 'done') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
        {renderDetailsButton()}
        {renderChunkToolbar()}
        {renderDetailsList()}
      </div>
    );
  }

  // If status is error, show the failed chunk index and a button to resume
  if (field.status === 'error') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
        <div style={{
          marginTop: '6px',
          padding: '8px',
          background: 'rgba(231, 76, 60, 0.04)',
          border: '1px solid rgba(231, 76, 60, 0.15)',
          borderRadius: 'var(--radius-md)',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.68rem', color: 'var(--accent-danger)' }}>
            <AlertTriangle size={12} />
            <span style={{ fontWeight: 600 }}>
              {fmt(ui.feChunkFailed, { idx: (failedIdx !== undefined ? failedIdx : 0) + 1, total: totalChunks })}
            </span>
            {completedCount > 0 && (
              <span style={{ color: 'var(--text-muted)' }}>
                {fmt(ui.feChunkSaved, { count: completedCount })}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button
              className="btn btn-ghost btn-xs"
              onClick={() => retranslateField(field.path, true)}
              disabled={phase === 'translating'}
              style={{
                padding: '3px 8px',
                fontSize: '0.68rem',
                fontWeight: 600,
                background: 'var(--accent-primary)',
                color: 'white',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                cursor: phase === 'translating' ? 'not-allowed' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              <RotateCcw size={10} />
              {completedCount > 0 ? fmt(ui.feChunkResumeFrom, { idx: completedCount + 1 }) : ui.feChunkRestart}
            </button>
            {completedCount > 0 && (
              <button
                className="btn btn-ghost btn-xs"
                onClick={() => retranslateField(field.path, false)}
                disabled={phase === 'translating'}
                style={{
                  padding: '3px 8px',
                  fontSize: '0.68rem',
                  fontWeight: 500,
                  color: 'var(--text-muted)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  cursor: phase === 'translating' ? 'not-allowed' : 'pointer',
                }}
              >
                {ui.feChunkRestart}
              </button>
            )}
          </div>
        </div>
        {renderDetailsButton()}
        {renderChunkToolbar()}
        {renderDetailsList()}
      </div>
    );
  }

  // If status is pending or ignored, but it already has completed chunks cached
  if (completedCount > 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
        <div style={{ fontSize: '0.62rem', color: 'var(--accent-info)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ padding: '1px 5px', background: 'rgba(124,106,240,0.12)', borderRadius: '3px', fontWeight: 600 }}>
            {fmt(ui.feChunkSavedOf, { done: completedCount, total: totalChunks })}
          </span>
          <button
            className="btn btn-ghost btn-xs"
            onClick={() => retranslateField(field.path, true)}
            disabled={phase === 'translating'}
            style={{
              padding: '1px 5px',
              fontSize: '0.6rem',
              color: 'var(--accent-primary)',
              background: 'transparent',
              border: '1px solid rgba(124, 106, 240, 0.3)',
              borderRadius: '3px',
              cursor: phase === 'translating' ? 'not-allowed' : 'pointer',
            }}
          >
            {ui.feChunkContinue}
          </button>
        </div>
        {renderDetailsButton()}
        {renderChunkToolbar()}
        {renderDetailsList()}
      </div>
    );
  }

  return null;
}

/** Live HTML/Regex Preview Pane — renders translated HTML in a sandboxed iframe */
function HtmlPreviewPane({ html }: { html: string }) {
  const srcdoc = useMemo(() => {
    // Wrap in a basic document with dark bg and common ST CSS vars
    return `<!DOCTYPE html>
<html>
<head>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Segoe UI', Tahoma, sans-serif;
    font-size: 14px;
    line-height: 1.5;
    color: #e0e0e0;
    background: #1a1a2e;
    padding: 12px;
    word-break: break-word;
    overflow-wrap: break-word;
  }
  img { max-width: 100%; height: auto; }
  table { border-collapse: collapse; width: 100%; }
  td, th { border: 1px solid #444; padding: 4px 8px; }
  a { color: #82b1ff; }
</style>
</head>
<body>
${html}
</body>
</html>`;
  }, [html]);

  return (
    <div style={{
      marginTop: '6px',
      border: '1px solid rgba(124,106,240,0.2)',
      borderRadius: 'var(--radius-md)',
      overflow: 'hidden',
      background: '#1a1a2e',
    }}>
      <div style={{
        padding: '3px 8px',
        fontSize: '0.6rem',
        fontWeight: 600,
        color: 'var(--accent-primary)',
        background: 'rgba(124,106,240,0.06)',
        borderBottom: '1px solid rgba(124,106,240,0.1)',
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
      }}>
        <Eye size={10} />
        HTML Preview (sandboxed)
      </div>
      <iframe
        srcDoc={srcdoc}
        sandbox="allow-same-origin"
        style={{
          width: '100%',
          minHeight: '120px',
          maxHeight: '400px',
          border: 'none',
          display: 'block',
        }}
        title="HTML Preview"
      />
    </div>
  );
}

/** Toggle wrapper for HtmlPreviewPane — shows an eye button to expand/collapse */
function HtmlPreviewToggle({ html }: { html: string }) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ marginTop: '4px' }}>
      <button
        onClick={() => setShow(p => !p)}
        className="btn btn-ghost btn-xs"
        style={{
          padding: '2px 8px',
          fontSize: '0.62rem',
          color: show ? 'var(--accent-primary)' : 'var(--text-muted)',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          opacity: show ? 1 : 0.7,
        }}
      >
        <Eye size={11} />
        {show ? 'Hide Preview' : 'Preview HTML'}
      </button>
      {show && <HtmlPreviewPane html={html} />}
    </div>
  );
}

/** Live Regex Match Simulator */
function RegexSimulatorPane({ regexStr }: { regexStr: string }) {
  const [testText, setTestText] = useState('');
  
  // Parse regex safely
  const parsedRegex = useMemo(() => {
    if (!regexStr) return null;
    try {
      let pattern = regexStr;
      let flags = 'g';
      // SillyTavern format: /pattern/flags
      const match = regexStr.match(/^\/(.+)\/([gimsuy]*)$/);
      if (match) {
        pattern = match[1];
        flags = match[2];
        if (!flags.includes('g')) flags += 'g'; // Force global to find all matches
      } else {
        // If it doesn't have slashes, just treat as raw string
      }
      return new RegExp(pattern, flags);
    } catch (e) {
      return null; // Invalid regex
    }
  }, [regexStr]);

  const highlightedElements = useMemo(() => {
    if (!testText) return null;
    if (!parsedRegex) return <span style={{color: 'var(--accent-danger)'}}>Invalid Regular Expression</span>;

    const elements: React.ReactNode[] = [];
    let lastIndex = 0;
    
    parsedRegex.lastIndex = 0; // reset
    let match;
    let key = 0;
    let iterations = 0;
    
    while ((match = parsedRegex.exec(testText)) !== null) {
      iterations++;
      if (iterations > 1000) break; // Infinite loop safety
      
      const start = match.index;
      const end = parsedRegex.lastIndex;
      
      // Zero-length match prevention
      if (start === end) {
        parsedRegex.lastIndex++;
        continue;
      }

      if (start > lastIndex) {
        elements.push(<span key={key++}>{testText.slice(lastIndex, start)}</span>);
      }
      
      elements.push(
        <mark key={key++} style={{ 
          background: 'rgba(236,72,153,0.3)', 
          color: '#ff9ecd', 
          borderRadius: '2px',
          padding: '0 2px'
        }} title="Matched segment">
          {testText.slice(start, end)}
        </mark>
      );
      
      lastIndex = end;
    }
    
    if (lastIndex < testText.length) {
      elements.push(<span key={key++}>{testText.slice(lastIndex)}</span>);
    }
    
    if (elements.length === 1 && typeof elements[0] === 'object' && 'type' in (elements[0] as any) && (elements[0] as any).type === 'span') {
      return <span style={{color: 'var(--text-muted)'}}>No matches found.</span>;
    }
    
    return elements;
  }, [testText, parsedRegex]);

  return (
    <div style={{
      marginTop: '6px',
      border: '1px solid rgba(236,72,153,0.2)',
      borderRadius: 'var(--radius-md)',
      padding: '8px',
      background: '#1a1a2e',
    }}>
      <div style={{
        fontSize: '0.6rem',
        fontWeight: 600,
        color: '#f472b6',
        marginBottom: '6px',
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
      }}>
        <Search size={10} />
        Regex Match Simulator
      </div>
      <textarea
        value={testText}
        onChange={e => setTestText(e.target.value)}
        placeholder="Paste narrative text here to simulate what this regex will match/eat..."
        style={{
          width: '100%',
          minHeight: '60px',
          background: 'rgba(0,0,0,0.2)',
          border: '1px solid rgba(255,255,255,0.1)',
          color: 'var(--text-primary)',
          padding: '6px',
          borderRadius: '4px',
          fontSize: '0.8rem',
          resize: 'vertical',
          marginBottom: '8px'
        }}
      />
      {testText && (
        <div style={{
          padding: '8px',
          background: 'rgba(0,0,0,0.3)',
          borderRadius: '4px',
          fontSize: '0.8rem',
          color: 'var(--text-secondary)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          maxHeight: '150px',
          overflowY: 'auto'
        }}>
          {highlightedElements}
        </div>
      )}
    </div>
  );
}

/** Toggle wrapper for RegexSimulatorPane */
function RegexSimulatorToggle({ regexStr }: { regexStr: string }) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ marginTop: '4px' }}>
      <button
        onClick={() => setShow(p => !p)}
        className="btn btn-ghost btn-xs"
        style={{
          padding: '2px 8px',
          fontSize: '0.62rem',
          color: show ? '#f472b6' : 'var(--text-muted)',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          opacity: show ? 1 : 0.7,
        }}
      >
        <Search size={11} />
        {show ? 'Hide Simulator' : 'Test Regex Match'}
      </button>
      {show && <RegexSimulatorPane regexStr={regexStr} />}
    </div>
  );
}

const VirtualFieldTableRow = memo(({
  field,
  updateField,
  retranslateField,
  applyModToField,
  phase,
  t,
  modEnabled,
  allFields,
  setFields,
  addToast,
  setRagDebugField,
}: {
  field: any;
  updateField: any;
  retranslateField: any;
  applyModToField: any;
  phase: string;
  t: Record<string, string>;
  modEnabled: boolean;
  allFields: any[];
  setFields: any;
  addToast: any;
  setRagDebugField: any;
}) => {
  const ui = useUi();
  // Chiều cao CHUNG cho ô Gốc và ô Dịch → 2 bên LUÔN cao bằng nhau (trước đây ô Gốc là <div> cao
  // theo nội dung, ô Dịch là <textarea rows> cao theo số dòng gốc ⇒ lệch cao–thấp khó nhìn).
  // Dùng ĐÚNG công thức mà estimateRowHeight đã ước lượng cho hàng ảo hoá (2–8 dòng × 20px + 12).
  const cellBoxRows = Math.min(Math.max((field.original || '').split('\n').length, 2), 8);
  const cellBoxHeight = cellBoxRows * 20 + 12;
  const handleRowCheckboxChange = (field: any, checked: boolean) => {
    if (checked) {
      const nextStatus = field.translated?.trim() ? 'done' : 'pending';
      updateField(field.path, { status: nextStatus });
    } else {
      updateField(field.path, { status: 'ignored' });
    }
  };

  return (
    <div
      className={`field-grid-layout field-grid-row ${field.status === 'error' ? 'field-error' : ''}`}
      style={{
        opacity: field.status === 'ignored' ? 0.5 : 1,
      }}
    >
      {/* Field name */}
      <div className="field-grid-cell">
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', width: '100%' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', marginTop: '2px', flexShrink: 0 }}>
            <label className="checkbox-wrapper" style={{ cursor: phase === 'translating' ? 'not-allowed' : 'pointer' }}>
              <input
                type="checkbox"
                checked={field.status !== 'ignored'}
                onChange={(e) => handleRowCheckboxChange(field, e.target.checked)}
                disabled={phase === 'translating'}
              />
            </label>
            {(() => {
              const baseKey = getFieldBaseKey(field.path);
              // (bug 39) O(1) qua cache thay vì filter 605 field mỗi hàng mỗi render.
              if ((getBaseKeyCounts(allFields).get(baseKey) || 0) <= 1) return null;
              return (
                <button
                  className="btn btn-ghost tooltip"
                  data-tooltip={fmt(ui.feApplyAllTitle, { key: baseKey })}
                  onClick={() => {
                    const targetStatus = field.status;
                    const nextFields = allFields.map(f => {
                      if (getFieldBaseKey(f.path) === baseKey) {
                        if (targetStatus === 'ignored') {
                          return { ...f, status: 'ignored' as const };
                        } else {
                          const activeStatus = f.translated?.trim() ? 'done' as const : 'pending' as const;
                          return { ...f, status: activeStatus };
                        }
                      }
                      return f;
                    });
                    setFields(nextFields);
                    addToast('success', fmt(ui.feApplyAllToast, { key: baseKey }));
                  }}
                  disabled={phase === 'translating'}
                  style={{ padding: '2px', height: '18px', width: '18px', minHeight: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-primary)', opacity: 0.8 }}
                  title={fmt(ui.feApplyAllTitle, { key: baseKey })}
                >
                  <Zap size={10} />
                </button>
              );
            })()}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              className="field-name"
              style={{
                textDecoration: field.status === 'ignored' ? 'line-through' : 'none',
                color: field.status === 'ignored' ? 'var(--text-muted)' : 'var(--accent-secondary)',
              }}
            >
              {field.label}
            </div>
            <div style={{ marginTop: '4px', display: 'flex', flexWrap: 'wrap', gap: '3px', alignItems: 'center' }}>
              {field.entryType === 'json_patch' && (
                <span style={{ fontSize: '0.55rem', padding: '1px 4px', background: 'rgba(236,72,153,0.1)', color: '#f472b6', borderRadius: '3px', fontWeight: 600 }}>PATCH</span>
              )}
              <StatusBadge status={field.status} t={t} />
              {field.surgicalResult && <SurgicalResultBadge result={field.surgicalResult} />}
              {field.reusedFrom && <ReusedBadge source={field.reusedFrom} />}
              <CharRatio original={field.original} translated={field.translated} />
              {field.status === 'done' && <ResidualCjkBadge original={field.original} translated={field.translated} t={t} />}
            </div>
            {field.error && (
              <div
                title={field.error}
                style={{
                  fontSize: '0.65rem',
                  color: 'var(--accent-danger)',
                  marginTop: '4px',
                  wordBreak: 'break-word',
                  display: '-webkit-box',
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                {field.error}
              </div>
            )}
            <ChunkStatusAndResume
              field={field}
              retranslateField={retranslateField}
              phase={phase}
            />
          </div>
        </div>
      </div>

      {/* Original */}
      <div className="field-grid-cell">
        <div className="field-original" style={{ position: 'relative', paddingRight: '24px', width: '100%', height: `${cellBoxHeight}px`, maxHeight: `${cellBoxHeight}px`, boxSizing: 'border-box' }}>
          <div style={{ position: 'absolute', top: '2px', right: '2px', zIndex: 10 }}>
            <CopyButton text={field.original} />
          </div>
          {field.original.length > 500
            ? field.original.slice(0, 500) + '...'
            : field.original}
        </div>
      </div>

      {/* Translated */}
      <div className="field-grid-cell field-translated">
        {/* (bugNeedFix/107) Ô này phải chịu được bộ gõ tiếng Việt: xem TranslatedTextarea. */}
        <TranslatedTextarea
          value={field.translated}
          onCommit={(val) => {
            updateField(field.path, {
              translated: val,
              status: val.trim() ? 'done' : 'pending',
              error: undefined
            });
          }}
          placeholder={field.status === 'pending' ? 'Not translated yet' : ''}
          style={{ height: `${cellBoxHeight}px`, boxSizing: 'border-box' }}
        />
        {field.group === 'regex' && field.path.includes('findRegex') && (
          <RegexSimulatorToggle regexStr={field.translated || field.original} />
        )}
      </div>

      {/* Actions */}
      <div className="field-grid-cell" style={{ alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', width: '100%' }}>
          <button
            className="btn btn-ghost btn-xs tooltip"
            data-tooltip={t.ignored}
            onClick={() => updateField(field.path, { status: field.status === 'ignored' ? 'pending' : 'ignored' })}
            disabled={phase === 'translating'}
            style={{ padding: '4px' }}
          >
            {field.status === 'ignored' ? <RotateCcw size={14} /> : <Ban size={14} />}
          </button>
          {modEnabled ? (
            <>
              <button
                className="btn btn-ghost btn-xs tooltip"
                data-tooltip={t.modField}
                onClick={() => applyModToField(field.path)}
                disabled={phase === 'translating'}
                style={{ padding: '4px', color: '#9b59b6' }}
              >
                <Wand2 size={14} />
              </button>
              <button
                className="btn btn-ghost btn-xs tooltip"
                data-tooltip={t.retranslate}
                onClick={() => retranslateField(field.path)}
                disabled={phase === 'translating'}
                style={{ padding: '4px', opacity: 0.5 }}
              >
                <RotateCcw size={14} />
              </button>
            </>
          ) : (
            <button
              className="btn btn-ghost btn-xs tooltip"
              data-tooltip={t.retranslate}
              onClick={() => retranslateField(field.path)}
              disabled={phase === 'translating'}
              style={{ padding: '4px' }}
            >
              <RotateCcw size={14} />
            </button>
          )}
          <button
            className="btn btn-ghost btn-xs tooltip"
            data-tooltip="RAG Debug"
            onClick={() => setRagDebugField(field)}
            style={{ padding: '4px', color: 'var(--text-muted)', opacity: 0.6 }}
          >
            <Brain size={14} />
          </button>
        </div>
      </div>
    </div>
  );
});

/** Virtualized Table View — only renders visible rows using CSS Grid */
function VirtualTableView({
  fields,
  updateField,
  retranslateField,
  applyModToField,
  phase,
  t,
  modEnabled,
  scrollToPath,
  highlightPath,
}: {
  fields: any[];
  updateField: (path: string, update: any) => void;
  retranslateField: (path: string) => void;
  applyModToField: (path: string) => void;
  phase: string;
  t: Record<string, string>;
  modEnabled: boolean;
  scrollToPath?: string | null;
  highlightPath?: string | null;
}) {
  // (bugNeedFix/39) selector hẹp + throttle allFields — 2 view bảng này mount suốt lúc dịch.
  const setFields = useStore((s) => s.setFields);
  const allFields = useThrottledStore((s) => s.fields, 200);
  const addToast = useStore((s) => s.addToast);
  const parentRef = useRef<HTMLDivElement>(null);
  const headerCheckboxRef = useRef<HTMLInputElement>(null);

  const activeFields = useMemo(() => fields.filter(f => f.status !== 'translating'), [fields]);
  const allChecked = useMemo(() => {
    if (activeFields.length === 0) return false;
    return activeFields.every(f => f.status !== 'ignored');
  }, [activeFields]);

  const someChecked = useMemo(() => {
    return activeFields.some(f => f.status !== 'ignored');
  }, [activeFields]);

  const isIndeterminate = someChecked && !allChecked;

  useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = isIndeterminate;
    }
  }, [isIndeterminate]);

  const handleHeaderCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const checked = e.target.checked;
    const targetPaths = new Set(activeFields.map(f => f.path));
    const nextFields = allFields.map(f => {
      if (targetPaths.has(f.path)) {
        if (checked) {
          if (f.status === 'ignored') {
            const nextStatus: TranslationStatus = f.translated?.trim() ? 'done' : 'pending';
            return { ...f, status: nextStatus };
          }
        } else {
          if (f.status !== 'ignored') {
            const nextStatus: TranslationStatus = 'ignored';
            return { ...f, status: nextStatus };
          }
        }
      }
      return f;
    });
    setFields(nextFields);
  };

  const estimateRowHeight = useCallback((index: number) => {
    const field = fields[index];
    if (!field) return 80;

    let contentHeight = 0;

    // 1. Textarea height estimation
    const textareaRows = Math.min(Math.max(field.original.split('\n').length, 2), 8);
    const textareaHeight = textareaRows * 20 + 12; // 20px per line + padding

    // 2. Original text height estimation (capped at 120px max-height in css)
    const originalLines = field.original.split('\n').length;
    const originalHeight = Math.min(originalLines * 18 + 12, 120);

    // Grid row content height is determined by the maximum height of columns
    contentHeight = Math.max(originalHeight, textareaHeight);

    // 3. Error message height
    if (field.error) {
      contentHeight += 24;
    }

    // 4. Chunk details block height estimation
    const isChunked = field.original.length > 100000 || field.totalChunks > 1 || (field.completedChunks && field.completedChunks.length > 0);
    if (isChunked) {
      contentHeight += 32;
    }

    // 5. Regex simulator toggle space
    const isRegexFind = field.group === 'regex' && field.path.includes('findRegex');
    if (isRegexFind) {
      contentHeight += 28;
    }

    // Add extra padding (16px vertical) and border spacing
    return Math.max(contentHeight + 20, 80);
  }, [fields]);

  const virtualizer = useVirtualizer({
    count: fields.length,
    getScrollElement: () => parentRef.current,
    estimateSize: estimateRowHeight,
    overscan: 8,
  });

  // "Nhảy tới trường": cuộn danh sách ảo hoá tới đúng trường được yêu cầu (canh giữa).
  useEffect(() => {
    if (!scrollToPath) return;
    const idx = fields.findIndex((f) => f.path === scrollToPath);
    if (idx >= 0) virtualizer.scrollToIndex(idx, { align: 'center' });
  }, [scrollToPath, fields, virtualizer]);

  // (Bug UI 2026 — "kéo xuống dưới cùng vẫn không thấy hết bảng") Cache chiều cao của virtualizer
  // đánh số theo INDEX. Khi danh sách ĐỔI ĐỘ DÀI (lọc/gộp So Sánh/đổi nhóm field), chiều cao đã đo
  // của row cũ bị gán nhầm cho row mới ở cùng index → tổng chiều cao spacer sai → cuộn tới "đáy"
  // scrollbar mà vẫn còn row chưa hiện. Đổi độ dài là hiếm (không phải mỗi lần update field) nên
  // measure() lại toàn bộ ở đây rẻ và an toàn.
  const prevLenRef = useRef(fields.length);
  useEffect(() => {
    if (prevLenRef.current !== fields.length) {
      prevLenRef.current = fields.length;
      virtualizer.measure();
    }
  }, [fields.length, virtualizer]);

  const [ragDebugField, setRagDebugField] = useState<TranslationField | null>(null);

  return (
    <>
    {ragDebugField && (
      <Suspense fallback={null}>
        <RAGDebugPanel field={ragDebugField} onClose={() => setRagDebugField(null)} />
      </Suspense>
    )}
    <div
      ref={parentRef}
      style={{
        maxHeight: '600px',
        overflowY: 'auto',
        overflowX: 'auto',
      }}
    >
      {/* Sticky header using CSS Grid */}
      <div className="field-grid-layout field-grid-header">
        <div className="field-grid-header-cell">
          <label className="checkbox-wrapper" style={{ display: 'inline-flex', cursor: phase === 'translating' ? 'not-allowed' : 'pointer' }}>
            <input
              type="checkbox"
              ref={headerCheckboxRef}
              checked={allChecked}
              onChange={handleHeaderCheckboxChange}
              disabled={phase === 'translating' || activeFields.length === 0}
            />
            <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
              {t.field}
            </span>
          </label>
        </div>
        <div className="field-grid-header-cell">{t.original}</div>
        <div className="field-grid-header-cell">{modEnabled ? t.modResult : t.translated}</div>
        <div className="field-grid-header-cell" style={{ justifyContent: 'center' }}>{t.actions}</div>
      </div>

      {/* Virtualized body */}
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const field = fields[virtualRow.index];
          const isJumpHighlight = !!highlightPath && field.path === highlightPath;
          return (
            <div
              // (Bug UI 2026) key phải kèm index: nếu 2 field TRÙNG path (có thể xảy ra sau luồng
              // So Sánh/gộp) thì React lặng lẽ VỨT row trùng key → bảng thiếu row dù data đủ.
              key={`${virtualRow.index}:${field.path}`}
              ref={virtualizer.measureElement}
              data-index={virtualRow.index}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
                willChange: 'transform',
                outline: isJumpHighlight ? '2px solid var(--accent-primary)' : undefined,
                outlineOffset: isJumpHighlight ? '-2px' : undefined,
                borderRadius: isJumpHighlight ? 'var(--radius-sm)' : undefined,
                background: isJumpHighlight ? 'rgba(124,106,240,0.10)' : undefined,
                transition: 'background 0.3s ease',
              }}
            >
              <VirtualFieldTableRow
                field={field}
                updateField={updateField}
                retranslateField={retranslateField}
                applyModToField={applyModToField}
                phase={phase}
                t={t}
                modEnabled={modEnabled}
                allFields={allFields}
                setFields={setFields}
                addToast={addToast}
                setRagDebugField={setRagDebugField}
              />
            </div>
          );
        })}
      </div>
    </div>
    </>
  );
}

/** Virtualized Diff View */
const VirtualFieldCardRow = memo(({
  field,
  updateField,
  retranslateField,
  applyModToField,
  phase,
  t,
  modEnabled,
  allFields,
  setFields,
  addToast,
}: {
  field: any;
  updateField: any;
  retranslateField: any;
  applyModToField: any;
  phase: string;
  t: Record<string, string>;
  modEnabled: boolean;
  allFields: any[];
  setFields: any;
  addToast: any;
}) => {
  const ui = useUi();
  const handleRowCheckboxChange = (field: any, checked: boolean) => {
    if (checked) {
      const nextStatus = field.translated?.trim() ? 'done' : 'pending';
      updateField(field.path, { status: nextStatus });
    } else {
      updateField(field.path, { status: 'ignored' });
    }
  };

  return (
    <div
      style={{
        padding: '12px',
        background: 'var(--bg-primary)',
        borderRadius: 'var(--radius-md)',
        border: `1px solid ${field.status === 'error' ? 'var(--accent-danger)' : 'var(--border-subtle)'}`,
        opacity: field.status === 'ignored' ? 0.5 : 1,
        transition: 'opacity 0.2s ease',
      }}
    >
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: '8px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
            <label className="checkbox-wrapper" style={{ cursor: phase === 'translating' ? 'not-allowed' : 'pointer' }}>
              <input
                type="checkbox"
                checked={field.status !== 'ignored'}
                onChange={(e) => handleRowCheckboxChange(field, e.target.checked)}
                disabled={phase === 'translating'}
              />
            </label>
            {(() => {
              const baseKey = getFieldBaseKey(field.path);
              // (bug 39) O(1) qua cache thay vì filter 605 field mỗi hàng mỗi render.
              if ((getBaseKeyCounts(allFields).get(baseKey) || 0) <= 1) return null;
              return (
                <button
                  className="btn btn-ghost tooltip"
                  data-tooltip={fmt(ui.feApplyAllTitle, { key: baseKey })}
                  onClick={() => {
                    const targetStatus = field.status;
                    const nextFields = allFields.map(f => {
                      if (getFieldBaseKey(f.path) === baseKey) {
                        if (targetStatus === 'ignored') {
                          return { ...f, status: 'ignored' as const };
                        } else {
                          const activeStatus = f.translated?.trim() ? 'done' as const : 'pending' as const;
                          return { ...f, status: activeStatus };
                        }
                      }
                      return f;
                    });
                    setFields(nextFields);
                    addToast('success', fmt(ui.feApplyAllToast, { key: baseKey }));
                  }}
                  disabled={phase === 'translating'}
                  style={{ padding: '2px', height: '18px', width: '18px', minHeight: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-primary)', opacity: 0.8 }}
                  title={fmt(ui.feApplyAllTitle, { key: baseKey })}
                >
                  <Zap size={10} />
                </button>
              );
            })()}
          </div>
          <span style={{
            fontWeight: 600,
            fontSize: '0.8rem',
            textDecoration: field.status === 'ignored' ? 'line-through' : 'none',
            color: field.status === 'ignored' ? 'var(--text-muted)' : 'var(--text-primary)',
          }}>
            {field.label}
          </span>
          {field.entryType === 'json_patch' && (
            <span style={{ fontSize: '0.55rem', padding: '1px 4px', background: 'rgba(236,72,153,0.1)', color: '#f472b6', borderRadius: '3px', fontWeight: 600 }}>PATCH</span>
          )}
          <StatusBadge status={field.status} t={t} />
          <CharRatio original={field.original} translated={field.translated} />
        </div>
        <div style={{ display: 'flex', gap: '4px' }}>
          <button
            className="btn btn-ghost btn-xs tooltip"
            data-tooltip={t.ignored}
            onClick={() => updateField(field.path, { status: field.status === 'ignored' ? 'pending' : 'ignored' })}
            disabled={phase === 'translating'}
            style={{ padding: '3px 6px' }}
          >
            {field.status === 'ignored' ? <RotateCcw size={12} /> : <Ban size={12} />}
          </button>
          {modEnabled ? (
            <>
              <button
                className="btn btn-ghost btn-xs tooltip"
                data-tooltip={t.modField}
                onClick={() => applyModToField(field.path)}
                disabled={phase === 'translating'}
                style={{ padding: '3px 6px', color: '#9b59b6' }}
              >
                <Wand2 size={12} />
              </button>
              <button
                className="btn btn-ghost btn-xs tooltip"
                data-tooltip={t.retranslate}
                onClick={() => retranslateField(field.path)}
                disabled={phase === 'translating'}
                style={{ padding: '3px 6px', opacity: 0.5 }}
              >
                <RotateCcw size={12} />
              </button>
            </>
          ) : (
            <button
              className="btn btn-ghost btn-xs tooltip"
              data-tooltip={t.retranslate}
              onClick={() => retranslateField(field.path)}
              disabled={phase === 'translating'}
              style={{ padding: '3px 6px' }}
            >
              <RotateCcw size={12} />
            </button>
          )}
        </div>
      </div>
      <DiffView original={field.original} translated={field.translated} />
      {/* Show HTML preview toggle for regex fields */}
      {field.group === 'regex' && field.path.includes('replaceString') && field.translated && (
        <HtmlPreviewToggle html={field.translated} />
      )}
      {/* Show Regex Simulator toggle for findRegex fields */}
      {field.group === 'regex' && field.path.includes('findRegex') && (
        <RegexSimulatorToggle regexStr={field.translated || field.original} />
      )}
      {field.error && (
        <div title={field.error} style={{ fontSize: '0.65rem', color: 'var(--accent-danger)', marginTop: '6px', wordBreak: 'break-word', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {field.error}
        </div>
      )}
      <ChunkStatusAndResume
        field={field}
        retranslateField={retranslateField}
        phase={phase}
      />
    </div>
  );
});

/** Virtualized Diff View */
function VirtualDiffView({
  fields,
  updateField,
  retranslateField,
  applyModToField,
  phase,
  t,
  modEnabled,
  scrollToPath,
  highlightPath,
}: {
  fields: any[];
  updateField: (path: string, update: any) => void;
  retranslateField: (path: string) => void;
  applyModToField: (path: string) => void;
  phase: string;
  t: Record<string, string>;
  modEnabled: boolean;
  scrollToPath?: string | null;
  highlightPath?: string | null;
}) {
  // (bugNeedFix/39) selector hẹp + throttle allFields — 2 view bảng này mount suốt lúc dịch.
  const setFields = useStore((s) => s.setFields);
  const allFields = useThrottledStore((s) => s.fields, 200);
  const addToast = useStore((s) => s.addToast);
  const parentRef = useRef<HTMLDivElement>(null);
  const headerCheckboxRef = useRef<HTMLInputElement>(null);

  const activeFields = useMemo(() => fields.filter(f => f.status !== 'translating'), [fields]);
  const allChecked = useMemo(() => {
    if (activeFields.length === 0) return false;
    return activeFields.every(f => f.status !== 'ignored');
  }, [activeFields]);

  const someChecked = useMemo(() => {
    return activeFields.some(f => f.status !== 'ignored');
  }, [activeFields]);

  const isIndeterminate = someChecked && !allChecked;

  useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = isIndeterminate;
    }
  }, [isIndeterminate]);

  const handleHeaderCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const checked = e.target.checked;
    const targetPaths = new Set(activeFields.map(f => f.path));
    const nextFields = allFields.map(f => {
      if (targetPaths.has(f.path)) {
        if (checked) {
          if (f.status === 'ignored') {
            const nextStatus: TranslationStatus = f.translated?.trim() ? 'done' : 'pending';
            return { ...f, status: nextStatus };
          }
        } else {
          if (f.status !== 'ignored') {
            const nextStatus: TranslationStatus = 'ignored';
            return { ...f, status: nextStatus };
          }
        }
      }
      return f;
    });
    setFields(nextFields);
  };

  const estimateCardHeight = useCallback((index: number) => {
    const field = fields[index];
    if (!field) return 160;

    let height = 48; // header + padding + margins

    if (!field.translated) {
      height += 24; // "No translation" message
    } else {
      // Original diff panel height
      const origText = field.original.length > 800 ? field.original.slice(0, 800) : field.original;
      const origLines = origText.split('\n').length;
      const origHeight = Math.min(origLines * 16 + 20, 200);

      // Translated diff panel height
      const transText = field.translated.length > 800 ? field.translated.slice(0, 800) : field.translated;
      const transLines = transText.split('\n').length;
      const transHeight = Math.min(transLines * 16 + 20, 200);

      height += origHeight + transHeight + 6; // panels + gap
    }

    // HTML Preview toggle space
    const isRegexReplace = field.group === 'regex' && field.path.includes('replaceString') && field.translated;
    if (isRegexReplace) {
      height += 24;
    }

    // Regex Simulator toggle space
    const isRegexFind = field.group === 'regex' && field.path.includes('findRegex');
    if (isRegexFind) {
      height += 24;
    }

    // Error message space
    if (field.error) {
      height += 24;
    }

    // Chunk status space
    const isChunked = field.original.length > 100000 || field.totalChunks > 1 || (field.completedChunks && field.completedChunks.length > 0);
    if (isChunked) {
      height += 32;
    }

    return Math.max(height, 100);
  }, [fields]);

  const virtualizer = useVirtualizer({
    count: fields.length,
    getScrollElement: () => parentRef.current,
    estimateSize: estimateCardHeight,
    overscan: 5,
  });

  // "Nhảy tới trường": cuộn tới đúng thẻ trong chế độ Diff.
  useEffect(() => {
    if (!scrollToPath) return;
    const idx = fields.findIndex((f) => f.path === scrollToPath);
    if (idx >= 0) virtualizer.scrollToIndex(idx, { align: 'center' });
  }, [scrollToPath, fields, virtualizer]);

  // (Bug UI 2026) Như bảng chính: đổi ĐỘ DÀI danh sách → measure() lại để tổng chiều cao spacer đúng.
  const prevLenRef = useRef(fields.length);
  useEffect(() => {
    if (prevLenRef.current !== fields.length) {
      prevLenRef.current = fields.length;
      virtualizer.measure();
    }
  }, [fields.length, virtualizer]);

  return (
    <div
      ref={parentRef}
      style={{ padding: '12px 20px', maxHeight: '700px', overflowY: 'auto' }}
    >
      {/* Bulk selection header for Diff View */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '0 8px 12px 8px',
        borderBottom: '1px solid var(--border-subtle)',
        marginBottom: '12px',
      }}>
        <label className="checkbox-wrapper" style={{ display: 'inline-flex', cursor: phase === 'translating' ? 'not-allowed' : 'pointer' }}>
          <input
            type="checkbox"
            ref={headerCheckboxRef}
            checked={allChecked}
            onChange={handleHeaderCheckboxChange}
            disabled={phase === 'translating' || activeFields.length === 0}
          />
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
            {allChecked ? 'Deselect All' : 'Select All'}
          </span>
        </label>
      </div>

      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const field = fields[virtualRow.index];
          const isJumpHighlight = !!highlightPath && field.path === highlightPath;
          return (
            <div
              // (Bug UI 2026) key kèm index — chống React vứt row khi 2 field trùng path (xem bảng chính).
              key={`${virtualRow.index}:${field.path}`}
              ref={virtualizer.measureElement}
              data-index={virtualRow.index}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
                paddingBottom: '8px',
                willChange: 'transform',
                outline: isJumpHighlight ? '2px solid var(--accent-primary)' : undefined,
                outlineOffset: isJumpHighlight ? '-2px' : undefined,
                borderRadius: isJumpHighlight ? 'var(--radius-sm)' : undefined,
                background: isJumpHighlight ? 'rgba(124,106,240,0.10)' : undefined,
              }}
            >
              <VirtualFieldCardRow
                field={field}
                updateField={updateField}
                retranslateField={retranslateField}
                applyModToField={applyModToField}
                phase={phase}
                t={t}
                modEnabled={modEnabled}
                allFields={allFields}
                setFields={setFields}
                addToast={addToast}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function FieldEditor() {
  // (bugNeedFix/39) `fields` THROTTLE 150ms + selector hẹp phần còn lại. Trước đây subscribe toàn
  // store: burst dịch (560+ set()) → re-render + lọc/đếm 605 field + reconcile bảng ảo hoá MỖI set();
  // nếu ô Tìm có chữ còn thêm toLowerCase trên ~5MB text mỗi lần ⇒ góp phần treo luồng So sánh.
  const fields = useThrottledStore((s) => s.fields, 150);
  const updateField = useStore((s) => s.updateField);
  const phase = useStore((s) => s.phase);
  const translationConfig = useStore((s) => s.translationConfig);
  const jumpToFieldPath = useStore((s) => s.jumpToFieldPath);
  const setJumpToFieldPath = useStore((s) => s.setJumpToFieldPath);
  const { retranslateField, applyModToField, retranslateSkipped } = useTranslation();
  const t = useT();
  const modEnabled = Boolean(translationConfig.enableModMode && translationConfig.modInstructions?.trim());
  const tabLabels = useTabLabels();
  const [activeTab, setActiveTab] = useState<FieldGroup | 'all'>('all');
  const [viewMode, setViewMode] = useState<'table' | 'diff'>('table');
  const [searchQuery, setSearchQuery] = useState('');
  /**
   * (bugNeedFix/176) LỌC THEO TRẠNG THÁI.
   * User: "thêm cơ chế kiểu lọc cho mình xem bao nhiêu mục bỏ qua để chọn tất cả cái bỏ qua dịch
   * lại nhanh, lỗi bỏ qua gần trăm trường dịch."
   * Trước đây bảng chỉ lọc theo NHÓM (Core/Lorebook/Keys…) và ô tìm chữ. Muốn biết có bao nhiêu
   * mục bị bỏ qua thì phải cuộn hết 1104 dòng đếm bằng mắt, và muốn dịch lại thì phải bấm từng cái.
   */
  const [statusFilter, setStatusFilter] = useState<'all' | TranslationStatus>('all');
  const [bulkRunning, setBulkRunning] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [jumpPath, setJumpPath] = useState<string | null>(null);

  // "Nhảy tới trường" từ bảng Sức khoẻ thẻ — chỉ xử lý trường THƯỜNG (không phải regex; regex do
  // RegexManagerPanel lo). Đặt đúng tab + xoá ô Tìm để trường hiện, cuộn bảng vào tầm nhìn, rồi
  // báo child cuộn tới + highlight.
  useEffect(() => {
    if (!jumpToFieldPath) return;
    if (jumpToFieldPath.includes('regex_scripts[')) return; // trường regex → panel khác xử lý
    const target = fields.find((f) => f.path === jumpToFieldPath);
    if (!target) { setJumpToFieldPath(null); return; }
    setActiveTab(target.group as FieldGroup);
    setSearchQuery('');
    setJumpPath(jumpToFieldPath);
    setJumpToFieldPath(null);
    requestAnimationFrame(() => containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }, [jumpToFieldPath, fields, setJumpToFieldPath]);

  // Tự tắt highlight sau ~2.6s.
  useEffect(() => {
    if (!jumpPath) return;
    const id = setTimeout(() => setJumpPath(null), 2600);
    return () => clearTimeout(id);
  }, [jumpPath]);

  /** Tập field sau khi lọc theo TAB + Ô TÌM (chưa lọc trạng thái) — dùng để đếm chip. */
  const scopedFields = useMemo(() => {
    let result = activeTab === 'all'
      ? fields.filter((f) => f.group !== 'regex')
      : fields.filter((f) => f.group === activeTab);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (f) =>
          f.label.toLowerCase().includes(q) ||
          f.original.toLowerCase().includes(q) ||
          f.translated.toLowerCase().includes(q) ||
          f.path.toLowerCase().includes(q)
      );
    }
    return result;
  }, [fields, activeTab, searchQuery]);

  // (bugNeedFix/176) Đếm theo TRẠNG THÁI trong phạm vi đang xem.
  const statusCounts = useMemo(() => {
    const c: Record<string, number> = { all: scopedFields.length, skipped: 0, error: 0, pending: 0, done: 0, ignored: 0 };
    for (const f of scopedFields) if (f.status in c) c[f.status]++;
    return c;
  }, [scopedFields]);

  const filteredFields = useMemo(
    () => (statusFilter === 'all' ? scopedFields : scopedFields.filter(f => f.status === statusFilter)),
    [scopedFields, statusFilter],
  );

  // Count fields per tab
  const tabCounts = useMemo(() => {
    const counts: Record<string, number> = { all: fields.filter(f => f.group !== 'regex').length };
    for (const f of fields) {
      if (f.group !== 'regex') {
        counts[f.group] = (counts[f.group] || 0) + 1;
      }
    }
    return counts;
  }, [fields]);

  if (fields.length === 0) return null;

  return (
    <div ref={containerRef} className="card fade-in" style={{ overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '16px 20px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            {modEnabled && (
              <Wand2 size={16} style={{ color: '#9b59b6' }} />
            )}
            {modEnabled ? t.modFieldEditor : t.fieldEditor}
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 400 }}>
              ({filteredFields.length} {t.fields})
            </span>
          </h3>
          {/* Search box */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            background: 'var(--bg-primary)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-sm)',
            padding: '4px 10px',
            flex: '0 1 260px',
            minWidth: '160px',
            transition: 'border-color 0.2s',
          }}>
            <Search size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t.search}
              style={{
                flex: 1,
                border: 'none',
                background: 'transparent',
                color: 'var(--text-primary)',
                fontSize: '0.8rem',
                outline: 'none',
                padding: '2px 0',
                minWidth: 0,
              }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-muted)',
                  padding: 0,
                  display: 'flex',
                  flexShrink: 0,
                }}
              >
                <X size={14} />
              </button>
            )}
          </div>
          {/* View mode toggle */}
          <div style={{
            display: 'flex', gap: '2px',
            background: 'var(--bg-primary)',
            borderRadius: 'var(--radius-sm)',
            padding: '2px',
            border: '1px solid var(--border-subtle)',
          }}>
            <button
              onClick={() => setViewMode('table')}
              style={{
                padding: '3px 8px',
                fontSize: '0.7rem',
                fontWeight: viewMode === 'table' ? 600 : 400,
                background: viewMode === 'table' ? 'rgba(124,106,240,0.12)' : 'transparent',
                color: viewMode === 'table' ? 'var(--accent-primary)' : 'var(--text-muted)',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {t.viewTable}
            </button>
            <button
              onClick={() => setViewMode('diff')}
              style={{
                padding: '3px 8px',
                fontSize: '0.7rem',
                fontWeight: viewMode === 'diff' ? 600 : 400,
                background: viewMode === 'diff' ? 'rgba(124,106,240,0.12)' : 'transparent',
                color: viewMode === 'diff' ? 'var(--accent-primary)' : 'var(--text-muted)',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                transition: 'all 0.15s',
                display: 'flex',
                alignItems: 'center',
                gap: '3px',
              }}
            >
              <ArrowLeftRight size={11} />
              {t.viewDiff}
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="tabs" style={{ overflowX: 'auto' }}>
          {TAB_IDS.map((tabId) => {
            const count = tabCounts[tabId] || 0;
            if (tabId !== 'all' && count === 0) return null;
            return (
              <button
                key={tabId}
                className={`tab ${activeTab === tabId ? 'tab-active' : ''}`}
                onClick={() => setActiveTab(tabId)}
              >
                {tabLabels[tabId] || tabId}
                {count > 0 && (
                  <span style={{ opacity: 0.7, marginLeft: '4px', fontSize: '0.7rem' }}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* ═══ (bugNeedFix/176) LỌC THEO TRẠNG THÁI + DỊCH LẠI HÀNG LOẠT ═══
            Chip nào có 0 mục thì ẩn, để dải này không phình ra vô ích. Bấm chip đang chọn lần nữa
            là bỏ lọc. Khi lọc đang ra một tập ĐANG CẦN DỊCH LẠI (bỏ qua / lỗi / chưa dịch) thì
            hiện luôn nút dịch lại CẢ TẬP ĐANG THẤY — nghĩa là nó tôn trọng cả tab và ô tìm, muốn
            dịch lại riêng Lorebook thì chọn tab Lorebook rồi bấm. */}
        {statusCounts.all > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap', padding: '8px 0 2px' }}>
            <Filter size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            {STATUS_CHIPS.map(chip => {
              const n = statusCounts[chip.id] || 0;
              if (chip.id !== 'all' && n === 0) return null;
              const active = statusFilter === chip.id;
              return (
                <button
                  key={chip.id}
                  onClick={() => setStatusFilter(active && chip.id !== 'all' ? 'all' : chip.id)}
                  title={chip.hint}
                  style={{
                    fontSize: '0.68rem', fontWeight: active ? 700 : 500, padding: '2px 8px',
                    borderRadius: '999px', cursor: 'pointer',
                    border: `1px solid ${active ? chip.color : 'var(--border-subtle)'}`,
                    background: active ? `${chip.color}22` : 'transparent',
                    color: active ? chip.color : 'var(--text-secondary)',
                  }}
                >{chip.icon} {chip.label} {n}</button>
              );
            })}

            {RETRANSLATABLE.has(statusFilter) && filteredFields.length > 0 && (
              <button
                disabled={bulkRunning || phase === 'translating'}
                onClick={async () => {
                  const paths = filteredFields.map(f => f.path);
                  setBulkRunning(true);
                  try { await retranslateSkipped(paths); } finally { setBulkRunning(false); }
                }}
                title={`Dịch lại toàn bộ ${filteredFields.length} mục đang hiện — chạy đa luồng theo đúng ngân sách RPM của bạn.\n`
                  + 'Với mục "Bỏ qua": bộ dò ngôn ngữ đã tưởng nhầm là không cần dịch, lần này sẽ ép dịch.'}
                style={{
                  marginLeft: 'auto', fontSize: '0.7rem', fontWeight: 600, padding: '3px 10px',
                  borderRadius: 'var(--radius-sm)', cursor: bulkRunning ? 'wait' : 'pointer',
                  border: '1px solid var(--accent-primary)', background: 'rgba(124,106,240,0.12)',
                  color: 'var(--accent-primary)',
                  opacity: bulkRunning || phase === 'translating' ? 0.5 : 1,
                }}
              >
                {bulkRunning ? '⏳ Đang dịch lại…' : `🔁 Dịch lại tất cả ${filteredFields.length} mục đang hiện`}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Virtualized Diff View */}
      {viewMode === 'diff' && (
        <VirtualDiffView
          fields={filteredFields}
          updateField={updateField}
          retranslateField={retranslateField}
          applyModToField={applyModToField}
          phase={phase}
          t={t}
          modEnabled={modEnabled}
          scrollToPath={jumpPath}
          highlightPath={jumpPath}
        />
      )}

      {/* Virtualized Table View */}
      {viewMode === 'table' && (
        <VirtualTableView
          fields={filteredFields}
          updateField={updateField}
          retranslateField={retranslateField}
          applyModToField={applyModToField}
          phase={phase}
          t={t}
          modEnabled={modEnabled}
          scrollToPath={jumpPath}
          highlightPath={jumpPath}
        />
      )}
    </div>
  );
}

/** Status badge mini-component */
function StatusBadge({ status, t }: { status: string; t: Record<string, string> }) {
  const ui = useUi();
  if (status === 'done') {
    return (
      <span className="badge badge-success" style={{ fontSize: '0.65rem' }}>
        <CheckCircle2 size={8} /> {t.done}
      </span>
    );
  }
  if (status === 'skipped') {
    return (
      <span className="badge badge-warning" style={{ fontSize: '0.65rem', background: 'var(--accent-warning)', color: '#fff', border: 'none' }}>
        <CheckCircle2 size={8} /> {ui.feSkip}
      </span>
    );
  }
  if (status === 'ignored') {
    return (
      <span className="badge badge-neutral" style={{ fontSize: '0.65rem', background: 'var(--bg-secondary)', color: 'var(--text-muted)' }}>
        <Ban size={8} /> {t.ignored || ui.feIgnoreFallback}
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span className="badge badge-danger" style={{ fontSize: '0.65rem' }}>
        <AlertTriangle size={8} /> {t.error}
      </span>
    );
  }
  if (status === 'pending') {
    return (
      <span className="badge badge-neutral" style={{ fontSize: '0.65rem' }}>
        <Clock size={8} /> Pending
      </span>
    );
  }
  if (status === 'translating') {
    return (
      <span className="badge badge-warning" style={{ fontSize: '0.65rem' }}>
        Translating...
      </span>
    );
  }
  return null;
}
