/**
 * FrontendStudio — tab "Front-End" của MVUZOD Studio (bug 192).
 * ─────────────────────────────────────────────────────────────────────────────
 * Biến thẻ thành một ứng dụng chạy trong tin nhắn: màn khởi tạo → màn chính có bảng chỉ
 * số và KHUNG CHAT NHÚNG nói thẳng với SillyTavern (không dán chữ vào khung chat gốc).
 *
 * Khác "Game UI" ngay bên cạnh: Game UI nhờ AI viết từng mảnh trang trí (thanh chỉ số,
 * form mở màn). Tab này KHÔNG gọi AI — nó ghép sẵn một bộ khung đã chạy thật trên
 * SillyTavern, và suy toàn bộ cấu hình từ schema, nên kết quả tất định và lặp lại được.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MonitorSmartphone, Check, AlertTriangle, Loader2, Eye, Code2, Download,
  Plus, Trash2, Info, RefreshCw, Sparkles,
} from 'lucide-react';
import { useCardStore } from '../../store/cardStore';
import type { MVUZODSchema, InitVarConfig } from '../../types/mvuzod.types';
import type { FrontendKitOptions, StfeScenario } from '../../lib/frontendKit/types';
import {
  THEME_PRESETS, flattenScalarFields, detectUpdateTag,
  suggestFormPaths, suggestBars, suggestNamePath, suggestChipPaths, suggestScenarioPath,
} from '../../lib/frontendKit/schemaToConfig';
import { buildFrontend, mergeFrontendScripts, formatKb } from '../../lib/frontendKit/buildPayload';
// @ts-expect-error — module JS thuần dùng chung với bộ dựng dòng lệnh
import { buildPresets } from '../../lib/frontendKit/presetBuilder.js';

interface Props { schema: MVUZODSchema | null; initVarConfig?: InitVarConfig | null; }

type ProductTab = 'preview' | 'config' | 'checks';

const DEFAULT_SCENARIOS: StfeScenario[] = [
  { id: 's1', title: 'Khởi đầu êm', desc: 'Mở màn ở nơi an toàn, nhiều NPC, nhịp chậm.', seed: 'Nhân vật đang ở một nơi an toàn, xung quanh có người qua lại, chưa có nguy hiểm trước mắt.' },
  { id: 's2', title: 'Vào việc ngay', desc: 'Mở màn giữa một nhiệm vụ đang dở. Nhịp nhanh.', seed: 'Nhân vật đang ở giữa một nhiệm vụ dở dang và phải quyết định ngay trong vài phút tới.' },
  { id: 's3', title: 'Tự do — tôi tự mô tả', desc: 'Viết bối cảnh mở màn theo ý bạn ở ô ghi chú.', seed: '' },
];

const DEFAULT_QUICK = [
  'Quan sát kỹ xung quanh.',
  'Bắt chuyện với người gần nhất.',
  'Kiểm tra đồ đạc trên người.',
  'Nghỉ một lát cho lại sức.',
];

export function FrontendStudio({ schema, initVarConfig }: Props) {
  const card = useCardStore(s => s.card);
  const updateCard = useCardStore(s => s.updateCard);

  const scalars = useMemo(() => flattenScalarFields(schema), [schema]);

  /** Thẻ cập nhật biến phải DÒ từ chính thẻ, không đoán — sai thẻ là không có màn chính. */
  const detectedTag = useMemo(() => detectUpdateTag([
    card.data.post_history_instructions || '',
    ...(card.data.character_book?.entries || []).map(e => e.content || ''),
  ]), [card.data.post_history_instructions, card.data.character_book]);

  const [opts, setOpts] = useState<FrontendKitOptions>(() => ({
    title: card.data.name || 'Thẻ nhập vai',
    subtitle: '',
    bootTag: 'GameBoot',
    updateTag: detectedTag,
    themeId: THEME_PRESETS[0].id,
    historyTurns: 14,
    formPaths: suggestFormPaths(schema),
    chipPaths: suggestChipPaths(schema),
    bars: suggestBars(schema),
    namePath: suggestNamePath(schema),
    scenarios: DEFAULT_SCENARIOS,
    quickActions: DEFAULT_QUICK,
    openingExtra: '',
    derive: [],
    scenarioPath: suggestScenarioPath(schema),
  }));

  const [productTab, setProductTab] = useState<ProductTab>('preview');
  const [applied, setApplied] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [schemaChanged, setSchemaChanged] = useState(false);

  /** Người dùng đã tự chỉnh gì chưa. Chỉnh rồi thì không tự ghi đè lên lựa chọn của họ. */
  const touched = useRef(false);

  const set = useCallback(<K extends keyof FrontendKitOptions>(k: K, v: FrontendKitOptions[K]) => {
    touched.current = true;
    setOpts(o => ({ ...o, [k]: v }));
    setApplied('');
    setSchemaChanged(false);
  }, []);

  /**
   * Panel này thường được mở TRƯỚC khi thẻ được nạp (nhập JSON, mở dự án khác, dựng xong
   * schema ở tab bên cạnh). `useState` chỉ chạy hàm khởi tạo đúng một lần, nên nếu không
   * có chỗ này thì mọi gợi ý vẫn là của lúc chưa có schema: 0 trường biểu mẫu, 0 thanh
   * chỉ số, tên thẻ vẫn là "New Character" — nhìn thì tưởng công cụ hỏng.
   */
  const schemaKey = useMemo(
    () => (schema?.fields || []).map(f => f.path).join('|') + '#' + (card.data.name || ''),
    [schema, card.data.name],
  );
  const lastKey = useRef(schemaKey);
  useEffect(() => {
    if (lastKey.current === schemaKey) return;
    lastKey.current = schemaKey;
    if (touched.current) { setSchemaChanged(true); return; }
    setOpts(o => ({
      ...o,
      title: card.data.name || o.title,
      updateTag: detectedTag,
      formPaths: suggestFormPaths(schema),
      chipPaths: suggestChipPaths(schema),
      bars: suggestBars(schema),
      namePath: suggestNamePath(schema),
      scenarioPath: suggestScenarioPath(schema),
    }));
  }, [schemaKey, schema, card.data.name, detectedTag]);

  const build = useMemo(() => {
    try {
      return { ok: true as const, result: buildFrontend(schema, initVarConfig ?? null, opts) };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  }, [schema, initVarConfig, opts]);

  const resuggest = useCallback(() => {
    setOpts(o => ({
      ...o,
      title: card.data.name || o.title,
      formPaths: suggestFormPaths(schema),
      chipPaths: suggestChipPaths(schema),
      bars: suggestBars(schema),
      namePath: suggestNamePath(schema),
      scenarioPath: suggestScenarioPath(schema),
      updateTag: detectedTag,
    }));
    setApplied('');
    setSchemaChanged(false);
  }, [schema, detectedTag, card.data.name]);

  const apply = useCallback(() => {
    if (!build.ok || build.result.violations.length) return;
    setBusy(true);
    try {
      const r = build.result;
      updateCard(c => {
        const ext = c.data.extensions as unknown as Record<string, unknown>;
        const existing = (ext.regex_scripts as typeof r.scripts) || [];
        ext.regex_scripts = mergeFrontendScripts(existing, r.scripts);
        c.data.first_mes = r.firstMes;
      });
      setApplied(`Đã gắn 2 script vào thẻ và đặt first_mes = ${r.firstMes}`);
    } finally {
      setBusy(false);
    }
  }, [build, updateCard]);

  const downloadPresets = useCallback(() => {
    const p = buildPresets({ title: opts.title, subtitle: opts.subtitle, updateTag: opts.updateTag });
    const save = (name: string, obj: unknown) => {
      const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name + '.json';
      a.click();
      URL.revokeObjectURL(a.href);
    };
    save(p.names.khoiDau, p.khoiDau);
    save(p.names.choiThe, p.choiThe);
  }, [opts.title, opts.subtitle, opts.updateTag]);

  const toggleIn = (list: string[], v: string) =>
    list.includes(v) ? list.filter(x => x !== v) : [...list, v];

  if (!schema || !schema.fields?.length) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
          <AlertTriangle className="inline w-4 h-4 mr-2" />
          Chưa có schema. Dựng schema ở tab <b>Schema</b> và giá trị khởi tạo ở tab <b>InitVar</b> trước —
          giao diện front-end suy ra từ đúng hai thứ đó, không bịa trường nào.
        </div>
      </div>
    );
  }

  const r = build.ok ? build.result : null;
  const hasViolation = !!r && r.violations.length > 0;

  return (
    <div className="flex h-full min-h-0">
      {/* ── Cột trái: cấu hình ─────────────────────────────────────────── */}
      <div className="w-[440px] shrink-0 overflow-y-auto scrollbar-thin border-r border-white/10 p-4 space-y-4">
        <div className="flex items-center gap-2">
          <MonitorSmartphone className="w-5 h-5 text-cyan-400" />
          <h2 className="font-semibold">Giao diện Front-End</h2>
          <button onClick={resuggest} className="ml-auto text-xs px-2 py-1 rounded border border-white/15 hover:bg-white/5 flex items-center gap-1">
            <RefreshCw className="w-3 h-3" /> Gợi ý lại
          </button>
        </div>

        <p className="text-xs text-white/50 leading-relaxed">
          Cả ván chơi diễn ra trong <b>một tin nhắn</b>: màn khởi tạo → màn chính có khung chat nhúng
          gọi thẳng SillyTavern. Nhật ký lưu trong biến chat nên thoát thẻ vào lại không mất gì.
        </p>

        {schemaChanged && (
          <div className="rounded border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-200">
            Schema hoặc thẻ vừa đổi, nhưng bạn đã tự chỉnh cấu hình nên tôi không ghi đè.
            Bấm <b>Gợi ý lại</b> nếu muốn lấy theo schema mới.
          </div>
        )}

        <Field label="Tên hiển thị">
          <input className="fe-in" value={opts.title} onChange={e => set('title', e.target.value)} />
        </Field>
        <Field label="Dòng phụ (tuỳ chọn)">
          <input className="fe-in" value={opts.subtitle} onChange={e => set('subtitle', e.target.value)}
            placeholder="VD: Năm 3000 · Kỷ nguyên Veil" />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Thẻ mở màn" hint="Đặt vào first_mes, phải là tên riêng chưa dùng ở đâu.">
            <input className="fe-in" value={opts.bootTag}
              onChange={e => set('bootTag', e.target.value.replace(/[^A-Za-z0-9_]/g, ''))} />
          </Field>
          <Field label="Thẻ cập nhật biến" hint={`Dò được từ thẻ: ${detectedTag}`}>
            <input className="fe-in" value={opts.updateTag}
              onChange={e => set('updateTag', e.target.value.replace(/[^A-Za-z0-9_]/g, ''))} />
          </Field>
        </div>

        <Field label="Bảng màu">
          <div className="grid grid-cols-2 gap-2">
            {THEME_PRESETS.map(t => (
              <button key={t.id} onClick={() => set('themeId', t.id)}
                className={`text-left text-xs px-2 py-2 rounded border transition ${
                  opts.themeId === t.id ? 'border-cyan-400 bg-cyan-400/10' : 'border-white/10 hover:border-white/25'}`}>
                <span className="inline-block w-3 h-3 rounded-full mr-2 align-middle"
                  style={{ background: t.vars['--fe-accent'] }} />
                {t.label}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Tên nhân vật trên thanh đầu">
          <select className="fe-in" value={opts.namePath} onChange={e => set('namePath', e.target.value)}>
            <option value="">— không hiện —</option>
            {scalars.filter(f => f.type === 'string').map(f => (
              <option key={f.dotPath} value={f.dotPath}>{f.label} ({f.dotPath})</option>
            ))}
          </select>
        </Field>

        <Field label={`Trường trên biểu mẫu khởi tạo (${opts.formPaths.length})`}
          hint="Người chơi khai những trường này trước khi vào game; giá trị được ghi THẲNG vào biến, không nhờ AI đặt hộ.">
          <div className="max-h-52 overflow-y-auto scrollbar-thin rounded border border-white/10 divide-y divide-white/5">
            {scalars.map(f => (
              <label key={f.dotPath} className="flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-white/5 cursor-pointer">
                <input type="checkbox" checked={opts.formPaths.includes(f.dotPath)}
                  onChange={() => set('formPaths', toggleIn(opts.formPaths, f.dotPath))} />
                <span className="flex-1 truncate">{f.label}</span>
                <span className="text-white/35 truncate max-w-[45%]">{f.dotPath}</span>
                {!!f.enumValues?.length && <span className="text-cyan-400/70">chọn</span>}
              </label>
            ))}
          </div>
        </Field>

        <Field label={`Chip trạng thái ở thanh đầu (${opts.chipPaths.length})`}>
          <div className="max-h-40 overflow-y-auto scrollbar-thin rounded border border-white/10 divide-y divide-white/5">
            {scalars.map(f => (
              <label key={f.dotPath} className="flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-white/5 cursor-pointer">
                <input type="checkbox" checked={opts.chipPaths.includes(f.dotPath)}
                  onChange={() => set('chipPaths', toggleIn(opts.chipPaths, f.dotPath))} />
                <span className="flex-1 truncate">{f.label}</span>
                <span className="text-white/35 truncate max-w-[45%]">{f.dotPath}</span>
              </label>
            ))}
          </div>
        </Field>

        <Field label={`Thanh chỉ số (${opts.bars.length})`} hint="Cặp giá trị hiện tại / tối đa nằm chung một nhóm.">
          {opts.bars.length === 0 && <div className="text-xs text-white/40 italic">Schema không có cặp hiện tại/tối đa nào.</div>}
          {opts.bars.map((b, i) => (
            <div key={i} className="flex items-center gap-2 text-xs mb-1">
              <input className="fe-in flex-1" value={b.label}
                onChange={e => set('bars', opts.bars.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} />
              <span className="text-white/35 truncate max-w-[45%]">{b.cur} / {b.max}</span>
              <button onClick={() => set('bars', opts.bars.filter((_, j) => j !== i))}
                className="p-1 rounded hover:bg-white/10"><Trash2 className="w-3 h-3" /></button>
            </div>
          ))}
        </Field>

        <Field label="Ghi tóm tắt bối cảnh vào">
          <select className="fe-in" value={opts.scenarioPath} onChange={e => set('scenarioPath', e.target.value)}>
            <option value="">— không ghi —</option>
            {scalars.filter(f => f.type === 'string').map(f => (
              <option key={f.dotPath} value={f.dotPath}>{f.label} ({f.dotPath})</option>
            ))}
          </select>
        </Field>

        <Field label={`Bối cảnh mở màn (${opts.scenarios.length})`}>
          {opts.scenarios.map((s, i) => (
            <div key={s.id} className="rounded border border-white/10 p-2 mb-2 space-y-1">
              <div className="flex gap-1">
                <input className="fe-in flex-1" value={s.title} placeholder="Tiêu đề"
                  onChange={e => set('scenarios', opts.scenarios.map((x, j) => j === i ? { ...x, title: e.target.value } : x))} />
                <button onClick={() => set('scenarios', opts.scenarios.filter((_, j) => j !== i))}
                  className="p-1.5 rounded hover:bg-white/10"><Trash2 className="w-3 h-3" /></button>
              </div>
              <input className="fe-in" value={s.desc} placeholder="Mô tả ngắn cho người chơi"
                onChange={e => set('scenarios', opts.scenarios.map((x, j) => j === i ? { ...x, desc: e.target.value } : x))} />
              <textarea className="fe-in min-h-[48px]" value={s.seed} placeholder="Câu mồi gửi cho AI (để trống = người chơi tự mô tả)"
                onChange={e => set('scenarios', opts.scenarios.map((x, j) => j === i ? { ...x, seed: e.target.value } : x))} />
            </div>
          ))}
          <button onClick={() => set('scenarios', [...opts.scenarios, { id: 's' + Date.now(), title: 'Bối cảnh mới', desc: '', seed: '' }])}
            className="text-xs px-2 py-1 rounded border border-white/15 hover:bg-white/5 flex items-center gap-1">
            <Plus className="w-3 h-3" /> Thêm bối cảnh
          </button>
        </Field>

        <Field label="Nút hành động nhanh" hint="Mỗi dòng một câu; bấm là điền vào ô nhập.">
          <textarea className="fe-in min-h-[70px]" value={opts.quickActions.join('\n')}
            onChange={e => set('quickActions', e.target.value.split('\n').filter(Boolean))} />
        </Field>

        <Field label="Dặn thêm cho lượt mở màn (tuỳ chọn)">
          <textarea className="fe-in min-h-[60px]" value={opts.openingExtra}
            onChange={e => set('openingExtra', e.target.value)}
            placeholder="VD: mở màn phải có mưa; NPC đầu tiên là một thợ rèn già." />
        </Field>

        <Field label="Số lượt nhật ký gửi lại cho AI">
          <input type="number" min={4} max={40} className="fe-in" value={opts.historyTurns}
            onChange={e => set('historyTurns', Math.max(4, Math.min(40, Number(e.target.value) || 14)))} />
        </Field>
      </div>

      {/* ── Cột phải: sản phẩm ─────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex items-center gap-1 border-b border-white/10 px-3 py-2">
          {([['preview', 'Xem trước', Eye], ['config', 'Cấu hình sinh ra', Code2], ['checks', 'Kiểm tra', Check]] as const)
            .map(([id, label, Icon]) => (
              <button key={id} onClick={() => setProductTab(id)}
                className={`text-xs px-3 py-1.5 rounded flex items-center gap-1.5 ${
                  productTab === id ? 'bg-white/10 text-white' : 'text-white/50 hover:text-white'}`}>
                <Icon className="w-3.5 h-3.5" /> {label}
              </button>
            ))}
          <div className="ml-auto flex items-center gap-2">
            {r && (
              <span className="text-[11px] text-white/40">
                khởi tạo {formatKb(r.sizes.opening)} · chính {formatKb(r.sizes.main)}
              </span>
            )}
            <button onClick={downloadPresets}
              className="text-xs px-2.5 py-1.5 rounded border border-white/15 hover:bg-white/5 flex items-center gap-1">
              <Download className="w-3.5 h-3.5" /> Tải 2 preset
            </button>
            <button onClick={apply} disabled={!r || hasViolation || busy}
              className="text-xs px-3 py-1.5 rounded bg-cyan-500/90 hover:bg-cyan-400 text-black font-medium disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              Gắn vào thẻ
            </button>
          </div>
        </div>

        {applied && (
          <div className="mx-3 mt-3 rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
            <Check className="inline w-3.5 h-3.5 mr-1" />{applied}. Nhớ bấm <b>Lưu</b> rồi xuất thẻ.
          </div>
        )}
        {!build.ok && (
          <div className="mx-3 mt-3 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
            Không dựng được: {build.error}
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-hidden p-3">
          {productTab === 'preview' && r && (
            <div className="h-full flex flex-col gap-2">
              <div className="text-[11px] text-white/40 flex items-center gap-1">
                <Info className="w-3 h-3" />
                Xem trước tĩnh: nút bấm được nhưng chưa có API của quán rượu nên chưa gọi AI được.
              </div>
              <iframe title="Xem trước màn khởi tạo" className="flex-1 rounded border border-white/10 bg-black/40"
                sandbox="allow-scripts" srcDoc={r.openingHtml} />
            </div>
          )}

          {productTab === 'config' && r && (
            <pre className="h-full overflow-auto scrollbar-thin text-[11px] leading-relaxed bg-black/30 rounded p-3 border border-white/10">
              {r.configSource}
            </pre>
          )}

          {productTab === 'checks' && r && (
            <div className="h-full overflow-y-auto scrollbar-thin space-y-3 text-xs">
              <CheckRow ok={!hasViolation}
                title="Payload sống sót qua đường giao hàng của SillyTavern"
                detail={hasViolation
                  ? `${r.violations.length} vi phạm — xem bên dưới`
                  : 'Không có ký tự nào bị engine.js hay substituteParams nuốt mất'} />
              {hasViolation && (
                <pre className="bg-red-950/40 border border-red-500/30 rounded p-2 whitespace-pre-wrap">
                  {r.violations.join('\n')}
                </pre>
              )}
              <CheckRow ok={r.scripts.every(s => s.markdownOnly && !s.promptOnly)}
                title="Hai script chỉ tác động lên hiển thị"
                detail="markdownOnly = true, promptOnly = false — đống HTML không đi ngược vào prompt" />
              <CheckRow ok={!!opts.updateTag}
                title={`Thẻ cập nhật biến: ${opts.updateTag}`}
                detail={opts.updateTag === detectedTag
                  ? 'Khớp với thẻ dò được trong thẻ bài'
                  : `⚠ Thẻ dò được là "${detectedTag}" — đặt sai thì màn chính không bao giờ hiện`} />
              <CheckRow ok={opts.formPaths.length > 0}
                title={`Biểu mẫu khởi tạo có ${opts.formPaths.length} trường`}
                detail="Không có trường nào thì người chơi vào thẳng game, không khai được gì" />
              <CheckRow ok={Object.keys((r.configSource.match(/"defaultStat": \{[\s\S]*?\n {2}\}/) || [''])[0] || '').length > 20}
                title="Có bộ biến mặc định"
                detail="Lấy từ InitVar. Thiếu nó thì các danh sách không tồn tại và lệnh insert của AI sẽ trượt êm" />
              <div className="rounded border border-white/10 bg-white/[0.03] p-3 text-white/60 leading-relaxed">
                <b className="text-white/80">Sau khi gắn vào thẻ</b>, trong SillyTavern nhớ:
                bật extension Trợ Thủ Tavern; bật script nhúng của thẻ; cho phép regex của thẻ;
                và chọn preset <b>【Khởi Đầu】</b> cho lượt mở màn, <b>【Chơi Thẻ】</b> cho các lượt sau.
              </div>
            </div>
          )}
        </div>
      </div>

      <style>{`
        .fe-in { width: 100%; background: rgba(0,0,0,.3); border: 1px solid rgba(255,255,255,.12);
          border-radius: 6px; padding: 5px 8px; font-size: 12px; color: #e6edf7; }
        .fe-in:focus { outline: none; border-color: rgba(34,211,238,.6); }
      `}</style>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium text-white/70">{label}</div>
      {children}
      {hint && <div className="text-[11px] text-white/35 leading-snug">{hint}</div>}
    </div>
  );
}

function CheckRow({ ok, title, detail }: { ok: boolean; title: string; detail: string }) {
  return (
    <div className={`rounded border p-2.5 ${ok ? 'border-emerald-500/30 bg-emerald-500/[0.07]' : 'border-red-500/40 bg-red-500/10'}`}>
      <div className="flex items-center gap-2 font-medium">
        {ok ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <AlertTriangle className="w-3.5 h-3.5 text-red-400" />}
        {title}
      </div>
      <div className="text-white/50 mt-0.5 pl-5">{detail}</div>
    </div>
  );
}
