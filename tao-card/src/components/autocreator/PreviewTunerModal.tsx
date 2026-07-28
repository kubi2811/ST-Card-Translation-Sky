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
import { X, Wand2, RotateCcw, Trash2, ChevronLeft, ChevronRight, Loader2, Check, Sparkles } from 'lucide-react';
import { useAutoCreatorStore } from '../../store/autoCreatorStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useToastStore } from '../../store/toastStore';
import { callAI } from '../../lib/ai/client';
import { buildMvuzodPrompt } from '../../lib/ai/autoCreatorPrompts';
import { extractJsonFromText } from '../../lib/ai/autoCreatorPipeline';
import { makeTuning, validateTunedSchema, buildThemeChoices, ideaSignature } from '../../lib/ai/cardTuning';
import { normalizeMVUZODSchema } from '../../lib/mvuzod/normalizeSchema';
import type { MVUZODField, MVUZODSchema } from '../../types/mvuzod.types';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Bấm "Bắt đầu tạo Card" ở Bước 3 — trang cha chạy pipeline như nút thường. */
  onStart: () => void;
}

/** Lá phẳng để hiện bảng chỉnh — normalize dựng lại cây từ path khi lưu. */
interface FlatVar {
  path: string;
  label: string;
  type: MVUZODField['type'];
  min?: number;
  max?: number;
  enumValues?: string;
  defaultValue: string;
  /** Ràng buộc riêng user viết cho biến này (đi vào constraints.checkRules). */
  rule: string;
}

function schemaToFlat(schema: MVUZODSchema): FlatVar[] {
  const out: FlatVar[] = [];
  const walk = (fs: MVUZODField[]) => {
    for (const f of fs) {
      if (f.children?.length) { walk(f.children); continue; }
      out.push({
        path: f.path,
        label: f.label,
        type: f.type,
        min: f.constraints?.min,
        max: f.constraints?.max,
        enumValues: f.constraints?.enumValues?.join(', '),
        defaultValue: f.defaultValue === undefined ? '' : String(f.defaultValue),
        rule: (f.constraints?.checkRules ?? []).join('\n'),
      });
    }
  };
  walk(schema.fields);
  return out;
}

function flatToSchema(flat: FlatVar[]): MVUZODSchema {
  const fields = flat.map((v) => {
    const constraints: Record<string, unknown> = {};
    if (v.min !== undefined && !Number.isNaN(v.min)) constraints.min = v.min;
    if (v.max !== undefined && !Number.isNaN(v.max)) constraints.max = v.max;
    const enums = (v.enumValues ?? '').split(',').map(s => s.trim()).filter(Boolean);
    if (enums.length) constraints.enumValues = enums;
    if (v.rule.trim()) constraints.checkRules = v.rule.split('\n').map(s => s.trim()).filter(Boolean);
    let defaultValue: unknown = v.defaultValue;
    if (v.type === 'number') { const n = Number(v.defaultValue); defaultValue = Number.isFinite(n) ? n : 0; }
    if (v.type === 'boolean') defaultValue = v.defaultValue === 'true';
    return { path: v.path, type: v.type, label: v.label, defaultValue, constraints };
  });
  // normalize dựng cây từ path phẳng (nestFlatSchema) + dọn constraints.
  return normalizeMVUZODSchema({ version: '1.0', fields });
}

export function PreviewTunerModal({ open, onClose, onStart }: Props) {
  const store = useAutoCreatorStore();
  const settings = useSettingsStore();
  const tuning = store.config.tuning;
  const [busy, setBusy] = useState<'analyze' | 'copilot' | null>(null);
  const [copilotAsk, setCopilotAsk] = useState('');

  const activeProfile = settings.getActiveProfile();
  const idea = store.config.idea;
  const ideaChanged = !!tuning && tuning.ideaSig !== ideaSignature(idea);

  const flat = useMemo(() => (tuning ? schemaToFlat(tuning.schema) : []), [tuning]);
  const setFlat = useCallback((next: FlatVar[]) => {
    const { schema } = validateTunedSchema(flatToSchema(next));
    useAutoCreatorStore.getState().setTuning({ schema, confirmed: false });
  }, []);

  // Bước 2 dựng thuần máy — đổi schema là preview tự đổi.
  const themeChoices = useMemo(
    () => (tuning && tuning.step >= 2 ? buildThemeChoices(tuning.schema, 'Preview') : []),
    [tuning],
  );

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
                    <span className="text-xs text-muted-foreground flex-1">{flat.length} biến — sửa trực tiếp từng ô; xoá biến thấy dư; viết ràng buộc riêng ngay tại chỗ.</span>
                    <button onClick={() => useAutoCreatorStore.getState().setTuning({ schema: JSON.parse(JSON.stringify(tuning!.originalSchema)), confirmed: false })}
                      className="flex items-center gap-1 px-2 py-1 rounded text-[10px] border border-border hover:bg-muted" title="Bỏ mọi chỉnh sửa, quay về bản AI đề xuất">
                      <RotateCcw className="w-3 h-3" /> Reset về bản AI đưa
                    </button>
                    <button onClick={handleAnalyze} disabled={busy !== null}
                      className="px-2 py-1 rounded text-[10px] border border-border hover:bg-muted disabled:opacity-50" title="Quét lại ý tưởng từ đầu (1 call AI)">
                      🔄 Quét lại
                    </button>
                  </div>

                  <div className="space-y-1.5">
                    {flat.map((v, i) => (
                      <div key={v.path} className="rounded-lg border border-border p-2 grid grid-cols-12 gap-1.5 items-center text-[11px]">
                        <input className="col-span-3 px-2 py-1 rounded border border-border bg-card" value={v.label}
                          title={v.path}
                          onChange={e => {
                            const next = [...flat];
                            const name = e.target.value;
                            const segs = v.path.split('/'); segs[segs.length - 1] = name;
                            next[i] = { ...v, label: name, path: segs.join('/') };
                            setFlat(next);
                          }} />
                        <select className="col-span-2 px-1 py-1 rounded border border-border bg-card" value={v.type}
                          onChange={e => { const next = [...flat]; next[i] = { ...v, type: e.target.value as FlatVar['type'] }; setFlat(next); }}>
                          <option value="number">number</option><option value="string">string</option><option value="boolean">boolean</option>
                        </select>
                        {v.type === 'number' ? (
                          <>
                            <input className="col-span-1 px-1 py-1 rounded border border-border bg-card" placeholder="min" value={v.min ?? ''}
                              onChange={e => { const next = [...flat]; next[i] = { ...v, min: e.target.value === '' ? undefined : Number(e.target.value) }; setFlat(next); }} />
                            <input className="col-span-1 px-1 py-1 rounded border border-border bg-card" placeholder="max" value={v.max ?? ''}
                              onChange={e => { const next = [...flat]; next[i] = { ...v, max: e.target.value === '' ? undefined : Number(e.target.value) }; setFlat(next); }} />
                          </>
                        ) : (
                          <input className="col-span-2 px-1 py-1 rounded border border-border bg-card" placeholder="enum: A, B, C" value={v.enumValues ?? ''}
                            onChange={e => { const next = [...flat]; next[i] = { ...v, enumValues: e.target.value }; setFlat(next); }} />
                        )}
                        <input className="col-span-2 px-1 py-1 rounded border border-border bg-card" placeholder="mặc định" value={v.defaultValue}
                          onChange={e => { const next = [...flat]; next[i] = { ...v, defaultValue: e.target.value }; setFlat(next); }} />
                        <input className={`${v.type === 'number' ? 'col-span-2' : 'col-span-3'} px-1 py-1 rounded border border-border bg-card`} placeholder="ràng buộc riêng cho biến này…" value={v.rule}
                          onChange={e => { const next = [...flat]; next[i] = { ...v, rule: e.target.value }; setFlat(next); }} />
                        <button className="col-span-1 justify-self-end p-1 rounded text-red-400 hover:bg-red-500/10" title="Xoá biến này"
                          onClick={() => setFlat(flat.filter((_, j) => j !== i))}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>

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
              <p className="text-xs text-muted-foreground">3 phương án dựng TỪ schema bạn vừa chốt (mỗi phương án = Opening Form + Status Bar cùng tông). Chọn 1:</p>
              <div className="grid md:grid-cols-3 gap-2">
                {themeChoices.map(c => (
                  <button key={c.themeId}
                    onClick={() => useAutoCreatorStore.getState().setTuning({ themeId: c.themeId, confirmed: false })}
                    className={`rounded-xl border-2 overflow-hidden text-left transition-colors ${tuning.themeId === c.themeId ? 'border-primary' : 'border-border hover:border-primary/40'}`}>
                    <div className={`px-2 py-1.5 text-[11px] font-medium flex items-center gap-1.5 ${tuning.themeId === c.themeId ? 'bg-primary/15 text-primary' : 'bg-muted/20'}`}>
                      {tuning.themeId === c.themeId && <Check className="w-3 h-3" />}{c.label}
                    </div>
                    <iframe title={c.themeId} sandbox="allow-scripts" srcDoc={c.previewHtml}
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
                <div>🧬 Schema: <b>{flat.length} biến</b>{JSON.stringify(tuning.schema) !== JSON.stringify(tuning.originalSchema) ? ' (đã tinh chỉnh)' : ' (bản AI đề xuất, không chỉnh)'}</div>
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
