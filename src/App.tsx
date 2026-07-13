import { useEffect, useState, lazy, Suspense } from 'react';
import UpdateButton from './components/UpdateButton';
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
import { APP_VERSION, APP_VERSION_NOTE } from './version';

// Lazy-load heavy components — only loaded after card is imported
const FieldEditor = lazy(() => import('./components/FieldEditor'));
const ExportPanel = lazy(() => import('./components/ExportPanel'));
const VerifyPanel = lazy(() => import('./components/VerifyPanel'));

const EjsCreatorPanel = lazy(() => import('./components/EjsCreatorPanel'));
const RegexManagerPanel = lazy(() => import('./components/RegexManagerPanel'));
const AiCompanionPanel = lazy(() => import('./components/AiCompanionPanel'));
const PresetPromptViewer = lazy(() => import('./components/PresetPromptViewer'));
const CompareCardsPanel = lazy(() => import('./components/CompareCardsPanel'));

export default function App() {
  const { toasts, removeToast, card, jumpToFieldPath } = useStore();
  const t = useT();
  const ui = useUi();
  const [showEjsCreator, setShowEjsCreator] = useState(false);
  const [showRegexManager, setShowRegexManager] = useState(false);
  const [showAiCompanion, setShowAiCompanion] = useState(false);
  const [showPresetViewer, setShowPresetViewer] = useState(false);
  const [showCompare, setShowCompare] = useState(false);

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
                <span style={{ flex: 1 }}>{toast.message}</span>
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
          {/* Locale switcher */}
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <UpdateButton />
          </div>
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
        {card && (
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
        {!card ? (
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
              <span style={{ flex: 1 }}>{toast.message}</span>
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
  return (
    <div
      className="card"
      style={{
        padding: '20px',
        minHeight: '80px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
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
    </div>
  );
}

