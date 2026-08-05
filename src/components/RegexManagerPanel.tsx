import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useStore } from '../store';
import { useThrottledStore } from '../hooks/useThrottledStore';
import { useTranslation } from '../hooks/useTranslation';
import { useT, useUi } from '../i18n/useLocale';
import { fmt } from '../i18n';
import { X, Regex, Languages, Save, Check, Loader2, Sparkles, RefreshCw, Copy, Trash2, StopCircle, CircleStop, Code2, Play, CheckCircle2, Search, Wrench } from 'lucide-react';
import type { RegexScript } from '../types/card';
import { aiRegexScan, aiRegexFixAll, aiRegexProcess } from '../utils/aiVerify';
import type { VerifyIssue, RegexFixResult, RegexScanProgress, RegexProcessProgress } from '../utils/aiVerify';
import AiCompanionPanel from './AiCompanionPanel';
import ExternalLinkTab from './ExternalLinkTab';

/* ════════════════════════════════════════════════════════════════════
   HELPER: Render fully interactive HTML preview with jQuery & ST CSS
   ════════════════════════════════════════════════════════════════════ */
const renderSafeHtml = (htmlContent: string) => {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <script src="https://code.jquery.com/jquery-3.6.0.min.js"></script>
        <style>
          body {
            margin: 0;
            padding: 12px 16px;
            background: #0f0f12;
            color: #e8e6f0;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            font-size: 0.9rem;
            line-height: 1.7;
          }
          /* Custom SillyTavern Chat Bubble CSS */
          .chinh_van {
            border-left: 3px solid #6366f1;
            padding-left: 10px;
            margin: 4px 0;
            color: #c7d2fe;
          }
          .thoai {
            color: #67e8f9;
            font-style: italic;
          }
          .hanhdong {
            color: #fbbf24;
            font-style: italic;
            font-family: monospace;
          }
          .suy_nghi {
            color: #c084fc;
            font-style: italic;
            opacity: 0.85;
          }
          .regex-error {
            color: #f06a6a;
            font-family: monospace;
            font-size: 0.8rem;
            padding: 4px 8px;
            background: rgba(240, 106, 106, 0.1);
            border-radius: 4px;
          }
          
          /* Native ST/Tavern accordion details */
          .section {
            border-bottom: 1px solid #2a2a3e;
            margin-bottom: 6px;
          }
          .section-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 8px 12px;
            cursor: pointer;
            user-select: none;
            background: #16161e;
            border-radius: 6px;
            font-weight: 600;
            font-size: 0.85rem;
            color: #a09cb5;
            transition: background 0.15s;
          }
          .section-header:hover {
            background: #2a2a3e;
            color: #e8e6f0;
          }
          .section-content {
            padding: 12px 14px;
            font-size: 0.82rem;
            color: #e8e6f0;
          }
          .hidden {
            display: none !important;
          }
          .divider {
            height: 1px;
            background: #2a2a3e;
            margin: 8px 0;
          }
          ul.scroll-list {
            list-style: none;
            padding: 0;
            margin: 0;
            overflow-y: auto;
          }
          li.list-item {
            display: flex;
            justify-content: space-between;
            padding: 6px 8px;
            border-bottom: 1px solid rgba(255,255,255,0.03);
          }
          .badge {
            font-size: 0.7rem;
            font-weight: 600;
            padding: 2px 6px;
            border-radius: 99px;
            background: rgba(160,156,181,0.1);
            color: #a09cb5;
            margin-left: 6px;
          }
        </style>
      </head>
      <body>
        <div class="st-preview">
          ${htmlContent}
        </div>
        
        <script>
          // Automatic accordion toggler fallback for ST-style script accordions
          $(document).ready(function() {
            // Bind section togglers
            $(document).on('click', '.section-header', function() {
              $(this).toggleClass('collapsed');
              $(this).next('.section-content').toggleClass('hidden');
            });

            // Log interaction
            console.log('ST Accoridon and Event fallback binders executed.');
          });
        </script>

        <script>
          /* (User 2026) TỰ BÁO CHIỀU CAO ra ngoài để iframe giãn ĐÚNG bằng nội dung → KHÔNG còn thanh
             cuộn RIÊNG trong khung preview (cuộn lồng cuộn rất khó theo dõi). Sandbox không có
             allow-same-origin nên parent KHÔNG đọc được contentDocument → phải postMessage từ trong ra.
             Gửi lại mỗi khi DOM/ảnh/accordion đổi kích thước (ResizeObserver + load). */
          (function () {
            var lastH = 0, sent = 0;
            function report() {
              /* Chốt an toàn: card dùng min-height:100vh sẽ ăn theo chiều cao iframe → iframe cao lên
                 lại làm 100vh cao lên (vòng lặp phình). Giới hạn 40 lần báo là dừng — đủ cho mọi
                 layout thật (ảnh/font tải xong, accordion mở), mà không bao giờ chạy loạn. */
              if (sent > 40) return;
              var d = document.documentElement, b = document.body;
              var h = Math.max(
                b.scrollHeight, b.offsetHeight,
                d.scrollHeight, d.offsetHeight, d.clientHeight
              );
              if (Math.abs(h - lastH) < 2) return;
              lastH = h;
              sent++;
              parent.postMessage({ __rmPreviewHeight: h, id: window.name }, '*');
            }
            window.addEventListener('load', report);
            window.addEventListener('resize', report);
            document.addEventListener('click', function () { setTimeout(report, 60); }); // accordion mở/đóng
            if (window.ResizeObserver) new ResizeObserver(report).observe(document.body);
            setTimeout(report, 0);
            setTimeout(report, 300);
          })();
        </script>
      </body>
    </html>
  `;
};

/**
 * (User 2026) Iframe preview TỰ GIÃN theo nội dung — bỏ chiều cao cứng 240px + scroll bên trong.
 * Nhận chiều cao qua postMessage từ srcDoc (sandbox không cho parent đọc contentDocument).
 * `name` dùng làm ID để 2 khung (Gốc / Đã dịch) không nhận nhầm chiều cao của nhau.
 */
function AutoHeightPreview({ name, title, srcDoc }: { name: string; title: string; srcDoc: string }) {
  const [height, setHeight] = useState(240);
  useEffect(() => {
    const onMsg = (ev: MessageEvent) => {
      const d = ev.data as { __rmPreviewHeight?: number; id?: string } | null;
      if (!d || typeof d.__rmPreviewHeight !== 'number' || d.id !== name) return;
      // Trần 4000px: card game khổng lồ vẫn đọc được mà không làm trang dài vô tận.
      setHeight(Math.min(Math.max(d.__rmPreviewHeight, 80), 4000));
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [name]);
  return (
    <iframe
      name={name}
      title={title}
      srcDoc={srcDoc}
      sandbox="allow-scripts"
      scrolling="no"
      style={{
        width: '100%',
        height: `${height}px`,
        display: 'block',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-md)',
        background: '#0f0f12',
        overflow: 'hidden',
      }}
    />
  );
}

/* ════════════════════════════════════════════════════════════════════
   TYPES
   ════════════════════════════════════════════════════════════════════ */
interface RegexFieldRow {
  scriptIndex: number;
  scriptName: string;
  fieldKey: 'scriptName' | 'findRegex' | 'replaceString' | 'trimStrings';
  subIndex?: number;           // for trimStrings array items
  original: string;
  translated: string;
  status: 'pending' | 'translating' | 'done' | 'error';
  error?: string;
}

/* ════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ════════════════════════════════════════════════════════════════════ */
export default function RegexManagerPanel({ onClose, isFullscreen }: { onClose: () => void; isFullscreen?: boolean }) {
  const t = useT();
  // (bug 132) saveTranslationCache: mọi việc làm trong tab này (dịch lẻ, AI sửa, áp vào thẻ,
  // bật/tắt) phải xuống đĩa — trước đây tab Regex không hề gọi nó nên F5/nhập lại là mất trắng.
  // (bug 213) Selector hẹp thay cho destructure trần. Vòng dịch chính chạy bằng promise loop đọc
  // getState() nên nó KHÔNG chết khi TranslationPanel unmount — user mở Regex Manager fullscreen
  // giữa lúc đang dịch là mỗi addLog/updateField re-render cả panel 1200 dòng kèm subtree 2 iframe
  // preview. `fields` throttle 300ms (chỉ dùng để hiển thị trạng thái/bản dịch của từng script).
  const card = useStore((s) => s.card);
  const updateCard = useStore((s) => s.updateCard);
  const addToast = useStore((s) => s.addToast);
  const fields = useThrottledStore((s) => s.fields, 300);
  const updateField = useStore((s) => s.updateField);
  const phase = useStore((s) => s.phase);
  const deleteCurrentCardCache = useStore((s) => s.deleteCurrentCardCache);
  const translationConfig = useStore((s) => s.translationConfig);
  const addLog = useStore((s) => s.addLog);
  const proxy = useStore((s) => s.proxy);
  const jumpToFieldPath = useStore((s) => s.jumpToFieldPath);
  const setJumpToFieldPath = useStore((s) => s.setJumpToFieldPath);
  const saveTranslationCache = useStore((s) => s.saveTranslationCache);
  const { retranslateField, cancelTranslation, cancelFieldTranslation, cancelAllFieldTranslations } = useTranslation();

  // ─── Regex scripts from card ───
  const scripts: RegexScript[] = useMemo(
    () => card?.data?.extensions?.regex_scripts || [],
    [card]
  );

  // ─── State ───
  const [selectedScriptIdx, setSelectedScriptIdx] = useState<number>(0);
  const [showAiChat, setShowAiChat] = useState(false);

  // "Nhảy tới trường" từ bảng Sức khoẻ thẻ, trỏ vào 1 trường regex → chọn đúng script chứa nó.
  useEffect(() => {
    if (!jumpToFieldPath || !jumpToFieldPath.includes('regex_scripts[')) return;
    const m = jumpToFieldPath.match(/regex_scripts\[(\d+)\]/);
    if (m) {
      const idx = parseInt(m[1], 10);
      if (idx >= 0 && idx < scripts.length) setSelectedScriptIdx(idx);
    }
    setJumpToFieldPath(null); // tiêu thụ tín hiệu
  }, [jumpToFieldPath, scripts.length, setJumpToFieldPath]);

  // ─── AI Regex Fix State ───
  const [isRegexScanning, setIsRegexScanning] = useState(false);
  const [isRegexFixing, setIsRegexFixing] = useState(false);
  const [regexIssues, setRegexIssues] = useState<VerifyIssue[]>([]);
  const [regexFixResults, setRegexFixResults] = useState<RegexFixResult[]>([]);
  const [regexScanProgress, setRegexScanProgress] = useState<RegexScanProgress | null>(null);
  const [regexFixProgress, setRegexFixProgress] = useState('');
  const regexAbortRef = React.useRef<AbortController | null>(null);
  // ─── Pipeline gộp Quét+Sửa (4 giai đoạn) ───
  const [isRegexAuto, setIsRegexAuto] = useState(false);
  const [regexAutoProgress, setRegexAutoProgress] = useState<RegexProcessProgress | null>(null);
  const regexAutoAbortRef = useRef<AbortController | null>(null);

  const ui = useUi();

  const handleRegexScan = useCallback(async () => {
    setIsRegexScanning(true);
    setRegexScanProgress(null);
    setRegexIssues([]);
    setRegexFixResults([]);
    regexAbortRef.current = new AbortController();
    try {
      addLog('active', ui.rmScanning);
      const { issues, regexResults } = await aiRegexScan(
        fields, proxy, translationConfig.targetLanguage,
        translationConfig.mvuDictionary, translationConfig.sourceLanguage,
        (progress) => setRegexScanProgress({ ...progress }),
        regexAbortRef.current.signal,
      );
      setRegexIssues(issues);
      const errCount = issues.filter(i => i.severity === 'error').length;
      const warnCount = issues.filter(i => i.severity === 'warning').length;
      addLog(errCount > 0 ? 'error' : 'success',
        fmt(ui.rmScanResult, { err: errCount, warn: warnCount }));
      if (issues.length === 0) addToast('success', ui.rmScanClean);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg !== 'The operation was aborted.' && msg !== 'AbortError') {
        addToast('error', `Regex scan failed: ${msg}`);
      }
    } finally {
      setIsRegexScanning(false);
      regexAbortRef.current = null;
    }
  }, [fields, proxy, translationConfig, addLog, addToast, ui]);

  const handleCancelRegexScan = useCallback(() => {
    regexAbortRef.current?.abort();
    addLog('warning', ui.rmScanCancelled);
  }, [addLog, ui]);

  const handleRegexFix = useCallback(async () => {
    if (regexIssues.length === 0) return;
    setIsRegexFixing(true);
    setRegexFixResults([]);
    regexAbortRef.current = new AbortController();
    try {
      addLog('active', fmt(ui.rmFixing, { count: regexIssues.length }));
      const results = await aiRegexFixAll(
        regexIssues, fields, proxy, translationConfig.targetLanguage,
        translationConfig.mvuDictionary, translationConfig.sourceLanguage,
        ({ fixing, done, total, results: r }) => {
          setRegexFixProgress(fmt(ui.rmFixProgress, { done, total, name: fixing }));
          setRegexFixResults([...r]);
        },
        regexAbortRef.current.signal,
      );
      setRegexFixResults(results);
      const accepted = results.filter(r => r.success).length;
      const rejected = results.filter(r => !r.success).length;
      const summary = (t as any).regexFixDone?.replace('{accepted}', String(accepted)).replace('{rejected}', String(rejected))
                      || fmt(ui.rmFixDoneFallback, { accepted, rejected });
      addLog(accepted > 0 ? 'success' : 'warning', `🔧 ${summary}`);
      addToast(accepted > 0 ? 'success' : 'info', summary);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg !== 'The operation was aborted.' && msg !== 'AbortError') {
        addToast('error', `Regex fix failed: ${msg}`);
      }
    } finally {
      setIsRegexFixing(false);
      setRegexFixProgress('');
      regexAbortRef.current = null;
    }
  }, [regexIssues, fields, proxy, translationConfig, addLog, addToast, ui, t]);

  // ─── Pipeline GỘP: Quét + Sửa (4 giai đoạn: plan → so sánh chunk → sửa → coverage) ───
  const handleRegexAuto = useCallback(async () => {
    setIsRegexAuto(true);
    setRegexIssues([]);
    setRegexFixResults([]);
    setRegexAutoProgress(null);
    const abort = new AbortController();
    regexAutoAbortRef.current = abort;
    try {
      addLog('active', ui.rmAutoStart);
      const { issues, fixes } = await aiRegexProcess(
        fields, proxy, translationConfig.targetLanguage,
        translationConfig.mvuDictionary, translationConfig.sourceLanguage,
        // (bug 132) Lưu ngay sau mỗi field AI sửa — đường này KHÔNG đi qua retranslateField nên
        // không hưởng lệnh lưu ở đó; bỏ quên là mất sạch khi F5/nhập lại thẻ.
        (fieldPath, newTranslated) => {
          updateField(fieldPath, { translated: newTranslated, status: 'done' });
          saveTranslationCache();
        },
        (p) => setRegexAutoProgress({ ...p, issues: [...p.issues], fixes: [...p.fixes] }),
        abort.signal,
      );
      setRegexIssues(issues);
      setRegexFixResults(fixes);
      const errCount = issues.filter(i => i.severity === 'error').length;
      const fixedCount = fixes.filter(f => f.success).length;
      addLog('success', fmt(ui.rmAutoDone, { err: errCount, fixed: fixedCount }));
      addToast('success', fmt(ui.rmAutoToast, { err: errCount, fixed: fixedCount }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!abort.signal.aborted) addToast('error', fmt(ui.rmAutoErr, { msg }));
    } finally {
      setIsRegexAuto(false);
      regexAutoAbortRef.current = null;
    }
  }, [fields, proxy, translationConfig, updateField, addLog, addToast, saveTranslationCache]);

  const handleCancelRegexAuto = useCallback(() => {
    regexAutoAbortRef.current?.abort();
    addLog('warning', ui.rmAutoCancelled);
  }, [addLog]);

  // ─── Build field rows from store fields (reactive to translation progress) ───
  const fieldRows = useMemo((): (RegexFieldRow & { path: string })[] => {
    const regexFields = fields.filter(f => f.group === 'regex');
    return regexFields.map(f => {
      const match = f.path.match(/data\.extensions\.regex_scripts\[(\d+)\]\.(\w+)(?:\[(\d+)\])?/);
      if (!match) return null;

      const scriptIdx = parseInt(match[1]);
      const fieldKey = match[2] as 'scriptName' | 'findRegex' | 'replaceString' | 'trimStrings';
      const subIdx = match[3] !== undefined ? parseInt(match[3]) : undefined;
      const script = scripts[scriptIdx];
      const scriptName = script?.scriptName || `Script ${scriptIdx + 1}`;

      return {
        scriptIndex: scriptIdx,
        scriptName,
        fieldKey,
        subIndex: subIdx,
        original: f.original,
        translated: f.translated || '',
        status: f.status === 'ignored' || f.status === 'skipped' ? 'pending' : (f.status as any),
        error: f.error,
        path: f.path,
      };
    }).filter(Boolean) as (RegexFieldRow & { path: string })[];
  }, [fields, scripts]);

  const isTranslating = phase === 'translating';

  // ─── Translate all fields ───
  const handleTranslateAll = async () => {
    const pendingRegexFields = fields.filter(f => f.group === 'regex' && f.status !== 'done');
    if (pendingRegexFields.length === 0) {
      addToast('info', ui.rmNothingToTranslate);
      return;
    }

    addToast('info', fmt(ui.rmStartTranslate, { count: pendingRegexFields.length }));
    for (const f of pendingRegexFields) {
      try {
        await retranslateField(f.path);
      } catch (err) {
        console.error(`Failed to translate ${f.path}:`, err);
      }
    }
  };

  // ─── Re-translate ALL regex fields (including done) ───
  const handleRetranslateAll = async () => {
    const allRegexFields = fields.filter(f => f.group === 'regex');
    if (allRegexFields.length === 0) {
      addToast('info', ui.rmNothingToRetranslate);
      return;
    }

    addToast('info', fmt(ui.rmRetranslateAll, { count: allRegexFields.length }));
    for (const f of allRegexFields) {
      try {
        await retranslateField(f.path);
      } catch (err) {
        console.error(`Failed to retranslate ${f.path}:`, err);
      }
    }
  };

  // ─── Apply translations back to card ───
  const handleApplyToCard = () => {
    if (!card) return;
    const newCard = JSON.parse(JSON.stringify(card));
    const regexScripts = newCard.data?.extensions?.regex_scripts;
    if (!regexScripts) return;

    let applied = 0;
    fieldRows.forEach(row => {
      if (row.status !== 'done' || !row.translated.trim()) return;
      const script = regexScripts[row.scriptIndex];
      if (!script) return;

      if (row.fieldKey === 'replaceString') {
        script.replaceString = row.translated;
        applied++;
      } else if (row.fieldKey === 'scriptName') {
        script.scriptName = row.translated;
        applied++;
      } else if (row.fieldKey === 'findRegex') {
        script.findRegex = row.translated;
        applied++;
      } else if (row.fieldKey === 'trimStrings' && row.subIndex !== undefined) {
        if (script.trimStrings && script.trimStrings[row.subIndex] !== undefined) {
          script.trimStrings[row.subIndex] = row.translated;
          applied++;
        }
      }
    });

    updateCard(newCard);
    // (bug 132) Thay đổi vừa ghi vào THẺ cũng phải xuống đĩa — snapshot có `regexScripts`.
    saveTranslationCache();
    addToast('success', fmt(ui.rmApplied, { count: applied }));
  };

  // ─── (bugNeedFix/35) Bật/tắt regex trong SillyTavern (cờ `disabled`) ───
  // User muốn NHÌN THẤY regex nào đang bật/tắt (giống danh sách ST) rồi tự quyết dịch sao. Bấm chip để
  // đảo cờ `disabled` ghi thẳng vào card (KHÔNG ảnh hưởng việc dịch — dịch vẫn xử lý tất cả regex).
  const toggleScriptDisabled = useCallback((idx: number, e: React.MouseEvent) => {
    e.stopPropagation(); // đừng đổi script đang chọn khi bấm chip
    if (!card) return;
    const newCard = JSON.parse(JSON.stringify(card));
    const rs = newCard.data?.extensions?.regex_scripts;
    if (!rs || !rs[idx]) return;
    rs[idx].disabled = !rs[idx].disabled;
    updateCard(newCard);
    saveTranslationCache();   // (bug 132) cờ bật/tắt cũng là dữ liệu người dùng — đừng để mất
    const name = rs[idx].scriptName || `Script ${idx + 1}`;
    addToast('info', fmt(rs[idx].disabled ? ui.rmToggleOff : ui.rmToggleOn, { name }));
  }, [card, updateCard, addToast, ui, saveTranslationCache]);

  // Thống kê bật/tắt để hiện ở thanh dưới.
  const enabledCount = useMemo(() => scripts.filter(s => !s.disabled).length, [scripts]);

  // ─── Cancel translation ───
  const handleCancel = () => {
    cancelTranslation();
  };

  // ─── Cancel all in-flight regex translations ───
  const handleCancelAll = () => {
    cancelAllFieldTranslations();
    addToast('info', ui.rmStoppedAll);
  };

  // ─── Check if any regex fields are currently translating ───
  const anyTranslating = fieldRows.some(r => r.status === 'translating');

  // ─── Clear all regex cache ───
  const handleClearCache = async () => {
    if (!confirm(ui.rmClearCacheConfirm)) return;
    
    // Reset only regex fields to pending
    const regexFields = fields.filter(f => f.group === 'regex');
    for (const f of regexFields) {
      updateField(f.path, {
        translated: '',
        status: 'pending',
        error: undefined,
      });
    }
    
    addToast('success', fmt(ui.rmCacheCleared, { count: regexFields.length }));
  };



  // ─── Stats ───
  const doneCount = fieldRows.filter(r => r.status === 'done').length;
  const errorCount = fieldRows.filter(r => r.status === 'error').length;
  const totalCount = fieldRows.length;

  return (
    <div className={isFullscreen ? "regex-fullscreen-container" : "regex-modal-overlay"} onClick={isFullscreen ? undefined : onClose}>
      <div className={isFullscreen ? "regex-fullscreen-main" : "regex-modal"} onClick={e => e.stopPropagation()}>
        {/* ══════ LEFT SIDEBAR ══════ */}
        <div className="regex-sidebar">
          {/* Header */}
          <div style={{
            padding: '16px',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
          }}>
            <div style={{
              width: '28px', height: '28px', borderRadius: 'var(--radius-sm)',
              background: 'linear-gradient(135deg, #f97316, #ef4444)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <Regex size={14} color="white" />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: '0.85rem' }}>Regex Manager</div>
              <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>
                {scripts.length} script{scripts.length !== 1 ? 's' : ''}
              </div>
            </div>
            <button onClick={onClose} style={{
              background: 'none', border: 'none', color: 'var(--text-muted)',
              cursor: 'pointer', padding: '4px',
            }}>
              <X size={16} />
            </button>
          </div>

          {/* Script list */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
            <button
              onClick={() => setSelectedScriptIdx(-1)}
              style={{
                width: '100%',
                padding: '8px 12px',
                marginBottom: '8px',
                background: selectedScriptIdx === -1 ? 'rgba(124, 106, 240, 0.15)' : 'rgba(124, 106, 240, 0.05)',
                border: selectedScriptIdx === -1 ? '1px solid var(--accent-primary)' : '1px solid rgba(124, 106, 240, 0.2)',
                borderRadius: 'var(--radius-sm)',
                color: selectedScriptIdx === -1 ? 'var(--accent-primary)' : 'var(--text-primary)',
                cursor: 'pointer',
                textAlign: 'left',
                fontSize: '0.78rem',
                fontWeight: 600,
                transition: 'all 0.15s',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <span>🔗</span>
              <span>{ui.rmExternalLink}</span>
            </button>
            <div style={{ height: '1px', background: 'var(--border-subtle)', marginBottom: '8px' }} />

            {scripts.length === 0 ? (
              <div style={{
                padding: '20px 12px', textAlign: 'center',
                color: 'var(--text-muted)', fontSize: '0.75rem',
              }}>
                {ui.rmNoRegex}
              </div>
            ) : (
              scripts.map((script, idx) => {
                const isOff = !!script.disabled;
                return (
                <button
                  key={idx}
                  onClick={() => setSelectedScriptIdx(idx)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    marginBottom: '2px',
                    background: selectedScriptIdx === idx ? 'var(--bg-hover)' : 'transparent',
                    border: selectedScriptIdx === idx ? '1px solid var(--border-default)' : '1px solid transparent',
                    borderRadius: 'var(--radius-sm)',
                    color: selectedScriptIdx === idx ? 'var(--text-primary)' : 'var(--text-secondary)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    fontSize: '0.78rem',
                    transition: 'all 0.15s',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    opacity: isOff ? 0.55 : 1,
                  }}
                >
                  {/* (bugNeedFix/35) Chip bật/tắt: nhìn thấy trạng thái + bấm để đảo cờ trong SillyTavern */}
                  <span
                    role="switch"
                    aria-checked={!isOff}
                    title={ui.rmToggleHint}
                    onClick={(e) => toggleScriptDisabled(idx, e)}
                    style={{
                      flexShrink: 0,
                      width: '26px',
                      height: '15px',
                      borderRadius: '999px',
                      background: isOff ? 'var(--bg-input, rgba(255,255,255,0.12))' : 'var(--accent-primary)',
                      border: '1px solid var(--border-default)',
                      position: 'relative',
                      cursor: 'pointer',
                      transition: 'background 0.15s',
                    }}
                  >
                    <span style={{
                      position: 'absolute',
                      top: '1px',
                      left: isOff ? '1px' : '12px',
                      width: '11px',
                      height: '11px',
                      borderRadius: '50%',
                      background: '#fff',
                      transition: 'left 0.15s',
                    }} />
                  </span>
                  <Regex size={12} style={{ flexShrink: 0, opacity: 0.5 }} />
                  <span style={{
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    textDecoration: isOff ? 'line-through' : 'none',
                    flex: 1,
                  }}>
                    {script.scriptName || `Script ${idx + 1}`}
                  </span>
                  {isOff && (
                    <span style={{
                      flexShrink: 0,
                      fontSize: '0.6rem',
                      fontWeight: 700,
                      letterSpacing: '0.04em',
                      color: 'var(--text-muted)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: '4px',
                      padding: '1px 4px',
                    }}>{ui.rmStatusOff}</span>
                  )}
                </button>
                );
              })
            )}
          </div>

          {/* Bottom stats */}
          {totalCount > 0 && (
            <div style={{
              padding: '10px 12px',
              borderTop: '1px solid var(--border-subtle)',
              fontSize: '0.7rem',
              color: 'var(--text-muted)',
              display: 'flex',
              justifyContent: 'space-between',
            }}>
              <span>{fmt(ui.rmDoneCount, { done: doneCount, total: totalCount })}</span>
              <span style={{ color: 'var(--text-muted)' }} title={ui.rmToggleHint}>
                {fmt(ui.rmOnOffSummary, { on: enabledCount, off: scripts.length - enabledCount })}
              </span>
              {errorCount > 0 && <span style={{ color: 'var(--accent-danger)' }}>{fmt(ui.rmErrCount, { count: errorCount })}</span>}
            </div>
          )}

          {/* AI Regex Scan & Fix */}
          <div style={{
            padding: '12px 12px 8px',
            borderTop: '1px solid var(--border-subtle)',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}>
            <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
              {ui.rmCheckTitle}
            </div>
            {regexIssues.length > 0 && (
              <div style={{ fontSize: '0.7rem', color: 'var(--accent-warning)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span>{fmt(ui.rmIssueCount, { count: regexIssues.length })}</span>
              </div>
            )}
            
            {/* 1 nút: Quét & Sửa (pipeline 4 giai đoạn) */}
            {!isRegexAuto ? (
              <button
                onClick={handleRegexAuto}
                title={ui.rmScanFixTitle}
                style={{
                  padding: '8px', background: 'rgba(124,106,240,0.12)', border: '1px solid var(--accent-primary)',
                  borderRadius: 'var(--radius-sm)', color: 'var(--accent-primary)', fontSize: '0.78rem', fontWeight: 700,
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                }}
              >
                <Wrench size={13} /> {ui.rmScanFixBtn}
              </button>
            ) : (
              <button
                onClick={handleCancelRegexAuto}
                style={{
                  padding: '8px', background: 'rgba(255,82,82,0.1)', border: '1px solid rgba(255,82,82,0.3)',
                  borderRadius: 'var(--radius-sm)', color: 'var(--accent-danger)', fontSize: '0.78rem', fontWeight: 700,
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                }}
              >
                <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> {ui.rmStop}
              </button>
            )}
            {regexAutoProgress && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)' }}>{regexAutoProgress.phaseLabel}</div>
                {regexAutoProgress.total > 0 && regexAutoProgress.phase !== 'done' && (
                  <div className="progress-track" style={{ height: '4px' }}>
                    <div className="progress-fill" style={{ width: `${Math.round((regexAutoProgress.done / Math.max(1, regexAutoProgress.total)) * 100)}%` }} />
                  </div>
                )}
                <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>
                  {fmt(ui.rmAutoProgress, { err: regexAutoProgress.issues.filter(i => i.severity === 'error').length, fixed: regexAutoProgress.fixes.filter(f => f.success).length })}
                </div>
              </div>
            )}
          </div>

          {/* AI Chat button */}
          <div style={{
            padding: '8px 12px',
            borderTop: '1px solid var(--border-subtle)',
          }}>
            <button
              onClick={() => setShowAiChat(true)}
              style={{
                width: '100%',
                padding: '8px 12px',
                background: 'rgba(168, 85, 247, 0.1)',
                border: '1px solid rgba(168, 85, 247, 0.2)',
                borderRadius: 'var(--radius-sm)',
                color: '#c084fc',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                fontSize: '0.78rem',
                transition: 'all 0.15s'
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'rgba(168, 85, 247, 0.15)';
                e.currentTarget.style.borderColor = 'rgba(168, 85, 247, 0.3)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'rgba(168, 85, 247, 0.1)';
                e.currentTarget.style.borderColor = 'rgba(168, 85, 247, 0.2)';
              }}
            >
              <Sparkles size={12} style={{ flexShrink: 0 }} />
              <span>{ui.rmAiAssistant}</span>
            </button>
          </div>
        </div>

        {/* ══════ RIGHT MAIN ══════ */}
        <div className="regex-main">
          {/* Header */}
          <div style={{
            padding: '12px 20px',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Languages size={14} style={{ color: 'var(--accent-primary)' }} />
              <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{ui.rmTranslateRegex}</span>
            </div>

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: '6px' }}>
              {isTranslating ? (
                <button className="btn btn-danger btn-sm" onClick={handleCancel}>
                  <X size={12} /> {ui.rmCancel}
                </button>
              ) : (
                <button className="btn btn-primary btn-sm" onClick={handleTranslateAll} disabled={scripts.length === 0}>
                  <Languages size={12} /> {ui.rmTranslateAll}
                </button>
              )}
              {anyTranslating && !isTranslating && (
                <button
                  className="btn btn-danger btn-sm"
                  onClick={handleCancelAll}
                  title={ui.rmStopAllTitle}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    animation: 'pulse 2s ease-in-out infinite',
                  }}
                >
                  <CircleStop size={12} /> {ui.rmStopAll}
                </button>
              )}
              {doneCount > 0 && !isTranslating && (
                <button className="btn btn-secondary btn-sm" onClick={handleRetranslateAll}
                  title={ui.rmRetranslateAllTitle}
                >
                  <RefreshCw size={12} /> {ui.rmRetranslateAllBtn}
                </button>
              )}
              {doneCount > 0 && !isTranslating && (
                <button className="btn btn-secondary btn-sm" onClick={handleApplyToCard}>
                  <Save size={12} /> {ui.rmApplyToCard}
                </button>
              )}
              {!isTranslating && totalCount > 0 && (
                <button className="btn btn-secondary btn-sm" onClick={handleClearCache}
                  title={ui.rmClearCacheTitle}
                  style={{ color: 'var(--accent-danger)', borderColor: 'rgba(239, 68, 68, 0.3)' }}
                >
                  <Trash2 size={12} /> {ui.rmClearCache}
                </button>
              )}
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setShowAiChat(true)}
                style={{
                  color: '#c084fc',
                  borderColor: 'rgba(168, 85, 247, 0.3)',
                  background: 'rgba(168, 85, 247, 0.05)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <Sparkles size={12} /> {ui.rmAiAssistant}
              </button>
            </div>
          </div>

          {/* ─── Surgical Prompt Instructions ─── */}
          <SurgicalPromptSection />

          {/* ─── Content ─── */}
          <div className="regex-main-scroll">
            {scripts.length > 0 && fieldRows.length === 0 && (
              <div style={{
                padding: '12px 20px',
                background: 'rgba(239, 68, 68, 0.1)',
                borderBottom: '1px solid rgba(239, 68, 68, 0.2)',
                color: '#f87171',
                fontSize: '0.78rem',
                textAlign: 'center',
              }}>
                {ui.rmGroupDisabled}
              </div>
            )}
            {selectedScriptIdx === -1 ? (
              <ExternalLinkTab />
            ) : (
              <FieldsTab
                scripts={scripts}
                selectedScriptIdx={selectedScriptIdx}
                fieldRows={fieldRows}
                updateField={updateField}
                isTranslating={isTranslating}
                retranslateField={retranslateField}
                cancelFieldTranslation={cancelFieldTranslation}
              />
            )}
          </div>
        {showAiChat && (
          <AiCompanionPanel onClose={() => setShowAiChat(false)} />
        )}
      </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   TAB 1: Fields — list translatable regex fields
   ════════════════════════════════════════════════════════════════════ */
function FieldsTab({
  scripts,
  selectedScriptIdx,
  fieldRows,
  updateField,
  isTranslating,
  retranslateField,
  cancelFieldTranslation,
}: {
  scripts: RegexScript[];
  selectedScriptIdx: number;
  fieldRows: (RegexFieldRow & { path: string })[];
  updateField: (path: string, update: any) => void;
  isTranslating: boolean;
  retranslateField: (path: string) => Promise<void>;
  cancelFieldTranslation: (path: string) => void;
}) {
  const ui = useUi();
  const [retranslatingPaths, setRetranslatingPaths] = useState<Set<string>>(new Set());
  const selectedScript = scripts[selectedScriptIdx];
  if (!selectedScript) {
    return (
      <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
        <Regex size={32} style={{ opacity: 0.3, marginBottom: 12 }} />
        <div style={{ fontSize: '0.85rem' }}>{ui.rmPickScript}</div>
      </div>
    );
  }

  // Filter rows for this script
  const scriptRows = fieldRows.filter(r => r.scriptIndex === selectedScriptIdx);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* Script info header */}
      <div style={{
        padding: '12px 16px',
        background: 'var(--bg-primary)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-subtle)',
      }}>
        <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '6px' }}>
          {selectedScript.scriptName || `Script ${selectedScriptIdx + 1}`}
        </div>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', fontSize: '0.72rem' }}>
          <DetailBadge label="findRegex" value={selectedScript.findRegex || '—'} />
          <DetailBadge label="replaceString" value={(selectedScript.replaceString || '').slice(0, 60) + ((selectedScript.replaceString || '').length > 60 ? '...' : '')} />
          {selectedScript.trimStrings?.length ? (
            <DetailBadge label="trimStrings" value={`${selectedScript.trimStrings.length} items`} />
          ) : null}
        </div>
      </div>

      {/* Field rows */}
      {scriptRows.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '30px',
          color: 'var(--text-muted)', fontSize: '0.8rem',
        }}>
          {ui.rmNoField}
        </div>
      ) : (
        scriptRows.map((row, rIdx) => {
          const globalIdx = fieldRows.findIndex(
            r => r.scriptIndex === row.scriptIndex && r.fieldKey === row.fieldKey && r.subIndex === row.subIndex
          );
          return (
            <div key={rIdx} style={{
              padding: '12px 14px',
              background: 'var(--bg-primary)',
              borderRadius: 'var(--radius-md)',
              border: `1px solid ${
                row.status === 'error' ? 'rgba(240,106,106,0.3)' :
                row.status === 'done' ? 'rgba(106,240,138,0.2)' :
                row.status === 'translating' ? 'rgba(124,106,240,0.3)' :
                'var(--border-subtle)'
              }`,
              transition: 'border-color 0.2s',
            }}>
              {/* Field header */}
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                marginBottom: '8px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <code style={{
                    fontSize: '0.7rem', color: 'var(--accent-secondary)',
                    background: 'var(--bg-elevated)', padding: '2px 6px',
                    borderRadius: '3px', fontFamily: 'var(--font-mono)',
                  }}>
                    {row.fieldKey}{row.subIndex !== undefined ? `[${row.subIndex}]` : ''}
                  </code>
                  {row.status === 'done' && <Check size={12} style={{ color: 'var(--accent-success)' }} />}
                  {row.status === 'translating' && <Loader2 size={12} className="animate-spin" style={{ color: 'var(--accent-primary)' }} />}
                  {row.status === 'error' && (
                    <span style={{ fontSize: '0.65rem', color: 'var(--accent-danger)' }}>
                      {row.error?.slice(0, 40)}
                    </span>
                  )}
                </div>
                {row.status === 'translating' ? (
                  <button
                    onClick={() => cancelFieldTranslation(row.path)}
                    title={ui.rmStopFieldTitle}
                    style={{
                      background: 'none',
                      border: '1px solid rgba(239, 68, 68, 0.4)',
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--accent-danger)',
                      cursor: 'pointer',
                      padding: '3px 8px',
                      fontSize: '0.65rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      animation: 'pulse 2s ease-in-out infinite',
                    }}
                  >
                    <StopCircle size={10} /> {ui.rmStop}
                  </button>
                ) : (
                  <button
                    onClick={async () => {
                      setRetranslatingPaths(prev => new Set(prev).add(row.path));
                      try {
                        await retranslateField(row.path);
                      } catch (err) {
                        console.error(`Retranslate failed for ${row.path}:`, err);
                      } finally {
                        setRetranslatingPaths(prev => { const next = new Set(prev); next.delete(row.path); return next; });
                      }
                    }}
                    disabled={isTranslating}
                    title={ui.rmRetranslateFieldTitle}
                    style={{
                      background: 'none',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--text-muted)',
                      cursor: isTranslating ? 'not-allowed' : 'pointer',
                      padding: '3px 8px',
                      fontSize: '0.65rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      transition: 'all 0.15s',
                      opacity: isTranslating ? 0.4 : 1,
                    }}
                    onMouseEnter={e => { if (!isTranslating) { e.currentTarget.style.borderColor = 'var(--accent-primary)'; e.currentTarget.style.color = 'var(--accent-primary)'; } }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-subtle)'; e.currentTarget.style.color = 'var(--text-muted)'; }}
                  >
                    <RefreshCw size={10} /> {ui.rmRetranslate}
                  </button>
                )}
              </div>

              {/* Original */}
              <div style={{ marginBottom: '6px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
                  <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Original:</span>
                  <CopyButton text={row.original} />
                </div>
                <pre style={{
                  fontSize: '0.78rem', color: 'var(--text-secondary)',
                  fontFamily: 'var(--font-mono)',
                  whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                  maxHeight: '120px', overflowY: 'auto',
                  background: 'var(--bg-secondary)', padding: '6px 10px',
                  borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)',
                  margin: 0,
                }}>
                  {row.original || ui.rmEmpty}
                </pre>
              </div>

              {/* Translated */}
              <div>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: '2px' }}>Translated:</div>
                <textarea
                  value={row.translated}
                  onChange={(e) => {
                    updateField(row.path, {
                      translated: e.target.value,
                      status: e.target.value.trim() ? 'done' : 'pending'
                    });
                  }}
                  disabled={isTranslating}
                  style={{
                    width: '100%', minHeight: '50px',
                    background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)', padding: '6px 10px',
                    color: 'var(--text-primary)', fontFamily: 'var(--font-mono)',
                    fontSize: '0.78rem', resize: 'vertical', outline: 'none',
                    transition: 'border-color 0.2s',
                  }}
                  placeholder={ui.rmTranslatedPh}
                />
              </div>

              {/* HTML Preview for replaceString */}
              {row.fieldKey === 'replaceString' && (
                <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{ui.rmPreviewLabel}</div>
                  {/* (User 2026) 2 khung giãn ĐÚNG bằng nội dung — không còn cuộn riêng bên trong
                      (đã có cuộn của bảng ngoài rồi; cuộn lồng cuộn rất khó theo dõi). `align-items:
                      start` để 2 cột cao khác nhau không bị kéo bằng nhau. */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', alignItems: 'start' }}>
                    <div>
                      <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginBottom: '2px' }}>Original Preview:</div>
                      <AutoHeightPreview
                        name={`rmprev-o-${row.path}`}
                        title="Original Preview"
                        srcDoc={renderSafeHtml((row.original || '').replace(/\$[0-9&]+/g, ui.rmSampleContent))}
                      />
                    </div>
                    <div>
                      <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginBottom: '2px' }}>Translated Preview:</div>
                      <AutoHeightPreview
                        name={`rmprev-t-${row.path}`}
                        title="Translated Preview"
                        srcDoc={renderSafeHtml((row.translated || row.original || '').replace(/\$[0-9&]+/g, ui.rmSampleContent))}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

function DetailBadge({ label, value }: { label: string; value: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '4px',
      background: 'var(--bg-elevated)', padding: '2px 8px',
      borderRadius: '4px', fontFamily: 'var(--font-mono)',
    }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}:</span>
      <span style={{ color: 'var(--text-secondary)', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {value}
      </span>
    </span>
  );
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

/* ════════════════════════════════════════════════════════════════════
   Surgical Prompt Section — inline in RegexManager header
   ════════════════════════════════════════════════════════════════════ */
function SurgicalPromptSection() {
  const ui = useUi();
  // (bug 213) selector hẹp — destructure trần từ useStore() là subscribe TOÀN store: mọi
  // set() (addLog/updateField suốt lượt dịch) đều kéo component này re-render dù chẳng liên quan.
  const translationConfig = useStore((s) => s.translationConfig);
  const setTranslationConfig = useStore((s) => s.setTranslationConfig);
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div style={{
      borderBottom: '1px solid var(--border-subtle)',
      background: 'var(--bg-secondary)',
    }}>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          width: '100%',
          padding: '8px 20px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          fontSize: '0.72rem',
          fontWeight: 600,
          color: translationConfig.surgicalPrompt ? 'var(--accent-primary)' : 'var(--text-muted)',
          transition: 'all 0.15s',
        }}
      >
        <span style={{
          transform: isExpanded ? 'rotate(90deg)' : 'none',
          transition: 'transform 0.15s',
          display: 'inline-block',
          fontSize: '0.6rem',
        }}>▶</span>
        {ui.rmCustomInstruction}
        {translationConfig.surgicalPrompt && (
          <span style={{
            fontSize: '0.58rem',
            padding: '1px 6px',
            background: 'rgba(124,106,240,0.1)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--accent-primary)',
          }}>
            {ui.rmInUse}
          </span>
        )}
      </button>

      {isExpanded && (
        <div style={{ padding: '0 20px 12px' }}>
          <textarea
            className="input"
            style={{
              width: '100%',
              minHeight: '60px',
              fontSize: '0.75rem',
              resize: 'vertical',
              fontFamily: 'monospace',
            }}
            placeholder={ui.rmCustomInstructionPh}
            value={translationConfig.surgicalPrompt}
            onChange={(e) => setTranslationConfig({ surgicalPrompt: e.target.value })}
          />
          <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: '3px', lineHeight: '1.3' }}>
            {ui.rmCustomInstructionHint}
          </div>
        </div>
      )}
    </div>
  );
}

