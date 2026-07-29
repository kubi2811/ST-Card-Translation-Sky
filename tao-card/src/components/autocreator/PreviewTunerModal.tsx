/**
 * PreviewTunerModal — (bug 141) "XEM TRƯỚC & TINH CHỈNH" trước khi Bắt đầu tạo card.
 * ─────────────────────────────────────────────────────────────────────────────
 * Bước 1: AI quét ý tưởng → hiện schema MVU sẽ dùng; chỉnh trực tiếp từng biến (tên, phạm vi,
 *         enum, mặc định, xoá bớt, ràng buộc riêng); copilot mini nhờ AI sửa giùm; nút reset.
 * Bước 2: máy dựng sẵn 3 phương án giao diện (Opening Form + Status Bar) TỪ schema đã chỉnh —
 *         thuần buildProgrammaticRegex, đổi schema là preview đổi theo, 0 call AI. Chọn 1.
 * Bước 3: xác nhận — pipeline sẽ áp ĐÚNG 100% schema + theme đã chốt (khoá ở bước mvuzod/game_ui).
 * Trạng thái nằm trong config (persist) → thoát giữa chừng, vào lại đúng chỗ.
 */
import { useCallback, useMemo, useState } from 'react';
import { X, Wand2, RotateCcw, ChevronLeft, ChevronRight, Loader2, Check, Sparkles } from 'lucide-react';
import { useAutoCreatorStore } from '../../store/autoCreatorStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useToastStore } from '../../store/toastStore';
import { callAI } from '../../lib/ai/client';
import { buildMvuzodPrompt } from '../../lib/ai/autoCreatorPrompts';
import { extractJsonFromText } from '../../lib/ai/autoCreatorPipeline';
import { makeTuning, validateTunedSchema, buildThemeChoices, ideaSignature } from '../../lib/ai/cardTuning';
import {
  buildThemeDesignMessages, parseThemeSpec, registerAiTheme, checkThemeReadability,
  AI_THEME_ID, type AiThemeSpec,
} from '../../lib/ai/themeDesigner';
import { normalizeMVUZODSchema } from '../../lib/mvuzod/normalizeSchema';
import type { MVUZODField, MVUZODSchema } from '../../types/mvuzod.types';
import { SchemaVarTable, type VarRow } from './SchemaVarTable';
import { withPreviewData } from '../../lib/ai/schemaPreviewData';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Bấm "Bắt đầu tạo Card" ở Bước 3 — trang cha chạy pipeline như nút thường. */
  onStart: () => void;
}

/**
 * (bug 148) Schema ⇄ hàng bảng. Lá thường phẳng ra hàng; array/record giữ CẤU TRÚC CON
 * (children có path "/_child/") thành `children` của hàng để bảng con hiện đúng.
 */
function schemaToRows(schema: MVUZODSchema): VarRow[] {
  const toRow = (f: MVUZODField): VarRow => ({
    path: f.path,
    label: f.label,
    type: f.type,
    min: f.constraints?.min,
    max: f.constraints?.max,
    enumValues: f.constraints?.enumValues?.join(', '),
    defaultValue: f.defaultValue === undefined ? '' : (typeof f.defaultValue === 'object' ? JSON.stringify(f.defaultValue) : String(f.defaultValue)),
    rule: (f.constraints?.checkRules ?? []).join('\n'),
    children: (f.children ?? []).filter(c => c.path.includes('/_child/')).map(toRow),
  });

  const out: VarRow[] = [];
  const walk = (fs: MVUZODField[]) => {
    for (const f of fs) {
      const structural = f.type === 'array' || f.type === 'record';
      // Nhóm object thuần (children KHÔNG phải _child) chỉ là tầng chứa — đi xuyên qua.
      if (!structural && f.children?.some(c => !c.path.includes('/_child/'))) { walk(f.children); continue; }
      out.push(toRow(f));
    }
  };
  walk(schema.fields);
  return out;
}

function rowsToSchema(rows: VarRow[]): MVUZODSchema {
  const toField = (v: VarRow): Record<string, unknown> => {
    const constraints: Record<string, unknown> = {};
    if (v.type === 'number') {
      if (v.min !== undefined && !Number.isNaN(v.min)) constraints.min = v.min;
      if (v.max !== undefined && !Number.isNaN(v.max)) constraints.max = v.max;
    }
    if (v.type === 'string') {
      const enums = (v.enumValues ?? '').split(',').map(s => s.trim()).filter(Boolean);
      if (enums.length) constraints.enumValues = enums;
    }
    if (v.rule.trim()) constraints.checkRules = v.rule.split('\n').map(s => s.trim()).filter(Boolean);

    let defaultValue: unknown = v.defaultValue;
    if (v.type === 'number') { const n = Number(v.defaultValue); defaultValue = Number.isFinite(n) ? n : 0; }
    else if (v.type === 'boolean') defaultValue = v.defaultValue === 'true';
    else if (v.type === 'array') { try { defaultValue = JSON.parse(v.defaultValue || '[]'); } catch { defaultValue = []; } }
    else if (v.type === 'record' || v.type === 'object') { try { defaultValue = JSON.parse(v.defaultValue || '{}'); } catch { defaultValue = {}; } }

    const field: Record<string, unknown> = { path: v.path, type: v.type, label: v.label, defaultValue, constraints };
    if ((v.type === 'array' || v.type === 'record') && v.children?.length) {
      field.children = v.children.map(toField);
    }
    return field;
  };
  // normalize dựng cây từ path phẳng (nestFlatSchema) + dọn constraints.
  return normalizeMVUZODSchema({ version: '1.0', fields: rows.map(toField) });
}

export function PreviewTunerModal({ open, onClose, onStart }: Props) {
  const store = useAutoCreatorStore();
  const settings = useSettingsStore();
  const tuning = store.config.tuning;
  const [busy, setBusy] = useState<'analyze' | 'copilot' | 'theme' | null>(null);
  const [copilotAsk, setCopilotAsk] = useState('');
  // (bugNeedFix/145) Bước 2 — "Nhờ AI tạo giao diện". Giữ NGUYÊN spec đang có để lượt chỉnh sau
  // gửi lại cho AI, nhờ đó nó sửa đúng chỗ bị chê thay vì vẽ lại từ đầu.
  const [themeAsk, setThemeAsk] = useState('');
  const [aiSpec, setAiSpec] = useState<AiThemeSpec | null>(null);
  const [aiWarn, setAiWarn] = useState<string[]>([]);
  const [aiNonce, setAiNonce] = useState(0);   // đổi để buildThemeChoices dựng lại preview
  // (bug 148-3) Xem trước VỚI BIẾN THẬT của schema đang chỉnh — mặc định BẬT, vì khung rỗng
  // chẳng nói lên điều gì về schema vừa sửa.
  const [withData, setWithData] = useState(true);

  const activeProfile = settings.getActiveProfile();
  const idea = store.config.idea;
  const ideaChanged = !!tuning && tuning.ideaSig !== ideaSignature(idea);
  // (bugNeedFix/145) Tên gợi cho AI biết thẻ nói về gì — lấy dòng có chữ đầu tiên của ý tưởng.
  const ideaHeadline = useMemo(
    () => (idea.split(/\r?\n/).map(l => l.replace(/^[#\-*\s]+/, '').trim()).find(Boolean) ?? 'Thẻ nhân vật').slice(0, 80),
    [idea],
  );

  const rows = useMemo(() => (tuning ? schemaToRows(tuning.schema) : []), [tuning]);
  const setRows = useCallback((next: VarRow[]) => {
    const { schema } = validateTunedSchema(rowsToSchema(next));
    useAutoCreatorStore.getState().setTuning({ schema, confirmed: false });
  }, []);

  // Bước 2 dựng thuần máy — đổi schema là preview tự đổi.
  // (bugNeedFix/145) aiNonce nằm trong deps để khi AI sinh xong theme mới thì danh sách phương
  // án dựng lại và thẻ "Giao diện AI" hiện ra ngay cạnh 3 mẫu dựng sẵn.
  const themeChoices = useMemo(
    () => (tuning && tuning.step >= 2 ? buildThemeChoices(tuning.schema, 'Preview', aiSpec ? 4 : 3) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tuning, aiNonce, aiSpec],
  );

  /**
   * (bugNeedFix/145) Bước 2 — nhờ AI dựng giao diện theo phong cách/màu người dùng mô tả.
   * AI chỉ quyết BẢNG MÀU + FONT; khung HTML vẫn do buildProgrammaticRegex dựng như 3 mẫu sẵn,
   * nên giao diện AI tạo ra chắc chắn còn nguyên đường ghi/đọc biến (bài học bug 114).
   * Bấm lần nữa với yêu cầu mới = CHỈNH bản vừa tạo, không phải làm lại từ số không.
   */
  const handleDesignTheme = useCallback(async () => {
    const toast = useToastStore.getState();
    if (!activeProfile) { toast.warning('Chưa cấu hình API.'); return; }
    if (!themeAsk.trim()) { toast.warning('Hãy tả phong cách bạn muốn (tông màu, không khí, thời đại…).'); return; }
    setBusy('theme');
    try {
      const res = await callAI({
        profile: activeProfile,
        params: { ...settings.generationParams, temperature: 0.6, useJsonResponseFormat: true, stream: false },
        messages: buildThemeDesignMessages(themeAsk.trim(), ideaHeadline, aiSpec ?? undefined),
        label: aiSpec ? 'Chỉnh giao diện AI' : 'Thiết kế giao diện AI',
      });
      const spec = parseThemeSpec(res.text);
      registerAiTheme(spec);
      setAiSpec(spec);
      setAiWarn(checkThemeReadability(spec));
      setAiNonce(n => n + 1);
      useAutoCreatorStore.getState().setTuning({ themeId: AI_THEME_ID, confirmed: false });
      setThemeAsk('');
      toast.success(`Đã dựng giao diện "${spec.name}" — xem trước bên dưới, chưa ưng thì tả tiếp để chỉnh.`);
    } catch (e) {
      toast.error(`Không dựng được giao diện: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  }, [activeProfile, themeAsk, aiSpec, settings.generationParams, ideaHeadline]);

  /** Bước 1 — gọi AI sinh schema từ ý tưởng (chỉ khi chưa có hoặc ý tưởng đã đổi). */
  const handleAnalyze = useCallback(async () => {
    const toast = useToastStore.getState();
    if (!activeProfile) { toast.warning('Chưa cấu hình API.'); return; }
    setBusy('analyze');
    try {
      const cfg = useAutoCreatorStore.getState().config;
      const prompt = buildMvuzodPrompt(cfg.idea, '(chưa có lorebook — chỉ dựa vào ý tưởng)', cfg.stepConfigs.mvuzod, null);
      const res = await callAI({
        profile: activeProfile,
        params: { ...settings.generationParams, useJsonResponseFormat: true, stream: false },
        messages: [{ role: 'user', content: prompt }],
        label: 'Xem trước schema',
      });
      const parsed = extractJsonFromText(res.text) as { schema?: unknown } | null;
      const check = validateTunedSchema(parsed?.schema);
      if (!check.ok) throw new Error(check.problems.join(' · '));
      useAutoCreatorStore.getState().setTuning(makeTuning(check.schema, cfg.idea));
    } catch (e) {
      toast.error(`Không sinh được schema xem trước: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  }, [activeProfile, settings.generationParams]);

  /** Copilot mini — nhờ AI sửa schema theo yêu cầu; máy validate rồi mới nhận. */
  const handleCopilot = useCallback(async () => {
    const toast = useToastStore.getState();
    const t = useAutoCreatorStore.getState().config.tuning;
    if (!activeProfile || !t || !copilotAsk.trim()) return;
    setBusy('copilot');
    try {
      const res = await callAI({
        profile: activeProfile,
        params: { ...settings.generationParams, temperature: 0.2, useJsonResponseFormat: true, stream: false },
        messages: [
          { role: 'system', content: 'Bạn là trợ lý chỉnh schema MVU. Nhận schema JSON hiện tại + yêu cầu của user, trả về DUY NHẤT JSON {"schema": {...}} — schema ĐẦY ĐỦ sau khi sửa. Chỉ sửa đúng phần user yêu cầu, giữ nguyên phần còn lại (path/type/constraints/defaultValue). Không thêm lời giải thích.' },
          { role: 'user', content: `SCHEMA HIỆN TẠI:\n${JSON.stringify(t.schema, null, 1)}\n\nYÊU CẦU: ${copilotAsk.trim()}` },
        ],
        label: 'Copilot schema',
      });
      const parsed = extractJsonFromText(res.text) as { schema?: unknown } | null;
      const check = validateTunedSchema(parsed?.schema ?? parsed);
      if (!check.ok) throw new Error(check.problems.join(' · '));
      useAutoCreatorStore.getState().setTuning({ schema: check.schema, confirmed: false });
      setCopilotAsk('');
      useToastStore.getState().success('Đã áp chỉnh sửa của copilot (máy đã kiểm schema hợp lệ).');
    } catch (e) {
      toast.error(`Copilot không sửa được: ${e instanceof Error ? e.message : String(e)} — schema giữ nguyên.`);
    } finally {
      setBusy(null);
    }
  }, [activeProfile, copilotAsk, settings.generationParams]);

  if (!open) return null;

  const step = tuning?.step ?? 1;
  const go = (s: 1 | 2 | 3) => useAutoCreatorStore.getState().setTuning({ step: s });

  return (
    <div className="fixed inset-0 z-[90] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-4xl max-h-[90vh] flex flex-col rounded-2xl border border-border bg-background shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Header + bước */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <Sparkles className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold flex-1">Xem trước &amp; Tinh chỉnh</span>
          {[1, 2, 3].map(s => (
            <span key={s} className={`px-2 py-0.5 rounded-full text-[10px] ${step === s ? 'bg-primary/20 text-primary font-semibold' : 'text-muted-foreground'}`}>
              {s === 1 ? '1 · Schema' : s === 2 ? '2 · Giao diện' : '3 · Xác nhận'}
            </span>
          ))}
          <button onClick={onClose} title="Đóng — mọi thứ được lưu tạm, vào lại tiếp tục" className="p-1.5 rounded hover:bg-muted"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-3">
          {/* ═══ BƯỚC 1 — SCHEMA ═══ */}
          {step === 1 && (
            <>
              {(!tuning || ideaChanged) ? (
                <div className="text-center py-8 space-y-3">
                  {ideaChanged && <p className="text-xs text-amber-400">Ý tưởng đã thay đổi từ lần xem trước — cần quét lại.</p>}
                  <p className="text-xs text-muted-foreground">AI sẽ quét toàn bộ Ý tưởng và hiện sơ lược schema MVU sẽ tạo (biến, kiểu, phạm vi) để bạn chỉnh trước.</p>
                  <button onClick={handleAnalyze} disabled={busy !== null || !idea.trim() || !activeProfile}
                    className="px-4 py-2 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                    {busy === 'analyze' ? <span className="flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Đang quét ý tưởng…</span> : '🔍 Quét ý tưởng & hiện schema'}
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground flex-1">{rows.length} biến (nhóm cấp cao) — sửa trực tiếp từng ô; xoá biến thấy dư; viết ràng buộc riêng ngay tại chỗ.</span>
                    <button onClick={() => useAutoCreatorStore.getState().setTuning({ schema: JSON.parse(JSON.stringify(tuning!.originalSchema)), confirmed: false })}
                      className="flex items-center gap-1 px-2 py-1 rounded text-[10px] border border-border hover:bg-muted" title="Bỏ mọi chỉnh sửa, quay về bản AI đề xuất">
                      <RotateCcw className="w-3 h-3" /> Reset về bản AI đưa
                    </button>
                    <button onClick={handleAnalyze} disabled={busy !== null}
                      className="px-2 py-1 rounded text-[10px] border border-border hover:bg-muted disabled:opacity-50" title="Quét lại ý tưởng từ đầu (1 call AI)">
                      🔄 Quét lại
                    </button>
                  </div>

                  {/* (bug 148) Bảng 5 cột cố định, ô nhập đổi theo Type, bảng con đệ quy cho Array/Record. */}
                  <SchemaVarTable rows={rows} onChange={setRows} />

                  {/* Copilot mini */}
                  <div className="rounded-lg border border-purple-500/30 bg-purple-500/5 p-2 space-y-1.5">
                    <div className="text-[10px] text-purple-300 flex items-center gap-1"><Wand2 className="w-3 h-3" /> Sợ đụng hỏng schema? Nhờ AI sửa giùm — máy kiểm hợp lệ rồi mới nhận:</div>
                    <div className="flex gap-1.5">
                      <input className="flex-1 px-2 py-1.5 rounded border border-border bg-card text-[11px]"
                        placeholder={'vd: "gộp HP với Thể lực", "thêm biến Danh vọng 0-1000", "bỏ hết biến về thời tiết"'}
                        value={copilotAsk} onChange={e => setCopilotAsk(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') void handleCopilot(); }} />
                      <button onClick={handleCopilot} disabled={busy !== null || !copilotAsk.trim()}
                        className="px-3 py-1.5 rounded text-[11px] border border-purple-500/40 text-purple-300 hover:bg-purple-500/10 disabled:opacity-50">
                        {busy === 'copilot' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Sửa giùm'}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          {/* ═══ BƯỚC 2 — GIAO DIỆN ═══ */}
          {step === 2 && tuning && (
            <>
              <div className="flex items-start gap-2">
                <p className="text-xs text-muted-foreground flex-1">Các phương án dựng TỪ schema bạn vừa chốt (mỗi phương án = Opening Form + Status Bar cùng tông). Chọn 1:</p>
                {/* (bug 148-3) Xem trước có ĐỔ BIẾN của schema đang chỉnh vào giao diện — tắt đi
                    thì thấy khung trơn như trước. */}
                <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground shrink-0 cursor-pointer"
                  title="Đổ giá trị mẫu sinh từ chính schema bạn vừa chỉnh vào giao diện, để thấy trước thanh trạng thái/biểu mẫu khi chơi thật">
                  <input type="checkbox" checked={withData} onChange={e => setWithData(e.target.checked)} />
                  Xem với biến của schema
                </label>
              </div>

              {/* ═══ (bugNeedFix/145) NHỜ AI TẠO GIAO DIỆN ═══
                  AI chỉ quyết bảng màu + font; khung HTML vẫn do máy dựng như các mẫu sẵn, nên
                  giao diện AI tạo không thể làm hỏng đường ghi/đọc biến (bài học bug 114). */}
              <div className="rounded-xl border border-primary/30 bg-primary/5 p-2.5 space-y-2">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-primary">
                  <Sparkles className="w-3.5 h-3.5" />
                  {aiSpec ? `Giao diện AI: ${aiSpec.icon} ${aiSpec.name}` : 'Nhờ AI tạo giao diện riêng'}
                </div>
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  {aiSpec
                    ? 'Chưa ưng chỗ nào thì tả tiếp — AI giữ nguyên phần còn lại và chỉ sửa đúng chỗ bạn nói.'
                    : 'Tả phong cách bạn thích: tông màu chủ đạo, không khí (u ám / tươi sáng / cổ trang / công nghệ), thời đại… AI sẽ phối màu và chọn font cho vừa thế giới của thẻ.'}
                </p>
                <div className="flex gap-1.5">
                  <input
                    value={themeAsk}
                    onChange={(e) => setThemeAsk(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !busy) handleDesignTheme(); }}
                    placeholder={aiSpec ? 'VD: nền tối hơn, chữ vàng đồng, bớt tím' : 'VD: tiên hiệp thanh nhã, tông xanh ngọc, nền tối'}
                    className="flex-1 px-2 py-1.5 rounded-lg bg-background border border-border text-[11px]"
                  />
                  <button
                    onClick={handleDesignTheme}
                    disabled={busy !== null || !themeAsk.trim()}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    {busy === 'theme' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                    {aiSpec ? 'Chỉnh lại' : 'Tạo giao diện'}
                  </button>
                </div>
                {aiSpec && (
                  <div className="flex flex-wrap gap-1 pt-0.5">
                    {Object.entries(aiSpec.colors).slice(0, 12).map(([k, v]) => (
                      <span key={k} title={`${k}: ${v}`} className="w-4 h-4 rounded border border-border/50" style={{ background: v }} />
                    ))}
                  </div>
                )}
                {aiWarn.length > 0 && (
                  <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-1.5 space-y-0.5">
                    {aiWarn.map((w, i) => (
                      <p key={i} className="text-[10px] text-amber-500 leading-snug">⚠️ {w}</p>
                    ))}
                    <p className="text-[10px] text-muted-foreground">Bảo AI &quot;tăng tương phản chữ&quot; rồi bấm Chỉnh lại.</p>
                  </div>
                )}
              </div>
              <div className="grid md:grid-cols-3 gap-2">
                {themeChoices.map(c => (
                  <button key={c.themeId}
                    onClick={() => useAutoCreatorStore.getState().setTuning({ themeId: c.themeId, confirmed: false })}
                    className={`rounded-xl border-2 overflow-hidden text-left transition-colors ${tuning.themeId === c.themeId ? 'border-primary' : 'border-border hover:border-primary/40'}`}>
                    <div className={`px-2 py-1.5 text-[11px] font-medium flex items-center gap-1.5 ${tuning.themeId === c.themeId ? 'bg-primary/15 text-primary' : 'bg-muted/20'}`}>
                      {tuning.themeId === c.themeId && <Check className="w-3 h-3" />}{c.label}
                    </div>
                    <iframe title={c.themeId} sandbox="allow-scripts" srcDoc={withData ? withPreviewData(c.previewHtml, tuning.schema) : c.previewHtml}
                      className="w-full h-64 bg-white pointer-events-none" />
                  </button>
                ))}
              </div>
            </>
          )}

          {/* ═══ BƯỚC 3 — XÁC NHẬN ═══ */}
          {step === 3 && tuning && (
            <div className="space-y-3 py-4 text-center">
              <p className="text-sm font-semibold">Chốt lại trước khi tạo card</p>
              <div className="inline-block text-left text-xs rounded-xl border border-border p-4 space-y-1">
                <div>🧬 Schema: <b>{rows.length} nhóm biến</b>{JSON.stringify(tuning.schema) !== JSON.stringify(tuning.originalSchema) ? ' (đã tinh chỉnh)' : ' (bản AI đề xuất, không chỉnh)'}</div>
                <div>🎨 Giao diện: <b>{themeChoices.find(c => c.themeId === tuning.themeId)?.label ?? 'mặc định (chưa chọn)'}</b></div>
                <div className="text-muted-foreground pt-1">Card tạo ra sẽ dùng ĐÚNG 100% schema + giao diện trên — bước MVUZOD và Game UI bị khoá theo lựa chọn này.</div>
              </div>
            </div>
          )}
        </div>

        {/* Footer điều hướng */}
        <div className="flex items-center gap-2 px-4 py-3 border-t border-border">
          {step > 1 && (
            <button onClick={() => go((step - 1) as 1 | 2)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs border border-border hover:bg-muted">
              <ChevronLeft className="w-3.5 h-3.5" /> Quay lại
            </button>
          )}
          <span className="flex-1 text-[10px] text-muted-foreground">Không chỉnh gì mà bấm Tiếp tục = dùng mặc định. Thoát giữa chừng vẫn được lưu.</span>
          {step < 3 && tuning && !ideaChanged && (
            <button onClick={() => go((step + 1) as 2 | 3)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs bg-primary text-primary-foreground hover:bg-primary/90">
              Tiếp tục <ChevronRight className="w-3.5 h-3.5" />
            </button>
          )}
          {step === 3 && tuning && (
            <button
              onClick={() => { useAutoCreatorStore.getState().setTuning({ confirmed: true }); onClose(); onStart(); }}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium bg-gradient-to-r from-emerald-600 to-teal-600 text-white hover:from-emerald-500 hover:to-teal-500">
              ▶ Bắt đầu tạo Card (theo bản đã chốt)
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
