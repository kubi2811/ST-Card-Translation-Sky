import { useEffect, useState, lazy, Suspense } from 'react';
import ProxyConfig from './components/ProxyConfig';
import FileUpload from './components/FileUpload';
import TranslateConfig from './components/TranslateConfig';
import CardPreview from './components/CardPreview';
import TranslationProgress from './components/TranslationProgress';
import { useStore, flushProgressBeacon } from './store';
import { useT, useUi } from './i18n/useLocale';
import { Languages, X, Globe } from 'lucide-react';
import PresetImportPanel from './components/PresetImportPanel';
import PresetRecommendModal from './components/PresetRecommendModal';
import PostTranslateGuideModal from './components/PostTranslateGuideModal';
import GlossaryVizPanel from './components/GlossaryVizPanel';
import { APP_VERSION, APP_VERSION_NOTE } from './version';

// Lazy-load heavy components — only loaded after card is imported.
// (User 2026) MỖI import() = 1 request HTTP tới CÙNG ORIGIN với call AI (/api-proxy/…). Trình duyệt
// chỉ cho ~6 kết nối đồng thời/host (HTTP/1.1) → khi ĐANG DỊCH (pool mở hàng chục call LLM, mỗi call
// treo tới hàng phút, có cái 524) thì request tải chunk XẾP HÀNG mãi không tới lượt ⇒ Suspense quay
// vô tận (bug user: bấm Regex Manager lúc đang dịch → load không vào). Cách chữa: gọi sẵn các
// import() này lúc app RẢNH (xem warmupLazyChunks bên dưới) → lúc cần mở panel thì chunk đã có trong
// bộ nhớ, KHÔNG cần request nào nữa, mở tức thì dù đang dịch.
const importFieldEditor = () => import('./components/FieldEditor');
const importExportPanel = () => import('./components/ExportPanel');
const importVerifyPanel = () => import('./components/VerifyPanel');
const importEjsCreatorPanel = () => import('./components/EjsCreatorPanel');
const importRegexManagerPanel = () => import('./components/RegexManagerPanel');
const importAiCompanionPanel = () => import('./components/AiCompanionPanel');
const importPresetPromptViewer = () => import('./components/PresetPromptViewer');
const importCompareCardsPanel = () => import('./components/CompareCardsPanel');

const FieldEditor = lazy(importFieldEditor);
const ExportPanel = lazy(importExportPanel);
const VerifyPanel = lazy(importVerifyPanel);
const EjsCreatorPanel = lazy(importEjsCreatorPanel);
const RegexManagerPanel = lazy(importRegexManagerPanel);
const AiCompanionPanel = lazy(importAiCompanionPanel);
const PresetPromptViewer = lazy(importPresetPromptViewer);
const CompareCardsPanel = lazy(importCompareCardsPanel);

/** Nạp trước MỌI chunk lazy khi trình duyệt rảnh — chạy 1 lần, nuốt lỗi (mạng hỏng thì Suspense lo). */
let warmedUp = false;
function warmupLazyChunks() {
  if (warmedUp) return;
  warmedUp = true;
  const loaders = [
    importFieldEditor, importExportPanel, importVerifyPanel, importEjsCreatorPanel,
    importRegexManagerPanel, importAiCompanionPanel, importPresetPromptViewer, importCompareCardsPanel,
  ];
  const run = () => { for (const load of loaders) load().catch(() => { warmedUp = false; }); };
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
  if (ric) ric(run, { timeout: 3000 });
  else setTimeout(run, 1200);
}

export default function App() {
  // (User 2026 — bugNeedFix/39) Selector HẸP ở ROOT: trước đây `useStore()` không selector khiến
  // MỌI set() (560+ lần trong burst dịch) re-render CẢ CÂY app từ gốc — vô hiệu hoá mọi fix selector
  // của các component con. `card` chỉ dùng để bật/tắt khối UI → thu về boolean cho đỡ re-render
  // khi updateCard đổi nội dung.
  const toasts = useStore((s) => s.toasts);
  const removeToast = useStore((s) => s.removeToast);
  const hasCard = useStore((s) => !!s.card);
  const jumpToFieldPath = useStore((s) => s.jumpToFieldPath);
  const t = useT();
  const ui = useUi();
  const [showEjsCreator, setShowEjsCreator] = useState(false);
  const [showRegexManager, setShowRegexManager] = useState(false);
  const [showAiCompanion, setShowAiCompanion] = useState(false);
  const [showPresetViewer, setShowPresetViewer] = useState(false);
  const [showCompare, setShowCompare] = useState(false);

  // (User 2026) Nạp trước chunk các panel nặng NGAY khi app rảnh — trước khi user bấm Dịch. Sau đó
  // mở Regex Manager / Trợ Lý AI / EJS Creator lúc đang dịch là tức thì, không phải chờ 1 khe kết nối
  // trống giữa hàng chục call LLM (bug "quay quài" của user).
  useEffect(() => { warmupLazyChunks(); }, []);

  // Flush translation progress to the project folder when the tab is closed/hidden, so an
  // accidental close within the auto-save window doesn't lose the last few seconds of work.
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') flushProgressBeacon(); };
    window.addEventListener('beforeunload', flushProgressBeacon);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('beforeunload', flushProgressBeacon);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, []);

  // "Nhảy tới trường" trỏ vào trường REGEX → mở panel Regex (panel tự chọn đúng script + xoá tín hiệu).
  useEffect(() => {
    if (jumpToFieldPath && jumpToFieldPath.includes('regex_scripts[')) {
      setShowRegexManager(true);
    }
  }, [jumpToFieldPath]);

  if (showRegexManager) {
    return (
      <div style={{ width: '100%', height: '100vh', background: 'var(--bg-primary)' }}>
        <Suspense fallback={<LazyFallback />}>
          <RegexManagerPanel onClose={() => setShowRegexManager(false)} isFullscreen />
        </Suspense>
        <div className="toast-container">
          {toasts.map((toast) => (
            <div key={toast.id} className={`toast toast-${toast.level}`}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                <span style={{ flex: 1 }}>{toast.message}{toast.count && toast.count > 1 ? ` (×${toast.count})` : ''}</span>
                <button
                  onClick={() => removeToast(toast.id)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'inherit',
                    cursor: 'pointer',
                    padding: '0',
                    flexShrink: 0,
                  }}
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="app-layout">
      {/* ─── Sidebar ─── */}
      <aside className="sidebar">
        {/* Logo + Locale switcher */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
          }}
        >
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: 'var(--radius-md)',
              background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Languages size={18} color="white" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: '0.95rem', letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              {t.appTitle}
              <span
                title={APP_VERSION_NOTE}
                style={{
                  fontSize: '0.6rem', fontWeight: 700, color: 'var(--accent-secondary)',
                  background: 'rgba(78,205,196,0.12)', border: '1px solid rgba(78,205,196,0.35)',
                  padding: '1px 6px', borderRadius: '999px', letterSpacing: '0', whiteSpace: 'nowrap',
                }}
              >
                v{APP_VERSION}
              </span>
            </div>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
              {t.appSubtitle}
            </div>
          </div>
          {/* (bug 148-1) Nút "Chọn phiên bản" ĐÃ CHUYỂN sang app "Giới thiệu" — mọi thao tác
              đổi phiên bản nay nằm một chỗ, không rải rác ở từng app nữa. */}
        </div>

        {/* Sidebar sections */}
        <ProxyConfig />

        {/* So Sánh Card — đặt NGAY TRÊN "Character Card", luôn hiện (không cần nạp card) */}
        <div style={{ padding: '0 20px', marginBottom: '6px' }}>
          <button
            onClick={() => setShowCompare(true)}
            style={{
              width: '100%', padding: '10px',
              background: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-md)', color: '#38bdf8', fontWeight: 600, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', transition: 'all 0.2s',
            }}
            onMouseOver={e => e.currentTarget.style.borderColor = '#38bdf8'}
            onMouseOut={e => e.currentTarget.style.borderColor = 'var(--border-default)'}
          >
            {ui.appCompareCards}
          </button>
        </div>

        <FileUpload />
        <PresetImportPanel onOpenPromptViewer={() => setShowPresetViewer(true)} />
        <TranslateConfig />

        {/* Nút mở EJS Creator Modal */}
        {hasCard && (
          <div style={{ padding: '0 20px', marginTop: '10px', marginBottom: '10px' }}>
            <button
              onClick={() => setShowEjsCreator(true)}
              style={{
                width: '100%',
                padding: '10px',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--accent-primary)',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                transition: 'all 0.2s'
              }}
              onMouseOver={e => e.currentTarget.style.borderColor = 'var(--accent-primary)'}
              onMouseOut={e => e.currentTarget.style.borderColor = 'var(--border-default)'}
            >
              <Globe size={16} /> EJS Creator / Lorebook
            </button>
            <button
              onClick={() => setShowRegexManager(true)}
              style={{
                width: '100%',
                padding: '10px',
                marginTop: '6px',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-md)',
                color: '#f97316',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                transition: 'all 0.2s'
              }}
              onMouseOver={e => e.currentTarget.style.borderColor = '#f97316'}
              onMouseOut={e => e.currentTarget.style.borderColor = 'var(--border-default)'}
            >
              {ui.appRegexManager}
            </button>
            <button
              onClick={() => setShowAiCompanion(true)}
              style={{
                width: '100%',
                padding: '10px',
                marginTop: '6px',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-md)',
                color: '#a855f7',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                transition: 'all 0.2s'
              }}
              onMouseOver={e => e.currentTarget.style.borderColor = '#a855f7'}
              onMouseOut={e => e.currentTarget.style.borderColor = 'var(--border-default)'}
            >
              {ui.appAiCompanion}
            </button>
          </div>
        )}
      </aside>

      {/* ─── Main Content ─── */}
      <main className="main-content">
        {!hasCard ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: '60vh',
              textAlign: 'center',
              gap: '16px',
            }}
          >
            <div
              style={{
                width: '80px',
                height: '80px',
                borderRadius: '50%',
                background: 'var(--bg-secondary)',
                border: '2px dashed var(--border-default)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Languages size={32} style={{ color: 'var(--text-muted)' }} />
            </div>
            <div>
              <h2 style={{ fontSize: '1.2rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>
                {t.noCardTitle}
              </h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', maxWidth: '400px' }}>
                {t.noCardDesc}
              </p>
            </div>
            <div
              style={{
                display: 'flex',
                gap: '24px',
                marginTop: '16px',
                fontSize: '0.75rem',
                color: 'var(--text-muted)',
              }}
            >
              <Step num={1} text={t.stepConfigureApi} />
              <Step num={2} text={t.stepUploadCard} />
              <Step num={3} text={t.stepTranslate} />
              <Step num={4} text={t.stepExport} />
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: 'none' /* (feedback) khung keo het canh phai, khong du khoang trong */ }}>
            <CardPreview />
            <TranslationProgress />
            <GlossaryVizPanel />
            <Suspense fallback={<LazyFallback />}>
              <FieldEditor />
            </Suspense>
            <div id="verify-panel-anchor">
              <Suspense fallback={<LazyFallback />}>
                <VerifyPanel />
              </Suspense>
            </div>
            <div id="export-panel-anchor">
              <Suspense fallback={<LazyFallback />}>
                <ExportPanel />
              </Suspense>
            </div>

          </div>
        )}

        {/* EJS Creator Modal */}
        {showEjsCreator && (
          <Suspense fallback={<LazyFallback />}>
            <EjsCreatorPanel onClose={() => setShowEjsCreator(false)} />
          </Suspense>
        )}

        {/* AI Assistant Modal */}
        {showAiCompanion && (
          <Suspense fallback={<LazyFallback />}>
            <AiCompanionPanel onClose={() => setShowAiCompanion(false)} />
          </Suspense>
        )}

        {/* Preset Prompt Viewer Modal */}
        {showPresetViewer && (
          <Suspense fallback={<LazyFallback />}>
            <PresetPromptViewer onClose={() => setShowPresetViewer(false)} />
          </Suspense>
        )}

        {/* So Sánh Card Modal */}
        {showCompare && (
          <Suspense fallback={<LazyFallback />}>
            <CompareCardsPanel onClose={() => setShowCompare(false)} />
          </Suspense>
        )}

        {/* Footer */}
        <footer
          style={{
            marginTop: '40px',
            padding: '16px 0',
            borderTop: '1px solid var(--border-subtle)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            gap: '8px',
            fontSize: '0.7rem',
            color: 'var(--text-muted)',
          }}
        >
          <span>{t.appTitle}</span>
          <span>·</span>
          <span>{t.appFooter}</span>
        </footer>
      </main>

      {/* Popup gợi ý cấu hình sau khi import card */}
      <PresetRecommendModal />

      {/* Popup hướng dẫn bước tiếp theo sau khi dịch xong */}
      <PostTranslateGuideModal />

      {/* ─── Toasts ─── */}
      <div className="toast-container">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.level}`}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
              <span style={{ flex: 1 }}>{toast.message}{toast.count && toast.count > 1 ? ` (×${toast.count})` : ''}</span>
              <button
                onClick={() => removeToast(toast.id)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'inherit',
                  cursor: 'pointer',
                  padding: '0',
                  flexShrink: 0,
                }}
              >
                <X size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Step({ num, text }: { num: number; text: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
      <div
        style={{
          width: '22px',
          height: '22px',
          borderRadius: '50%',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-default)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '0.7rem',
          fontWeight: 600,
        }}
      >
        {num}
      </div>
      <span>{text}</span>
    </div>
  );
}

/** Skeleton placeholder shown while lazy components load */
function LazyFallback() {
  // (User 2026) Nếu chunk phải tải NGAY GIỮA lúc đang dịch (vd user F5 giữa chừng nên chưa kịp
  // warm-up), request bị xếp sau hàng chục call LLM → chờ lâu. Sau 6s nói rõ lý do + cách xử lý,
  // thay vì để user nhìn vòng xoay vô nghĩa.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setSlow(true), 6000);
    return () => clearTimeout(id);
  }, []);
  const ui = useUi();
  return (
    <div
      className="card"
      style={{
        padding: '20px',
        minHeight: '80px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '10px',
      }}
    >
      <div
        style={{
          width: '20px',
          height: '20px',
          border: '2px solid var(--border-subtle)',
          borderTopColor: 'var(--accent-primary)',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }}
      />
      {slow && (
        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textAlign: 'center', maxWidth: '420px', lineHeight: 1.5 }}>
          {ui.appLazySlow}
        </div>
      )}
    </div>
  );
}

