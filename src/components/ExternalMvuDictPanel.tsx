/**
 * (bug 238) TỪ ĐIỂN MVU CHO LINK NGOÀI — quét key, AI dịch key còn thiếu, tra/sửa ngay tại chỗ.
 *
 * User (gogopikachu): "phần dịch link ngoài trong regex manager nên thêm vào chức năng tạo từ điển,
 * tra từ điển như khi dịch ở bên phần ngoài. Hiện đã có trường hợp toàn bộ các biến và giá trị mvu
 * đều được đưa vào bên trong script link ngoài… số key của từ điển card rất ít (9-14 key) nhưng
 * đem đi quét thì ra 140+ key… dịch link ngoài cũng không có chức năng quét hay dịch key mà chỉ
 * áp dụng key."
 *
 * Làm THẲNG vào từ điển MVU chung của thẻ, không đẻ từ điển riêng: biến trong link ngoài và biến
 * trong thẻ là MỘT biến — thẻ đọc `Độ Hảo Cảm` thì script ngoài cũng phải ghi đúng `Độ Hảo Cảm`.
 * Hai từ điển là hai nguồn sự thật, sớm muộn sẽ lệch nhau và vỡ đúng chỗ người dùng sợ nhất.
 */
import { useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { useIdleMemo } from '../hooks/useIdleMemo';
import {
  extractMvuKeysFromCode, aiTranslateMvuKeys, extractZodDescriptions, extractSchemaContextFromCard,
  enforceExactConsistency, type MvuKeyInfo,
} from '../utils/mvuSync';
import { computePoolConcurrency } from '../utils/apiClient';
import { BookOpen, Wand2, Search, Square, ChevronDown, ChevronRight, Lock } from 'lucide-react';

interface Props {
  /** Code gốc đang nằm ở ô dịch link ngoài. */
  code: string;
}

export default function ExternalMvuDictPanel({ code }: Props) {
  const card = useStore((s) => s.card);
  const proxy = useStore((s) => s.proxy);
  const translationConfig = useStore((s) => s.translationConfig);
  const setTranslationConfig = useStore((s) => s.setTranslationConfig);
  const mvuKeyMetadata = useStore((s) => s.mvuKeyMetadata);
  const setMvuKeyMetadata = useStore((s) => s.setMvuKeyMetadata);
  const pushDictionaryHistory = useStore((s) => s.pushDictionaryHistory);
  const addToast = useStore((s) => s.addToast);
  const { mvuDictionary, enableMvuSync, mvuDictLocked } = translationConfig;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Quét lúc máy rảnh: file link ngoài có khi 1-3MB, quét đồng bộ trong render là treo khung.
  const keys = useIdleMemo<MvuKeyInfo[]>(
    () => (code.trim() ? extractMvuKeysFromCode(code) : []),
    [code], [],
  );

  const stats = useMemo(() => {
    const has = keys.filter(k => !!mvuDictionary[k.key]?.trim());
    return { total: keys.length, has: has.length, missing: keys.length - has.length };
  }, [keys, mvuDictionary]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return keys
      .filter(k => !onlyMissing || !mvuDictionary[k.key]?.trim())
      .filter(k => !q || k.key.toLowerCase().includes(q) || (mvuDictionary[k.key] || '').toLowerCase().includes(q))
      .sort((a, b) => b.occurrences - a.occurrences);
  }, [keys, mvuDictionary, query, onlyMissing]);

  if (!code.trim() || keys.length === 0) return null;

  /** Ghi một loạt cặp key → bản dịch vào từ điển CHUNG, đánh dấu nguồn 'external'. */
  const writeDict = (pairs: Record<string, string>, confidence: 'ai' | 'manual') => {
    const st = useStore.getState();
    const base = st.translationConfig.mvuDictionary;
    pushDictionaryHistory(base);
    const nextDict = { ...base, ...pairs };
    const nextMeta = { ...st.mvuKeyMetadata };
    const infoOf = new Map(keys.map(k => [k.key, k]));
    for (const k of Object.keys(pairs)) {
      const ki = infoOf.get(k);
      const prev = nextMeta[k];
      const sources = [...new Set([...(prev?.sources || ki?.sources || []), 'external'])];
      nextMeta[k] = {
        ...prev,
        sources,
        keyType: prev?.keyType ?? ki?.keyType,
        description: prev?.description ?? ki?.description,
        occurrences: prev?.occurrences ?? ki?.occurrences ?? 1,
        confidence,
      };
    }
    setMvuKeyMetadata(nextMeta);
    // Cùng chốt đồng nhất như panel MVU chính: một key nguồn chỉ được có một bản dịch.
    const { fixedDict } = enforceExactConsistency(nextDict, nextMeta);
    setTranslationConfig({ mvuDictionary: fixedDict });
  };

  const translateMissing = async () => {
    const missing = keys.filter(k => !mvuDictionary[k.key]?.trim()).map(k => k.key);
    if (missing.length === 0) { addToast('info', 'Mọi key trong file này đều đã có trong từ điển.'); return; }
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy({ done: 0, total: missing.length });
    try {
      // Ngữ cảnh cho AI: CHÍNH file này trước (key đang dịch nằm ở đây; AI chỉ đọc ~5.000 ký tự
      // đầu của ngữ cảnh), schema của thẻ theo sau.
      const schemaContext = [code.slice(0, 60_000), translationConfig.customSchema || extractSchemaContextFromCard(card)]
        .filter(Boolean).join('\n\n');
      const translations = await aiTranslateMvuKeys(
        missing,
        translationConfig.targetLanguage,
        proxy,
        ctrl.signal,
        schemaContext,
        extractZodDescriptions(code),
        undefined,
        // Đưa từ điển đang có làm mẫu → key mới dịch cùng kiểu với key cũ của thẻ.
        useStore.getState().translationConfig.mvuDictionary,
        translationConfig.mvuTranslationPrompt,
        (done, total) => setBusy({ done, total }),
        computePoolConcurrency(proxy),
      );
      const pairs: Record<string, string> = {};
      for (const [k, v] of Object.entries(translations)) if (v && v.trim()) pairs[k] = v.trim();
      writeDict(pairs, 'ai');
      const got = Object.keys(pairs).length;
      addToast(got === missing.length ? 'success' : 'info',
        `Đã thêm ${got}/${missing.length} key vào từ điển MVU của thẻ`
        + (got < missing.length ? ' — key còn trống thì điền tay ở danh sách.' : '.'));
    } catch (err) {
      if (!ctrl.signal.aborted) addToast('error', `AI dịch key lỗi: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
      abortRef.current = null;
    }
  };

  return (
    <div style={{ padding: '12px 14px', background: 'var(--bg-primary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={() => setOpen(v => !v)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 0, display: 'flex' }}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <BookOpen size={14} color="var(--accent-primary)" />
        <b style={{ fontSize: '0.8rem' }}>Từ điển MVU của link này</b>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
          {stats.total} key · <span style={{ color: 'var(--accent-success, #4ade80)' }}>{stats.has} đã có</span>
          {stats.missing > 0 && <> · <span style={{ color: 'var(--accent-warning, #f59e0b)' }}>{stats.missing} còn thiếu</span></>}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {busy ? (
            <button className="btn btn-ghost btn-sm" onClick={() => abortRef.current?.abort()}>
              <Square size={12} /> Dừng ({busy.done}/{busy.total})
            </button>
          ) : (
            <button className="btn btn-primary btn-sm" onClick={translateMissing} disabled={stats.missing === 0 || mvuDictLocked}
              title={mvuDictLocked ? 'Từ điển đang khoá — mở khoá ở panel MVU để thêm key.' : 'Gọi AI dịch các key còn thiếu rồi ghi vào từ điển MVU chung của thẻ.'}>
              <Wand2 size={12} /> AI dịch {stats.missing} key thiếu
            </button>
          )}
        </div>
      </div>

      {!enableMvuSync && (
        <div style={{ marginTop: 8, fontSize: '0.7rem', color: 'var(--accent-warning, #f59e0b)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          Đồng bộ MVU đang TẮT — từ điển sẽ không được áp khi dịch link này, tên biến có thể lệch với thẻ.
          <button className="btn btn-ghost btn-sm" onClick={() => setTranslationConfig({ enableMvuSync: true })}>Bật đồng bộ MVU</button>
        </div>
      )}
      {mvuDictLocked && (
        <div style={{ marginTop: 8, fontSize: '0.7rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Lock size={12} /> Từ điển đang khoá: vẫn được áp khi dịch, nhưng không thêm/sửa ở đây.
        </div>
      )}

      {open && (
        <>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', margin: '8px 0', lineHeight: 1.5 }}>
            Đây là từ điển MVU <b>chung</b> của thẻ (cùng bảng ở panel MVU) — biến trong link ngoài và
            biến trong thẻ phải là một. Key ở đây được quét từ chính file đang mở.
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
            <Search size={12} color="var(--text-muted)" />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Tra key gốc hoặc bản dịch…"
              style={{ flex: '1 1 180px', padding: '4px 8px', fontSize: '0.72rem', borderRadius: 4, border: '1px solid var(--border-default)', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }} />
            <label style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4 }}>
              <input type="checkbox" checked={onlyMissing} onChange={e => setOnlyMissing(e.target.checked)} /> chỉ key thiếu
            </label>
          </div>
          <div style={{ maxHeight: 260, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {rows.map(k => {
              const v = mvuDictionary[k.key] || '';
              return (
                <div key={k.key} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr) auto', gap: 6, alignItems: 'center', fontSize: '0.72rem', padding: '2px 4px', borderRadius: 4, background: v ? 'transparent' : 'rgba(245,158,11,0.06)' }}>
                  <code style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={k.description || k.key}>{k.key}</code>
                  <input
                    defaultValue={v}
                    key={`${k.key}:${v}`}
                    disabled={mvuDictLocked}
                    placeholder="(chưa có — điền tay hoặc bấm AI dịch)"
                    onBlur={e => { const nv = e.target.value.trim(); if (nv && nv !== v) writeDict({ [k.key]: nv }, 'manual'); }}
                    style={{ padding: '2px 6px', fontSize: '0.72rem', borderRadius: 4, border: `1px solid ${v ? 'var(--border-default)' : 'rgba(245,158,11,0.5)'}`, background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                  />
                  <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }} title={`Nguồn: ${k.sources.join(', ')}`}>×{k.occurrences}</span>
                </div>
              );
            })}
            {rows.length === 0 && <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Không có key nào khớp.</div>}
          </div>
        </>
      )}
    </div>
  );
}
