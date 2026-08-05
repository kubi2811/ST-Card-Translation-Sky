/**
 * CardEditorPage — Module 2: Card Editor (5 tabs)
 * Spec Phần 6: Thông tin cơ bản / Tính cách & Bối cảnh / Hội thoại / Prompt hệ thống / Mở rộng
 */

import { useState, useCallback, useMemo } from 'react';
import {
  FileText, User, MessageSquare, Terminal, Puzzle,
  Plus, Trash2, GripVertical, Star, StarOff, Hash,
  X, ChevronDown, ChevronUp, ChevronRight, Copy,
} from 'lucide-react';
import { normalizeAvatarFile, describeNormalize } from '../lib/converters/avatarImage';
import { useCardStore } from '../store/cardStore';
import StagePersonaButton from '../components/StagePersonaButton';
import { t as ui, fmt } from '../i18n';

// ─── Token estimator ────────────────────────────────────────────────────────
const estimateTokens = (text: string) => Math.ceil((text || '').length / 4);

// ─── Macros ─────────────────────────────────────────────────────────────────
const MACROS = ['{{char}}', '{{user}}', '{{date}}', '{{time}}', '{{random}}', '{{roll}}', '{{input}}'];

// ─── Tab definitions ────────────────────────────────────────────────────────
const TABS = [
  { id: 'basic', label: ui.ceTabBasic, icon: FileText },
  { id: 'personality', label: ui.ceTabPersonality, icon: User },
  { id: 'dialogue', label: ui.ceTabDialogue, icon: MessageSquare },
  { id: 'system', label: ui.ceTabSystem, icon: Terminal },
  { id: 'advanced', label: ui.ceTabAdvanced, icon: Puzzle },
] as const;

type TabId = (typeof TABS)[number]['id'];

export function CardEditorPage() {
  const [activeTab, setActiveTab] = useState<TabId>('basic');
  const card = useCardStore(s => s.card);
  const updateField = useCardStore(s => s.updateField);

  const data = card.data;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Tab bar */}
      <div className="flex border-b border-border bg-card/50 px-2 shrink-0">
        {TABS.map(tab => {
          const Icon = tab.icon;
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition-all whitespace-nowrap ${
                activeTab === tab.id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30'
              }`}>
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto scrollbar-thin p-5">
        <div className="max-w-3xl mx-auto space-y-5">
          {activeTab === 'basic' && <TabBasic data={data} updateField={updateField} />}
          {activeTab === 'personality' && <TabPersonality data={data} updateField={updateField} />}
          {activeTab === 'dialogue' && <TabDialogue data={data} updateField={updateField} />}
          {activeTab === 'system' && <TabSystem data={data} updateField={updateField} />}
          {activeTab === 'advanced' && <TabAdvanced data={data} updateField={updateField} />}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 1 — THÔNG TIN CƠ BẢN
// ═══════════════════════════════════════════════════════════════════════════

function TabBasic({ data, updateField }: TabProps) {
  const avatar = useCardStore(s => s.card.avatar);
  const [tagInput, setTagInput] = useState('');

  const handleAddTag = useCallback(() => {
    const tag = tagInput.trim();
    if (!tag || data.tags.includes(tag)) return;
    updateField('data.tags', [...data.tags, tag]);
    setTagInput('');
  }, [tagInput, data.tags, updateField]);

  const handleRemoveTag = useCallback((tag: string) => {
    updateField('data.tags', data.tags.filter(t => t !== tag));
  }, [data.tags, updateField]);

  return (
    <>
      <SectionCard title={ui.ceCharacter}>
        <FieldRow label={ui.ceCharName} required>
          <input type="text" value={data.name}
            onChange={e => updateField('data.name', e.target.value)}
            className="settings-input" placeholder={ui.ceCharName} />
        </FieldRow>

        <FieldRow label={ui.ceAvatar}>
          <div className="flex items-center gap-4">
            <div className="w-20 h-20 rounded-lg bg-muted border border-border flex items-center justify-center overflow-hidden shrink-0">
              {avatar && avatar !== 'none' ? (
                <img src={avatar} alt="Avatar" className="w-full h-full object-cover" />
              ) : (
                <User className="w-8 h-8 text-muted-foreground/40" />
              )}
            </div>
            <div className="space-y-1.5 flex-1">
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = 'image/*';
                    input.onchange = async (e) => {
                      const file = (e.target as HTMLInputElement).files?.[0];
                      if (!file) return;
                      // (bug 217) Thu nhỏ + nén trước khi lưu. Trước đây ảnh vào nguyên xi rồi nở
                      // thêm 33% vì base64 — ảnh 4K là thẻ nặng vài chục MB, trong khi avatar chỉ
                      // hiển thị vài trăm pixel.
                      try {
                        const norm = await normalizeAvatarFile(file);
                        updateField('avatar', norm.dataUrl);
                        console.info(`[bug217] ${describeNormalize(norm, file.size)}`);
                      } catch {
                        // Không đọc được ảnh (định dạng lạ) → giữ nguyên hành vi cũ để không mất chức năng.
                        const base64 = await new Promise<string>((resolve) => {
                          const reader = new FileReader();
                          reader.onloadend = () => resolve(reader.result as string);
                          reader.readAsDataURL(file);
                        });
                        updateField('avatar', base64);
                      }
                    };
                    input.click();
                  }}
                  className="px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors"
                >
                  {ui.cePickImage}
                </button>
                {avatar && avatar !== 'none' && (
                  <button
                    onClick={() => updateField('avatar', 'none')}
                    className="px-3 py-1.5 rounded-lg bg-destructive/10 text-destructive text-xs font-medium hover:bg-destructive/20 transition-colors"
                  >
                    {ui.ceRemoveImage}
                  </button>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground">
                {ui.ceAvatarHint}
              </p>
            </div>
          </div>
        </FieldRow>

        <FieldRow label={ui.ceCreator}>
          <input type="text" value={data.creator}
            onChange={e => updateField('data.creator', e.target.value)}
            className="settings-input" placeholder={ui.ceCreatorPh} />
        </FieldRow>

        <FieldRow label={ui.ceVersion}>
          <div className="flex items-center gap-2">
            <input type="text" value={data.character_version}
              onChange={e => updateField('data.character_version', e.target.value)}
              className="settings-input" placeholder="1.0" />
            <button
              onClick={() => {
                const current = data.character_version || '1.0';
                const match = current.match(/^(.*?)(\d+)(\D*)$/);
                if (match) {
                  updateField('data.character_version', `${match[1]}${parseInt(match[2], 10) + 1}${match[3]}`);
                } else {
                  updateField('data.character_version', current + ' 1');
                }
              }}
              className="p-1.5 bg-slate-800 hover:bg-slate-700 border border-white/10 rounded text-gray-400 hover:text-white transition-colors"
              title={ui.ceVersionUp}
            >
              <ChevronUp size={16} />
            </button>
            <button
              onClick={() => {
                const current = data.character_version || '1.0';
                const match = current.match(/^(.*?)(\d+)(\D*)$/);
                if (match) {
                  const num = Math.max(0, parseInt(match[2], 10) - 1);
                  updateField('data.character_version', `${match[1]}${num}${match[3]}`);
                }
              }}
              className="p-1.5 bg-slate-800 hover:bg-slate-700 border border-white/10 rounded text-gray-400 hover:text-white transition-colors"
              title={ui.ceVersionDown}
            >
              <ChevronDown size={16} />
            </button>
          </div>
        </FieldRow>

        <FieldRow label="Tags">
          <div className="space-y-2">
            <div className="flex gap-2">
              <input type="text" value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleAddTag())}
                className="settings-input flex-1" placeholder={ui.ceTagPh} />
              <button onClick={handleAddTag}
                className="px-3 py-2 rounded-lg bg-muted hover:bg-muted/80 border border-border text-sm transition-colors">
                <Plus className="w-4 h-4" />
              </button>
            </div>
            {data.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {data.tags.map(tag => (
                  <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary/10 text-primary text-xs">
                    <Hash className="w-3 h-3" />{tag}
                    <button onClick={() => handleRemoveTag(tag)} className="hover:text-destructive ml-0.5">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </FieldRow>
      </SectionCard>

      <SectionCard title={ui.ceNotesSection}>
        <FieldRow label={ui.ceAuthorNotes}>
          <TextareaWithTokens value={data.creator_notes} rows={3}
            onChange={v => updateField('data.creator_notes', v)} placeholder={ui.ceAuthorNotesPh} />
        </FieldRow>

        <FieldRow label={ui.ceFavourite}>
          <button onClick={() => updateField('data.extensions.fav', !data.extensions.fav)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-all text-sm ${
              data.extensions.fav
                ? 'border-amber-500/30 bg-amber-500/10 text-amber-400'
                : 'border-border bg-background text-muted-foreground hover:text-foreground'
            }`}>
            {data.extensions.fav ? <Star className="w-4 h-4 fill-current" /> : <StarOff className="w-4 h-4" />}
            {data.extensions.fav ? ui.ceFavourited : ui.ceMarkFavourite}
          </button>
        </FieldRow>

        <FieldRow label={`Talkativeness: ${data.extensions.talkativeness}`}>
          <input type="range" min={0} max={1} step={0.05}
            value={parseFloat(data.extensions.talkativeness) || 0.5}
            onChange={e => updateField('data.extensions.talkativeness', e.target.value)}
            className="settings-range w-full" />
          <p className="text-[10px] text-muted-foreground mt-1">{ui.ceTalkHint}</p>
        </FieldRow>
      </SectionCard>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 2 — TÍNH CÁCH & BỐI CẢNH
// ═══════════════════════════════════════════════════════════════════════════

function TabPersonality({ data, updateField }: TabProps) {
  return (
    <>
      <SectionCard title={ui.ceDescription}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <StagePersonaButton
            currentDescription={data.description}
            onInsert={(v) => updateField('data.description', v)}
          />
        </div>
        <TextareaWithMacros value={data.description} rows={12}
          onChange={v => updateField('data.description', v)}
          placeholder={ui.ceDescriptionPh} />
      </SectionCard>

      <SectionCard title={ui.cePersonality}>
        <TextareaWithTokens value={data.personality} rows={6}
          onChange={v => updateField('data.personality', v)}
          placeholder={ui.cePersonalityPh} />
      </SectionCard>

      <SectionCard title={ui.ceScenario}>
        <TextareaWithTokens value={data.scenario} rows={6}
          onChange={v => updateField('data.scenario', v)}
          placeholder={ui.ceScenarioPh} />
      </SectionCard>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 3 — HỘI THOẠI
// ═══════════════════════════════════════════════════════════════════════════

function TabDialogue({ data, updateField }: TabProps) {
  const updateCard = useCardStore(s => s.updateCard);

  const handleAddGreeting = useCallback(() => {
    updateCard(c => { c.data.alternate_greetings.push(''); });
  }, [updateCard]);

  const handleUpdateGreeting = useCallback((i: number, value: string) => {
    updateCard(c => { c.data.alternate_greetings[i] = value; });
  }, [updateCard]);

  const handleRemoveGreeting = useCallback((i: number) => {
    updateCard(c => { c.data.alternate_greetings.splice(i, 1); });
  }, [updateCard]);

  return (
    <>
      <SectionCard title={ui.ceFirstMes}>
        <TextareaWithTokens value={data.first_mes} rows={10}
          onChange={v => updateField('data.first_mes', v)}
          placeholder={ui.ceFirstMesPh} />
      </SectionCard>

      <SectionCard title={ui.ceAltGreetings} action={
        <button onClick={handleAddGreeting}
          className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors">
          <Plus className="w-3.5 h-3.5" /> {ui.ceAdd}
        </button>
      }>
        {data.alternate_greetings.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">{ui.ceNoAltGreeting}</p>
        ) : (
          <div className="space-y-3">
            {data.alternate_greetings.map((g, i) => (
              <div key={i} className="relative group">
                <div className="flex items-center gap-2 mb-1">
                  <GripVertical className="w-3.5 h-3.5 text-muted-foreground/50" />
                  <span className="text-xs text-muted-foreground">#{i + 1}</span>
                  <button onClick={() => handleRemoveGreeting(i)}
                    className="ml-auto p-1 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-all">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <TextareaWithTokens value={g} rows={4}
                  onChange={v => handleUpdateGreeting(i, v)}
                  placeholder={fmt(ui.ceAltGreetingPh, { n: i + 1 })} />
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title={ui.ceExampleMessages}>
        <div className="mb-2 px-3 py-2 rounded-lg bg-muted/50 border border-border text-xs text-muted-foreground">
          {ui.ceExampleHint1} <code className="px-1 py-0.5 bg-background rounded text-primary">&lt;START&gt;</code> {ui.ceExampleHint2}
        </div>
        <TextareaWithTokens value={data.mes_example} rows={12}
          onChange={v => updateField('data.mes_example', v)}
          placeholder={ui.ceExamplePh} />
      </SectionCard>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 4 — PROMPT HỆ THỐNG
// ═══════════════════════════════════════════════════════════════════════════

function TabSystem({ data, updateField }: TabProps) {
  return (
    <>
      <SectionCard title="System Prompt">
        <TextareaWithMacros value={data.system_prompt} rows={12}
          onChange={v => updateField('data.system_prompt', v)}
          placeholder={ui.ceSystemPromptPh} />
      </SectionCard>

      <SectionCard title="Post History Instructions (Author's Note)">
        <TextareaWithMacros value={data.post_history_instructions} rows={8}
          onChange={v => updateField('data.post_history_instructions', v)}
          placeholder={ui.cePostHistoryPh} />
      </SectionCard>

      <SectionCard title="Depth Prompt">
        <FieldRow label={ui.ceDepthContent}>
          <TextareaWithTokens value={data.extensions.depth_prompt.prompt} rows={6}
            onChange={v => updateField('data.extensions.depth_prompt.prompt', v)}
            placeholder={ui.ceDepthPh} />
        </FieldRow>

        <div className="grid grid-cols-2 gap-4">
          <FieldRow label="Depth">
            <input type="number" value={data.extensions.depth_prompt.depth}
              onChange={e => updateField('data.extensions.depth_prompt.depth', parseInt(e.target.value) || 4)}
              min={0} max={100} className="settings-input" />
          </FieldRow>
          <FieldRow label="Role">
            <select value={data.extensions.depth_prompt.role}
              onChange={e => updateField('data.extensions.depth_prompt.role', e.target.value)}
              className="settings-input">
              <option value="system">System</option>
              <option value="user">User</option>
              <option value="assistant">Assistant</option>
            </select>
          </FieldRow>
        </div>
      </SectionCard>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 5 — MỞ RỘNG / NÂNG CAO
// ═══════════════════════════════════════════════════════════════════════════

function TabAdvanced({ data, updateField }: TabProps) {
  const [showScripts, setShowScripts] = useState(false);
  const [showVariables, setShowVariables] = useState(false);
  const [showRawJson, setShowRawJson] = useState(false);
  const updateCard = useCardStore(s => s.updateCard);

  const scriptsCount = data.extensions.tavern_helper.scripts.length;
  const regexCount = data.extensions.regex_scripts.length;
  const variablesJson = useMemo(() =>
    JSON.stringify(data.extensions.tavern_helper.variables, null, 2),
    [data.extensions.tavern_helper.variables]
  );
  const extensionsJson = useMemo(() =>
    JSON.stringify(data.extensions, null, 2),
    [data.extensions]
  );

  return (
    <>
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-border bg-card p-4 text-center">
          <p className="text-2xl font-semibold text-primary">{scriptsCount}</p>
          <p className="text-xs text-muted-foreground mt-1">TavernHelper Scripts</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 text-center">
          <p className="text-2xl font-semibold text-primary">{regexCount}</p>
          <p className="text-xs text-muted-foreground mt-1">Regex Scripts</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 text-center">
          <p className="text-2xl font-semibold text-primary">{data.extensions.mvuzod ? '✓' : '—'}</p>
          <p className="text-xs text-muted-foreground mt-1">MVUZOD</p>
        </div>
      </div>

      {/* TavernHelper Scripts */}
      <AccordionSection title={`TavernHelper Scripts (${scriptsCount})`}
        open={showScripts} onToggle={() => setShowScripts(!showScripts)}>
        {scriptsCount === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">{ui.ceNoScript}</p>
        ) : (
          <div className="space-y-2">
            {data.extensions.tavern_helper.scripts.map((s, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-background border border-border">
                <span className={`w-2 h-2 rounded-full ${s.enabled ? 'bg-emerald-400' : 'bg-muted-foreground/30'}`} />
                <span className="text-sm flex-1 truncate">{s.name || 'Untitled'}</span>
                <span className="text-xs text-muted-foreground">{s.content.length} chars</span>
                <button onClick={() => {
                  updateCard(c => { c.data.extensions.tavern_helper.scripts[i].enabled = !s.enabled; });
                }} className="text-xs text-muted-foreground hover:text-foreground">
                  {s.enabled ? ui.ceOff : ui.ceOn}
                </button>
              </div>
            ))}
          </div>
        )}
        <p className="text-xs text-muted-foreground mt-2">
          {ui.ceEditDetail1} <strong>EJS Studio</strong> {ui.ceEditDetail2}
        </p>
      </AccordionSection>

      {/* Variables */}
      <AccordionSection title={ui.ceGlobalVars}
        open={showVariables} onToggle={() => setShowVariables(!showVariables)}>
        <textarea value={variablesJson} rows={10} readOnly
          className="settings-input font-mono text-xs leading-relaxed" />
        <p className="text-xs text-muted-foreground mt-1">{ui.ceEditViaMvuzod}</p>
      </AccordionSection>

      {/* MVUZOD Config */}
      {data.extensions.mvuzod && (
        <SectionCard title="MVUZOD Config">
          <p className="text-sm text-muted-foreground">
            Schema version: <span className="text-foreground">{data.extensions.mvuzod.schema?.version ?? 'N/A'}</span>
            · Fields: <span className="text-foreground">{data.extensions.mvuzod.schema?.fields?.length ?? 0}</span>
            · Mode: <span className="text-foreground">{data.extensions.mvuzod.validationMode}</span>
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            {ui.ceOpenMvuzod1} <strong>MVUZOD Studio</strong> {ui.ceOpenMvuzod2}
          </p>
        </SectionCard>
      )}

      {/* Raw JSON */}
      <AccordionSection title="Raw JSON (data.extensions)"
        open={showRawJson} onToggle={() => setShowRawJson(!showRawJson)}>
        <textarea value={extensionsJson} rows={20}
          onChange={e => {
            try {
              const parsed = JSON.parse(e.target.value);
              updateField('data.extensions', parsed);
            } catch { /* ignore invalid JSON while typing */ }
          }}
          className="settings-input font-mono text-xs leading-relaxed" />
      </AccordionSection>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SHARED COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════

interface TabProps {
  data: import('../types').CharacterData;
  updateField: (path: string, value: unknown) => void;
}

function SectionCard({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-5 py-3 border-b border-border bg-muted/30 flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        {action}
      </div>
      <div className="p-5 space-y-4">{children}</div>
    </div>
  );
}

function FieldRow({ label, children, required }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div>
      <label className="settings-label">
        {label} {required && <span className="text-destructive">*</span>}
      </label>
      {children}
    </div>
  );
}

function AccordionSection({ title, open, onToggle, children }: {
  title: string; open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <button onClick={onToggle}
        className="w-full flex items-center justify-between px-5 py-3 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors">
        {title}
        {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
      </button>
      {open && <div className="px-5 pb-5 pt-2 border-t border-border">{children}</div>}
    </div>
  );
}

/** Textarea with live token count */
function TextareaWithTokens({ value, onChange, rows, placeholder }: {
  value: string; onChange: (v: string) => void; rows: number; placeholder?: string;
}) {
  const tokens = estimateTokens(value);
  return (
    <div className="relative">
      <textarea value={value} onChange={e => onChange(e.target.value)}
        rows={rows} className="settings-input resize-y font-mono text-xs leading-relaxed pr-20"
        placeholder={placeholder} />
      {value.length > 0 && (
        <span className="absolute top-2 right-2 text-[10px] text-muted-foreground/60 bg-background/80 px-1.5 py-0.5 rounded pointer-events-none">
          ~{tokens} tokens
        </span>
      )}
    </div>
  );
}

/** Textarea with macro-insert buttons + token count */
function TextareaWithMacros({ value, onChange, rows, placeholder }: {
  value: string; onChange: (v: string) => void; rows: number; placeholder?: string;
}) {
  const tokens = estimateTokens(value);
  const [showMacros, setShowMacros] = useState(false);

  const insertMacro = useCallback((macro: string) => {
    onChange(value + macro);
  }, [value, onChange]);

  return (
    <div className="space-y-2">
      {/* Macro toolbar */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <button onClick={() => setShowMacros(!showMacros)}
          className="text-xs text-muted-foreground hover:text-primary transition-colors flex items-center gap-1">
          <Copy className="w-3 h-3" /> {ui.ceInsertMacro}
          {showMacros ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </button>
        {showMacros && MACROS.map(m => (
          <button key={m} onClick={() => insertMacro(m)}
            className="px-2 py-0.5 rounded bg-primary/10 text-primary text-[11px] font-mono hover:bg-primary/20 transition-colors">
            {m}
          </button>
        ))}
      </div>
      <div className="relative">
        <textarea value={value} onChange={e => onChange(e.target.value)}
          rows={rows} className="settings-input resize-y font-mono text-xs leading-relaxed pr-20"
          placeholder={placeholder} />
        {value.length > 0 && (
          <span className="absolute top-2 right-2 text-[10px] text-muted-foreground/60 bg-background/80 px-1.5 py-0.5 rounded pointer-events-none">
            ~{tokens} tokens
          </span>
        )}
      </div>
    </div>
  );
}
