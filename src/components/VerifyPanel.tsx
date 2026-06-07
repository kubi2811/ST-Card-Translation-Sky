import { useState, useCallback, useMemo, useRef } from 'react';
import { useStore } from '../store';
import { useTranslation } from '../hooks/useTranslation';
import { useT } from '../i18n/useLocale';
import { aiVerifyCard, aiVerifyCardStreaming, aiRegexScan, aiRegexFixAll, quickVerify, extractSystemReferences, verifyFields, applyAutoFix, aiFixIssues, aiFixSingleIssue } from '../utils/aiVerify';
import type { VerifyIssue, VerifyResult, FieldIssue, AIFixReport, StreamingVerifyProgress, RegexScanProgress, RegexFixResult } from '../utils/aiVerify';
import { crossCheckHtmlVsInitvar, validateFindRegexVsNarrative } from '../utils/mvuValidator';
import type { CrossCheckResult, FindRegexValidationResult } from '../utils/mvuValidator';
import { ShieldCheck, AlertTriangle, AlertCircle, Info, Loader2, Zap, Eye, ChevronDown, ChevronUp, Wrench, FileWarning, Code2, Braces, Hash, Type, ArrowLeftRight, CheckCircle2, Pencil, Save, Bot, XCircle, Link2, Diff, GitCompare, Fingerprint, Regex, Check, X, Copy } from 'lucide-react';

const SEVERITY_CONFIG = {
  error: { color: 'var(--accent-danger)', bg: 'rgba(255,82,82,0.06)', icon: AlertCircle, label: 'Error' },
  warning: { color: 'var(--accent-warning)', bg: 'rgba(240,196,106,0.06)', icon: AlertTriangle, label: 'Warning' },
  info: { color: 'var(--accent-primary)', bg: 'rgba(124,106,240,0.06)', icon: Info, label: 'Info' },
};

/** Map category key to i18n translation key */
const CATEGORY_I18N_KEY: Record<string, string> = {
  residual_source: 'catResidualSource',
  html_broken: 'catHtmlBroken',
  bracket_mismatch: 'catBracketMismatch',
  macro_damaged: 'catMacroDamaged',
  json_broken: 'catJsonBroken',
  mvu_inconsistent: 'catMvuInconsistent',
  length_anomaly: 'catLengthAnomaly',
  empty_translation: 'catEmpty',
  json_patch_broken: 'catJsonPatchBroken',
  zod_schema_mismatch: 'catZodSchemaMismatch',
  regex_broken: 'catRegexBroken',
  code_splice: 'catCodeSplice',
  structural_truncation: 'catStructuralTruncation',
  css_class_sync: 'catCssClassSync',
  function_signature: 'catFunctionSignature',
  template_literal_content: 'catTemplateLiteralContent',
};

const CATEGORY_ICON: Record<string, typeof Code2> = {
  residual_source: Type, html_broken: Code2, bracket_mismatch: Braces,
  macro_damaged: Hash, json_broken: FileWarning, mvu_inconsistent: ArrowLeftRight,
  length_anomaly: AlertTriangle, empty_translation: AlertCircle,
  json_patch_broken: FileWarning, zod_schema_mismatch: Braces,
  regex_broken: Code2, code_splice: Braces, structural_truncation: AlertCircle,
  css_class_sync: Fingerprint, function_signature: Code2, template_literal_content: Hash,
};

type VerifyTab = 'field' | 'card';

export default function VerifyPanel() {
  const store = useStore();
  const { card, fields, proxy, translationConfig, locale, addToast, addLog, updateField } = store;
  const { getExportCard } = useTranslation();
  const t = useT() as Record<string, string>;
  const isVi = locale === 'vi';

  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
  const [fieldIssues, setFieldIssues] = useState<FieldIssue[]>([]);
  const [isVerifying, setIsVerifying] = useState(false);
  const [activeTab, setActiveTab] = useState<VerifyTab>('field');
  const [expandedIssues, setExpandedIssues] = useState<Set<string>>(new Set());
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<string | null>(null);
  const [refStats, setRefStats] = useState<{ total: number; types: Record<string, number> } | null>(null);
  const [isAIFixing, setIsAIFixing] = useState(false);
  const [aiFixProgress, setAiFixProgress] = useState('');
  const [aiFixReport, setAiFixReport] = useState<AIFixReport | null>(null);
  const [aiFixingIssueId, setAiFixingIssueId] = useState<string | null>(null);
  const aiFixAbortRef = useRef<AbortController | null>(null);
  const [crossCheckResult, setCrossCheckResult] = useState<CrossCheckResult | null>(null);
  const [findRegexResult, setFindRegexResult] = useState<FindRegexValidationResult | null>(null);
  // Streaming verify state
  const [streamingProgress, setStreamingProgress] = useState<StreamingVerifyProgress | null>(null);
  const aiVerifyAbortRef = useRef<AbortController | null>(null);
  // Diff viewer state
  const [showDiff, setShowDiff] = useState(false);
  const [diffFieldPath, setDiffFieldPath] = useState<string>('');
  // Regex scan & fix state
  const [regexScanProgress, setRegexScanProgress] = useState<RegexScanProgress | null>(null);
  const [regexIssues, setRegexIssues] = useState<VerifyIssue[]>([]);
  const [regexFixResults, setRegexFixResults] = useState<RegexFixResult[]>([]);
  const [isRegexScanning, setIsRegexScanning] = useState(false);
  const [isRegexFixing, setIsRegexFixing] = useState(false);
  const [regexFixProgress, setRegexFixProgress] = useState('');
  const regexAbortRef = useRef<AbortController | null>(null);

  const doneCount = fields.filter(f => f.status === 'done').length;

  const toggleIssue = (id: string) => {
    setExpandedIssues(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // ─── Field-level verify ───
  const handleFieldVerify = useCallback(() => {
    setIsVerifying(true);
    setActiveTab('field');
    try {
      const issues = verifyFields(fields, translationConfig.mvuDictionary, translationConfig.sourceLanguage);
      setFieldIssues(issues);
      addLog('info', `Field verify: ${issues.length} issues (${issues.filter(i => i.severity === 'error').length} errors)`);

      // ─── Cross-check: HTML ↔ Initvar ───
      const regexFields = fields
        .filter(f => f.group === 'regex' && f.path.includes('replaceString') && f.translated)
        .map(f => ({ translated: f.translated, label: f.label }));
      const initvarFields = fields
        .filter(f => f.entryType === 'initvar' && f.translated)
        .map(f => ({ translated: f.translated, label: f.label }));
      if (regexFields.length > 0 && (initvarFields.length > 0 || Object.keys(translationConfig.mvuDictionary).length > 0)) {
        const crossCheck = crossCheckHtmlVsInitvar(regexFields, initvarFields, translationConfig.mvuDictionary);
        setCrossCheckResult(crossCheck);
      } else {
        setCrossCheckResult(null);
      }

      // ─── Cross-check: findRegex ↔ Narrative ───
      const findRegexFields = fields
        .filter(f => f.group === 'regex' && f.path.includes('findRegex') && f.translated)
        .map(f => ({ findRegex: f.translated, label: f.label }));
      const narrativeFields = fields
        .filter(f => ['core', 'messages', 'system'].includes(f.group) && f.translated)
        .map(f => ({ translated: f.translated, label: f.label }));
      if (findRegexFields.length > 0 && narrativeFields.length > 0) {
        const frResult = validateFindRegexVsNarrative(findRegexFields, narrativeFields);
        setFindRegexResult(frResult);
      } else {
        setFindRegexResult(null);
      }

      if (issues.length === 0) {
        addToast('success', t.verifyNoIssues);
      }
    } catch (err) {
      addToast('error', `Verify failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsVerifying(false);
    }
  }, [fields, translationConfig, addLog, addToast, isVi]);

  // ─── Card-level quick verify ───
  const handleQuickVerify = useCallback(() => {
    if (!card) return;
    setIsVerifying(true);
    setActiveTab('card');
    try {
      const exportCard = getExportCard();
      if (!exportCard) { addToast('error', isVi ? 'Không thể tạo card xuất' : 'Cannot generate export card'); return; }
      const origRefs = extractSystemReferences(card);
      const types: Record<string, number> = {};
      for (const r of origRefs) types[r.type] = (types[r.type] || 0) + 1;
      setRefStats({ total: origRefs.length, types });
      const issues = quickVerify(card, exportCard);
      setVerifyResult({
        totalIssues: issues.length,
        errors: issues.filter(i => i.severity === 'error').length,
        warnings: issues.filter(i => i.severity === 'warning').length,
        info: issues.filter(i => i.severity === 'info').length,
        issues,
        summary: issues.length === 0
          ? t.verifyAllRefsValid
          : t.verifyFoundIssues.replace('{count}', String(issues.length)),
      });
    } catch (err) {
      addToast('error', `Verify failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsVerifying(false);
    }
  }, [card, getExportCard, addToast, isVi, addLog]);

  // ─── AI deep verify (streaming) ───
  const handleAIVerify = useCallback(async () => {
    if (!card) return;
    setIsVerifying(true);
    setActiveTab('card');
    setStreamingProgress(null);
    aiVerifyAbortRef.current = new AbortController();
    try {
      const exportCard = getExportCard();
      if (!exportCard) { addToast('error', isVi ? 'Không thể tạo card xuất' : 'Cannot generate export card'); return; }
      addLog('active', isVi ? '🔍 AI Streaming — quét từng section...' : '🔍 AI Streaming — scanning sections...');
      const result = await aiVerifyCardStreaming(
        card, exportCard, proxy, translationConfig.targetLanguage,
        translationConfig.mvuDictionary,
        (progress) => setStreamingProgress({ ...progress }),
        aiVerifyAbortRef.current.signal,
      );
      setVerifyResult(result);
      setStreamingProgress(prev => prev ? { ...prev, status: 'done' } : null);
      addLog(result.errors > 0 ? 'error' : 'success', `AI Verify: ${result.errors} errors, ${result.warnings} warnings — ${result.summary}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg !== 'The operation was aborted.' && msg !== 'AbortError') {
        addToast('error', `AI Verify failed: ${msg}`);
      }
    } finally {
      setIsVerifying(false);
      aiVerifyAbortRef.current = null;
    }
  }, [card, getExportCard, proxy, translationConfig, addToast, addLog, isVi]);

  // ─── Cancel AI Verify ───
  const handleCancelAIVerify = useCallback(() => {
    aiVerifyAbortRef.current?.abort();
    addLog('warning', isVi ? '🛑 AI Verify đã hủy' : '🛑 AI Verify cancelled');
  }, [addLog, isVi]);

  // ─── Regex Scan ───
  const handleRegexScan = useCallback(async () => {
    setIsRegexScanning(true);
    setRegexScanProgress(null);
    setRegexIssues([]);
    setRegexFixResults([]);
    regexAbortRef.current = new AbortController();
    try {
      addLog('active', isVi ? '🔍 Đang quét regex scripts...' : '🔍 Scanning regex scripts...');
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
        isVi ? `Regex scan: ${errCount} lỗi, ${warnCount} cảnh báo` : `Regex scan: ${errCount} errors, ${warnCount} warnings`);
      if (issues.length === 0) addToast('success', isVi ? '✅ Regex sạch!' : '✅ Regex clean!');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg !== 'The operation was aborted.' && msg !== 'AbortError') {
        addToast('error', `Regex scan failed: ${msg}`);
      }
    } finally {
      setIsRegexScanning(false);
      regexAbortRef.current = null;
    }
  }, [fields, proxy, translationConfig, addLog, addToast, isVi]);

  const handleCancelRegexScan = useCallback(() => {
    regexAbortRef.current?.abort();
    addLog('warning', isVi ? '🛑 Regex scan đã hủy' : '🛑 Regex scan cancelled');
  }, [addLog, isVi]);

  // ─── Regex Fix All ───
  const handleRegexFix = useCallback(async () => {
    if (regexIssues.length === 0) return;
    setIsRegexFixing(true);
    setRegexFixResults([]);
    regexAbortRef.current = new AbortController();
    try {
      addLog('active', isVi ? `🔧 Đang sửa ${regexIssues.length} lỗi regex...` : `🔧 Fixing ${regexIssues.length} regex issues...`);
      const results = await aiRegexFixAll(
        regexIssues, fields, proxy, translationConfig.targetLanguage,
        translationConfig.mvuDictionary, translationConfig.sourceLanguage,
        ({ fixing, done, total, results: r }) => {
          setRegexFixProgress(isVi ? `Sửa ${done}/${total}: ${fixing}` : `Fix ${done}/${total}: ${fixing}`);
          setRegexFixResults([...r]);
        },
        regexAbortRef.current.signal,
      );
      setRegexFixResults(results);
      const accepted = results.filter(r => r.success).length;
      const rejected = results.filter(r => !r.success).length;
      const summary = t.regexFixDone.replace('{accepted}', String(accepted)).replace('{rejected}', String(rejected));
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
  }, [regexIssues, fields, proxy, translationConfig, addLog, addToast, isVi, t]);

  // ─── Apply single regex fix ───
  const handleApplyRegexFix = useCallback((result: RegexFixResult) => {
    if (!result.success || !result.after) return;
    updateField(result.fieldPath, { translated: result.after });
    addLog('success', `✅ Applied regex fix: ${result.scriptName} → ${result.fieldType}`);
    addToast('success', isVi ? `Đã áp dụng: ${result.scriptName}` : `Applied: ${result.scriptName}`);
  }, [updateField, addLog, addToast, isVi]);

  // ─── Apply all successful regex fixes ───
  const handleApplyAllRegexFixes = useCallback(() => {
    const successful = regexFixResults.filter(r => r.success && r.after);
    for (const r of successful) {
      updateField(r.fieldPath, { translated: r.after });
    }
    addLog('success', isVi ? `✅ Đã áp dụng ${successful.length} regex fix` : `✅ Applied ${successful.length} regex fixes`);
    addToast('success', isVi ? `${successful.length} regex đã sửa` : `${successful.length} regex fixed`);
  }, [regexFixResults, updateField, addLog, addToast, isVi]);

  // ─── Auto-fix handler ───
  const handleAutoFix = useCallback((issue: FieldIssue) => {
    const newFields = applyAutoFix(issue, fields);
    const changed = newFields.find(f => f.path === issue.fixPath);
    if (changed) {
      updateField(changed.path, { translated: changed.translated });
      // For compound fixes (e.g. macro_damaged), remove all issues sharing the same fixPath+category
      setFieldIssues(prev => prev.filter(i =>
        !(i.fixPath === issue.fixPath && i.category === issue.category && i.autoFixable)
      ));
      addLog('success', `🔧 Auto-fixed: ${issue.location} — ${issue.category}`);
      addToast('success', t.verifyFixed.replace('{location}', issue.location));
    }
  }, [fields, updateField, addLog, addToast, t]);

  // ─── Fix all auto-fixable ───
  const handleFixAll = useCallback(() => {
    let fixCount = 0;
    const fixable = fieldIssues.filter(i => i.autoFixable);
    for (const issue of fixable) {
      if (issue.fixPath && issue.fixValue) {
        updateField(issue.fixPath, { translated: issue.fixValue });
        fixCount++;
      }
    }
    setFieldIssues(prev => prev.filter(i => !i.autoFixable));
    addLog('success', `🔧 Auto-fixed ${fixCount} issues`);
    addToast('success', t.verifyAutoFixed.replace('{count}', String(fixCount)));
  }, [fieldIssues, updateField, addLog, addToast, isVi]);

  // ─── AI Fix all issues (multi-round) ───
  const handleAIFix = useCallback(async () => {
    aiFixAbortRef.current = new AbortController();
    setIsAIFixing(true);
    setAiFixReport(null);
    setAiFixProgress(isVi ? 'Đang chuẩn bị...' : 'Preparing...');
    try {
      const allIssues: (FieldIssue | VerifyIssue)[] = [
        ...fieldIssues,
        ...(verifyResult?.issues || []),
      ];
      if (allIssues.length === 0) {
        addToast('info', isVi ? 'Không có lỗi để sửa' : 'No issues to fix');
        return;
      }
      addLog('active', isVi ? `🤖 AI đang sửa ${allIssues.length} lỗi (tối đa 3 round)...` : `🤖 AI fixing ${allIssues.length} issues (up to 3 rounds)...`);

      const report = await aiFixIssues(
        allIssues, fields, proxy, translationConfig.targetLanguage,
        (done, total, label, round) => {
          setAiFixProgress(isVi
            ? `Round ${round || 1}/3 — Sửa ${done}/${total}: ${label}`
            : `Round ${round || 1}/3 — Fixing ${done}/${total}: ${label}`);
        },
        aiFixAbortRef.current.signal,
        translationConfig.mvuDictionary,
        translationConfig.sourceLanguage
      );

      setAiFixReport(report);

      // Apply accepted fixes
      for (const { path, fixedText } of report.fixes) {
        updateField(path, { translated: fixedText });
      }

      const summary = isVi
        ? `🤖 AI: ${report.fixes.length} sửa, ${report.totalRejected} từ chối, ${report.roundsCompleted} rounds`
        : `🤖 AI: ${report.fixes.length} fixed, ${report.totalRejected} rejected, ${report.roundsCompleted} rounds`;
      addLog(report.fixes.length > 0 ? 'success' : 'warning', summary);
      addToast(report.fixes.length > 0 ? 'success' : 'info', summary);

      // Log rejected reasons
      for (const entry of report.report.filter(r => r.status === 'rejected')) {
        addLog('info', `❌ Rejected ${entry.label}: ${entry.reason}`);
      }

      // Re-verify
      if (report.fixes.length > 0) {
        const updatedFields = fields.map(f => {
          const fix = report.fixes.find(fx => fx.path === f.path);
          return fix ? { ...f, translated: fix.fixedText } : f;
        });
        const remaining = verifyFields(updatedFields, translationConfig.mvuDictionary, translationConfig.sourceLanguage);
        setFieldIssues(remaining);
        setVerifyResult(null);
        setActiveTab('field');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg !== 'The operation was aborted.' && msg !== 'AbortError') {
        addToast('error', `AI Fix failed: ${msg}`);
      }
    } finally {
      setIsAIFixing(false);
      setAiFixProgress('');
      aiFixAbortRef.current = null;
    }
  }, [fieldIssues, verifyResult, fields, proxy, translationConfig, updateField, addLog, addToast, isVi]);

  // ─── Cancel AI Fix ───
  const handleCancelAIFix = useCallback(() => {
    aiFixAbortRef.current?.abort();
    addLog('warning', isVi ? '🛑 AI Fix đã bị hủy' : '🛑 AI Fix cancelled');
  }, [addLog, isVi]);

  // ─── AI Fix single issue ───
  const handleAISingleFix = useCallback(async (issue: FieldIssue) => {
    setAiFixingIssueId(issue.id);
    try {
      const result = await aiFixSingleIssue(
        issue, fields, proxy, translationConfig.targetLanguage,
        undefined,
        translationConfig.mvuDictionary,
        translationConfig.sourceLanguage
      );
      if (result.success && result.fixedText) {
        updateField(issue.fieldPath, { translated: result.fixedText });
        setFieldIssues(prev => prev.filter(i => i.id !== issue.id));
        addLog('success', `🤖 AI fixed: ${issue.location} — ${issue.category}`);
        addToast('success', isVi ? `AI đã sửa ${issue.location}` : `AI fixed ${issue.location}`);
      } else {
        addLog('warning', `🤖 AI could not fix ${issue.location}: ${result.reason}`);
        addToast('info', isVi ? `AI không sửa được: ${result.reason}` : `AI could not fix: ${result.reason}`);
      }
    } catch (err) {
      addToast('error', `AI Fix failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setAiFixingIssueId(null);
    }
  }, [fields, proxy, translationConfig, updateField, addLog, addToast, isVi]);

  // ─── Derived data ───
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const i of fieldIssues) counts[i.category] = (counts[i.category] || 0) + 1;
    return counts;
  }, [fieldIssues]);

  const filteredFieldIssues = useMemo(() => {
    let list = fieldIssues;
    if (categoryFilter) list = list.filter(i => i.category === categoryFilter);
    if (severityFilter) list = list.filter(i => i.severity === severityFilter);
    return list;
  }, [fieldIssues, categoryFilter, severityFilter]);

  const autoFixableCount = fieldIssues.filter(i => i.autoFixable).length;
  const fieldErrors = fieldIssues.filter(i => i.severity === 'error').length;
  const fieldWarnings = fieldIssues.filter(i => i.severity === 'warning').length;

  // Early return AFTER all hooks to comply with Rules of Hooks
  if (!card || doneCount === 0) return null;

  return (
    <div className="card fade-in" style={{ padding: '20px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <ShieldCheck size={18} color="var(--accent-primary)" />
          <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>
            {t.verifyTitle}
          </h3>
        </div>
        {fieldIssues.length > 0 && (
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            {fieldErrors > 0 && <Badge color="var(--accent-danger)" bg="rgba(255,82,82,0.1)" text={`${fieldErrors} ${t.verifyErrors}`} />}
            {fieldWarnings > 0 && <Badge color="var(--accent-warning)" bg="rgba(240,196,106,0.1)" text={`${fieldWarnings} ${t.verifyWarnings}`} />}
            {fieldIssues.length === 0 && <Badge color="var(--accent-success)" bg="rgba(76,175,80,0.1)" text={`✅ ${t.verifyPass}`} />}
          </div>
        )}
      </div>

      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '12px', lineHeight: 1.5 }}>
        {t.verifyDesc}
      </p>

      {/* Action Buttons */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '14px', flexWrap: 'wrap' }}>
        <button className="btn btn-primary" onClick={handleFieldVerify} disabled={isVerifying}
          style={{ flex: '1 1 120px', padding: '8px 12px', fontSize: '0.8rem' }}>
          {isVerifying && activeTab === 'field'
            ? <><Loader2 size={14} className="spin" /> {t.verifyChecking}</>
            : <><Zap size={14} /> {t.verifyFields}</>}
        </button>
        <button className="btn btn-secondary" onClick={handleQuickVerify} disabled={isVerifying}
          style={{ flex: '1 1 120px', padding: '8px 12px', fontSize: '0.8rem' }}>
          {isVerifying && activeTab === 'card'
            ? <><Loader2 size={14} className="spin" /> ...</>
            : <><ShieldCheck size={14} /> {t.verifyCheckRefs}</>}
        </button>
        <div style={{ display: 'flex', gap: '3px', flex: '1 1 140px' }}>
          <button className="btn btn-secondary" onClick={handleAIVerify}
            disabled={isVerifying && activeTab === 'card'}
            style={{ flex: 1, padding: '8px 12px', fontSize: '0.8rem',
              background: isVerifying && activeTab === 'card' ? 'linear-gradient(135deg, var(--accent-primary), #a78bfa)' : undefined,
              color: isVerifying && activeTab === 'card' ? '#fff' : undefined }}>
            {isVerifying && activeTab === 'card'
              ? <><Loader2 size={14} className="spin" /> {streamingProgress
                  ? `${streamingProgress.sectionIndex}/${streamingProgress.totalSections}`
                  : t.verifyChecking}</>
              : <><Eye size={14} /> {t.verifyAIDeep}</>}
          </button>
          {isVerifying && activeTab === 'card' && (
            <button className="btn btn-secondary" onClick={handleCancelAIVerify}
              style={{ padding: '8px', fontSize: '0.8rem', color: 'var(--accent-danger)' }}>
              <XCircle size={14} />
            </button>
          )}
        </div>
        <button className="btn btn-secondary" onClick={() => setShowDiff(!showDiff)}
          disabled={fields.filter(f => f.translated).length === 0}
          style={{ padding: '8px 12px', fontSize: '0.8rem',
            background: showDiff ? 'rgba(124,106,240,0.12)' : undefined,
            color: showDiff ? 'var(--accent-primary)' : undefined }}>
          <GitCompare size={14} /> {t.diffCompare}
        </button>
        <div style={{ display: 'flex', gap: '3px' }}>
          <button className="btn btn-secondary" onClick={handleRegexScan}
            disabled={isRegexScanning || isVerifying || fields.filter(f => f.group === 'regex' && f.translated).length === 0}
            style={{ padding: '8px 12px', fontSize: '0.8rem',
              background: isRegexScanning ? 'linear-gradient(135deg, #f59e0b, #ef4444)' : undefined,
              color: isRegexScanning ? '#fff' : undefined }}>
            {isRegexScanning
              ? <><Loader2 size={14} className="spin" /> {regexScanProgress
                  ? `${regexScanProgress.regexIndex}/${regexScanProgress.totalRegex}`
                  : '...'}</>
              : <><Regex size={14} /> {t.regexScanBtn}</>}
          </button>
          {isRegexScanning && (
            <button className="btn btn-secondary" onClick={handleCancelRegexScan}
              style={{ padding: '8px', color: 'var(--accent-danger)' }}>
              <XCircle size={14} />
            </button>
          )}
        </div>
      </div>

      {/* ═══ Streaming Progress Panel ═══ */}
      {streamingProgress && streamingProgress.status !== 'done' && (
        <div style={{ padding: '10px 12px', background: 'rgba(124,106,240,0.04)', border: '1px solid rgba(124,106,240,0.12)',
          borderRadius: 'var(--radius-md)', marginBottom: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
            <Loader2 size={14} className="spin" color="var(--accent-primary)" />
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              {t.verifyScanning.replace('{section}', streamingProgress.currentSection || '...')}
            </span>
            <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
              {t.verifySectionProgress
                .replace('{current}', String(streamingProgress.sectionIndex))
                .replace('{total}', String(streamingProgress.totalSections))}
            </span>
          </div>
          {/* Progress bar */}
          <div style={{ height: '4px', background: 'rgba(124,106,240,0.1)', borderRadius: '2px', overflow: 'hidden', marginBottom: '8px' }}>
            <div style={{
              height: '100%', borderRadius: '2px', transition: 'width 0.4s ease',
              background: 'linear-gradient(90deg, var(--accent-primary), #a78bfa)',
              width: `${streamingProgress.totalSections > 0 ? (streamingProgress.sectionIndex / streamingProgress.totalSections * 100) : 0}%`,
            }} />
          </div>
          {/* Section badges */}
          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
            {streamingProgress.sectionResults.map((sr, idx) => {
              const statusColor = sr.status === 'ok' ? 'var(--accent-success)'
                : sr.status === 'issues' ? 'var(--accent-danger)'
                : sr.status === 'error' ? 'var(--accent-warning)'
                : 'var(--text-muted)';
              const statusBg = sr.status === 'ok' ? 'rgba(76,175,80,0.1)'
                : sr.status === 'issues' ? 'rgba(255,82,82,0.1)'
                : sr.status === 'error' ? 'rgba(240,196,106,0.1)'
                : 'rgba(124,106,240,0.05)';
              const statusIcon = sr.status === 'ok' ? '✅' : sr.status === 'issues' ? '❌' : sr.status === 'error' ? '⚠️' : '⏳';
              return (
                <span key={idx} style={{
                  padding: '2px 6px', borderRadius: '8px', fontSize: '0.58rem', fontWeight: 500,
                  background: statusBg, color: statusColor, whiteSpace: 'nowrap',
                }}>
                  {statusIcon} {sr.name.length > 25 ? sr.name.slice(0, 25) + '…' : sr.name}
                  {sr.issueCount > 0 && ` (${sr.issueCount})`}
                </span>
              );
            })}
          </div>
          {/* Accumulated issues count */}
          {streamingProgress.issuesSoFar.length > 0 && (
            <div style={{ marginTop: '6px', fontSize: '0.68rem', color: 'var(--text-secondary)' }}>
              {isVi ? `Đã tìm thấy ${streamingProgress.issuesSoFar.length} lỗi` : `Found ${streamingProgress.issuesSoFar.length} issues so far`}
            </div>
          )}
        </div>
      )}

      {/* ═══ Regex Scan Progress Panel ═══ */}
      {regexScanProgress && (
        <div style={{ padding: '10px 12px', background: 'rgba(245,158,11,0.04)', border: '1px solid rgba(245,158,11,0.15)',
          borderRadius: 'var(--radius-md)', marginBottom: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
            <Regex size={14} color="#f59e0b" />
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              {regexScanProgress.status === 'done'
                ? t.regexScanDone.replace('{count}', String(regexScanProgress.totalRegex))
                : regexScanProgress.status === 'cancelled'
                  ? (isVi ? 'Đã hủy' : 'Cancelled')
                  : t.regexScanning.replace('{name}', regexScanProgress.currentRegex || '...')}
            </span>
            <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
              {regexScanProgress.regexIndex}/{regexScanProgress.totalRegex}
            </span>
          </div>
          {/* Progress bar */}
          <div style={{ height: '4px', background: 'rgba(245,158,11,0.1)', borderRadius: '2px', overflow: 'hidden', marginBottom: '8px' }}>
            <div style={{
              height: '100%', borderRadius: '2px', transition: 'width 0.4s ease',
              background: 'linear-gradient(90deg, #f59e0b, #ef4444)',
              width: `${regexScanProgress.totalRegex > 0 ? (regexScanProgress.regexIndex / regexScanProgress.totalRegex * 100) : 0}%`,
            }} />
          </div>
          {/* Regex section badges */}
          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
            {regexScanProgress.regexResults.map((sr, idx) => {
              const statusIcon = sr.status === 'ok' ? '✅' : sr.status === 'issues' ? '❌' : sr.status === 'error' ? '⚠️' : '⏳';
              const statusColor = sr.status === 'ok' ? 'var(--accent-success)' : sr.status === 'issues' ? 'var(--accent-danger)' : sr.status === 'error' ? 'var(--accent-warning)' : 'var(--text-muted)';
              return (
                <span key={idx} style={{
                  padding: '2px 6px', borderRadius: '8px', fontSize: '0.58rem', fontWeight: 500,
                  background: `${statusColor}15`, color: statusColor, whiteSpace: 'nowrap',
                }}>
                  {statusIcon} {sr.name.length > 20 ? sr.name.slice(0, 20) + '…' : sr.name}
                  {sr.issueCount > 0 && ` (${sr.issueCount})`}
                </span>
              );
            })}
          </div>
          {/* Issues summary + Fix button */}
          {regexScanProgress.status === 'done' && regexIssues.length > 0 && (
            <div style={{ marginTop: '8px', display: 'flex', gap: '6px', alignItems: 'center' }}>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                {isVi ? `${regexIssues.filter(i => i.severity === 'error').length} lỗi, ${regexIssues.filter(i => i.severity === 'warning').length} cảnh báo`
                  : `${regexIssues.filter(i => i.severity === 'error').length} errors, ${regexIssues.filter(i => i.severity === 'warning').length} warnings`}
              </span>
              <button className="btn btn-primary" onClick={handleRegexFix}
                disabled={isRegexFixing}
                style={{ marginLeft: 'auto', padding: '5px 12px', fontSize: '0.72rem',
                  background: isRegexFixing ? 'linear-gradient(135deg, #f59e0b, #ef4444)' : 'linear-gradient(135deg, #ef4444, #f59e0b)',
                  border: 'none', color: '#fff', opacity: isRegexFixing ? 0.8 : 1 }}>
                {isRegexFixing
                  ? <><Loader2 size={13} className="spin" /> {regexFixProgress}</>
                  : <><Wrench size={13} /> {t.regexFixBtn.replace('{count}', String(regexIssues.length))}</>}
              </button>
              {isRegexFixing && (
                <button className="btn btn-secondary" onClick={handleCancelRegexScan}
                  style={{ padding: '5px 8px', color: 'var(--accent-danger)' }}>
                  <XCircle size={13} />
                </button>
              )}
            </div>
          )}
          {regexScanProgress.status === 'done' && regexIssues.length === 0 && (
            <div style={{ marginTop: '6px', fontSize: '0.72rem', color: 'var(--accent-success)', fontWeight: 600 }}>
              ✅ {isVi ? 'Tất cả regex scripts đều sạch!' : 'All regex scripts are clean!'}
            </div>
          )}
        </div>
      )}

      {/* ═══ Regex Scan Issues List ═══ */}
      {regexIssues.length > 0 && !isRegexFixing && regexFixResults.length === 0 && (
        <div style={{ maxHeight: '300px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '10px' }}>
          {regexIssues.map(issue => <IssueRow key={issue.id} issue={issue} isVi={isVi}
            expanded={expandedIssues.has(issue.id)} onToggle={() => toggleIssue(issue.id)} />)}
        </div>
      )}

      {/* ═══ Regex Fix Results ═══ */}
      {regexFixResults.length > 0 && (
        <div style={{ padding: '10px 12px', background: 'rgba(76,175,80,0.03)', border: '1px solid rgba(76,175,80,0.15)',
          borderRadius: 'var(--radius-md)', marginBottom: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <Wrench size={14} color="var(--accent-success)" />
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              {t.regexFixDone
                .replace('{accepted}', String(regexFixResults.filter(r => r.success).length))
                .replace('{rejected}', String(regexFixResults.filter(r => !r.success).length))}
            </span>
            {regexFixResults.filter(r => r.success).length > 0 && (
              <button className="btn btn-primary" onClick={handleApplyAllRegexFixes}
                style={{ marginLeft: 'auto', padding: '4px 10px', fontSize: '0.68rem',
                  background: 'var(--accent-success)', border: 'none', color: '#fff' }}>
                <Check size={12} /> {t.regexAcceptAll.replace('{count}', String(regexFixResults.filter(r => r.success).length))}
              </button>
            )}
          </div>
          {/* Individual fix results */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', maxHeight: '400px', overflowY: 'auto' }}>
            {regexFixResults.map((r, i) => (
              <div key={i} style={{
                padding: '8px', borderRadius: 'var(--radius-sm)',
                border: `1px solid ${r.success ? 'rgba(76,175,80,0.2)' : 'rgba(255,82,82,0.2)'}`,
                background: r.success ? 'rgba(76,175,80,0.03)' : 'rgba(255,82,82,0.03)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                  {r.success ? <CheckCircle2 size={13} color="var(--accent-success)" /> : <XCircle size={13} color="var(--accent-danger)" />}
                  <span style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                    {r.scriptName} → {r.fieldType}
                  </span>
                  {!r.success && r.reason && (
                    <span style={{ fontSize: '0.6rem', color: 'var(--accent-danger)', marginLeft: 'auto' }}>
                      {r.reason}
                    </span>
                  )}
                  {r.success && (
                    <button onClick={() => handleApplyRegexFix(r)}
                      className="btn btn-ghost btn-xs" style={{ marginLeft: 'auto', padding: '2px 8px', fontSize: '0.6rem', color: 'var(--accent-success)' }}>
                      <Check size={11} /> {t.regexAccept}
                    </button>
                  )}
                </div>
                {/* Preview: before → after (collapsed by default, click to expand) */}
                {r.success && r.after && (
                  <details>
                    <summary style={{ fontSize: '0.6rem', color: 'var(--text-muted)', cursor: 'pointer' }}>
                      {isVi ? 'Xem chi tiết' : 'View changes'} ({r.before.length}→{r.after.length} chars)
                    </summary>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', marginTop: '4px' }}>
                      <pre style={{
                        margin: 0, padding: '5px', fontSize: '0.56rem', lineHeight: 1.3,
                        background: 'rgba(255,82,82,0.04)', border: '1px solid rgba(255,82,82,0.1)',
                        borderRadius: '4px', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                        maxHeight: '150px', overflowY: 'auto', color: 'var(--text-muted)',
                      }}>
                        {r.before.slice(0, 3000)}
                      </pre>
                      <pre style={{
                        margin: 0, padding: '5px', fontSize: '0.56rem', lineHeight: 1.3,
                        background: 'rgba(76,175,80,0.04)', border: '1px solid rgba(76,175,80,0.1)',
                        borderRadius: '4px', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                        maxHeight: '150px', overflowY: 'auto', color: 'var(--text-muted)',
                      }}>
                        {r.after.slice(0, 3000)}
                      </pre>
                    </div>
                  </details>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══ Diff Viewer ═══ */}
      {showDiff && (
        <DiffViewer fields={fields} selectedPath={diffFieldPath} onSelectPath={setDiffFieldPath} t={t} isVi={isVi} />
      )}

      {/* Severity filter tabs */}
      {fieldIssues.length > 0 && (
        <div style={{ display: 'flex', gap: '3px', marginBottom: '8px' }}>
          {(['all', 'error', 'warning', 'info'] as const).map(sev => {
            const count = sev === 'all' ? fieldIssues.length : fieldIssues.filter(i => i.severity === sev).length;
            if (count === 0 && sev !== 'all') return null;
            const active = sev === 'all' ? !severityFilter : severityFilter === sev;
            return (
              <button key={sev} onClick={() => setSeverityFilter(sev === 'all' ? null : sev)} style={{
                padding: '4px 10px', borderRadius: '14px', fontSize: '0.65rem', fontWeight: active ? 700 : 500,
                background: active ? (sev === 'error' ? 'rgba(255,82,82,0.12)' : sev === 'warning' ? 'rgba(240,196,106,0.12)' : 'rgba(124,106,240,0.12)') : 'var(--bg-primary)',
                color: active ? (sev === 'error' ? 'var(--accent-danger)' : sev === 'warning' ? 'var(--accent-warning)' : 'var(--accent-primary)') : 'var(--text-muted)',
                border: `1px solid ${active ? 'currentColor' : 'var(--border-subtle)'}`,
                cursor: 'pointer', transition: 'all 0.15s',
              }}>
                {t[sev === 'all' ? 'filterAll' : sev === 'error' ? 'filterErrors' : sev === 'warning' ? 'filterWarnings' : 'filterInfo']} {count > 0 && <span style={{ opacity: 0.7 }}>{count}</span>}
              </button>
            );
          })}
        </div>
      )}

      {/* Auto-fix all button */}
      {autoFixableCount > 0 && (
        <button className="btn btn-primary" onClick={handleFixAll}
          style={{ width: '100%', padding: '8px', fontSize: '0.78rem', marginBottom: '6px', background: 'var(--accent-success)', border: 'none' }}>
          <Wrench size={14} /> {t.verifyAutoFixAll.replace('{count}', String(autoFixableCount))}
        </button>
      )}

      {/* AI Fix button */}
      {(fieldIssues.length > 0 || (verifyResult && verifyResult.issues.length > 0)) && (
        <div style={{ display: 'flex', gap: '4px', marginBottom: '6px' }}>
          <button className="btn btn-primary" onClick={handleAIFix} disabled={isAIFixing || isVerifying}
            style={{ flex: 1, padding: '8px', fontSize: '0.78rem',
              background: 'linear-gradient(135deg, var(--accent-primary), #a78bfa)', border: 'none', opacity: isAIFixing ? 0.8 : 1 }}>
            {isAIFixing
              ? <><Loader2 size={14} className="spin" /> {aiFixProgress}</>
              : <><Bot size={14} /> {isVi ? '🤖 AI Sửa Tất Cả (3 Rounds)' : '🤖 AI Fix All (3 Rounds)'}</>}
          </button>
          {isAIFixing && (
            <button className="btn btn-secondary" onClick={handleCancelAIFix}
              style={{ padding: '8px 12px', fontSize: '0.78rem', color: 'var(--accent-danger)' }}>
              <XCircle size={14} />
            </button>
          )}
        </div>
      )}

      {/* AI Fix Report */}
      {aiFixReport && (
        <div style={{ padding: '8px 10px', background: 'rgba(124,106,240,0.04)', border: '1px solid rgba(124,106,240,0.12)',
          borderRadius: 'var(--radius-sm)', marginBottom: '10px', fontSize: '0.68rem', lineHeight: 1.5 }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>
              {isVi ? `🤖 Kết quả AI Fix (${aiFixReport.roundsCompleted} rounds):` : `🤖 AI Fix Report (${aiFixReport.roundsCompleted} rounds):`}
            </span>
            <Badge color="var(--accent-success)" bg="rgba(76,175,80,0.1)" text={`✅ ${aiFixReport.totalAccepted}`} />
            <Badge color="var(--accent-danger)" bg="rgba(255,82,82,0.1)" text={`❌ ${aiFixReport.totalRejected}`} />
            {aiFixReport.totalErrors > 0 && <Badge color="var(--accent-warning)" bg="rgba(240,196,106,0.1)" text={`⚠️ ${aiFixReport.totalErrors}`} />}
          </div>
          {aiFixReport.totalRejected > 0 && (
            <details style={{ marginTop: '4px' }}>
              <summary style={{ cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.62rem' }}>
                {isVi ? 'Xem lý do từ chối' : 'View rejection reasons'}
              </summary>
              <div style={{ marginTop: '3px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                {aiFixReport.report.filter(r => r.status === 'rejected').map((r, i) => (
                  <div key={i} style={{ fontSize: '0.6rem', color: 'var(--text-muted)', padding: '2px 4px', background: 'rgba(255,82,82,0.03)', borderRadius: '4px' }}>
                    <span style={{ color: 'var(--accent-danger)' }}>R{r.round}</span> {r.label}: {r.reason}
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {/* Category filter chips */}
      {fieldIssues.length > 0 && (
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '10px' }}>
          <FilterChip label={t.all} count={fieldIssues.length} active={!categoryFilter} onClick={() => setCategoryFilter(null)} />
          {Object.entries(categoryCounts).map(([cat, count]) => {
            const i18nKey = CATEGORY_I18N_KEY[cat];
            return <FilterChip key={cat} label={i18nKey ? t[i18nKey] : cat} count={count}
              active={categoryFilter === cat} onClick={() => setCategoryFilter(categoryFilter === cat ? null : cat)} />;
          })}
        </div>
      )}

      {/* Field Issues List */}
      {fieldIssues.length > 0 && activeTab === 'field' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', maxHeight: '450px', overflowY: 'auto' }}>
          {filteredFieldIssues.map(issue => <IssueRow key={issue.id} issue={issue} isVi={isVi}
            expanded={expandedIssues.has(issue.id)} onToggle={() => toggleIssue(issue.id)}
            onAutoFix={issue.autoFixable ? () => handleAutoFix(issue) : undefined}
            onAIFix={() => handleAISingleFix(issue)}
            isAIFixing={aiFixingIssueId === issue.id}
            onManualEdit={(newValue) => {
              updateField(issue.fieldPath, { translated: newValue });
              setFieldIssues(prev => prev.filter(i => i.id !== issue.id));
              addLog('success', `✏️ Manual fix: ${issue.location}`);
              addToast('success', t.verifyFixed.replace('{location}', issue.location));
            }}
            fields={fields} />)}
        </div>
      )}

      {/* Card-level results */}
      {verifyResult && activeTab === 'card' && (
        <div style={{ marginTop: '4px' }}>
          {refStats && (
            <div style={{ padding: '8px 12px', background: 'var(--bg-primary)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)', marginBottom: '10px', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
              <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>
                {t.verifyRefs} {refStats.total}
              </span>
              <div style={{ display: 'flex', gap: '6px', marginTop: '4px', flexWrap: 'wrap' }}>
                {Object.entries(refStats.types).map(([type, count]) => (
                  <span key={type} style={{ padding: '1px 6px', borderRadius: '8px', background: 'rgba(124,106,240,0.08)', fontSize: '0.6rem' }}>{type}: {count}</span>
                ))}
              </div>
            </div>
          )}
          <div style={{
            padding: '10px 12px',
            background: verifyResult.errors > 0 ? 'rgba(255,82,82,0.05)' : 'rgba(76,175,80,0.05)',
            border: `1px solid ${verifyResult.errors > 0 ? 'rgba(255,82,82,0.15)' : 'rgba(76,175,80,0.15)'}`,
            borderRadius: 'var(--radius-md)', marginBottom: '10px', fontSize: '0.8rem', lineHeight: 1.5, color: 'var(--text-secondary)',
          }}>
            {verifyResult.summary}
          </div>
          {verifyResult.issues.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', maxHeight: '350px', overflowY: 'auto' }}>
              {verifyResult.issues.map(issue => <IssueRow key={issue.id} issue={issue} isVi={isVi}
                expanded={expandedIssues.has(issue.id)} onToggle={() => toggleIssue(issue.id)} />)}
            </div>
          )}
        </div>
      )}

      {/* Empty state after verify */}
      {fieldIssues.length === 0 && activeTab === 'field' && !isVerifying && fieldIssues !== null && (
        <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
          <CheckCircle2 size={28} color="var(--accent-success)" style={{ marginBottom: '6px' }} />
          <div>{t.verifyStartHint}</div>
        </div>
      )}

      {/* ═══ Cross-check Results: HTML ↔ Initvar ═══ */}
      {crossCheckResult && (
        <div style={{ marginTop: '10px', padding: '10px 12px', borderRadius: 'var(--radius-md)',
          border: `1px solid ${crossCheckResult.valid ? 'rgba(76,175,80,0.2)' : 'rgba(255,82,82,0.2)'}`,
          background: crossCheckResult.valid ? 'rgba(76,175,80,0.03)' : 'rgba(255,82,82,0.03)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
            <Link2 size={14} color={crossCheckResult.valid ? 'var(--accent-success)' : 'var(--accent-danger)'} />
            <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              {isVi ? 'Đồng bộ HTML ↔ Initvar' : 'HTML ↔ Initvar Sync'}
            </span>
            <Badge color={crossCheckResult.valid ? 'var(--accent-success)' : 'var(--accent-danger)'}
              bg={crossCheckResult.valid ? 'rgba(76,175,80,0.1)' : 'rgba(255,82,82,0.1)'}
              text={crossCheckResult.summary} />
          </div>
          {crossCheckResult.orphanVars.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', maxHeight: '200px', overflowY: 'auto' }}>
              {crossCheckResult.orphanVars.map((orphan, i) => {
                const suggestion = crossCheckResult.suggestions.find(s => s.orphan === orphan.varName);
                return (
                  <div key={i} style={{ padding: '4px 8px', fontSize: '0.66rem', borderRadius: 'var(--radius-sm)',
                    background: 'rgba(255,82,82,0.04)', border: '1px solid rgba(255,82,82,0.1)' }}>
                    <span style={{ color: 'var(--accent-danger)', fontWeight: 600 }}>❌ "{orphan.varName}"</span>
                    <span style={{ color: 'var(--text-muted)' }}> — {isVi ? 'trong' : 'in'} {orphan.source} ({orphan.context})</span>
                    {suggestion && (
                      <span style={{ color: 'var(--accent-success)', marginLeft: '6px' }}>
                        💡 {isVi ? 'Có thể là' : 'Did you mean'} "{suggestion.closest}" ({Math.round(suggestion.similarity * 100)}%)
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {crossCheckResult.valid && (
            <div style={{ fontSize: '0.68rem', color: 'var(--accent-success)' }}>
              ✅ {isVi ? 'Tất cả biến trong HTML đều khớp với Initvar/Dictionary' : 'All HTML variables match Initvar/Dictionary'}
            </div>
          )}
        </div>
      )}

      {/* ═══ Cross-check Results: findRegex ↔ Narrative ═══ */}
      {findRegexResult && (findRegexResult.matchedTags.length > 0 || findRegexResult.missingTags.length > 0) && (
        <div style={{ marginTop: '8px', padding: '10px 12px', borderRadius: 'var(--radius-md)',
          border: `1px solid ${findRegexResult.valid ? 'rgba(76,175,80,0.2)' : 'rgba(255,180,0,0.25)'}`,
          background: findRegexResult.valid ? 'rgba(76,175,80,0.03)' : 'rgba(255,180,0,0.03)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
            <Code2 size={14} color={findRegexResult.valid ? 'var(--accent-success)' : 'var(--accent-warning)'} />
            <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              {isVi ? 'findRegex ↔ Tag Narrative' : 'findRegex ↔ Narrative Tags'}
            </span>
            <Badge color={findRegexResult.valid ? 'var(--accent-success)' : 'var(--accent-warning)'}
              bg={findRegexResult.valid ? 'rgba(76,175,80,0.1)' : 'rgba(255,180,0,0.1)'}
              text={findRegexResult.summary} />
          </div>
          {findRegexResult.missingTags.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
              {findRegexResult.missingTags.map((mt, i) => (
                <div key={i} style={{ padding: '3px 8px', fontSize: '0.66rem', borderRadius: 'var(--radius-sm)',
                  background: 'rgba(255,180,0,0.04)', border: '1px solid rgba(255,180,0,0.1)' }}>
                  <span style={{ color: 'var(--accent-warning)', fontWeight: 600 }}>⚠️ &lt;{mt.tag}&gt;</span>
                  <span style={{ color: 'var(--text-muted)' }}>
                    {' '}{isVi ? `trong ${mt.regexLabel} — không tìm thấy trong bất kỳ field nào` : `in ${mt.regexLabel} — not found in any narrative field`}
                  </span>
                </div>
              ))}
            </div>
          )}
          {findRegexResult.valid && (
            <div style={{ fontSize: '0.68rem', color: 'var(--accent-success)' }}>
              ✅ {isVi ? 'Tất cả custom tags đều khớp với nội dung narrative' : 'All custom tags match narrative content'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Sub-components ─── */

function Badge({ color, bg, text }: { color: string; bg: string; text: string }) {
  return (
    <span style={{ padding: '2px 8px', borderRadius: '10px', fontSize: '0.65rem', fontWeight: 700, background: bg, color }}>{text}</span>
  );
}

function FilterChip({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      padding: '3px 8px', borderRadius: '12px', fontSize: '0.65rem', fontWeight: active ? 700 : 500,
      background: active ? 'rgba(124,106,240,0.15)' : 'var(--bg-primary)',
      color: active ? 'var(--accent-primary)' : 'var(--text-muted)',
      border: `1px solid ${active ? 'var(--accent-primary)' : 'var(--border-subtle)'}`,
      cursor: 'pointer', transition: 'all 0.15s',
    }}>
      {label} <span style={{ opacity: 0.7 }}>{count}</span>
    </button>
  );
}

function IssueRow({ issue, isVi, expanded, onToggle, onAutoFix, onAIFix, isAIFixing, onManualEdit, fields }: {
  issue: VerifyIssue | FieldIssue; isVi: boolean; expanded: boolean; onToggle: () => void; onAutoFix?: () => void;
  onAIFix?: () => void; isAIFixing?: boolean;
  onManualEdit?: (newValue: string) => void; fields?: { path: string; translated: string }[];
}) {
  const cfg = SEVERITY_CONFIG[issue.severity] || SEVERITY_CONFIG.info;
  const Icon = cfg.icon;
  const t = useT() as Record<string, string>;
  const category = 'category' in issue ? (issue as FieldIssue).category : null;
  const catLabel = category ? (CATEGORY_I18N_KEY[category] && t[CATEGORY_I18N_KEY[category]] ? t[CATEGORY_I18N_KEY[category]] : category.replace(/_/g, ' ')) : null;
  const fieldPath = 'fieldPath' in issue ? (issue as FieldIssue).fieldPath : null;

  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');

  const startEdit = () => {
    if (!fieldPath || !fields) return;
    const field = fields.find(f => f.path === fieldPath);
    setEditValue(field?.translated || '');
    setEditing(true);
  };

  const saveEdit = () => {
    if (onManualEdit && editValue) {
      onManualEdit(editValue);
    }
    setEditing(false);
  };

  return (
    <div style={{ border: `1px solid ${cfg.color}20`, borderRadius: 'var(--radius-md)', background: cfg.bg, overflow: 'hidden' }}>
      <div onClick={onToggle} style={{ padding: '7px 10px', display: 'flex', alignItems: 'center', gap: '7px', cursor: 'pointer', userSelect: 'none' }}>
        <Icon size={13} color={cfg.color} style={{ flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '0.73rem', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
            <span style={{ color: cfg.color }}>[{issue.location}]</span>
            {catLabel && <span style={{ fontSize: '0.6rem', padding: '1px 5px', borderRadius: '6px', background: 'rgba(124,106,240,0.08)', color: 'var(--text-muted)' }}>
              {catLabel}
            </span>}
            <span style={{ fontWeight: 500 }}>{issue.description.slice(0, 100)}</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
          {onAutoFix && (
            <button onClick={(e) => { e.stopPropagation(); onAutoFix(); }}
              className="btn btn-ghost btn-xs" style={{ padding: '2px 6px', fontSize: '0.6rem', color: 'var(--accent-success)' }}>
              <Wrench size={11} /> Fix
            </button>
          )}
          {fieldPath && onAIFix && (
            <button onClick={(e) => { e.stopPropagation(); onAIFix(); }} disabled={isAIFixing}
              className="btn btn-ghost btn-xs" style={{ padding: '2px 6px', fontSize: '0.6rem', color: 'var(--accent-primary)', opacity: isAIFixing ? 0.6 : 1 }}>
              {isAIFixing ? <Loader2 size={11} className="spin" /> : <Bot size={11} />} AI
            </button>
          )}
          {fieldPath && onManualEdit && (
            <button onClick={(e) => { e.stopPropagation(); if (!editing) { if (!expanded) onToggle(); startEdit(); } }}
              className="btn btn-ghost btn-xs" style={{ padding: '2px 6px', fontSize: '0.6rem', color: 'var(--accent-primary)' }}>
              <Pencil size={11} />
            </button>
          )}
          {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </div>
      </div>
      {expanded && (
        <div style={{ padding: '0 10px 8px', fontSize: '0.68rem', display: 'flex', flexDirection: 'column', gap: '5px' }}>
          {issue.description.length > 100 && <div style={{ color: 'var(--text-secondary)', lineHeight: 1.4 }}>{issue.description}</div>}
          {issue.original && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 600, color: 'var(--accent-danger)', fontSize: '0.58rem', textTransform: 'uppercase' }}>Original:</span>
                <CopyButton text={issue.original} />
              </div>
              <pre style={{ margin: '2px 0 0', padding: '5px 7px', background: 'rgba(0,0,0,0.05)', borderRadius: 'var(--radius-sm)', whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: '0.66rem', maxHeight: '80px', overflowY: 'auto' }}>{issue.original}</pre>
            </div>
          )}
          {issue.current && issue.current !== '(missing)' && issue.current !== '(missing or renamed)' && (
            <div>
              <span style={{ fontWeight: 600, color: 'var(--accent-warning)', fontSize: '0.58rem', textTransform: 'uppercase' }}>Current:</span>
              <pre style={{ margin: '2px 0 0', padding: '5px 7px', background: 'rgba(0,0,0,0.05)', borderRadius: 'var(--radius-sm)', whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: '0.66rem', maxHeight: '80px', overflowY: 'auto' }}>{issue.current}</pre>
            </div>
          )}
          {issue.suggestion && (
            <div style={{ padding: '5px 7px', background: 'rgba(76,175,80,0.06)', border: '1px solid rgba(76,175,80,0.15)', borderRadius: 'var(--radius-sm)' }}>
              <span style={{ fontWeight: 600, color: 'var(--accent-success)', fontSize: '0.58rem', textTransform: 'uppercase' }}>
                💡 {t.verifySuggestFix}
              </span>
              <div style={{ marginTop: '2px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>{issue.suggestion}</div>
            </div>
          )}
          {editing && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>
              <textarea value={editValue} onChange={e => setEditValue(e.target.value)}
                style={{ width: '100%', minHeight: '80px', padding: '6px 8px', fontSize: '0.68rem', fontFamily: 'monospace',
                  background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--accent-primary)',
                  borderRadius: 'var(--radius-sm)', resize: 'vertical', lineHeight: 1.4 }} />
              <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
                <button onClick={() => setEditing(false)} className="btn btn-ghost btn-xs"
                  style={{ padding: '3px 8px', fontSize: '0.6rem' }}>
                  {isVi ? 'Hủy' : 'Cancel'}
                </button>
                <button onClick={saveEdit} className="btn btn-xs"
                  style={{ padding: '3px 8px', fontSize: '0.6rem', background: 'var(--accent-success)', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)' }}>
                  <Save size={11} /> {isVi ? 'Lưu' : 'Save'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Diff Viewer Component ─── */

function countStructures(text: string) {
  return {
    macros: (text.match(/\{\{[^}]+\}\}/g) || []).length,
    htmlTags: (text.match(/<[a-z][^>]*>/gi) || []).length,
    brackets: (text.match(/[{}[\]()]/g) || []).length,
    backticks: (text.match(/`/g) || []).length,
    functions: (text.match(/function\s+\w+/g) || []).length,
  };
}

function DiffViewer({ fields, selectedPath, onSelectPath, t, isVi }: {
  fields: { path: string; label: string; original: string; translated: string; group: string }[];
  selectedPath: string;
  onSelectPath: (path: string) => void;
  t: Record<string, string>;
  isVi: boolean;
}) {
  // Code-heavy fields first
  const codeFields = fields.filter(f => f.translated && ['regex', 'tavern_helper', 'lorebook'].includes(f.group));
  const otherFields = fields.filter(f => f.translated && !['regex', 'tavern_helper', 'lorebook'].includes(f.group));
  const allFields = [...codeFields, ...otherFields];

  const selected = allFields.find(f => f.path === selectedPath) || allFields[0];
  if (!selected) return null;

  const origWords = selected.original.split(/\s+/).filter(Boolean).length;
  const transWords = selected.translated.split(/\s+/).filter(Boolean).length;
  const origStructures = countStructures(selected.original);
  const transStructures = countStructures(selected.translated);

  return (
    <div style={{ padding: '10px 12px', background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-md)', marginBottom: '10px' }}>
      {/* Field selector */}
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '8px' }}>
        <GitCompare size={14} color="var(--accent-primary)" />
        <select value={selected.path} onChange={e => onSelectPath(e.target.value)}
          style={{ flex: 1, padding: '4px 8px', fontSize: '0.72rem', borderRadius: 'var(--radius-sm)',
            background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)' }}>
          {allFields.map(f => (
            <option key={f.path} value={f.path}>{f.label} ({f.group})</option>
          ))}
        </select>
      </div>

      {/* Stats row */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '8px', fontSize: '0.62rem' }}>
        <StatBadge label={t.diffWordCount} orig={origWords} trans={transWords} />
        <StatBadge label={t.diffCharCount} orig={selected.original.length} trans={selected.translated.length} />
        <StatBadge label="Macros" orig={origStructures.macros} trans={transStructures.macros} />
        <StatBadge label="HTML" orig={origStructures.htmlTags} trans={transStructures.htmlTags} />
        <StatBadge label="Brackets" orig={origStructures.brackets} trans={transStructures.brackets} />
        <StatBadge label="Functions" orig={origStructures.functions} trans={transStructures.functions} />
      </div>

      {/* Side-by-side panels */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' }}>
            <span style={{ fontSize: '0.62rem', fontWeight: 700, color: 'var(--accent-danger)', textTransform: 'uppercase' }}>
              {t.diffOriginal}
            </span>
            <CopyButton text={selected.original} />
          </div>
          <pre style={{
            margin: 0, padding: '8px', fontSize: '0.62rem', lineHeight: 1.4,
            background: 'rgba(255,82,82,0.03)', border: '1px solid rgba(255,82,82,0.1)',
            borderRadius: 'var(--radius-sm)', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            maxHeight: '300px', overflowY: 'auto', color: 'var(--text-secondary)',
          }}>
            {selected.original.slice(0, 8000)}
            {selected.original.length > 8000 && `\n\n[... ${selected.original.length - 8000} more chars ...]`}
          </pre>
        </div>
        <div>
          <div style={{ fontSize: '0.62rem', fontWeight: 700, color: 'var(--accent-success)', marginBottom: '3px', textTransform: 'uppercase' }}>
            {t.diffTranslated}
          </div>
          <pre style={{
            margin: 0, padding: '8px', fontSize: '0.62rem', lineHeight: 1.4,
            background: 'rgba(76,175,80,0.03)', border: '1px solid rgba(76,175,80,0.1)',
            borderRadius: 'var(--radius-sm)', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            maxHeight: '300px', overflowY: 'auto', color: 'var(--text-secondary)',
          }}>
            {selected.translated.slice(0, 8000)}
            {selected.translated.length > 8000 && `\n\n[... ${selected.translated.length - 8000} more chars ...]`}
          </pre>
        </div>
      </div>
    </div>
  );
}

function StatBadge({ label, orig, trans }: { label: string; orig: number; trans: number }) {
  const diff = trans - orig;
  const ratio = orig > 0 ? trans / orig : 1;
  const color = Math.abs(ratio - 1) > 0.3 ? 'var(--accent-danger)' : Math.abs(ratio - 1) > 0.1 ? 'var(--accent-warning)' : 'var(--accent-success)';
  return (
    <span style={{
      padding: '2px 6px', borderRadius: '8px', fontSize: '0.58rem',
      background: `${color}15`, color, fontWeight: 500,
    }}>
      {label}: {orig}→{trans}
      {diff !== 0 && <span style={{ opacity: 0.7 }}> ({diff > 0 ? '+' : ''}{diff})</span>}
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
