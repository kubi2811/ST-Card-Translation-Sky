/**
 * UpdateButton — (bugNeedFix/146) MỘT nút phiên bản thay cho hai mũi tên lên/xuống.
 * ─────────────────────────────────────────────────────────────────────────────
 * User: "Gộp 2 nút mũi tên lên/xuống (cập nhật và hạ bản) thành 1 nút chung vì hạ từng bản rất
 * cực. Khi bấm vào sẽ hiện danh sách tất cả các phiên bản từ trước tới nay để chọn phiên bản.
 * Bên cạnh mỗi phiên bản có thêm nút 'Log' để xem thông tin update, để mọi người có thể dùng dễ
 * dàng hơn và xem được log khi cậu Sky bận không tag lên Discord được."
 *
 * Vì sao bản cũ cực: "hạ cấp" chạy `git reset --hard HEAD~1` — lùi ĐÚNG MỘT bản mỗi lần, mà mỗi
 * lần lại cài lại thư viện cho cả monorepo. Muốn về bản của tuần trước thì bấm chục lần, và
 * không có cách nào biết mình đang ở đâu hay bản nào sửa cái gì.
 *
 * Nay: một nút mở danh sách 60 bản gần nhất (server đã `git fetch` nên thấy cả bản MỚI HƠN bản
 * đang dùng — không có bước đó thì hạ cấp xong sẽ không còn đường quay lại). Mỗi dòng có nút
 * "Log" mở nguyên nội dung commit tại chỗ, và nút chuyển thẳng tới đúng bản đó bằng một lần bấm.
 */
import { useState, useCallback } from 'react';
import { X, History, Loader2, ChevronDown, ChevronUp, Check, ArrowUpCircle } from 'lucide-react';
import { useUi } from '../i18n/useLocale';

interface VersionRow {
  sha: string;
  short: string;
  date: string;
  author: string;
  subject: string;
  body: string;
  current: boolean;
}

export default function UpdateButton() {
  const ui = useUi();
  const [listOpen, setListOpen] = useState(false);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState('');
  const [openLog, setOpenLog] = useState<string | null>(null);

  const [isOpen, setIsOpen] = useState(false);
  const [log, setLog] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const [modalTitle, setModalTitle] = useState('');

  const loadVersions = useCallback(async () => {
    setLoadingList(true);
    setListError('');
    try {
      const r = await fetch('/api/versions');
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'Không đọc được danh sách phiên bản.');
      setVersions(j.versions as VersionRow[]);
    } catch (e) {
      setListError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingList(false);
    }
  }, []);

  const openList = () => {
    setListOpen(true);
    if (versions.length === 0) void loadVersions();
  };

  const runCommand = async (endpoint: string, displayTitle: string) => {
    setListOpen(false);
    setIsOpen(true);
    setLog('');
    setIsUpdating(true);
    setModalTitle(displayTitle);
    try {
      const response = await fetch(endpoint, { method: 'POST' });
      if (!response.body) throw new Error('No response body');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        setLog((prev) => prev + decoder.decode(value, { stream: true }));
      }
    } catch (err) {
      setLog((prev) => prev + `\n${ui.ubErrPrefix}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsUpdating(false);
    }
  };

  const gotoVersion = (v: VersionRow) => {
    // Về bản CŨ hơn là thao tác bỏ mã nguồn mới ⇒ hỏi lại. Lên bản mới nhất thì không cần.
    const isNewest = versions[0]?.sha === v.sha;
    if (!isNewest) {
      const ok = window.confirm(
        `Chuyển sang phiên bản ${v.short} (${v.date})?\n\n${v.subject}\n\n`
        + 'Mã nguồn sẽ được đặt về đúng bản này và cài lại thư viện. '
        + 'Dữ liệu của bạn (thẻ, cache, tiến độ dịch) KHÔNG bị đụng tới.',
      );
      if (!ok) return;
    }
    void runCommand(`/api/goto?ref=${encodeURIComponent(v.sha)}`, `Chuyển sang phiên bản ${v.short}`);
  };

  const currentIdx = versions.findIndex(v => v.current);

  return (
    <>
      <button
        onClick={openList}
        title="Phiên bản: xem danh sách, đọc log, cập nhật hoặc quay về bản cũ"
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: '32px', height: '32px',
          background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-sm)', cursor: 'pointer',
          color: 'var(--accent-primary)', flexShrink: 0,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--bg-elevated)')}
      >
        <History size={16} />
      </button>

      {/* ═══ DANH SÁCH PHIÊN BẢN ═══ */}
      {listOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}
          onClick={() => setListOpen(false)}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ background: 'var(--bg-primary)', width: '92%', maxWidth: '720px', maxHeight: '80vh',
              borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)',
              display: 'flex', flexDirection: 'column', boxShadow: '0 10px 25px rgba(0,0,0,0.2)' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border-subtle)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Phiên bản</h3>
                <p style={{ margin: '2px 0 0', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                  {currentIdx === 0
                    ? 'Bạn đang dùng bản mới nhất.'
                    : currentIdx > 0
                      ? `Bạn đang ở bản cũ hơn ${currentIdx} phiên bản so với mới nhất.`
                      : 'Chọn một bản để chuyển sang. Dữ liệu của bạn không bị ảnh hưởng.'}
                </p>
              </div>
              <button onClick={() => setListOpen(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4, display: 'flex' }}>
                <X size={20} />
              </button>
            </div>

            <div style={{ overflowY: 'auto', padding: '10px 14px' }}>
              {loadingList && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '20px', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                  <Loader2 size={16} className="animate-spin" /> Đang đọc danh sách phiên bản từ GitHub…
                </div>
              )}
              {listError && (
                <p style={{ padding: '16px', fontSize: '0.8rem', color: 'var(--danger, #ef4444)' }}>
                  {listError}
                </p>
              )}
              {versions.map((v, i) => (
                <div key={v.sha}
                  style={{ padding: '8px 10px', marginBottom: '6px', borderRadius: 'var(--radius-sm)',
                    border: v.current ? '1px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
                    background: v.current ? 'rgba(124,106,240,0.08)' : 'transparent' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <code style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{v.short}</code>
                    <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{v.date}</span>
                    {i === 0 && (
                      <span style={{ fontSize: '0.6rem', fontWeight: 700, padding: '1px 5px', borderRadius: '3px',
                        background: 'rgba(34,197,94,0.15)', color: 'var(--success, #22c55e)' }}>MỚI NHẤT</span>
                    )}
                    {v.current && (
                      <span style={{ fontSize: '0.6rem', fontWeight: 700, padding: '1px 5px', borderRadius: '3px',
                        background: 'rgba(124,106,240,0.18)', color: 'var(--accent-primary)',
                        display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                        <Check size={9} /> ĐANG DÙNG
                      </span>
                    )}
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: '5px' }}>
                      <button onClick={() => setOpenLog(openLog === v.sha ? null : v.sha)}
                        title="Xem nội dung bản cập nhật này"
                        style={{ padding: '2px 7px', fontSize: '0.65rem', fontWeight: 600,
                          background: 'var(--bg-elevated)', color: 'var(--text-secondary)',
                          border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xs)',
                          cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                        {openLog === v.sha ? <ChevronUp size={10} /> : <ChevronDown size={10} />} Log
                      </button>
                      {!v.current && (
                        <button onClick={() => gotoVersion(v)}
                          title={i === 0 ? 'Cập nhật lên bản mới nhất' : 'Quay về đúng bản này'}
                          style={{ padding: '2px 7px', fontSize: '0.65rem', fontWeight: 600,
                            background: 'rgba(124,106,240,0.15)', color: 'var(--accent-primary)',
                            border: '1px solid rgba(124,106,240,0.3)', borderRadius: 'var(--radius-xs)',
                            cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                          <ArrowUpCircle size={10} /> {i === 0 ? 'Cập nhật' : 'Dùng bản này'}
                        </button>
                      )}
                    </div>
                  </div>
                  <p style={{ margin: '3px 0 0', fontSize: '0.76rem', color: 'var(--text-primary)', lineHeight: 1.35 }}>
                    {v.subject}
                  </p>
                  {openLog === v.sha && (
                    <pre style={{ margin: '6px 0 0', padding: '8px', background: '#1e1e1e', color: '#d4d4d4',
                      borderRadius: 'var(--radius-xs)', fontSize: '0.68rem', whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word', maxHeight: '260px', overflowY: 'auto' }}>
                      {v.body || '(Bản này không có mô tả chi tiết — chỉ có tiêu đề ở trên.)'}
                      {`\n\n— ${v.author}`}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ═══ CỬA SỔ CHẠY LỆNH (giữ nguyên như cũ) ═══ */}
      {isOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.5)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div style={{ background: 'var(--bg-primary)', width: '90%', maxWidth: '600px',
            borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)',
            display: 'flex', flexDirection: 'column', boxShadow: '0 10px 25px rgba(0,0,0,0.2)' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>{modalTitle}</h3>
              <button onClick={() => !isUpdating && setIsOpen(false)} disabled={isUpdating}
                style={{ background: 'none', border: 'none', cursor: isUpdating ? 'not-allowed' : 'pointer',
                  color: 'var(--text-muted)', padding: 4, display: 'flex', opacity: isUpdating ? 0.5 : 1 }}>
                <X size={20} />
              </button>
            </div>
            <div style={{ padding: '20px' }}>
              <pre style={{ background: '#1e1e1e', color: '#d4d4d4', padding: '16px',
                borderRadius: 'var(--radius-sm)', fontSize: '0.85rem', fontFamily: 'monospace',
                minHeight: '200px', maxHeight: '400px', overflowY: 'auto',
                whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 }}>
                {log || ui.ubPreparing}
              </pre>
            </div>
            <div style={{ padding: '16px 20px', borderTop: '1px solid var(--border-subtle)',
              display: 'flex', justifyContent: 'flex-end' }}>
              {!isUpdating && (
                <button onClick={() => window.location.reload()}
                  style={{ padding: '8px 16px', background: 'var(--accent-primary)', color: 'white',
                    border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontWeight: 500 }}>
                  {ui.ubReload}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
