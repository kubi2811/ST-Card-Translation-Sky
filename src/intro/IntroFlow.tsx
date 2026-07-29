/**
 * src/intro/IntroFlow.tsx — (bug 148-1) APP "GIỚI THIỆU".
 * ─────────────────────────────────────────────────────────────────────────────
 * User: gộp hai thứ đang nằm lạc chỗ về MỘT nơi, đặt nổi bật trên thanh điều hướng:
 *   • "Chọn phiên bản" — trước ở app Dịch Card (bug 146), nay chuyển hẳn sang đây, THÊM khả
 *     năng phân loại mỗi bản thuộc app nào (xem utils/versionApps.ts — đọc scope commit).
 *   • "Tài liệu Hướng Dẫn Sử Dụng" — trước nằm trong app Tạo Card, nay chuyển hẳn sang đây.
 * Và bỏ mọi đường đổi phiên bản rải rác ở app khác (2 mũi tên lên/xuống trong Tạo Card, mục
 * Chọn phiên bản trong Dịch Card) — "không còn thao tác đổi version rải rác ở app khác nữa".
 *
 * Tài liệu KẾ THỪA cơ chế tự cập nhật của bug 146: phần "Có gì mới" dựng THẲNG từ danh sách
 * commit thật của repo, nên mỗi lần cập nhật là tài liệu tự nói đúng bản đang chạy — không ai
 * phải sửa tay file hướng dẫn.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { History, BookOpen, Loader2, Check, ArrowUpCircle, ChevronDown, ChevronUp, Sparkles } from 'lucide-react';
import { APP_VERSION } from '../version';
import { FLOWS } from '../flows';
// (bug 157) Tài liệu THẬT nằm trong USER_GUIDE.md ở gốc repo — sửa tài liệu không phải sửa code,
// và mỗi lần thêm tính năng/sửa lỗi thì cập nhật đúng một file.
import guideMd from '../../USER_GUIDE.md?raw';
import { renderGuide, extractHeadings, filterGuide } from './guideMarkdown';
import {
  APP_TAGS, classifyCommitApps, countByApp, filterByApp, stripConventionalPrefix,
  type AppId,
} from '../utils/versionApps';

interface VersionRow {
  sha: string; short: string; date: string; author: string;
  subject: string; body: string; current: boolean;
}

export default function IntroFlow() {
  const [tab, setTab] = useState<'version' | 'guide'>('version');

  return (
    <div style={{ padding: '18px 20px', maxWidth: 1080, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <Sparkles size={20} style={{ color: 'var(--accent-primary)' }} />
        <h1 style={{ fontSize: '1.15rem', fontWeight: 800, margin: 0 }}>SillyTavern Multi Tools</h1>
        <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: 999, background: 'var(--bg-tertiary,#22222e)', color: 'var(--text-muted)' }}>
          v{APP_VERSION}
        </span>
      </div>
      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0 0 14px' }}>
        Bộ công cụ dịch, tạo và chỉnh sửa thẻ nhân vật cho SillyTavern — {FLOWS.length} app dùng chung một bản cài.
        Mọi thao tác đổi phiên bản và tài liệu hướng dẫn đều nằm ở đây.
      </p>

      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        <TabButton active={tab === 'version'} onClick={() => setTab('version')} icon={<History size={14} />} label="Chọn phiên bản" />
        <TabButton active={tab === 'guide'} onClick={() => setTab('guide')} icon={<BookOpen size={14} />} label="Hướng dẫn sử dụng" />
      </div>

      {tab === 'version' ? <VersionPanel /> : <GuidePanel />}
    </div>
  );
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 10,
      fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer',
      border: `1px solid ${active ? 'var(--accent-primary)' : 'var(--border-subtle,#2a2a3e)'}`,
      background: active ? 'color-mix(in srgb, var(--accent-primary) 15%, transparent)' : 'transparent',
      color: active ? 'var(--accent-primary)' : 'var(--text-muted)',
    }}>{icon}{label}</button>
  );
}

/* ═══════════════════ TAB 1 — CHỌN PHIÊN BẢN (chuyển từ Dịch Card) ═══════════════════ */

function VersionPanel() {
  const [rows, setRows] = useState<VersionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [app, setApp] = useState<AppId | null>(null);
  // (bug 157) Mở NHIỀU log cùng lúc — trước đây là một sha duy nhất nên mở bản này là bản kia
  // tự đóng, không đối chiếu hai phiên bản cạnh nhau được.
  const [openLogs, setOpenLogs] = useState<Set<string>>(() => new Set());
  const toggleLog = (sha: string) => setOpenLogs((prev) => {
    const next = new Set(prev);
    if (next.has(sha)) next.delete(sha); else next.add(sha);
    return next;
  });
  const [busySha, setBusySha] = useState<string | null>(null);
  const [result, setResult] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const r = await fetch('/api/versions');
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'Không đọc được danh sách phiên bản.');
      setRows(j.versions as VersionRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => countByApp(rows), [rows]);
  const shown = useMemo(() => filterByApp(rows, app), [rows, app]);

  const switchTo = async (row: VersionRow) => {
    if (!confirm(`Chuyển sang phiên bản ${row.short} — "${stripConventionalPrefix(row.subject)}"?\n\nMọi app sẽ dùng bản này (cài lại thư viện nếu cần).`)) return;
    setBusySha(row.sha); setResult('');
    try {
      // Dùng CHÍNH endpoint mà nút phiên bản cũ dùng (bug 146) — chuyển chỗ đặt nút,
      // không đổi cách chạy: server `git checkout` rồi cài lại thư viện cho cả monorepo.
      const r = await fetch(`/api/goto?ref=${encodeURIComponent(row.sha)}`, { method: 'POST' });
      const j = await r.json();
      setResult(j?.success
        ? `✅ Đã chuyển sang ${row.short}. Tải lại trang (F5) để dùng bản mới.`
        : `❌ ${j?.error || j?.message || 'Không chuyển được.'}`);
      if (j?.success) void load();
    } catch (e) {
      setResult(`❌ ${e instanceof Error ? e.message : String(e)}`);
    } finally { setBusySha(null); }
  };

  return (
    <div>
      {/* Bộ lọc theo APP — phần user yêu cầu thêm */}
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 10 }}>
        <FilterChip active={app === null} onClick={() => setApp(null)} label={`Tất cả (${rows.length})`} />
        {[...counts.entries()].sort((a, b) => b[1] - a[1]).map(([id, n]) => (
          <FilterChip key={id} active={app === id} onClick={() => setApp(id)} label={`${APP_TAGS[id].emoji} ${APP_TAGS[id].label} (${n})`} />
        ))}
      </div>

      {loading && <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}><Loader2 size={14} className="animate-spin" style={{ verticalAlign: -2 }} /> Đang đọc danh sách phiên bản từ GitHub…</p>}
      {error && <p style={{ fontSize: '0.8rem', color: '#f87171' }}>{error}</p>}
      {result && <p style={{ fontSize: '0.8rem', margin: '6px 0' }}>{result}</p>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {shown.map(row => {
          const apps = classifyCommitApps(row.subject);
          return (
            <div key={row.sha} style={{
              border: `1px solid ${row.current ? 'var(--accent-primary)' : 'var(--border-subtle,#2a2a3e)'}`,
              borderRadius: 10, padding: '8px 10px',
              background: row.current ? 'color-mix(in srgb, var(--accent-primary) 8%, transparent)' : 'transparent',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {row.current && <span style={{ fontSize: '0.65rem', color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', gap: 3 }}><Check size={11} />đang dùng</span>}
                {apps.map(id => (
                  <span key={id} style={{ fontSize: '0.62rem', padding: '1px 7px', borderRadius: 999, background: 'var(--bg-tertiary,#22222e)', color: 'var(--text-muted)' }}>
                    {APP_TAGS[id].emoji} {APP_TAGS[id].label}
                  </span>
                ))}
                <span style={{ fontSize: '0.78rem', flex: 1, minWidth: 200 }}>{stripConventionalPrefix(row.subject)}</span>
                <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{row.short} · {row.date}</span>
                <button onClick={() => toggleLog(row.sha)}
                  style={chipBtn}>{openLogs.has(row.sha) ? <ChevronUp size={11} /> : <ChevronDown size={11} />} Log</button>
                {!row.current && (
                  <button onClick={() => switchTo(row)} disabled={busySha !== null}
                    style={{ ...chipBtn, color: 'var(--accent-primary)', borderColor: 'var(--accent-primary)' }}>
                    {busySha === row.sha ? <Loader2 size={11} className="animate-spin" /> : <ArrowUpCircle size={11} />} Dùng bản này
                  </button>
                )}
              </div>
              {openLogs.has(row.sha) && (
                <pre style={{
                  marginTop: 6, fontSize: '0.68rem', whiteSpace: 'pre-wrap', maxHeight: 260, overflow: 'auto',
                  background: 'var(--bg-primary,#0f0f16)', padding: 8, borderRadius: 6, color: 'var(--text-muted)',
                }}>{row.body?.trim() || row.subject}</pre>
              )}
            </div>
          );
        })}
        {!loading && shown.length === 0 && (
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Không có phiên bản nào thuộc mục đã lọc.</p>
        )}
      </div>
    </div>
  );
}

const chipBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 3, fontSize: '0.65rem', padding: '2px 8px',
  borderRadius: 6, border: '1px solid var(--border-subtle,#2a2a3e)', background: 'transparent',
  color: 'var(--text-muted)', cursor: 'pointer',
};

function FilterChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} style={{
      fontSize: '0.68rem', padding: '3px 10px', borderRadius: 999, cursor: 'pointer',
      border: `1px solid ${active ? 'var(--accent-primary)' : 'var(--border-subtle,#2a2a3e)'}`,
      background: active ? 'color-mix(in srgb, var(--accent-primary) 15%, transparent)' : 'transparent',
      color: active ? 'var(--accent-primary)' : 'var(--text-muted)',
    }}>{label}</button>
  );
}

/* ═══════════════════ TAB 2 — HƯỚNG DẪN (chuyển từ Tạo Card) ═══════════════════ */


function GuidePanel() {
  const [commits, setCommits] = useState<VersionRow[]>([]);
  const [q, setQ] = useState('');
  // Mục lục dựng từ TOÀN BỘ tài liệu (không theo bộ lọc) để tìm xong vẫn nhảy về chỗ khác được.
  const headings = useMemo(() => extractHeadings(guideMd), []);
  const guideHtml = useMemo(() => renderGuide(filterGuide(guideMd, q)), [q]);
  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch('/api/versions');
        const j = await r.json();
        if (j?.ok) setCommits((j.versions as VersionRow[]).slice(0, 12));
      } catch { /* không có git thì phần "Có gì mới" ẩn đi, hướng dẫn vẫn đủ dùng */ }
    })();
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* (bug 157) BẢNG HƯỚNG DẪN CHI TIẾT — trước đây mỗi app chỉ một dòng, không đủ để làm theo.
          Nội dung lấy từ USER_GUIDE.md ở gốc repo: mục lục bên trái, ô tìm kiếm lọc theo MỤC
          (một dòng lẻ tách khỏi tiêu đề của nó thì đọc không hiểu gì). */}
      <section>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <h2 style={{ ...sectionH, margin: 0 }}>Hướng dẫn sử dụng</h2>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Tìm trong hướng dẫn…"
            style={{
              marginLeft: 'auto', fontSize: '0.72rem', padding: '4px 10px', borderRadius: 8, minWidth: 200,
              border: '1px solid var(--border-subtle,#2a2a3e)', background: 'transparent', color: 'inherit',
            }} />
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <nav style={{ width: 210, flexShrink: 0, position: 'sticky', top: 0, maxHeight: '70vh', overflow: 'auto' }}>
            {headings.map(h => (
              <button key={h.id} onClick={() => document.getElementById(`guide-${h.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer', background: 'transparent',
                  border: 'none', color: h.level === 1 ? 'var(--text-primary)' : 'var(--text-muted)',
                  fontSize: h.level === 1 ? '0.74rem' : '0.7rem', fontWeight: h.level === 1 ? 700 : 400,
                  padding: `2px 4px 2px ${(h.level - 1) * 10 + 4}px`, lineHeight: 1.5,
                }}>{h.text}</button>
            ))}
          </nav>
          <div style={{ flex: 1, minWidth: 0, maxHeight: '70vh', overflow: 'auto' }}
            className="intro-guide"
            dangerouslySetInnerHTML={{ __html: guideHtml }} />
        </div>
        {q.trim() && !guideHtml && (
          <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>Không có mục nào khớp “{q}”.</p>
        )}
      </section>

      {/* (bug 146) Tài liệu TỰ CẬP NHẬT: phần này dựng thẳng từ commit thật của repo. */}
      {commits.length > 0 && (
        <section>
          <h2 style={sectionH}>Có gì mới (tự cập nhật theo phiên bản)</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {commits.map(c => (
              <div key={c.sha} style={{ fontSize: '0.74rem', display: 'flex', gap: 6, alignItems: 'baseline' }}>
                {classifyCommitApps(c.subject).map(id => (
                  <span key={id} style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>{APP_TAGS[id].emoji}</span>
                ))}
                <span style={{ flex: 1 }}>{stripConventionalPrefix(c.subject)}</span>
                <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{c.date}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

const sectionH: React.CSSProperties = { fontSize: '0.85rem', fontWeight: 700, margin: '0 0 6px' };
