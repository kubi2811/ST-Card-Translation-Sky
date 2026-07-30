import { useState, useRef } from 'react';
import { Loader2, ScanLine, Sparkles, Wand2, Users, BookOpen, Settings2, Merge, Trash2, Microscope, Pause, Play, CheckCircle2, Circle, AlertTriangle } from 'lucide-react';
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
import {
  runDeepScan, canResume, toLorebookEntry,
  type DeepScanState, type DeepScanOptions, type DeepEntry, type DeepPassId, type EntryCat,
} from '../lib/ai/storyDeepScan';
import { isSameAsUserPersona } from '../lib/ai/userPersonaSwap';
import { adviseChunks, adviceText, type ChunkAdvice } from '../lib/ai/chunkAdvice';
import { t as ui, fmt } from '../i18n';

/**
 * "Tạo thẻ từ truyện".
 *
 * (bug 150) Nâng từ "quét nhân vật rồi sinh thẻ một lượt" lên hai chế độ:
 *  - 🔬 QUÉT TRUYỆN BẰNG AI (mặc định): pipeline nghiên cứu tác phẩm nhiều lượt
 *    (cấu trúc → nhân vật → thế giới → timeline → văn phong → đối chiếu lặp → tổng hợp
 *    Card + Lorebook đầy đủ → kiểm trùng/nhất quán). Có tạm dừng / tiếp tục, tiến trình
 *    tự lưu qua localStorage nên F5 không mất.
 *  - ⚡ QUÉT NHANH (cũ): flow một lượt như trước, cho truyện ngắn/cần thẻ gấp.
 */

interface DeepUiOpts {
  verifyRounds: number;
  nsfw: boolean;
  learnStyle: boolean;
  makeCard: boolean;
  cardChar: string;
  userReplaceName: string;
  userSetup: string;
  extraNotes: string;
}

const PASS_LABELS: Record<DeepPassId, () => string> = {
  structure: () => ui.s2cdPassStructure,
  roster: () => ui.s2cdPassRoster,
  characters: () => ui.s2cdPassCharacters,
  world: () => ui.s2cdPassWorld,
  timeline: () => ui.s2cdPassTimeline,
  style: () => ui.s2cdPassStyle,
  verify: () => ui.s2cdPassVerify,
  synthesize: () => ui.s2cdPassSynthesize,
  quality: () => ui.s2cdPassQuality,
};

const CAT_LABELS: Record<EntryCat, () => string> = {
  meta: () => ui.s2cdCatMeta,
  worldview: () => ui.s2cdCatWorldview,
  system: () => ui.s2cdCatSystem,
  mechanic: () => ui.s2cdCatMechanic,
  rule: () => ui.s2cdCatRule,
  character: () => ui.s2cdCatCharacter,
  faction: () => ui.s2cdCatFaction,
  location: () => ui.s2cdCatLocation,
  item: () => ui.s2cdCatItem,
  history: () => ui.s2cdCatHistory,
  culture: () => ui.s2cdCatCulture,
  term: () => ui.s2cdCatTerm,
  timeline: () => ui.s2cdCatTimeline,
  style: () => ui.s2cdCatStyle,
  other: () => ui.s2cdCatOther,
};

const CAT_ORDER: EntryCat[] = ['meta', 'worldview', 'system', 'mechanic', 'rule', 'timeline', 'style', 'character', 'faction', 'location', 'item', 'history', 'culture', 'term', 'other'];

export function StoryToCardPage() {
  const settings = useSettingsStore();
  const updateCard = useCardStore((s) => s.updateCard);
  const addEntry = useCardStore((s) => s.addEntry);
  const getNextEntryId = useCardStore((s) => s.getNextEntryId);
  const toast = useToastStore();

  // Persist inputs + outputs qua localStorage → F5 / đóng tab / đổi tab không mất việc.
  const [story, setStory] = usePersistedState('s2c.story', '');
  const [mode, setMode] = usePersistedState<'deep' | 'quick'>('s2c.mode', 'deep');
  // (User 23/07 — việc 89) `withWorldEntries` TRƯỚC ĐÂY KHÔNG có trong đây → luôn undefined →
  // prompt không hề yêu cầu world entries → chạy xong lorebook trống trơn. Sinh lore từ truyện
  // chính là lý do tồn tại của tab này nên phải BẬT SẴN.
  const [opts, setOpts] = usePersistedState<StoryCardOptions>('s2c.opts', { detail: 'vừa phải', nsfw: false, template: 'chuẩn', splitByStage: true, autoContinue: true, withWorldEntries: true });
  // Tuỳ chọn quét
  const [chunkSize, setChunkSize] = usePersistedState('s2c.chunkSize', 40000);
  const [maxChunks, setMaxChunks] = usePersistedState('s2c.maxChunks', 12);
  /** (bug 163) Lời khuyên số đoạn quét — hiện sau khi nạp truyện, null = không hiện. */
  const [chunkAdvice, setChunkAdvice] = useState<ChunkAdvice | null>(null);
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

  // (bug 150) Trạng thái pipeline quét sâu — persist trọn để TẠM DỪNG / F5 / TIẾP TỤC.
  const [deep, setDeep] = usePersistedState<DeepScanState | null>('s2c.deep', null);
  const [deepOpts, setDeepOpts] = usePersistedState<DeepUiOpts>('s2c.deepOpts', {
    verifyRounds: 2, nsfw: false, learnStyle: true, makeCard: true,
    cardChar: '', userReplaceName: '', userSetup: '', extraNotes: '',
  });
  const [deepRunning, setDeepRunning] = useState(false);
  const [deepLog, setDeepLog] = useState('');

  const profile = settings.profiles.find((p) => p.id === settings.activeProfileId);
  const set = (patch: Partial<StoryCardOptions>) => setOpts((o) => ({ ...o, ...patch }));
  const setD = (patch: Partial<DeepUiOpts>) => setDeepOpts((o) => ({ ...o, ...patch }));

  // #9.4 — nút Dừng: abort mọi call AI đang chạy. callAI nhận signal → fetch huỷ ngay.
  const abortRef = useRef<AbortController | null>(null);
  const isAbortErr = (e: unknown) => e instanceof DOMException && e.name === 'AbortError'
    || (e instanceof Error && /abort/i.test(e.message));
  const stopWork = () => { abortRef.current?.abort(); };

  const clearWork = () => {
    if (!confirm(ui.s2cConfirmClear)) return;
    setStory(''); setRoster([]); setChecked([]); setManualName(''); setCard(null); setBatch([]); setDeep(null);
  };

  const requireApi = () => {
    if (!profile?.apiKey) { toast.error(ui.s2cNoApi); return false; }
    return true;
  };

  // ─────────────────────────── Deep scan (bug 150) ───────────────────────────

  const buildDeepOptions = (signal: AbortSignal): DeepScanOptions => ({
    chunkSize, maxChunks,
    maxVerifyRounds: deepOpts.verifyRounds,
    nsfw: deepOpts.nsfw,
    learnStyle: deepOpts.learnStyle,
    makeCard: deepOpts.makeCard,
    cardCharacters: deepOpts.cardChar.trim() ? deepOpts.cardChar.split(/[,，]/).map((s) => s.trim()).filter(Boolean) : undefined,
    userReplaceName: deepOpts.userReplaceName.trim() || undefined,
    userSetup: deepOpts.userSetup.trim() || undefined,
    extraNotes: deepOpts.extraNotes.trim() || undefined,
    signal,
    onState: (s) => setDeep(s),
    onLog: (m) => setDeepLog(m),
  });

  const runDeep = async (resume: boolean) => {
    if (!requireApi()) return;
    if (!story.trim()) { toast.error(ui.s2cNeedStory); return; }
    abortRef.current = new AbortController();
    setDeepRunning(true);
    setDeepLog('');
    try {
      const o = buildDeepOptions(abortRef.current.signal);
      const prev = resume ? deep : null;
      const final = await runDeepScan(story, profile!, settings.generationParams, o, prev);
      setDeep(final);
      if (final.status === 'done' && final.result) {
        toast.success(fmt(ui.s2cdDoneToast, { entries: final.result.entries.length, cards: final.result.cards.filter((c) => c.card).length }));
      } else if (final.status === 'paused') {
        toast.info(ui.s2cdPausedToast);
      } else if (final.status === 'error') {
        toast.error(final.error || 'Lỗi không rõ');
      }
    } catch (e) {
      if (!isAbortErr(e)) toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setDeepRunning(false);
    }
  };

  const discardDeep = () => {
    if (!confirm(ui.s2cdConfirmDiscard)) return;
    setDeep(null);
  };

  const applyDeepEntries = (entries: DeepEntry[]) => {
    entries.forEach((e) => addEntry(toLorebookEntry(e, getNextEntryId())));
    toast.success(fmt(ui.s2cEntriesAdded, { count: entries.length }));
  };

  const resumable = !deepRunning && deep != null && (deep.status === 'paused' || deep.status === 'error')
    && canResume(deep, story, buildDeepOptions(new AbortController().signal));

  // ─────────────────────────── Quick mode (flow cũ) ───────────────────────────

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
    // thẻ sẽ vừa là người chơi vừa là người đối thoại với người chơi.
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
      // (User 23/07 — việc 89) Không có lore thì nói thẳng lý do thay vì im lặng.
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

  // (bug 136) Đọc nhiều file truyện → NỐI vào ô truyện (không ghi đè phần đã dán).
  const [importing, setImporting] = useState(false);
  const importFiles = async (files: File[]) => {
    if (!files.length) return;
    setImporting(true);
    try {
      const { readStoryFiles } = await import('../lib/ai/storyFileImport');
      const r = await readStoryFiles(files);
      if (r.text) {
        const merged = story.trim() ? `${story.trimEnd()}\n\n${r.text}` : r.text;
        setStory(merged);
        toast.success(fmt(ui.s2cFilesDone, { n: r.parts.length, chars: r.parts.reduce((s, p) => s + p.chars, 0).toLocaleString() }));
        // (bug 163) NGAY LÚC NẠP là lúc duy nhất user còn để ý tới cấu hình quét. Mặc định 12 đoạn
        // chỉ đọc 480k ký tự — với truyện triệu chữ là vài phần trăm, và không có chỗ nào nói ra
        // nên user cứ tưởng "tool quét cả truyện" rồi không hiểu vì sao ít entry. Hỏi ngay tại đây.
        const adv = adviseChunks(merged.length, chunkSize, maxChunks);
        if (adv.shouldAdvise) setChunkAdvice(adv);
      }
      for (const sk of r.skipped) toast.warning(`${sk.name}: ${sk.reason}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  };

  const applyToCard = (c: GeneratedStoryCard) => {
    updateCard((card) => {
      if (c.name) card.data.name = c.name;
      card.data.description = c.description;
      if (c.scenario) card.data.scenario = c.scenario;
      if (c.firstMes) card.data.first_mes = c.firstMes;
    });
    if (c.worldEntries.length) applyEntries(c.worldEntries);
    // (bug 136) Văn phong tác giả → một entry constant riêng, AI nào viết tiếp cũng thấy.
    if (c.styleGuide) {
      applyEntries([{ keys: ['văn phong', 'giọng văn'], content: `[Văn phong tác giả — bám theo khi kể chuyện]\n${c.styleGuide}` }]);
    }
    toast.success(ui.s2cApplied);
  };

  const multi = checked.length + (manualName.trim() ? 1 : 0) > 1;

  const deepEntryGroups = (() => {
    if (!deep?.result) return [];
    const by = new Map<EntryCat, DeepEntry[]>();
    for (const e of deep.result.entries) {
      const list = by.get(e.cat) ?? [];
      list.push(e);
      by.set(e.cat, list);
    }
    return CAT_ORDER.filter((c) => by.has(c)).map((c) => ({ cat: c, entries: by.get(c)! }));
  })();

  return (
    <div className="p-5 max-w-3xl mx-auto space-y-5">
      <div className="flex items-center gap-2 flex-wrap">
        <Wand2 className="w-5 h-5 text-primary shrink-0" />
        <h1 className="text-lg font-bold shrink-0">{ui.s2cTitle}</h1>
        <span className="text-xs text-muted-foreground truncate min-w-0 hidden sm:inline">{ui.s2cSubtitle}</span>
        <span className="ml-auto text-[11px] text-muted-foreground flex items-center gap-2 shrink-0">
          <span title={ui.s2cAutosaveTitle}>{ui.s2cAutosave}</span>
          {(story || roster.length > 0 || card || batch.length > 0 || deep) && (
            <button onClick={clearWork} className="inline-flex items-center gap-1 hover:text-red-400" title={ui.s2cClearTitle}>
              <Trash2 className="w-3.5 h-3.5" /> {ui.s2cClear}
            </button>
          )}
        </span>
      </div>

      {/* (bug 150) Chọn chế độ */}
      <div className="flex gap-2 text-sm">
        <button onClick={() => setMode('deep')}
          className="px-3 py-1.5 rounded-lg border inline-flex items-center gap-1.5"
          style={{ borderColor: mode === 'deep' ? '#7c6af0' : '#2a2a3e', background: mode === 'deep' ? 'rgba(124,106,240,0.12)' : 'transparent' }}>
          <Microscope className="w-4 h-4" /> {ui.s2cdTabDeep}
        </button>
        <button onClick={() => setMode('quick')}
          className="px-3 py-1.5 rounded-lg border inline-flex items-center gap-1.5"
          style={{ borderColor: mode === 'quick' ? '#7c6af0' : '#2a2a3e', background: mode === 'quick' ? 'rgba(124,106,240,0.12)' : 'transparent' }}>
          <ScanLine className="w-4 h-4" /> {ui.s2cdTabQuick}
        </button>
      </div>

      {/* 01 — Truyện (chung cho cả hai chế độ) */}
      <section className="rounded-xl border border-border/60 bg-muted/20 p-4 space-y-3">
        <div className="text-sm font-semibold flex items-center gap-2"><ScanLine className="w-4 h-4" /> {ui.s2cStep1}</div>

        {/* (bug 136) NHẬP FILE thay vì dán tay: kéo thả / chọn NHIỀU file .txt/.md/.epub một lúc. */}
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); void importFiles(Array.from(e.dataTransfer.files)); }}
          className="rounded-lg border-2 border-dashed border-border/70 px-3 py-2.5 text-xs text-muted-foreground flex items-center gap-2 hover:border-primary/40 transition-colors"
        >
          <span className="flex-1">{importing ? ui.s2cFilesReading : ui.s2cFilesHint}</span>
          <button
            onClick={() => {
              const inp = document.createElement('input');
              inp.type = 'file'; inp.multiple = true; inp.accept = '.txt,.md,.text,.markdown,.epub,application/epub+zip';
              inp.onchange = () => { void importFiles(Array.from(inp.files ?? [])); };
              inp.click();
            }}
            disabled={importing}
            className="px-2.5 py-1 rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50 shrink-0"
          >📂 {ui.s2cFilesBtn}</button>
        </div>

        <textarea value={story} onChange={(e) => setStory(e.target.value)} rows={8}
          className="settings-input text-sm resize-y w-full" placeholder={ui.s2cStoryPh} />
        <div className="text-xs text-muted-foreground">{fmt(ui.s2cChars, { n: story.length.toLocaleString() })}{chunkSize > 0 && story.length > chunkSize ? fmt(ui.s2cChunks, { n: Math.min(Math.ceil(story.length / chunkSize), maxChunks) }) : ''}</div>

        {/* (bug 163) HỘP ĐỀ XUẤT SỐ ĐOẠN QUÉT — hiện ngay sau khi nạp truyện.
            Lý do có màn này: mặc định 12 đoạn chỉ đọc 480.000 ký tự; truyện triệu chữ thì đó là vài
            phần trăm, phần còn lại không được nhìn tới nên nửa sau truyện KHÔNG có entry nào — mà
            app không có cách nào tự biết để báo. User đặt mốc "trên 500 entry" rồi không hiểu vì
            sao mãi không đạt, thật ra chỉ vì app chưa đọc tới đó.
            Nói cả cái giá (thời gian, số lượt gọi) rồi để user tự chọn — không tự ý nâng, vì nâng
            là nhân chi phí của MỌI lần chạy sau đó. */}
        {chunkAdvice && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 space-y-2">
            <div className="flex items-start gap-2">
              <span className="text-base leading-none mt-0.5">💡</span>
              <div className="flex-1">
                <div className="text-sm font-semibold">Nên tăng số đoạn quét lên {chunkAdvice.recommended}?</div>
                <ul className="mt-1.5 space-y-1 text-xs text-muted-foreground list-disc pl-4">
                  {adviceText(chunkAdvice, story.length, maxChunks).map((line, i) => <li key={i}>{line}</li>)}
                </ul>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 pt-0.5">
              <button
                onClick={() => { setMaxChunks(chunkAdvice.recommended); setChunkAdvice(null); toast.success(`Đã đặt ${chunkAdvice.recommended} đoạn quét.`); }}
                className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90"
              >Dùng {chunkAdvice.recommended} đoạn (khuyên dùng)</button>
              <button
                onClick={() => setChunkAdvice(null)}
                className="px-3 py-1.5 rounded-lg border border-border text-xs hover:bg-muted"
              >Giữ {maxChunks} đoạn</button>
              <button
                onClick={() => { setShowAdvanced(true); setChunkAdvice(null); }}
                className="px-3 py-1.5 rounded-lg border border-border text-xs hover:bg-muted"
              >Tự đặt số khác…</button>
            </div>
          </div>
        )}

        {/* Nâng cao: chunk — dùng chung cho cả hai chế độ */}
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
            {mode === 'quick' && (
              <label className="text-xs flex items-end gap-2 pb-1">
                <input type="checkbox" checked={includeIdentity} onChange={(e) => setIncludeIdentity(e.target.checked)} /> {ui.s2cIncludeIdentity}
              </label>
            )}
          </div>
        )}
      </section>

      {mode === 'deep' && (
        <>
          {/* 02 — Cấu hình pipeline quét sâu */}
          <section className="rounded-xl border border-border/60 bg-muted/20 p-4 space-y-3">
            <div className="text-sm font-semibold flex items-center gap-2"><Microscope className="w-4 h-4" /> {ui.s2cdStep2}</div>
            <p className="text-xs text-muted-foreground">{ui.s2cdIntro}</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <label className="text-xs">{ui.s2cdVerifyRounds}
                <select value={deepOpts.verifyRounds} onChange={(e) => setD({ verifyRounds: +e.target.value })} className="settings-input text-xs mt-1 w-full">
                  <option value={0}>0</option><option value={1}>1</option><option value={2}>2</option><option value={3}>3</option><option value={5}>5</option>
                </select>
              </label>
              <label className="text-xs md:col-span-2">{ui.s2cdCardChar}
                <input value={deepOpts.cardChar} onChange={(e) => setD({ cardChar: e.target.value })} className="settings-input text-xs mt-1 w-full" placeholder={ui.s2cdCardCharPh} />
              </label>
              <label className="text-xs">{ui.s2cUserChar}{'{{user}}'}
                <input value={deepOpts.userReplaceName} onChange={(e) => setD({ userReplaceName: e.target.value })} className="settings-input text-xs mt-1 w-full" placeholder={ui.s2cUserCharPh} />
              </label>
            </div>
            {deepOpts.userReplaceName.trim() && (
              <label className="text-xs block">{ui.s2cUserExtra}{'{{user}}'}{ui.s2cUserExtra2}
                <textarea value={deepOpts.userSetup} onChange={(e) => setD({ userSetup: e.target.value })} rows={2}
                  className="settings-input text-xs mt-1 w-full resize-y" placeholder={ui.s2cUserExtraPh} />
              </label>
            )}
            <label className="text-xs block">{ui.s2cExtraNotes}
              <input value={deepOpts.extraNotes} onChange={(e) => setD({ extraNotes: e.target.value })} className="settings-input text-xs mt-1 w-full" placeholder={ui.s2cExtraNotesPh} />
            </label>
            <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs">
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={deepOpts.nsfw} onChange={(e) => setD({ nsfw: e.target.checked })} /> NSFW</label>
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={deepOpts.learnStyle} onChange={(e) => setD({ learnStyle: e.target.checked })} /> {ui.s2cAnalyzeStyle}</label>
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={deepOpts.makeCard} onChange={(e) => setD({ makeCard: e.target.checked })} /> {ui.s2cdMakeCard}</label>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {!deepRunning && (
                <button onClick={() => void runDeep(false)}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-md font-semibold text-white"
                  style={{ background: '#7c6af0', border: 'none', cursor: 'pointer' }}>
                  <Microscope className="w-4 h-4" /> {deep && deep.status !== 'idle' ? ui.s2cdRestart : ui.s2cdStart}
                </button>
              )}
              {resumable && (
                <button onClick={() => void runDeep(true)}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-md font-semibold text-white"
                  style={{ background: '#22c55e', border: 'none', cursor: 'pointer' }}>
                  <Play className="w-4 h-4" /> {ui.s2cdResume}
                </button>
              )}
              {deepRunning && (
                <button onClick={stopWork}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-md font-semibold text-white"
                  style={{ background: '#f59e0b', border: 'none', cursor: 'pointer' }}>
                  <Pause className="w-4 h-4" /> {ui.s2cdPause}
                </button>
              )}
              {!deepRunning && deep && (
                <button onClick={discardDeep}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-md text-xs"
                  style={{ background: 'transparent', color: '#ef4444', border: '1px solid #ef4444', cursor: 'pointer' }}>
                  <Trash2 className="w-3.5 h-3.5" /> {ui.s2cdDiscard}
                </button>
              )}
            </div>
            {!deepRunning && deep && (deep.status === 'paused' || deep.status === 'error') && !resumable && (
              <div className="text-xs text-amber-400 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" /> {ui.s2cdStale}</div>
            )}
          </section>

          {/* 03 — Tiến trình pipeline */}
          {deep && deep.status !== 'idle' && (
            <section className="rounded-xl border border-border/60 bg-muted/20 p-4 space-y-3">
              <div className="text-sm font-semibold flex items-center justify-between">
                <span className="flex items-center gap-2">
                  {deepRunning ? <Loader2 className="w-4 h-4 animate-spin text-primary" /> : deep.status === 'done' ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <Pause className="w-4 h-4 text-amber-400" />}
                  {ui.s2cdProgress}
                  {deep.status === 'paused' && <span className="text-xs text-amber-400">({ui.s2cdStatusPaused})</span>}
                  {deep.status === 'error' && <span className="text-xs text-red-400">({deep.error})</span>}
                </span>
                <span className="text-[11px] text-muted-foreground font-normal">
                  🤖 {deep.stats.aiCalls} {ui.s2cdStatCalls} · 🧠 {deep.stats.facts} {ui.s2cdStatFacts} · 📚 {deep.stats.entries} {ui.s2cdStatEntries} · 📄 {fmt(ui.s2cdStatChunks, { n: deep.chunkCount })}
                </span>
              </div>
              <ul className="space-y-1.5 text-sm">
                {deep.passes.map((p) => (
                  <li key={p.id} className="flex items-center gap-2">
                    {p.status === 'done'
                      ? <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                      : p.status === 'running'
                        ? <Loader2 className="w-4 h-4 animate-spin text-primary shrink-0" />
                        : <Circle className="w-4 h-4 text-muted-foreground/40 shrink-0" />}
                    <span className={p.status === 'pending' ? 'text-muted-foreground' : ''}>
                      {PASS_LABELS[p.id]()}
                      {p.id === 'verify' && p.round ? ` — ${fmt(ui.s2cdRound, { r: p.round })}` : ''}
                    </span>
                    {p.total > 0 && p.status !== 'pending' && (
                      <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">{p.done}/{p.total}</span>
                    )}
                  </li>
                ))}
              </ul>
              {deepRunning && deepLog && <div className="text-[11px] text-muted-foreground truncate">▸ {deepLog}</div>}
              {deep.memory.mainCharacter && (
                <div className="text-xs text-muted-foreground">{fmt(ui.s2cdMain, { name: deep.memory.mainCharacter })}</div>
              )}
            </section>
          )}

          {/* 04 — Kết quả quét sâu */}
          {deep?.result && (
            <section className="rounded-xl border border-primary/40 bg-muted/20 p-4 space-y-3">
              <div className="text-sm font-semibold flex items-center justify-between">
                <span className="flex items-center gap-2"><BookOpen className="w-4 h-4 text-primary" /> {ui.s2cdResultTitle}</span>
                <button onClick={() => applyDeepEntries(deep.result!.entries)}
                  className="px-3 py-1.5 rounded-md text-xs font-semibold text-white" style={{ background: '#22c55e', border: 'none', cursor: 'pointer' }}>
                  {fmt(ui.s2cdApplyAll, { n: deep.result.entries.length })}
                </button>
              </div>

              {deepEntryGroups.map(({ cat, entries }) => (
                <div key={cat} className="rounded-lg border border-border/60 p-2.5 space-y-1.5">
                  <div className="text-xs font-bold text-primary flex items-center justify-between">
                    <span>{CAT_LABELS[cat]()} ({entries.length})</span>
                    <button onClick={() => applyDeepEntries(entries)} className="font-normal text-amber-400 hover:text-amber-300">{ui.s2cdApplyGroup}</button>
                  </div>
                  <ul className="text-xs space-y-1" style={{ maxHeight: 220, overflowY: 'auto' }}>
                    {entries.map((e, i) => (
                      <li key={i}>
                        <details>
                          <summary className="cursor-pointer">
                            <b>{e.title}</b>{e.keys.length > 0 && <span className="text-muted-foreground"> — [{e.keys.join(', ')}]</span>}
                          </summary>
                          <div className="whitespace-pre-wrap text-muted-foreground mt-1 pl-2 border-l border-border/60">{e.content}</div>
                        </details>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}

              {(deep.result.report.length > 0 || deep.memory.unknowns.length > 0) && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground">{ui.s2cdReport} ({deep.result.report.length + deep.memory.unknowns.length})</summary>
                  <ul className="mt-1 space-y-0.5 text-muted-foreground" style={{ maxHeight: 180, overflowY: 'auto' }}>
                    {deep.result.report.map((r, i) => <li key={`r${i}`}>• {r}</li>)}
                    {deep.memory.unknowns.map((u, i) => <li key={`u${i}`}>❓ {ui.s2cdUnknowns}: {u}</li>)}
                  </ul>
                </details>
              )}
            </section>
          )}
          {deep?.result?.cards.map((b) => b.card
            ? <CardResult key={b.name} card={b.card} onApply={() => applyToCard(b.card!)} onApplyEntries={applyEntries} />
            : <div key={b.name} className="rounded-xl border border-red-500/40 bg-red-500/5 p-3 text-sm">❌ <b>{b.name}</b>: {b.error}</div>)}
        </>
      )}

      {mode === 'quick' && (
        <>
          {/* Tuỳ chọn thẻ (flow cũ) */}
          <section className="rounded-xl border border-border/60 bg-muted/20 p-4 space-y-3">
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

            <label className="text-xs block">{ui.s2cExtraNotes}
              <input value={opts.extraNotes ?? ''} onChange={(e) => set({ extraNotes: e.target.value })} className="settings-input text-xs mt-1 w-full" placeholder={ui.s2cExtraNotesPh} />
            </label>

            {/* Toggles */}
            <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs">
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={!!opts.nsfw} onChange={(e) => set({ nsfw: e.target.checked })} /> NSFW</label>
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={opts.splitByStage !== false} onChange={(e) => set({ splitByStage: e.target.checked })} /> {ui.s2cSplitByStage}</label>
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={!!opts.omitEmptyFields} onChange={(e) => set({ omitEmptyFields: e.target.checked })} /> {ui.s2cOmitEmpty}</label>
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={!!opts.autoContinue} onChange={(e) => set({ autoContinue: e.target.checked })} /> {ui.s2cAutoContinue}</label>
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={!!opts.withWorldEntries} onChange={(e) => set({ withWorldEntries: e.target.checked })} /> {ui.s2cWithWorld}</label>
              {/* (bug 136) Học văn phong tác giả từ chính truyện → entry hướng dẫn giọng văn. */}
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={!!opts.analyzeStyle} onChange={(e) => set({ analyzeStyle: e.target.checked })} /> {ui.s2cAnalyzeStyle}</label>
            </div>

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
                  // (bugNeedFix/105) Người đã gán làm {{user}} thì KHÔNG chọn được.
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
        </>
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
