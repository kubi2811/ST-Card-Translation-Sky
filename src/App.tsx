import { useEffect, useState, lazy, Suspense } from 'react';
import UpdateButton from './components/UpdateButton';
import ProxyConfig from './components/ProxyConfig';
import FileUpload from './components/FileUpload';
import TranslateConfig from './components/TranslateConfig';
import CardPreview from './components/CardPreview';
import TranslationProgress from './components/TranslationProgress';
import { useStore } from './store';
import { useT } from './i18n/useLocale';
import type { Locale } from './i18n/translations';
import { Languages, X, Globe } from 'lucide-react';
import PresetImportPanel from './components/PresetImportPanel';

// Lazy-load heavy components — only loaded after card is imported
const FieldEditor = lazy(() => import('./components/FieldEditor'));
const ExportPanel = lazy(() => import('./components/ExportPanel'));
const VerifyPanel = lazy(() => import('./components/VerifyPanel'));

const EjsCreatorPanel = lazy(() => import('./components/EjsCreatorPanel'));
const RegexManagerPanel = lazy(() => import('./components/RegexManagerPanel'));
const AiCompanionPanel = lazy(() => import('./components/AiCompanionPanel'));
const PresetPromptViewer = lazy(() => import('./components/PresetPromptViewer'));

export default function App() {
  const { toasts, removeToast, card, locale, setLocale, loadStateFromIDB } = useStore();
  const t = useT();
  const [showEjsCreator, setShowEjsCreator] = useState(false);
  const [showRegexManager, setShowRegexManager] = useState(false);
  const [showAiCompanion, setShowAiCompanion] = useState(false);
  const [showPresetViewer, setShowPresetViewer] = useState(false);

  useEffect(() => {
    loadStateFromIDB();
  }, [loadStateFromIDB]);

  if (showRegexManager) {
    return (
      <div style={{ width: '100vw', height: '100vh', background: 'var(--bg-primary)' }}>
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
            <div style={{ fontWeight: 700, fontSize: '0.95rem', letterSpacing: '-0.02em' }}>
              {t.appTitle}
            </div>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
              {t.appSubtitle}
            </div>
          </div>
          {/* Locale switcher */}
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <LocaleSwitcher locale={locale} setLocale={setLocale} />
            <UpdateButton />
          </div>
        </div>

        {/* Sidebar sections */}
        <ProxyConfig />
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
              ⚡ Regex Manager
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
              🔮 Trợ Lý AI
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '1200px' }}>
            <CardPreview />
            <TranslationProgress />
            <Suspense fallback={<LazyFallback />}>
              <FieldEditor />
            </Suspense>
            <Suspense fallback={<LazyFallback />}>
              <VerifyPanel />
            </Suspense>
            <Suspense fallback={<LazyFallback />}>
              <ExportPanel />
            </Suspense>

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

function LocaleSwitcher({ locale, setLocale }: { locale: Locale; setLocale: (l: Locale) => void }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        background: 'var(--bg-primary)',
        borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--border-subtle)',
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      <button
        onClick={() => setLocale('en')}
        style={{
          padding: '4px 8px',
          fontSize: '0.65rem',
          fontWeight: locale === 'en' ? 700 : 400,
          background: locale === 'en' ? 'var(--accent-primary)' : 'transparent',
          color: locale === 'en' ? 'white' : 'var(--text-muted)',
          border: 'none',
          cursor: 'pointer',
          transition: 'all 0.15s',
        }}
      >
        EN
      </button>
      <button
        onClick={() => setLocale('vi')}
        style={{
          padding: '4px 8px',
          fontSize: '0.65rem',
          fontWeight: locale === 'vi' ? 700 : 400,
          background: locale === 'vi' ? 'var(--accent-primary)' : 'transparent',
          color: locale === 'vi' ? 'white' : 'var(--text-muted)',
          border: 'none',
          cursor: 'pointer',
          transition: 'all 0.15s',
        }}
      >
        VI
      </button>
    </div>
  );
}
