import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { useTranslation } from '../hooks/useTranslation';
import { useT, useUi } from '../i18n/useLocale';
import { fmt } from '../i18n';
import { Download, AlertTriangle, Image as ImageIcon, KeyRound, Code, Activity, FileText, XCircle, Info } from 'lucide-react';
import { embedCharaToPNG } from '../utils/pngHandler';
import { cardToWorldbook } from '../utils/worldbookParser';
import { characterBookToWorldInfo, worldInfoFileName } from '../utils/worldInfoFile';
import { setNestedValue } from '../utils/cardFields';
import { scanFieldsHealth, buildTranslationReport, type HealthSeverity } from '../utils/cardHealth';
import { verifyFields, quickVerify, type FieldIssue, type VerifyIssue } from '../utils/aiVerify';
import { countEjsBlocks } from '../utils/ejsSegmenter';
import { isLikelyJsScript, jsParseErrorAny } from '../utils/scriptSafety';
// (bugNeedFix/170) Sửa entry lỗi bằng AI — đọc bản gốc + bản dịch + [initvar] rồi vá, có chốt chặn.
import {
  collectRepairContext, buildRepairMessages, parseRepairResponse, verifyRepair, summarizeRepair,
} from '../utils/aiEntryRepair';
import { callProvider } from '../utils/apiClient';
import type { ExportKeyMode, TranslationField } from '../types/card';
import { useThrottledStore } from '../hooks/useThrottledStore';
import { useIdleMemo } from '../hooks/useIdleMemo';
// (bug 223) Thu hoi blob URL SAU khi trinh duyet doc xong - revoke ngay sau click lam hut file.
import { revokeSoon } from '../utils/downloadFile';

/** 1 dòng vấn đề trong báo cáo GỘP của "🩺 Kiểm tra tổng" (3 nguồn về chung 1 shape). */
interface MergedIssue {
  severity: HealthSeverity;
  label: string;
  path: string;   // rỗng = không nhảy tới field được (vấn đề mức card)
  detail: string;
  src: 'health' | 'deep' | 'card';
}

/** Nhãn ở module scope nên chỉ giữ KEY, tra `ui` lúc render. `desc` là chữ Hán cố ý (nhãn kỹ thuật). */
const KEY_MODE_OPTIONS: { value: ExportKeyMode; labelKey: 'epKeyModeMerge' | 'epKeyModeTranslated' | 'epKeyModeOriginal'; desc: string }[] = [
  { value: 'merge', labelKey: 'epKeyModeMerge', desc: '原Key + 译Key' },
  { value: 'translated_only', labelKey: 'epKeyModeTranslated', desc: '译Key only' },
  { value: 'original_only', labelKey: 'epKeyModeOriginal', desc: '原Key only' },
];

/** (bugNeedFix/37) Báo cáo rỗng dùng làm giá trị chờ trong lúc quét sức khoẻ chạy ở idle tick. */
const EMPTY_HEALTH: import('../utils/cardHealth').HealthReport = {
  counts: { total: 0, done: 0, error: 0, pending: 0, skipped: 0, brokenScripts: 0, residualCjkCode: 0, residualCjkText: 0, emptyBrackets: 0, renamedMacros: 0, glossaryUnapplied: 0 },
  issues: [],
  ok: true,
};

export default function ExportPanel() {
  // (bugNeedFix/37) Selector HẸP thay cho useStore() trọn gói: trước đây MỌI store write (kể cả addLog/
  // updateField lúc đang dịch) re-render panel này → scanFieldsHealth + acorn parse cả 692KB script chạy
  // ĐI CHẠY LẠI hàng trăm lần. `fields` throttle 300ms; các action là hàm ổn định.
  const card = useStore((s) => s.card);
  const fields = useThrottledStore((s) => s.fields, 300);
  const cardFileName = useStore((s) => s.cardFileName);
  const originalImage = useStore((s) => s.originalImage);
  const _pngArrayBuffer = useStore((s) => s._pngArrayBuffer);
  const translationConfig = useStore((s) => s.translationConfig);
  const setTranslationConfig = useStore((s) => s.setTranslationConfig);
  const proxy = useStore((s) => s.proxy);   // (bug 170) cấu hình API cho lượt sửa bằng AI
  const phase = useStore((s) => s.phase);
  const saveTranslationCache = useStore((s) => s.saveTranslationCache);
  const locale = useStore((s) => s.locale);
  const contentType = useStore((s) => s.contentType);
  const originalWorldbook = useStore((s) => s.originalWorldbook);
  const setJumpToFieldPath = useStore((s) => s.setJumpToFieldPath);
  const updateField = useStore((s) => s.updateField);
  const addLog = useStore((s) => s.addLog);
  // (bug 228) Bao ket qua xuat PNG bang toast thay vi alert tieng Anh cut lun.
  const addToast = useStore((s) => s.addToast);
  const { getExportCard } = useTranslation();
  const t = useT();
  const ui = useUi();
  const isWorldbook = contentType === 'worldbook';

  /**
   * (bugNeedFix/170) SỬA MỘT ENTRY LỖI BẰNG AI.
   * User: "ở phần kiểm tra lỗi hãy thêm nút chỉnh sửa bằng AI kế bên. AI sẽ quét lại toàn bộ
   * entry, bản dịch và bản raw để tìm ra chính xác lỗi là gì, kết hợp với schema và initvar của
   * lorebook để chỉnh sửa entry đó lại cho đúng."
   *
   * Vì sao cần đường riêng chứ không dùng nút "dịch lại": dịch lại là chạy lại đúng con đường đã
   * sinh ra lỗi, nên ra lại lỗi cũ. Đây là đường KHÁC — đưa cho AI cả bản gốc, bản dịch hỏng,
   * danh sách biến thật trong [initvar], và những gì máy đã bắt được, rồi bắt nó chẩn đoán.
   * Bản sửa phải qua verifyRepair mới được ghi đè; trượt thì GIỮ NGUYÊN bản cũ và nói lý do.
   */
  const [repairingPath, setRepairingPath] = useState<string | null>(null);
  const [repairNotes, setRepairNotes] = useState<Record<string, string>>({});

  const repairWithAi = async (path: string) => {
    const field = fields.find(f => f.path === path);
    if (!field || repairingPath) return;
    setRepairingPath(path);
    try {
      const ctx = collectRepairContext(field, fields);
      addLog('info', `🤖 Sửa bằng AI: "${field.label}" — ${ctx.machineFindings.length} dấu hiệu máy bắt được.`);

      const msgs = buildRepairMessages(ctx);
      const raw = await callProvider(proxy, msgs[0].content, msgs[1].content, undefined, undefined, { label: 'Sửa entry' });

      const parsed = parseRepairResponse(raw);
      if (!parsed) {
        const why = 'AI không trả về khối <da_sua> — giữ nguyên bản cũ.';
        setRepairNotes(p => ({ ...p, [path]: why }));
        addLog('warning', `⚠️ ${why}`);
        return;
      }

      const verdict = verifyRepair(ctx, parsed.fixed);
      const note = `${parsed.diagnosis} — ${summarizeRepair(verdict, parsed)}`;
      setRepairNotes(p => ({ ...p, [path]: note }));

      if (verdict.ok) {
        updateField(path, { translated: parsed.fixed, status: 'done', error: undefined });
        addLog('success', `✅ Đã sửa "${field.label}": ${summarizeRepair(verdict, parsed)}`);
      } else {
        // Không ghi đè. User vẫn thấy chẩn đoán để tự quyết — im lặng bỏ qua mới là tệ.
        addLog('warning', `⚠️ Không nhận bản sửa cho "${field.label}": ${verdict.reasons.join(' ')}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setRepairNotes(p => ({ ...p, [path]: `Lỗi gọi AI: ${msg}` }));
      addLog('error', `❌ Sửa bằng AI thất bại: ${msg}`);
    } finally {
      setRepairingPath(null);
    }
  };

  const doneCount = fields.filter((f) => f.status === 'done').length;
  const ignoredCount = fields.filter((f) => f.status === 'ignored').length;
  const hasLorebookKeys = fields.some(f => f.group === 'lorebook_keys');

  // 🩺 Sức khoẻ thẻ — quét nội dung bản dịch (script vỡ / chữ Hán sót / thuật ngữ chưa áp).
  // (bugNeedFix/37) HOÃN ra idle tick + TẠM NGƯNG khi đang dịch: scanFieldsHealth acorn-parse mọi field
  // JS (tavern_helper 692KB) — chạy đồng bộ NGAY khi import là 1 trong các thủ phạm đơ máy card lớn.
  const health = useIdleMemo(
    () => scanFieldsHealth(fields, translationConfig.glossary),
    [fields, translationConfig.glossary],
    EMPTY_HEALTH,
    phase !== 'translating',
  );
  const [showIssues, setShowIssues] = useState(false);

  // ═══ 🩺 KIỂM TRA TỔNG (nghiệm thu 1 nút) ═══
  // Sức khoẻ thẻ ở trên chạy passive (rẻ). Bấm nút thì chạy thêm 2 bộ kiểm NẶNG (đều local, 0 call AI):
  //  1. verifyFields — kiểm sâu từng field: macro hỏng, lệch ngoặc/HTML/JSON, cắt cụt cấu trúc, CJK sót theo tỉ lệ…
  //  2. quickVerify  — đối chiếu card gốc ↔ card xuất: macro/biến/Zod/EJS bị MẤT sau dịch.
  // Cả 3 gộp về 1 báo cáo, 1 phán quyết đạt/không đạt.
  const [deepCheck, setDeepCheck] = useState<{ fieldIssues: FieldIssue[]; cardIssues: VerifyIssue[]; at: number } | null>(null);
  const [isChecking, setIsChecking] = useState(false);

  const runTotalCheck = async () => {
    setIsChecking(true);
    await new Promise((r) => setTimeout(r, 30)); // cho UI vẽ trạng thái "đang kiểm" trước khi block main thread
    try {
      const fieldIssues = verifyFields(fields, translationConfig.mvuDictionary, translationConfig.sourceLanguage);
      const exportCard = getExportCard();
      const cardIssues = card && exportCard ? quickVerify(card, exportCard) : [];
      setDeepCheck({ fieldIssues, cardIssues, at: Date.now() });
      setShowIssues(true);
    } finally {
      setIsChecking(false);
    }
  };

  // ═══ (User 2026) SỬA NHANH entry EJS VỠ (non-AI) — vá card ĐANG mở mà không cần dịch lại ═══
  // Entry lớn bị chunk → AI rơi khối <%…%> → xuất ra card ST chạy LỖI (tag mismatch). Nút này quét
  // mọi field 'done' mà SỐ khối <%…%> của bản dịch KHÁC bản gốc → REVERT field đó về bản gốc (code
  // Trung vẫn chạy, an toàn tuyệt đối). Từ v1.99.4 lỗi này được chặn NGAY khi dịch; nút để chữa card cũ.
  // (User 2026) Gồm 2 loại VỠ: (a) EJS lệch số khối <%…%>; (b) script JS trần (TavernHelper) gốc
  // parse sạch mà bản dịch vỡ cú pháp (cụt output/đứt regex — bug script 71K). Cả 2 revert về gốc là an toàn.
  // (bugNeedFix/37) cũng HOÃN ra idle (acorn parse mỗi field JS) + tạm ngưng khi đang dịch.
  const brokenEjsFields = useIdleMemo<TranslationField[]>(
    () => fields.filter(f => {
      if (f.status !== 'done' || !f.translated || f.translated === f.original) return false;
      if (f.original.includes('<%')) {
        const o = countEjsBlocks(f.original);
        if (o > 0 && countEjsBlocks(f.translated) !== o) return true;
      }
      if (isLikelyJsScript(f.original) && jsParseErrorAny(f.original) === null && jsParseErrorAny(f.translated) !== null) {
        return true;
      }
      return false;
    }),
    [fields],
    [],
    phase !== 'translating',
  );
  const [repairMsg, setRepairMsg] = useState('');
  // (bug 74) Mặc định BẬT theo yêu cầu user. Xuất kèm file World Info rời: nạp file này vào ST
  // TRƯỚC khi import thẻ thì `world_names` đã có tên world ⇒ ST im lặng gắn luôn, không popup,
  // không phải vào "More… → Import Card Lore" gắn tay.
  const [alsoExportLorebook, setAlsoExportLorebook] = useState(true);

  /** Tải kèm file World Info rời (nếu thẻ có lorebook nhúng và user đang bật tuỳ chọn). */
  const downloadLorebookSideFile = (exportCard: unknown) => {
    if (!alsoExportLorebook) return;
    const wi = characterBookToWorldInfo(exportCard);
    if (!wi) return; // thẻ không có lorebook nhúng — không đẻ ra file rỗng
    const world = String(
      ((exportCard as Record<string, any>)?.data?.extensions?.world) ||
      ((exportCard as Record<string, any>)?.data?.character_book?.name) || '',
    );
    const blob = new Blob([JSON.stringify(wi, null, 4)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = worldInfoFileName(world);
    a.click();
    revokeSoon(url);
  };
  const repairBrokenEjs = () => {
    let reverted = 0;
    for (const f of brokenEjsFields) {
      const reason = f.original.includes('<%') && countEjsBlocks(f.original) > 0 && countEjsBlocks(f.translated || '') !== countEjsBlocks(f.original)
        ? `${countEjsBlocks(f.translated || '')}/${countEjsBlocks(f.original)} khối <%…%>`
        : `script vỡ cú pháp JS (dòng ~${jsParseErrorAny(f.translated || '')?.line ?? '?'})`;
      updateField(f.path, { translated: f.original });
      addLog('info', `🔧 Sửa nhanh: revert "${f.label}" về bản gốc (${reason} → khôi phục nguyên vẹn, không vỡ JS).`);
      reverted++;
    }
    saveTranslationCache();
    setRepairMsg(reverted > 0
      ? fmt(ui.epEjsRepairDone, { count: reverted })
      : ui.epEjsRepairNone);
    void runTotalCheck();
  };

  // Gộp 3 nguồn vấn đề (sức khoẻ + kiểm sâu + đối chiếu card) thành 1 danh sách, nặng trước.
  const allIssues = useMemo<MergedIssue[]>(() => {
    const merged: MergedIssue[] = health.issues.map((i) => ({
      severity: i.severity, label: i.label, path: i.path, detail: i.detail, src: 'health' as const,
    }));
    if (deepCheck) {
      // Kiểm sâu trùng 1 phần với sức khoẻ thẻ (CJK sót) — bỏ mục trùng path+loại để không báo đúp.
      const cjkPaths = new Set(health.issues.filter(i => i.kind.startsWith('residual_cjk')).map(i => i.path));
      for (const fi of deepCheck.fieldIssues) {
        if (fi.category === 'residual_source' && cjkPaths.has(fi.fieldPath)) continue;
        merged.push({ severity: fi.severity, label: fi.category.replace(/_/g, ' '), path: fi.fieldPath, detail: fi.description, src: 'deep' });
      }
      for (const ci of deepCheck.cardIssues) {
        merged.push({ severity: ci.severity, label: ci.location, path: '', detail: ci.description, src: 'card' });
      }
    }
    const rank: Record<HealthSeverity, number> = { error: 0, warning: 1, info: 2 };
    merged.sort((a, b) => rank[a.severity] - rank[b.severity]);
    return merged;
  }, [health, deepCheck]);

  const errCount = allIssues.filter((i) => i.severity === 'error').length;
  const checkOk = errCount === 0;

  const handleExportReport = () => {
    let md = buildTranslationReport(fields, cardFileName || 'card', health);
    if (deepCheck) {
      const lines: string[] = ['', '## 🩺 Kiểm tra tổng (kiểm sâu nội dung + đối chiếu card gốc)'];
      lines.push(`- Kiểm sâu nội dung: **${deepCheck.fieldIssues.length}** vấn đề · Đối chiếu macro/biến với card gốc: **${deepCheck.cardIssues.length}** vấn đề`);
      for (const fi of deepCheck.fieldIssues.slice(0, 200)) {
        lines.push(`- [${fi.severity}] **${fi.category}** \`${fi.fieldPath}\` — ${fi.description}`);
      }
      for (const ci of deepCheck.cardIssues.slice(0, 200)) {
        lines.push(`- [${ci.severity}] **${ci.location}** — ${ci.description}`);
      }
      md += '\n' + lines.join('\n');
    }
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const baseName = (cardFileName || 'card').replace(/\.(json|png)$/i, '');
    const a = document.createElement('a');
    a.href = url;
    a.download = `${baseName}_bao-cao-dich.md`;
    a.click();
    revokeSoon(url);
  };

  const handleExport = () => {
    // Auto-save translation cache before export
    saveTranslationCache();

    const exportCard = getExportCard();
    if (!exportCard) return;

    // If worldbook mode, convert back to worldbook format
    let exportData: unknown;
    if (isWorldbook && originalWorldbook) {
      exportData = cardToWorldbook(exportCard, originalWorldbook);
    } else {
      exportData = exportCard;
    }

    const json = JSON.stringify(exportData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    // Generate filename
    const baseName = cardFileName.replace(/\.json$/i, '');
    const langSuffix = translationConfig.targetLanguage === 'Tiếng Việt'
      ? 'vi'
      : translationConfig.targetLanguage === 'English'
        ? 'en'
        : translationConfig.targetLanguage === '日本語'
          ? 'ja'
          : translationConfig.targetLanguage === '한국어'
            ? 'ko'
            : translationConfig.targetLanguage.slice(0, 2).toLowerCase();
    const fileName = `${baseName}_${langSuffix}.json`;

    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    revokeSoon(url);
    // (bug 74) Chế độ worldbook vốn đã xuất ra file world rồi — không tải trùng thêm lần nữa.
    if (!isWorldbook) downloadLorebookSideFile(exportCard);
  };

  /**
   * (bug 228) Xuất PNG có ảnh.
   *
   * User: "gần như không thể xuất card có ảnh mà chỉ có thể tải xuống bản json của card."
   * Ba chỗ hỏng nối nhau, và cả ba đều im lặng:
   *   • ảnh trong store là `blob:` URL, mà bộ nhúng chỉ biết đọc `data:` URL ⇒ ném (đã sửa ở
   *     pngHandler);
   *   • `if (!originalImage) return;` — bấm nút không ra gì, không một dòng báo;
   *   • báo lỗi là `alert('Failed to export PNG')` tiếng Anh cụt, không nói được vì sao.
   * Nay: nhận thêm ảnh do người dùng gắn lại, và mọi ngả đều nói rõ chuyện gì xảy ra.
   */
  const handleExportPng = async (overrideImage?: ArrayBuffer) => {
    saveTranslationCache();

    const exportCard = getExportCard();
    if (!exportCard) return;

    const imageData = overrideImage || _pngArrayBuffer || originalImage;
    if (!imageData) {
      addToast('info', ui.epPngNoImage);
      return;
    }

    try {
      const json = JSON.stringify(exportCard);
      const dataUrl = await embedCharaToPNG(imageData, json);

      const baseName = cardFileName.replace(/\.(json|png)$/i, '');
      const langSuffix = translationConfig.targetLanguage === 'Tiếng Việt' ? 'vi' : 'translated';
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `${baseName}_${langSuffix}.png`;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      a.remove();
      downloadLorebookSideFile(exportCard);
      addToast('success', ui.epPngOk);
    } catch (e) {
      console.error('Failed to export PNG:', e);
      addToast('error', fmt(ui.epPngFail, { why: (e as Error).message || 'không rõ' }));
    }
  };

  /** Người dùng gắn lại ảnh gốc rồi xuất luôn — lối thoát khi ảnh trong bộ nhớ đã mất. */
  const attachImageAndExportPng = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => addToast('error', fmt(ui.epPngFail, { why: `không đọc được ${file.name}` }));
    reader.onload = () => { void handleExportPng(reader.result as ArrayBuffer); };
    reader.readAsArrayBuffer(file);
  };

  // Reconstruct translated regex scripts
  const translatedRegexes = useMemo(() => {
    if (!card || !card.data || !card.data.extensions || !card.data.extensions.regex_scripts) {
      return [];
    }
    const originalRegexScripts = card.data.extensions.regex_scripts;
    
    // Find all fields in group 'regex' with status === 'done' and non-empty translated content
    const doneRegexFields = fields.filter(
      (f) => f.group === 'regex' && f.status === 'done' && f.translated
    );
    
    if (doneRegexFields.length === 0) return [];
    
    // Group fields by script index
    const fieldsByScriptIndex: Record<number, typeof doneRegexFields> = {};
    for (const field of doneRegexFields) {
      const match = field.path.match(/^data\.extensions\.regex_scripts\[(\d+)\]\.(.+)$/);
      if (match) {
        const idx = parseInt(match[1], 10);
        if (!fieldsByScriptIndex[idx]) {
          fieldsByScriptIndex[idx] = [];
        }
        fieldsByScriptIndex[idx].push(field);
      }
    }
    
    // Reconstruct
    const results = [];
    for (const idxStr of Object.keys(fieldsByScriptIndex)) {
      const idx = parseInt(idxStr, 10);
      const originalScript = originalRegexScripts[idx];
      if (!originalScript) continue;
      
      const cloned = JSON.parse(JSON.stringify(originalScript));
      const scriptFields = fieldsByScriptIndex[idx];
      for (const field of scriptFields) {
        const match = field.path.match(/^data\.extensions\.regex_scripts\[(\d+)\]\.(.+)$/);
        if (match) {
          const relativePath = match[2];
          setNestedValue(cloned, relativePath, field.translated);
        }
      }
      results.push({
        index: idx,
        scriptName: cloned.scriptName || `Regex Script ${idx}`,
        script: cloned,
      });
    }
    return results;
  }, [card, fields]);

  // Reconstruct translated TavernHelper scripts
  const translatedTavernHelpers = useMemo(() => {
    if (!card || !card.data || !card.data.extensions) {
      return [];
    }
    const doneTavernHelperFields = fields.filter(
      (f) => f.group === 'tavern_helper' && f.status === 'done' && f.translated
    );
    
    if (doneTavernHelperFields.length === 0) return [];
    
    const fieldsByScript: Record<string, { key: string; scriptIndex: number; fields: typeof doneTavernHelperFields }> = {};
    
    for (const field of doneTavernHelperFields) {
      let key = '';
      let scriptIndex = -1;
      
      // Pattern 1: Tuple format
      const matchTuple = field.path.match(/^data\.extensions\.([a-zA-Z0-9_]+)\[\d+\]\[1\]\[(\d+)\]\.(.+)$/);
      if (matchTuple) {
        key = matchTuple[1];
        scriptIndex = parseInt(matchTuple[2], 10);
      } else {
        // Pattern 2: scripts array format
        const matchScripts = field.path.match(/^data\.extensions\.([a-zA-Z0-9_]+)\.scripts\[(\d+)\]\.(.+)$/);
        if (matchScripts) {
          key = matchScripts[1];
          scriptIndex = parseInt(matchScripts[2], 10);
        } else {
          // Pattern 3: direct array format
          const matchDirect = field.path.match(/^data\.extensions\.([a-zA-Z0-9_]+)\[(\d+)\]\.(.+)$/);
          if (matchDirect && matchDirect[1] !== 'regex_scripts') {
            key = matchDirect[1];
            scriptIndex = parseInt(matchDirect[2], 10);
          }
        }
      }
      
      if (key && scriptIndex !== -1) {
        const id = `${key}_${scriptIndex}`;
        if (!fieldsByScript[id]) {
          fieldsByScript[id] = { key, scriptIndex, fields: [] };
        }
        fieldsByScript[id].fields.push(field);
      }
    }
    
    const results = [];
    for (const id of Object.keys(fieldsByScript)) {
      const { key, scriptIndex, fields: scriptFields } = fieldsByScript[id];
      const extData = card.data.extensions[key];
      if (!extData) continue;
      
      let originalScript: any = null;
      if (Array.isArray(extData)) {
        const tupleEntry = extData.find(
          (item: any) => Array.isArray(item) && item[0] === 'scripts' && Array.isArray(item[1])
        );
        if (tupleEntry) {
          originalScript = tupleEntry[1][scriptIndex];
        } else {
          originalScript = extData[scriptIndex];
        }
      } else if (extData && typeof extData === 'object' && 'scripts' in extData && Array.isArray((extData as any).scripts)) {
        originalScript = (extData as any).scripts[scriptIndex];
      }
      
      if (!originalScript) continue;
      
      const cloned = JSON.parse(JSON.stringify(originalScript));
      for (const field of scriptFields) {
        let relPath = '';
        const matchT = field.path.match(/^data\.extensions\.([a-zA-Z0-9_]+)\[\d+\]\[1\]\[(\d+)\]\.(.+)$/);
        if (matchT) relPath = matchT[3];
        else {
          const matchS = field.path.match(/^data\.extensions\.([a-zA-Z0-9_]+)\.scripts\[(\d+)\]\.(.+)$/);
          if (matchS) relPath = matchS[3];
          else {
            const matchD = field.path.match(/^data\.extensions\.([a-zA-Z0-9_]+)\[(\d+)\]\.(.+)$/);
            if (matchD) relPath = matchD[3];
          }
        }
        
        if (relPath) {
          setNestedValue(cloned, relPath, field.translated);
        }
      }
      results.push({
        key,
        index: scriptIndex,
        name: cloned.name || `TavernHelper Script ${scriptIndex}`,
        script: cloned,
      });
    }
    return results;
  }, [card, fields]);

  if (!card || fields.length === 0) return null;

  const handleExportSingleRegex = (script: any, name: string) => {
    const json = JSON.stringify(script, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const baseName = cardFileName.replace(/\.(json|png)$/i, '');
    const cleanName = name.replace(/[^a-zA-Z0-9_\u00C0-\u1EF9-]/g, '_');
    const fileName = `${baseName}_regex_${cleanName}.json`;
    
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    revokeSoon(url);
  };

  const handleExportAllRegex = () => {
    const scripts = translatedRegexes.map(r => r.script);
    const json = JSON.stringify(scripts, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const baseName = cardFileName.replace(/\.(json|png)$/i, '');
    const fileName = `${baseName}_regex_all.json`;
    
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    revokeSoon(url);
  };

  const handleExportSingleTavernHelper = (script: any, name: string) => {
    const json = JSON.stringify(script, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const baseName = cardFileName.replace(/\.(json|png)$/i, '');
    const cleanName = name.replace(/[^a-zA-Z0-9_\u00C0-\u1EF9-]/g, '_');
    const fileName = `${baseName}_th_${cleanName}.json`;
    
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    revokeSoon(url);
  };

  const handleExportAllTavernHelper = () => {
    const scripts = translatedTavernHelpers.map(t => t.script);
    const json = JSON.stringify(scripts, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const baseName = cardFileName.replace(/\.(json|png)$/i, '');
    const fileName = `${baseName}_th_all.json`;
    
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    revokeSoon(url);
  };

  return (
    <div className="card fade-in" style={{ padding: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>{t.stepExport}</h3>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          {doneCount}/{fields.length} {t.fieldsTranslated}
        </span>
      </div>

      {/* 🩺 Kiểm tra tổng — sức khoẻ thẻ (passive) + nút chạy kiểm sâu + đối chiếu card gốc, gộp 1 báo cáo */}
      <div
        style={{
          padding: '10px 12px',
          background: checkOk ? 'rgba(80, 200, 120, 0.06)' : 'rgba(240, 100, 100, 0.07)',
          border: `1px solid ${checkOk ? 'rgba(80,200,120,0.25)' : 'rgba(240,100,100,0.3)'}`,
          borderRadius: 'var(--radius-md)',
          marginBottom: '12px',
          fontSize: '0.8rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: allIssues.length || !deepCheck ? '8px' : 0, flexWrap: 'wrap' }}>
          <Activity size={15} style={{ flexShrink: 0, color: checkOk ? 'var(--accent-success)' : 'var(--accent-danger)' }} />
          <span style={{ fontWeight: 600, color: checkOk ? 'var(--accent-success)' : 'var(--accent-danger)', flex: 1, minWidth: '180px' }}>
            {deepCheck
              ? (checkOk ? ui.epTotalPass : fmt(ui.epTotalFail, { count: errCount }))
              : (checkOk ? ui.epHealthOk : fmt(ui.epHealthBad, { count: errCount }))}
          </span>
          <button
            onClick={runTotalCheck}
            disabled={isChecking || fields.length === 0}
            title={ui.epTotalHint}
            style={{
              padding: '4px 12px', fontSize: '0.72rem', fontWeight: 700, cursor: isChecking ? 'wait' : 'pointer',
              color: '#fff', background: 'var(--accent-primary)', border: 'none',
              borderRadius: 'var(--radius-sm)', opacity: isChecking || fields.length === 0 ? 0.6 : 1, flexShrink: 0,
            }}
          >
            {isChecking ? ui.epTotalChecking : ui.epTotalBtn}
          </button>
        </div>
        {deepCheck && (
          <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', marginBottom: '6px' }}>
            {fmt(ui.epTotalDoneLine, {
              deep: deepCheck.fieldIssues.length,
              macro: deepCheck.cardIssues.length,
              time: new Date(deepCheck.at).toLocaleTimeString(),
            })}
          </div>
        )}

        {/* 🔧 Sửa nhanh entry EJS VỠ (mất khối <%…%>) → revert về gốc, non-AI, tức thì */}
        {brokenEjsFields.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', margin: '4px 0 8px', padding: '6px 8px', background: 'rgba(240,100,100,0.08)', border: '1px solid rgba(240,100,100,0.28)', borderRadius: 'var(--radius-sm)' }}>
            <AlertTriangle size={13} style={{ color: 'var(--accent-danger)', flexShrink: 0 }} />
            <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', flex: 1, minWidth: '160px' }}>
              {fmt(ui.epEjsRepairWarn, { count: brokenEjsFields.length })}
            </span>
            <button
              onClick={repairBrokenEjs}
              title={ui.epEjsRepairTip}
              style={{ padding: '4px 10px', fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer', color: '#fff', background: 'var(--accent-danger)', border: 'none', borderRadius: 'var(--radius-sm)', flexShrink: 0 }}
            >
              {ui.epEjsRepairBtn}
            </button>
          </div>
        )}
        {repairMsg && (
          <div style={{ fontSize: '0.68rem', color: 'var(--accent-success)', marginBottom: '6px' }}>{repairMsg}</div>
        )}

        {/* Chỉ số nhanh */}
        {(health.counts.error > 0 || health.counts.brokenScripts > 0 || health.counts.residualCjkCode > 0 || health.counts.residualCjkText > 0 || health.counts.pending > 0) && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 16px', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
            {health.counts.error > 0 && <span>{fmt(ui.epCntError, { count: health.counts.error })}</span>}
            {health.counts.pending > 0 && <span>{fmt(ui.epCntPending, { count: health.counts.pending })}</span>}
            {health.counts.brokenScripts > 0 && <span style={{ color: 'var(--accent-danger)', fontWeight: 600 }}>{fmt(ui.epCntBroken, { count: health.counts.brokenScripts })}</span>}
            {health.counts.residualCjkCode > 0 && <span style={{ color: 'var(--accent-danger)', fontWeight: 600 }}>{fmt(ui.epCntCjkCode, { count: health.counts.residualCjkCode })}</span>}
            {health.counts.residualCjkText > 0 && <span>{fmt(ui.epCntCjkText, { count: health.counts.residualCjkText })}</span>}
            {health.counts.glossaryUnapplied > 0 && <span>{fmt(ui.epCntGlossary, { count: health.counts.glossaryUnapplied })}</span>}
          </div>
        )}

        {/* Danh sách GỘP cả 3 nguồn (thu gọn) — bấm dòng có path để nhảy tới field trong Field Editor */}
        {allIssues.length > 0 && (
          <>
            <button
              onClick={() => setShowIssues(v => !v)}
              style={{ marginTop: '8px', background: 'none', border: 'none', color: 'var(--accent-primary)', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', padding: 0 }}
            >
              {showIssues ? ui.epHideDetails : fmt(ui.epShowDetails, { count: allIssues.length })}
            </button>
            {showIssues && (
              <div style={{ marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '260px', overflow: 'auto' }}>
                {allIssues.slice(0, 80).map((iss, idx) => (
                  <div
                    key={idx}
                    onClick={() => iss.path && setJumpToFieldPath(iss.path)}
                    title={iss.path ? ui.epJumpTitle : undefined}
                    style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', fontSize: '0.7rem', color: 'var(--text-secondary)', cursor: iss.path ? 'pointer' : 'default', padding: '2px 4px', borderRadius: 'var(--radius-sm)' }}
                    onMouseEnter={(e) => { if (iss.path) e.currentTarget.style.background = 'rgba(124,106,240,0.08)'; }}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <IssueIcon severity={iss.severity} />
                    <span>
                      {iss.src !== 'health' && (
                        <span style={{ fontSize: '0.58rem', fontWeight: 700, color: iss.src === 'deep' ? 'var(--accent-secondary)' : '#fbbf24', border: `1px solid ${iss.src === 'deep' ? 'rgba(56,189,248,0.4)' : 'rgba(251,191,36,0.4)'}`, borderRadius: '3px', padding: '0 4px', marginRight: '4px' }}>
                          {iss.src === 'deep' ? ui.epSrcDeep : ui.epSrcCard}
                        </span>
                      )}
                      <b>{iss.label}</b> — {iss.detail} <span style={{ color: 'var(--text-muted)', fontSize: '0.64rem' }}>{iss.path}</span> {iss.path && <span style={{ color: 'var(--accent-primary)', fontSize: '0.64rem' }}>{ui.epJump}</span>}

                      {/* (bugNeedFix/170) Nút sửa bằng AI ĐỨNG NGAY CẠNH dòng lỗi — đúng chỗ user
                          đang nhìn thấy lỗi, không bắt đi tìm ở panel khác. */}
                      {iss.path && (
                        <button
                          onClick={(e) => { e.stopPropagation(); void repairWithAi(iss.path); }}
                          disabled={repairingPath !== null}
                          title={'AI đọc BẢN GỐC + BẢN DỊCH + danh sách biến thật trong [initvar] để tìm đích danh lỗi rồi vá lại entry này.\n'
                            + 'Khác với "dịch lại": dịch lại là chạy lại đúng con đường đã sinh ra lỗi.\n'
                            + 'Bản sửa phải qua kiểm (đủ macro, đủ khối EJS, không đẻ biến lạ, cú pháp sạch) mới được ghi đè.'}
                          style={{
                            marginLeft: '6px', fontSize: '0.62rem', fontWeight: 600,
                            padding: '0 5px', borderRadius: '3px', cursor: repairingPath ? 'wait' : 'pointer',
                            border: '1px solid rgba(124,106,240,0.45)', background: 'transparent',
                            color: 'var(--accent-primary)', opacity: repairingPath && repairingPath !== iss.path ? 0.4 : 1,
                          }}
                        >
                          {repairingPath === iss.path ? '⏳ đang sửa…' : '🤖 Sửa bằng AI'}
                        </button>
                      )}

                      {repairNotes[iss.path] && (
                        <div style={{ marginTop: '2px', fontSize: '0.64rem', color: 'var(--text-muted)', lineHeight: 1.45, paddingLeft: '2px', borderLeft: '2px solid rgba(124,106,240,0.35)', paddingInlineStart: '6px' }}>
                          {repairNotes[iss.path]}
                        </div>
                      )}
                    </span>
                  </div>
                ))}
                {allIssues.length > 80 && (
                  <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>{fmt(ui.epMoreIssues, { count: allIssues.length - 80 })}</span>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Lorebook Key Mode Selector */}
      {hasLorebookKeys && (
        <div style={{ marginBottom: '12px' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)',
            marginBottom: '6px',
          }}>
            <KeyRound size={13} />
            {ui.epKeyModeTitle}
          </div>
          <div style={{
            display: 'flex', gap: '4px',
            background: 'var(--bg-primary)',
            borderRadius: 'var(--radius-sm)',
            padding: '3px',
            border: '1px solid var(--border-subtle)',
          }}>
            {KEY_MODE_OPTIONS.map(opt => {
              const isActive = translationConfig.exportKeyMode === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => setTranslationConfig({ exportKeyMode: opt.value })}
                  style={{
                    flex: 1,
                    padding: '5px 4px',
                    fontSize: '0.7rem',
                    fontWeight: isActive ? 600 : 400,
                    color: isActive ? 'var(--accent-primary)' : 'var(--text-muted)',
                    background: isActive ? 'rgba(124,106,240,0.1)' : 'transparent',
                    border: isActive ? '1px solid rgba(124,106,240,0.25)' : '1px solid transparent',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    lineHeight: 1.3,
                    textAlign: 'center',
                  }}
                  title={opt.desc}
                >
                  {ui[opt.labelKey]}
                </button>
              );
            })}
          </div>
          <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            {translationConfig.exportKeyMode === 'merge'
              ? ui.epKeyModeDescMerge
              : translationConfig.exportKeyMode === 'translated_only'
                ? ui.epKeyModeDescTranslated
                : ui.epKeyModeDescOriginal
            }
          </div>
        </div>
      )}

      {/* ⚡ Dịch nhẹ / nhiều field bỏ qua: nói TRƯỚC cho user biết ruột card giữ tiếng gốc là
          CHỦ Ý — chặn báo nhầm "xuất ra tiếng Trung dù dịch rồi". */}
      {(translationConfig.lightSkipContent || ignoredCount >= 5) && (
        <div style={{
          padding: '8px 10px', marginBottom: '10px', fontSize: '0.7rem', lineHeight: 1.55,
          background: 'rgba(251,191,36,0.07)', border: '1px solid rgba(251,191,36,0.35)',
          borderRadius: 'var(--radius-sm)', color: 'var(--text-secondary)',
        }}>
          {ui.epLightExportNote}
        </div>
      )}

      {/* (bug 74) Xuất kèm file Lorebook rời — mặc định BẬT.
          Chỉ hiện khi thẻ THẬT SỰ có lorebook nhúng, không thì tuỳ chọn này vô nghĩa. */}
      {!isWorldbook && (card?.data?.character_book?.entries?.length ?? 0) > 0 && (
        <label
          title={ui.epLoreFileTip}
          style={{
            display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer',
            padding: '9px 11px', marginBottom: '10px', fontSize: '0.72rem', lineHeight: 1.55,
            background: alsoExportLorebook ? 'rgba(34,197,94,0.07)' : 'transparent',
            border: `1px solid ${alsoExportLorebook ? 'rgba(34,197,94,0.32)' : 'var(--border-subtle)'}`,
            borderRadius: 'var(--radius-sm)', color: 'var(--text-secondary)',
          }}
        >
          <input
            type="checkbox"
            checked={alsoExportLorebook}
            onChange={(e) => setAlsoExportLorebook(e.target.checked)}
            style={{ marginTop: '2px', accentColor: '#22c55e', cursor: 'pointer' }}
          />
          <span>
            <b style={{ color: alsoExportLorebook ? '#4ade80' : 'var(--text-primary)' }}>
              {ui.epLoreFileLabel}
            </b>
            <br />
            {ui.epLoreFileHint}
          </span>
        </label>
      )}

      <div style={{ display: 'flex', gap: '8px', flexDirection: 'column' }}>
        <button
          className="btn btn-primary"
          onClick={handleExport}
          disabled={phase === 'translating' || doneCount === 0}
          style={{ width: '100%' }}
        >
          <Download size={16} />
          {t.downloadJson}
        </button>

        {/* (bug 228) Nút này TRƯỚC ĐÂY chỉ hiện khi còn `originalImage`. Sau khi khôi phục
            phiên (tab bị đóng/cho ngủ) thì ảnh không còn trong bộ nhớ ⇒ nút biến mất hẳn, và
            người dùng kết luận "chỉ tải được JSON" mà không có gì gợi ý phải làm sao. Nay nút
            luôn ở đó; mất ảnh thì đổi thành ô gắn lại ảnh gốc rồi xuất luôn. */}
        {!isWorldbook && (
          (_pngArrayBuffer || originalImage) ? (
            <button
              className="btn btn-secondary"
              onClick={() => void handleExportPng()}
              disabled={phase === 'translating' || doneCount === 0}
              style={{ width: '100%', background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
            >
              <ImageIcon size={16} />
              {t.downloadPng || 'Download PNG'}
            </button>
          ) : (
            <label
              title={ui.epPngAttachTip}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                padding: '9px 12px', cursor: doneCount === 0 ? 'not-allowed' : 'pointer', opacity: doneCount === 0 ? 0.5 : 1,
                background: 'var(--bg-secondary)', border: '1px dashed var(--border-subtle)',
                borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)', fontSize: '0.8rem', fontWeight: 600,
              }}
            >
              <ImageIcon size={16} />
              {ui.epPngAttachBtn}
              <input type="file" accept="image/png,.png" style={{ display: 'none' }}
                disabled={phase === 'translating' || doneCount === 0}
                onChange={attachImageAndExportPng} />
            </label>
          )
        )}

        {/* 📄 Báo cáo dịch — tổng quan + danh sách vấn đề (Markdown tải về) */}
        <button
          className="btn btn-secondary"
          onClick={handleExportReport}
          disabled={fields.length === 0}
          style={{ width: '100%', background: 'transparent', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}
          title={ui.epReportTitle}
        >
          <FileText size={15} />
          {ui.epReportBtn}
        </button>
      </div>

      {/* Script Export Section */}
      {(translatedRegexes.length > 0 || translatedTavernHelpers.length > 0) && (
        <div style={{ marginTop: '20px', borderTop: '1px solid var(--border-subtle)', paddingTop: '15px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', fontWeight: 600, marginBottom: '12px', color: 'var(--text-primary)' }}>
            <Code size={15} style={{ color: 'var(--accent-primary)' }} />
            {ui.epScriptSection}
          </div>
          
          {translatedRegexes.length > 0 && (
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Regex Scripts ({translatedRegexes.length})</span>
                {translatedRegexes.length > 1 && (
                  <button
                    onClick={handleExportAllRegex}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--accent-primary)',
                      fontSize: '0.7rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '2px 6px',
                      borderRadius: 'var(--radius-sm)',
                      transition: 'background 0.2s',
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(124, 106, 240, 0.1)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
                    title={ui.epDownloadAllRegexTitle}
                  >
                    <Download size={11} />
                    {ui.epDownloadAll}
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', gap: '6px', flexDirection: 'column' }}>
                {translatedRegexes.map((item) => (
                  <div 
                    key={`regex-${item.index}`} 
                    style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'space-between', 
                      padding: '6px 10px', 
                      background: 'var(--bg-secondary)', 
                      borderRadius: 'var(--radius-sm)', 
                      border: '1px solid var(--border-subtle)',
                      transition: 'border-color 0.2s, background-color 0.2s'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = 'rgba(124, 106, 240, 0.3)';
                      e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = 'var(--border-subtle)';
                      e.currentTarget.style.backgroundColor = 'var(--bg-secondary)';
                    }}
                  >
                    <span 
                      style={{ 
                        fontSize: '0.7rem', 
                        color: 'var(--text-primary)', 
                        fontWeight: 500,
                        overflow: 'hidden', 
                        textOverflow: 'ellipsis', 
                        whiteSpace: 'nowrap', 
                        maxWidth: '220px' 
                      }} 
                      title={item.scriptName}
                    >
                      {item.scriptName}
                    </span>
                    <button
                      onClick={() => handleExportSingleRegex(item.script, item.scriptName)}
                      style={{ 
                        padding: '4px 8px', 
                        cursor: 'pointer', 
                        background: 'rgba(124, 106, 240, 0.1)', 
                        border: '1px solid rgba(124, 106, 240, 0.2)', 
                        borderRadius: 'var(--radius-sm)',
                        color: 'var(--accent-primary)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        fontSize: '0.65rem',
                        fontWeight: 600,
                        transition: 'all 0.2s'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'rgba(124, 106, 240, 0.2)';
                        e.currentTarget.style.borderColor = 'rgba(124, 106, 240, 0.4)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'rgba(124, 106, 240, 0.1)';
                        e.currentTarget.style.borderColor = 'rgba(124, 106, 240, 0.2)';
                      }}
                      title={ui.epDownloadRegexTitle}
                    >
                      <Download size={11} />
                      JSON
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {translatedTavernHelpers.length > 0 && (
            <div>
              <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>TavernHelper Scripts ({translatedTavernHelpers.length})</span>
                {translatedTavernHelpers.length > 1 && (
                  <button
                    onClick={handleExportAllTavernHelper}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--accent-primary)',
                      fontSize: '0.7rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '2px 6px',
                      borderRadius: 'var(--radius-sm)',
                      transition: 'background 0.2s',
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(124, 106, 240, 0.1)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
                    title={ui.epDownloadAllThTitle}
                  >
                    <Download size={11} />
                    {ui.epDownloadAll}
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', gap: '6px', flexDirection: 'column' }}>
                {translatedTavernHelpers.map((item) => (
                  <div 
                    key={`th-${item.key}-${item.index}`} 
                    style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'space-between', 
                      padding: '6px 10px', 
                      background: 'var(--bg-secondary)', 
                      borderRadius: 'var(--radius-sm)', 
                      border: '1px solid var(--border-subtle)',
                      transition: 'border-color 0.2s, background-color 0.2s'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = 'rgba(124, 106, 240, 0.3)';
                      e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = 'var(--border-subtle)';
                      e.currentTarget.style.backgroundColor = 'var(--bg-secondary)';
                    }}
                  >
                    <span 
                      style={{ 
                        fontSize: '0.7rem', 
                        color: 'var(--text-primary)', 
                        fontWeight: 500,
                        overflow: 'hidden', 
                        textOverflow: 'ellipsis', 
                        whiteSpace: 'nowrap', 
                        maxWidth: '220px' 
                      }} 
                      title={item.name}
                    >
                      {item.name}
                    </span>
                    <button
                      onClick={() => handleExportSingleTavernHelper(item.script, item.name)}
                      style={{ 
                        padding: '4px 8px', 
                        cursor: 'pointer', 
                        background: 'rgba(124, 106, 240, 0.1)', 
                        border: '1px solid rgba(124, 106, 240, 0.2)', 
                        borderRadius: 'var(--radius-sm)',
                        color: 'var(--accent-primary)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        fontSize: '0.65rem',
                        fontWeight: 600,
                        transition: 'all 0.2s'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'rgba(124, 106, 240, 0.2)';
                        e.currentTarget.style.borderColor = 'rgba(124, 106, 240, 0.4)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'rgba(124, 106, 240, 0.1)';
                        e.currentTarget.style.borderColor = 'rgba(124, 106, 240, 0.2)';
                      }}
                      title={ui.epDownloadThTitle}
                    >
                      <Download size={11} />
                      JSON
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Icon nhỏ theo mức độ vấn đề trong danh sách sức khoẻ thẻ. */
function IssueIcon({ severity }: { severity: HealthSeverity }) {
  if (severity === 'error') return <XCircle size={12} style={{ flexShrink: 0, marginTop: 1, color: 'var(--accent-danger)' }} />;
  if (severity === 'warning') return <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 1, color: 'var(--accent-warning)' }} />;
  return <Info size={12} style={{ flexShrink: 0, marginTop: 1, color: 'var(--text-muted)' }} />;
}
