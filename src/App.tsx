import { useEffect, useState, lazy, Suspense } from 'react';
import ProxyConfig from './components/ProxyConfig';
import FileUpload from './components/FileUpload';
import TranslateConfig from './components/TranslateConfig';
import CardPreview from './components/CardPreview';
import TranslationProgress from './components/TranslationProgress';
import { useStore, flushProgressBeacon } from './store';
import { useT, useUi } from './i18n/useLocale';
import { fmt } from './i18n';
import { Languages, X, Globe, Settings2, Upload, Wrench, FileText, ShieldCheck, Download, BookText } from 'lucide-react';
import PresetImportPanel from './components/PresetImportPanel';
import PresetRecommendModal from './components/PresetRecommendModal';
import PostTranslateGuideModal from './components/PostTranslateGuideModal';
import Base64NoticeModal from './components/Base64NoticeModal';
import GlossaryVizPanel from './components/GlossaryVizPanel';
import { APP_VERSION, APP_VERSION_NOTE } from './version';
// (bug 165) Ba component dùng chung — NGUỒN DUY NHẤT cho style khối co giãn / tab / nút công cụ.
import CollapsibleSection from './components/ui/CollapsibleSection';
import TabGroup from './components/ui/TabGroup';
import ToolButton from './components/ui/ToolButton';
import { onPanelRequest } from './components/ui/panelNav';
import { OPEN_AI_COMPANION_EVENT } from './hub/openAiCompanion';
// (bug 226) Tab bị giết giữa khâu ghép chunk ⇒ mở lại phiên là tự ghép nốt.
import { planAutoJoin } from './utils/chunkAudit';

/** (bug 165) Tab của cột nội dung chính. */
type MainTabId = 'fields' | 'verify' | 'export' | 'glossary';

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

  // ═══ (bug 165) ĐẠI TU LỚP TRÌNH BÀY ═══
  // Chỉ đổi CHỖ MOUNT và cách nhóm, không đổi state/logic/lazy — xem ghi chú ở panelNav.ts và
  // components/ui/*. Ba thứ phải giữ nguyên bằng mọi giá: warmupLazyChunks, từng <Suspense> quanh
  // panel lazy, và hai điểm neo #verify-panel-anchor / #export-panel-anchor.
  const [mainTab, setMainTab] = useState<MainTabId>('fields');
  // Tóm tắt để CollapsibleSection thu gọn được khi đã xong việc (đỡ chiếm chỗ vĩnh viễn).
  const apiReady = useStore((s) => !!(s.proxy.apiKey || (s.proxy.apiKeys && s.proxy.apiKeys.length > 0)));
  const proxyModel = useStore((s) => s.proxy.model);

  // Tín hiệu "nhảy tới panel" → bật đúng tab TRƯỚC khi cuộn. Không có bước này thì panel đang ẩn
  // không tồn tại trong DOM và lệnh nhảy im lặng thất bại (xem panelNav.ts).
  useEffect(() => onPanelRequest((anchorId) => {
    if (anchorId === 'verify-panel-anchor') setMainTab('verify');
    else if (anchorId === 'export-panel-anchor') setMainTab('export');
  }), []);

  // (User 2026) Nạp trước chunk các panel nặng NGAY khi app rảnh — trước khi user bấm Dịch. Sau đó
  // mở Regex Manager / Trợ Lý AI / EJS Creator lúc đang dịch là tức thì, không phải chờ 1 khe kết nối
  // trống giữa hàng chục call LLM (bug "quay quài" của user).
  useEffect(() => { warmupLazyChunks(); }, []);

  // (bug 208) Nút Trợ Lý AI nay nằm trên rail của Hub (ngay trên nút Cập nhật) nên nó phải mở
  // được panel này từ bên ngoài App. Chưa nạp thẻ thì nói thẳng lý do — mở một Trợ Lý không có
  // gì để đọc chỉ tổ làm user tưởng app hỏng.
  useEffect(() => {
    const open = () => {
      if (!useStore.getState().card) {
        useStore.getState().addToast('info', ui.aiCompanionNeedCard);
        return;
      }
      setShowAiCompanion(true);
    };
    window.addEventListener(OPEN_AI_COMPANION_EVENT, open);
    return () => window.removeEventListener(OPEN_AI_COMPANION_EVENT, open);
  }, [ui]);

  // (bug 205) KHÔI PHỤC PHIÊN GẦN NHẤT khi mở app mà chưa có card — cho ca Edge tự tắt tab
  // chạy nền: mở lại là trắng trơn dù tiến trình vẫn nằm trong translation-progress/. Snapshot
  // giờ chứa cả CARD nên dựng lại được nguyên phiên (card + fields + chunk + từ điển).
  useEffect(() => {
    const t = setTimeout(() => {
      void useStore.getState().restoreLastSession?.().then((key) => {
        if (key) {
          // (bug 213) Trước đây câu này hardcode tiếng Việt nên user chạy UI English/中文 vẫn thấy
          // một dòng tiếng Việt chen ngang.
          useStore.getState().addLog('info', fmt(ui.appRestoredSession, { key }));
        }
        // (bug 226) Tab bị Edge giết ĐÚNG lúc đang ghép chunk: `completedChunks` còn nguyên
        // trong bộ nhớ đã lưu, nhưng `translated` vẫn là bản gốc — nên bộ quét đọc bản gốc rồi
        // báo "30k chữ Hán chưa dịch", trong khi bản dịch nằm ngay đó. Trước đây chỉ có nút
        // ghép TAY mới cứu được; nay mở lại phiên là tự ghép, bằng đúng phép ghép ấy.
        const st = useStore.getState();
        const plans = planAutoJoin(st.fields);
        for (const p of plans) {
          st.updateField(p.path, { translated: p.joined, status: 'done', error: undefined });
        }
        if (plans.length > 0) {
          const saved = plans.reduce((s, p) => s + Math.max(0, p.hanBefore - p.hanAfter), 0);
          st.addLog('success', fmt(ui.appAutoJoined, { count: plans.length, han: saved }));
          st.saveTranslationCache?.();
        }
      });
    }, 300); // nhường useEffect nạp card từ đường khác (nếu có) chạy trước
    return () => clearTimeout(t);
  }, []);

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
    if (!jumpToFieldPath) return;
    if (jumpToFieldPath.includes('regex_scripts[')) {
      setShowRegexManager(true);
      return;
    }
    // (bug 165) Trường thường do FieldEditor tự xử — nhưng nay nó nằm trong tab, không active thì
    // KHÔNG mount nên không nhận được tín hiệu. Bật tab trước, rồi nó nhận như cũ.
    setMainTab('fields');
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

        {/* ═══ (bug 165) SIDEBAR THEO GIAI ĐOẠN, KHÔNG PHẢI THEO COMPONENT ═══
            Trước đây 5 panel lớn xếp chồng liên tục (ProxyConfig 746 + FileUpload 386 +
            PresetImportPanel 342 + TranslateConfig 1520 dòng) rồi 3 nút full-width ba màu khác nhau —
            phải cuộn rất dài mới tới phần cấu hình dịch, và mọi thứ có cùng trọng số thị giác.
            Nay gom theo đúng thứ tự việc phải làm, và bước ĐÃ XONG thì tự thu lại thành một dòng.
            KHÔNG sửa gì bên trong các panel con — chỉ bọc lại. */}
        <CollapsibleSection
          step={1}
          title={ui.grpSetup}
          icon={<Settings2 size={13} />}
          // Đã có key thì coi như xong bước này → thu gọn, nhường chỗ cho bước sau.
          defaultOpen={!apiReady}
          summary={apiReady ? `✓ ${proxyModel || ui.grpSetupDone}` : undefined}
        >
          <ProxyConfig />
        </CollapsibleSection>

        <CollapsibleSection step={2} title={ui.grpLoad} icon={<Upload size={13} />} defaultOpen>
          <FileUpload />
          <PresetImportPanel onOpenPromptViewer={() => setShowPresetViewer(true)} />
        </CollapsibleSection>

        <CollapsibleSection
          step={3}
          title={ui.grpTranslate}
          icon={<Languages size={13} />}
          // Chưa có card thì cấu hình dịch chưa dùng được — đóng lại cho bớt tường chữ.
          defaultOpen={hasCard}
          summary={!hasCard ? ui.grpTranslateNeedCard : undefined}
        >
          <TranslateConfig />
        </CollapsibleSection>

        {/* Công cụ nâng cao: gom MỘT chỗ, đóng mặc định — trước đây 3-4 nút full-width ba màu nằm
            chen giữa luồng chính, trông quan trọng ngang các bước bắt buộc. */}
        <CollapsibleSection
          title={ui.grpTools}
          icon={<Wrench size={13} />}
          defaultOpen={false}
          accent="var(--accent-secondary)"
          summary={ui.grpToolsHint}
        >
          <div style={{ padding: '4px 20px 10px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {/* So Sánh Card không cần card đã nạp — giữ nguyên như cũ. */}
            <ToolButton label={ui.appCompareCards} accent="#38bdf8" onClick={() => setShowCompare(true)} />
            <ToolButton
              label="EJS Creator / Lorebook" icon={<Globe size={13} />}
              onClick={() => setShowEjsCreator(true)} disabled={!hasCard} title={!hasCard ? t.noCardTitle : undefined}
            />
            <ToolButton
              label={ui.appRegexManager} accent="#f97316"
              onClick={() => setShowRegexManager(true)} disabled={!hasCard} title={!hasCard ? t.noCardTitle : undefined}
            />
            {/* (bug 208) Nút Trợ Lý AI đã CHUYỂN lên rail bên trái, ngay trên nút Cập nhật —
                luôn nhìn thấy, không phải mở mục này ra mới bấm được. Để hai nút cùng chức năng
                ở hai chỗ chỉ tổ rối, nên ở đây chỉ còn một dòng chỉ đường. */}
          </div>
          <div style={{ padding: '0 20px 10px', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            {ui.grpToolsAiMoved}
          </div>
        </CollapsibleSection>

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
            {/* ═══ (bug 165) NỘI DUNG MẶC ĐỊNH: xem thẻ + tiến trình dịch ═══
                Đây là hai thứ người dùng cần thấy NGAY và liên tục trong lúc dịch. Phần còn lại
                (~4300 dòng UI) chuyển vào tab bên dưới, chỉ dựng khi được chọn. */}
            <CardPreview />
            <TranslationProgress />

            <TabGroup
              activeId={mainTab}
              onChange={(id) => setMainTab(id as MainTabId)}
              tabs={[
                {
                  id: 'fields',
                  label: ui.tabFields,
                  icon: <FileText size={13} />,
                  // Mỗi panel vẫn tự bọc <Suspense> như trước — chỉ đổi CHỖ mount, không đổi cách
                  // import động, và warmupLazyChunks vẫn nạp trước chunk như cũ.
                  render: () => (
                    <Suspense fallback={<LazyFallback />}>
                      <FieldEditor />
                    </Suspense>
                  ),
                },
                {
                  id: 'verify',
                  label: ui.tabVerify,
                  icon: <ShieldCheck size={13} />,
                  // Giữ NGUYÊN id neo: PostTranslateGuideModal nhảy tới đây bằng đúng id này.
                  render: () => (
                    <div id="verify-panel-anchor">
                      <Suspense fallback={<LazyFallback />}>
                        <VerifyPanel />
                      </Suspense>
                    </div>
                  ),
                },
                {
                  id: 'export',
                  label: ui.tabExport,
                  icon: <Download size={13} />,
                  render: () => (
                    <div id="export-panel-anchor">
                      <Suspense fallback={<LazyFallback />}>
                        <ExportPanel />
                      </Suspense>
                    </div>
                  ),
                },
                {
                  id: 'glossary',
                  label: ui.tabGlossary,
                  icon: <BookText size={13} />,
                  render: () => <GlossaryVizPanel />,
                },
              ]}
            />
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
      {/* (việc 233) Báo ngay lúc nhập thẻ khi thẻ có tài liệu bị nhúng dạng base64. */}
      <Base64NoticeModal />

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

