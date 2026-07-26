import { useState, useRef } from 'react';
import { Loader2, ScanLine, Sparkles, Wand2, Users, BookOpen, Settings2, Merge, Trash2 } from 'lucide-react';
import { useSettingsStore } from '../store/settingsStore';
import { useCardStore } from '../store/cardStore';
import { useToastStore } from '../store/toastStore';
import { usePersistedState } from '../lib/usePersistedState';
import { DEFAULT_ENTRY_EXT, type LorebookEntry } from '../types/lorebook.types';
import {
  scanCharacters, generateCardFromStory, generateCardsForMany,
  type ScannedCharacter, type GeneratedStoryCard, type StoryCardOptions, type StoryCardTemplate,
  type BatchCardResult, type WorldEntry,
} from '../lib/ai/storyToCard';
import { isSameAsUserPersona } from '../lib/ai/userPersonaSwap';
import { t as ui, fmt } from '../i18n';

/**
 * "Tạo thẻ từ truyện" — pipeline mô-đun học từ 小玉写卡器.
 * Dán truyện → quét nhân vật (chunk cho truyện dài) → chọn 1 hoặc NHIỀU nhân vật
 * → sinh thẻ theo mô-đun (+ tuỳ chọn world entries) → áp dụng vào dự án hiện tại.
 */
export function StoryToCardPage() {
  const settings = useSettingsStore();
  const updateCard = useCardStore((s) => s.updateCard);
  const addEntry = useCardStore((s) => s.addEntry);
  const getNextEntryId = useCardStore((s) => s.getNextEntryId);
  const toast = useToastStore();

  // Persist inputs + outputs qua localStorage → F5 / đóng tab / đổi tab không mất việc.
  const [story, setStory] = usePersistedState('s2c.story', '');
  // (User 23/07 — việc 89) `withWorldEntries` TRƯỚC ĐÂY KHÔNG có trong đây → luôn undefined →
  // prompt không hề yêu cầu world entries → chạy xong lorebook trống trơn. Sinh lore từ truyện
  // chính là lý do tồn tại của tab này nên phải BẬT SẴN.
  const [opts, setOpts] = usePersistedState<StoryCardOptions>('s2c.opts', { detail: 'vừa phải', nsfw: false, template: 'chuẩn', splitByStage: true, autoContinue: true, withWorldEntries: true });
  // Tuỳ chọn quét
  const [chunkSize, setChunkSize] = usePersistedState('s2c.chunkSize', 40000);
  const [maxChunks, setMaxChunks] = usePersistedState('s2c.maxChunks', 12);
  const [includeIdentity, setIncludeIdentity] = usePersistedState('s2c.includeIdentity', true);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [scanning, setScanning] = useState(false);
  const [scanProg, setScanProg] = useState<{ d: number; t: number } | null>(null);
  const [roster, setRoster] = usePersistedState<ScannedCharacter[]>('s2c.roster', []);
  const [checked, setChecked] = usePersistedState<string[]>('s2c.checked', []);
  const [manualName, setManualName] = usePersistedState('s2c.manualName', '');

  const [generating, setGenerating] = useState(false);
  const [batchProg, setBatchProg] = useState<{ d: number; t: number; name: string } | null>(null);
  const [card, setCard] = usePersistedState<GeneratedStoryCard | null>('s2c.card', null);
  const [batch, setBatch] = usePersistedState<BatchCardResult[]>('s2c.batch', []);

  const profile = settings.profiles.find((p) => p.id === settings.activeProfileId);
  const set = (patch: Partial<StoryCardOptions>) => setOpts((o) => ({ ...o, ...patch }));

  // #9.4 — nút Dừng: abort mọi call AI đang chạy (quét / tạo thẻ). callAI nhận signal → fetch huỷ ngay.
  const abortRef = useRef<AbortController | null>(null);
  const isAbortErr = (e: unknown) => e instanceof DOMException && e.name === 'AbortError'
    || (e instanceof Error && /abort/i.test(e.message));
  const stopWork = () => { abortRef.current?.abort(); };

  const clearWork = () => {
    if (!confirm(ui.s2cConfirmClear)) return;
    setStory(''); setRoster([]); setChecked([]); setManualName(''); setCard(null); setBatch([]);
  };

  const requireApi = () => {
    if (!profile?.apiKey) { toast.error(ui.s2cNoApi); return false; }
    return true;
  };

  const toggleCheck = (name: string) => setChecked((prev) =>
    prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]);

  const runScan = async () => {
    if (!requireApi()) return;
    if (!story.trim()) { toast.error(ui.s2cNeedStory); return; }
    setScanning(true); setRoster([]); setCard(null); setBatch([]); setChecked([]); setScanProg({ d: 0, t: 1 });
    abortRef.current = new AbortController();
    try {
      const chars = await scanCharacters(story, profile!, settings.generationParams, {
        chunkSize, maxChunks, includeIdentity,
        signal: abortRef.current.signal,
        onProgress: (d, t) => setScanProg({ d, t }),
      });
      if (chars.length === 0) toast.error(ui.s2cNoChar);
      setRoster(chars);
      if (chars[0]) setChecked([chars[0].name]);
    } catch (e) { if (isAbortErr(e)) toast.error(ui.s2cScanStopped); else toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setScanning(false); setScanProg(null); }
  };

  // Gộp các mục đang tick thành 1 nhân vật (union bí danh) — cho khi quét tách nhầm 1 người ra nhiều mục.
  const mergeChecked = () => {
    const names = [...checked];
    if (names.length < 2) { toast.error(ui.s2cNeed2ToMerge); return; }
    const picks = roster.filter((c) => checked.includes(c.name));
    const primary = picks[0];
    const mergedAliases = Array.from(new Set(picks.flatMap((c) => [c.name, ...c.aliases]).filter((a) => a !== primary.name)));
    const mergedBrief = picks.map((c) => c.brief).filter(Boolean).sort((a, b) => b.length - a.length)[0] || '';
    const merged: ScannedCharacter = { name: primary.name, aliases: mergedAliases, brief: mergedBrief };
    setRoster((r) => [merged, ...r.filter((c) => !checked.includes(c.name))]);
    setChecked([primary.name]);
    toast.success(fmt(ui.s2cMerged, { count: names.length, name: primary.name }));
  };

  /**
   * (bugNeedFix/105) Người được gán làm {{user}}, kèm biệt danh lấy từ bảng quét.
   * Chỉ điền tên đầy đủ vào ô đó là chưa đủ: trong truyện họ còn được gọi bằng "Tiểu Triệu",
   * "Triệu ca"… nên nếu không gom biệt danh thì thay xong vẫn còn tên người chơi rải rác.
   */
  const userPersona = (() => {
    const n = opts.userReplaceName?.trim();
    if (!n) return null;
    const hit = roster.find(c => isSameAsUserPersona(c.name, n) || c.aliases.some(a => isSameAsUserPersona(a, n)));
    const aliases = hit ? Array.from(new Set([hit.name, ...hit.aliases])).filter(a => a.trim() && a.trim() !== n) : [];
    return { name: n, aliases };
  })();

  /** Options gửi xuống engine — bơm kèm biệt danh của người chơi cho bước thay tên. */
  const genOpts = (): StoryCardOptions =>
    userPersona ? { ...opts, userReplaceAliases: userPersona.aliases } : opts;

  const targets = (): string[] => {
    const arr = [...checked];
    if (manualName.trim()) arr.push(manualName.trim());
    return Array.from(new Set(arr.map((s) => s.trim()).filter(Boolean)));
  };

  const runGenerate = async () => {
    if (!requireApi()) return;
    const names = targets();
    if (names.length === 0) { toast.error(ui.s2cPickChar); return; }
    if (!story.trim()) { toast.error(ui.s2cNeedStory2); return; }

    // (bugNeedFix/105) Chọn CHÍNH người đã gán làm {{user}} để làm nhân vật thẻ là mâu thuẫn:
    // thẻ sẽ vừa là người chơi vừa là người đối thoại với người chơi. Đúng tình huống trong
    // ảnh của user — thẻ ra tên "Triệu Hy Ngạn" còn {{user}} bị đẩy thành vai quần chúng.
    if (userPersona) {
      const clash = names.filter(n => isSameAsUserPersona(n, userPersona.name, userPersona.aliases));
      if (clash.length > 0) {
        toast.error(
          `"${clash[0]}" đang được đặt làm {{user}} nên không thể làm nhân vật của thẻ `
          + '— thẻ sẽ tự nói chuyện với chính mình. Bỏ chọn người này, hoặc xoá ô "Nhân vật thành {{user}}".',
        );
        return;
      }
    }
    setGenerating(true); setCard(null); setBatch([]);
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;
    try {
      let madeEntries = 0;
      if (names.length === 1) {
        const c = await generateCardFromStory(story, names[0], profile!, settings.generationParams, genOpts(), signal);
        setCard(c);
        madeEntries = c.worldEntries.length;
      } else {
        setBatchProg({ d: 0, t: names.length, name: '' });
        const res = await generateCardsForMany(story, names, profile!, settings.generationParams, genOpts(), signal,
          (d, t, name) => setBatchProg({ d, t, name }));
        setBatch(res);
        const ok = res.filter((r) => r.card).length;
        madeEntries = res.reduce((n, r) => n + (r.card?.worldEntries.length ?? 0), 0);
        toast.success(fmt(ui.s2cGenerated, { ok, total: names.length }));
      }
      // (User 23/07 — việc 89) Trước đây không có lore thì màn hình chỉ đơn giản là không hiện gì,
      // user tưởng tool hỏng. Nói thẳng lý do: tắt tuỳ chọn, hay AI không trả về entry nào.
      if (!opts.withWorldEntries) toast.info(ui.s2cWorldOffHint);
      else if (madeEntries === 0) toast.info(ui.s2cWorldEmptyHint);
    } catch (e) { if (isAbortErr(e)) toast.error(ui.s2cGenStopped); else toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setGenerating(false); setBatchProg(null); }
  };

  const applyEntries = (entries: WorldEntry[]) => {
    entries.forEach((we) => {
      const id = getNextEntryId();
      const entry: LorebookEntry = {
        id, keys: we.keys.length ? we.keys : ['lore'], secondary_keys: [],
        comment: we.keys[0] || `Lore #${id}`, content: we.content,
        constant: false, selective: true, insertion_order: 100, enabled: true,
        position: 'before_char', use_regex: true,
        extensions: { ...DEFAULT_ENTRY_EXT, display_index: id },
      };
      addEntry(entry);
    });
    toast.success(fmt(ui.s2cEntriesAdded, { count: entries.length }));
  };

  const applyToCard = (c: GeneratedStoryCard) => {
    updateCard((card) => {
      if (c.name) card.data.name = c.name;
      card.data.description = c.description;
      if (c.scenario) card.data.scenario = c.scenario;
      if (c.firstMes) card.data.first_mes = c.firstMes;
    });
    if (c.worldEntries.length) applyEntries(c.worldEntries);
    toast.success(ui.s2cApplied);
  };

  const multi = checked.length + (manualName.trim() ? 1 : 0) > 1;

  return (
    <div className="p-5 max-w-3xl mx-auto space-y-5">
      <div className="flex items-center gap-2 flex-wrap">
        <Wand2 className="w-5 h-5 text-primary shrink-0" />
        <h1 className="text-lg font-bold shrink-0">{ui.s2cTitle}</h1>
        <span className="text-xs text-muted-foreground truncate min-w-0 hidden sm:inline">{ui.s2cSubtitle}</span>
        <span className="ml-auto text-[11px] text-muted-foreground flex items-center gap-2 shrink-0">
          <span title={ui.s2cAutosaveTitle}>{ui.s2cAutosave}</span>
          {(story || roster.length > 0 || card || batch.length > 0) && (
            <button onClick={clearWork} className="inline-flex items-center gap-1 hover:text-red-400" title={ui.s2cClearTitle}>
              <Trash2 className="w-3.5 h-3.5" /> {ui.s2cClear}
            </button>
          )}
        </span>
      </div>

      {/* 01 — Truyện + tùy chọn */}
      <section className="rounded-xl border border-border/60 bg-muted/20 p-4 space-y-3">
        <div className="text-sm font-semibold flex items-center gap-2"><ScanLine className="w-4 h-4" /> {ui.s2cStep1}</div>
        <textarea value={story} onChange={(e) => setStory(e.target.value)} rows={8}
          className="settings-input text-sm resize-y w-full" placeholder={ui.s2cStoryPh} />
        <div className="text-xs text-muted-foreground">{fmt(ui.s2cChars, { n: story.length.toLocaleString() })}{chunkSize > 0 && story.length > chunkSize ? fmt(ui.s2cChunks, { n: Math.min(Math.ceil(story.length / chunkSize), maxChunks) }) : ''}</div>

        {/* Tuỳ chọn thẻ */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <label className="text-xs">{ui.s2cDetail}
            <select value={opts.detail} onChange={(e) => set({ detail: e.target.value as StoryCardOptions['detail'] })} className="settings-input text-xs mt-1 w-full">
              <option value="ngắn gọn">{ui.s2cDetailShort}</option>
              <option value="vừa phải">{ui.s2cDetailMedium}</option>
              <option value="chi tiết">{ui.s2cDetailFull}</option>
            </select>
          </label>
          <label className="text-xs">{ui.s2cTemplate}
            <select value={opts.template} onChange={(e) => set({ template: e.target.value as StoryCardTemplate })} className="settings-input text-xs mt-1 w-full">
              <option value="chuẩn">{ui.s2cTplStandard}</option>
              <option value="nhập vai đậm">{ui.s2cTplRoleplay}</option>
              <option value="súc tích">{ui.s2cTplConcise}</option>
              <option value="tối giản">{ui.s2cTplMinimal}</option>
            </select>
          </label>
          <label className="text-xs">{ui.s2cUserChar}{'{{user}}'}
            <input value={opts.userReplaceName ?? ''} onChange={(e) => set({ userReplaceName: e.target.value })} className="settings-input text-xs mt-1 w-full" placeholder={ui.s2cUserCharPh} />
          </label>
          <label className="text-xs">{ui.s2cRelationship}{'{{user}}'}
            <input value={opts.relationship ?? ''} onChange={(e) => set({ relationship: e.target.value })} className="settings-input text-xs mt-1 w-full" placeholder={ui.s2cRelationshipPh} />
          </label>
        </div>

        {/* #3 — Thiết lập bổ sung cho {{user}}, chỉ hiện khi có thay {{user}} */}
        {opts.userReplaceName?.trim() && (
          <label className="text-xs block">{ui.s2cUserExtra}{'{{user}}'}{ui.s2cUserExtra2}
            <textarea value={opts.userSetup ?? ''} onChange={(e) => set({ userSetup: e.target.value })} rows={2}
              className="settings-input text-xs mt-1 w-full resize-y" placeholder={ui.s2cUserExtraPh} />
          </label>
        )}

        {/* Toggles */}
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs">
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={!!opts.nsfw} onChange={(e) => set({ nsfw: e.target.checked })} /> NSFW</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={opts.splitByStage !== false} onChange={(e) => set({ splitByStage: e.target.checked })} /> {ui.s2cSplitByStage}</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={!!opts.omitEmptyFields} onChange={(e) => set({ omitEmptyFields: e.target.checked })} /> {ui.s2cOmitEmpty}</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={!!opts.autoContinue} onChange={(e) => set({ autoContinue: e.target.checked })} /> {ui.s2cAutoContinue}</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={!!opts.withWorldEntries} onChange={(e) => set({ withWorldEntries: e.target.checked })} /> {ui.s2cWithWorld}</label>
        </div>

        {/* Nâng cao: chunk + scan */}
        <button onClick={() => setShowAdvanced((v) => !v)} className="text-xs inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
          <Settings2 className="w-3.5 h-3.5" /> {showAdvanced ? ui.s2cHide : ui.s2cShow}{ui.s2cAdvancedOpts}
        </button>
        {showAdvanced && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 pt-1">
            <label className="text-xs">{ui.s2cChunkSize}
              <input type="number" min={0} step={5000} value={chunkSize} onChange={(e) => setChunkSize(Math.max(0, +e.target.value || 0))} className="settings-input text-xs mt-1 w-full" />
            </label>
            <label className="text-xs">{ui.s2cMaxChunks}
              <input type="number" min={1} max={50} value={maxChunks} onChange={(e) => setMaxChunks(Math.max(1, +e.target.value || 1))} className="settings-input text-xs mt-1 w-full" />
            </label>
            <label className="text-xs flex items-end gap-2 pb-1">
              <input type="checkbox" checked={includeIdentity} onChange={(e) => setIncludeIdentity(e.target.checked)} /> {ui.s2cIncludeIdentity}
            </label>
            <label className="text-xs md:col-span-3 block">{ui.s2cExtraNotes}
              <input value={opts.extraNotes ?? ''} onChange={(e) => set({ extraNotes: e.target.value })} className="settings-input text-xs mt-1 w-full" placeholder={ui.s2cExtraNotesPh} />
            </label>
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={runScan} disabled={scanning}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md font-semibold text-white"
            style={{ background: scanning ? '#3a3352' : '#7c6af0', border: 'none', cursor: scanning ? 'default' : 'pointer' }}>
            {scanning ? <><Loader2 className="w-4 h-4 animate-spin" /> {ui.s2cScanning}{scanProg && scanProg.t > 1 ? fmt(ui.s2cScanningChunks, { d: scanProg.d, t: scanProg.t }) : ''}...</> : <><ScanLine className="w-4 h-4" /> {ui.s2cScanChars}</>}
          </button>
          {scanning && (
            <button onClick={stopWork}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md font-semibold text-white"
              style={{ background: '#ef4444', border: 'none', cursor: 'pointer' }}>{ui.s2cStop}</button>
          )}
        </div>
      </section>

      {/* 02 — Chọn nhân vật (đa chọn) */}
      {(roster.length > 0 || manualName) && (
        <section className="rounded-xl border border-border/60 bg-muted/20 p-4 space-y-3">
          <div className="text-sm font-semibold flex items-center justify-between">
            <span className="flex items-center gap-2"><Users className="w-4 h-4" /> {ui.s2cStep2} {checked.length > 0 && <span className="text-xs text-primary">{fmt(ui.s2cSelectedCount, { count: checked.length })}</span>}</span>
            {roster.length > 0 && (
              <div className="flex items-center gap-3 text-xs font-normal">
                <button onClick={() => setChecked(roster.map((c) => c.name))} className="text-muted-foreground hover:text-foreground">{ui.s2cSelectAll}</button>
                <button onClick={() => setChecked([])} className="text-muted-foreground hover:text-foreground">{ui.s2cDeselect}</button>
                {checked.length >= 2 && <button onClick={mergeChecked} className="inline-flex items-center gap-1 text-amber-400 hover:text-amber-300"><Merge className="w-3.5 h-3.5" /> {ui.s2cMergeSelected}</button>}
              </div>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {roster.map((c) => {
              const on = checked.includes(c.name);
              // (bugNeedFix/105) Người đã gán làm {{user}} thì KHÔNG chọn được: thẻ của người chơi
              // là vô nghĩa. Vẫn hiện trong danh sách (kèm nhãn) để user biết vì sao mờ đi.
              const isUser = !!userPersona
                && (isSameAsUserPersona(c.name, userPersona.name, userPersona.aliases)
                  || c.aliases.some(a => isSameAsUserPersona(a, userPersona.name, userPersona.aliases)));
              return (
                <button key={c.name} onClick={() => !isUser && toggleCheck(c.name)} disabled={isUser}
                  title={isUser ? 'Người này đang được đặt làm {{user}} (người chơi) nên không thể làm nhân vật của thẻ.' : undefined}
                  className="text-left p-2.5 rounded-lg border flex gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ borderColor: isUser ? '#4b5563' : on ? '#7c6af0' : '#2a2a3e', background: on && !isUser ? 'rgba(124,106,240,0.1)' : 'transparent' }}>
                  <input type="checkbox" readOnly checked={on && !isUser} disabled={isUser} className="mt-0.5" />
                  <div>
                    <div className="text-sm font-semibold">
                      {c.name}{c.aliases.length > 0 && <span className="text-xs text-muted-foreground"> ({c.aliases.join(', ')})</span>}
                      {isUser && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300 align-middle">= {'{{user}}'}</span>}
                    </div>
                    {c.brief && <div className="text-xs text-muted-foreground mt-0.5">{c.brief}</div>}
                  </div>
                </button>
              );
            })}
          </div>
          <input value={manualName} onChange={(e) => setManualName(e.target.value)} className="settings-input text-sm w-full"
            placeholder={ui.s2cManualNamePh} />
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={runGenerate} disabled={generating}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md font-semibold text-white"
              style={{ background: generating ? '#3a3352' : '#a855f7', border: 'none', cursor: generating ? 'default' : 'pointer' }}>
              {generating
                ? <><Loader2 className="w-4 h-4 animate-spin" /> {batchProg ? fmt(ui.s2cGenerating, { d: batchProg.d, t: batchProg.t }) + (batchProg.name ? ` · ${batchProg.name}` : '') : ui.s2cGeneratingCard}</>
                : <><Sparkles className="w-4 h-4" /> {multi ? fmt(ui.s2cGenMany, { count: checked.length + (manualName.trim() ? 1 : 0) }) : ui.s2cGenOne}</>}
            </button>
            {generating && (
              <button onClick={stopWork}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-md font-semibold text-white"
                style={{ background: '#ef4444', border: 'none', cursor: 'pointer' }}>{ui.s2cStop}</button>
            )}
          </div>
        </section>
      )}

      {/* 03 — Kết quả đơn */}
      {card && <CardResult card={card} onApply={() => applyToCard(card)} onApplyEntries={applyEntries} />}

      {/* 03 — Kết quả hàng loạt */}
      {batch.length > 0 && (
        <div className="space-y-3">
          {batch.map((b) => b.card
            ? <CardResult key={b.name} card={b.card} onApply={() => applyToCard(b.card!)} onApplyEntries={applyEntries} />
            : <div key={b.name} className="rounded-xl border border-red-500/40 bg-red-500/5 p-3 text-sm">❌ <b>{b.name}</b>: {b.error}</div>
          )}
        </div>
      )}
    </div>
  );
}

function CardResult({ card, onApply, onApplyEntries }: {
  card: GeneratedStoryCard;
  onApply: () => void;
  onApplyEntries: (e: WorldEntry[]) => void;
}) {
  return (
    <section className="rounded-xl border border-primary/40 bg-muted/20 p-4 space-y-3">
      <div className="text-sm font-semibold flex items-center gap-2"><Sparkles className="w-4 h-4 text-primary" /> {ui.s2cCardLabel}{card.name}</div>
      {([[ui.s2cFieldDesc, card.description], [ui.s2cFieldScenario, card.scenario], [ui.s2cFieldGreeting, card.firstMes]] as const)
        .filter(([, v]) => v)
        .map(([label, v]) => (
          <div key={label} className="rounded-lg border border-border/60 p-2.5">
            <div className="text-xs font-bold text-primary mb-1">{label}</div>
            <div className="text-sm whitespace-pre-wrap leading-relaxed" style={{ maxHeight: 200, overflowY: 'auto' }}>{v}</div>
          </div>
        ))}
      {card.worldEntries.length > 0 && (
        <div className="rounded-lg border border-border/60 p-2.5">
          <div className="text-xs font-bold text-primary mb-1 flex items-center gap-1.5"><BookOpen className="w-3.5 h-3.5" /> {card.worldEntries.length} world entries</div>
          <ul className="text-xs space-y-1" style={{ maxHeight: 160, overflowY: 'auto' }}>
            {card.worldEntries.map((e, i) => (
              <li key={i}><span className="text-amber-400">[{e.keys.join(', ')}]</span> {e.content.slice(0, 120)}{e.content.length > 120 ? '…' : ''}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex gap-2">
        <button onClick={onApply} className="px-4 py-2 rounded-md font-semibold text-white" style={{ background: '#22c55e', border: 'none', cursor: 'pointer' }}>
          {ui.s2cApplyToCard}
        </button>
        {card.worldEntries.length > 0 && (
          <button onClick={() => onApplyEntries(card.worldEntries)} className="px-4 py-2 rounded-md font-semibold" style={{ background: 'transparent', color: '#fbbf24', border: '1px solid #fbbf24', cursor: 'pointer' }}>
            {ui.s2cOnlyEntries}
          </button>
        )}
      </div>
    </section>
  );
}
