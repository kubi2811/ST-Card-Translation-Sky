/* eslint-disable react-hooks/set-state-in-effect */
/**
 * VariableListGenerator — Auto-generate worldbook entries for variable display & injection
 * References: MVU_ZOD指南.md "第五步：编写变量提示词" + EJS实战指南 "用 getvar 获取变量"
 */

import { useState, useCallback, useEffect } from 'react';
import {
  ListTree, Copy, FileCode, Zap,
  ChevronDown, ChevronRight, Check, Settings2,
  Wand2, Loader2,
} from 'lucide-react';
import { useToastStore } from '../../store/toastStore';
import type { MVUZODSchema, MVUZODField, GeneratedVariableEntry } from '../../types/mvuzod.types';
import type { ChatMessage } from '../../types';
import { useCardStore } from '../../store/cardStore';
import { useSettingsStore } from '../../store/settingsStore';
import { callAI } from '../../lib/ai/client';
import { MVUZOD_VARLIST_PROMPT, MVUZOD_SIMPLE_UPDATE_RULES_PROMPT } from '../../prompts/modeMVUZOD';
import { copyWithToast } from '../../lib/copyToClipboard';   // (bug 224) copy chạy được cả trong iframe của Hub

// ─── Template Presets ────────────────────────────────────────────────────

const TEMPLATE_PRESETS = [
  {
    id: 'ejs-getvar',
    label: 'EJS getvar() — Chuẩn',
    description: 'Dùng getvar() để đọc biến, gửi dưới dạng text cho AI',
    displayTemplate: (field: MVUZODField) =>
      `<%= getvar('${field.path.replace(/\//g, '.')}') %>`,
    injectionTemplate: (field: MVUZODField) =>
      `${field.label}: <%= getvar('${field.path.replace(/\//g, '.')}') %>`,
  },
  {
    id: 'ejs-mvu',
    label: 'EJS getMvuData() — MVU Native',
    description: 'Dùng Mvu.getMvuData() trực tiếp, cần MVU ZOD framework',
    displayTemplate: (field: MVUZODField) => {
      const parts = field.path.split('/').filter(Boolean);
      return `<%= Mvu.getMvuData({type:'message',message_id:'latest'}).stat_data${parts.map(p => `['${p}']`).join('')} %>`;
    },
    injectionTemplate: (field: MVUZODField) => {
      const parts = field.path.split('/').filter(Boolean);
      return `${field.label}: <%= Mvu.getMvuData({type:'message',message_id:'latest'}).stat_data${parts.map(p => `['${p}']`).join('')} %>`;
    },
  },
  {
    id: 'macro',
    label: 'SillyTavern Macro',
    description: 'Dùng macro {{format_message_variable::X}} tiêu chuẩn',
    displayTemplate: (field: MVUZODField) =>
      `{{format_message_variable::${field.path.split('/').filter(Boolean).join('.')}}}`,
    injectionTemplate: (field: MVUZODField) =>
      `${field.label}: {{format_message_variable::${field.path.split('/').filter(Boolean).join('.')}}}`,
  },
];

// ─── Entry Generator Functions ──────────────────────────────────────────

function generateVariableListEntry(
  schema: MVUZODSchema,
  visiblePaths: Set<string>,
  presetId: string,
  charName: string,
): GeneratedVariableEntry {
  const preset = TEMPLATE_PRESETS.find(p => p.id === presetId) ?? TEMPLATE_PRESETS[0];
  const lines: string[] = [];
  lines.push(`[Biến số hiện tại của ${charName}]`);
  lines.push('');

  function processFields(fields: MVUZODField[], depth = 0) {
    for (const field of fields) {
      if (!visiblePaths.has(field.path)) continue;
      const indent = '  '.repeat(depth);

      if (field.children?.length) {
        lines.push(`${indent}【${field.label}】`);
        processFields(field.children, depth + 1);
      } else {
        lines.push(`${indent}${preset.injectionTemplate(field)}`);
      }
    }
  }

  processFields(schema.fields);

  return {
    comment: `[VariableList] Biến số - ${charName}`,
    content: lines.join('\n'),
    keys: [charName, 'biến số', 'variable', 'trạng thái'],
    position: 'before_char',
    order: 900,
    constant: true,
    description: 'Auto-generated variable display entry. Hiển thị giá trị biến hiện tại cho AI đọc.',
  };
}

function generateUpdateRulesEntry(
  schema: MVUZODSchema,
  charName: string,
): GeneratedVariableEntry {
  const paths = flattenPaths(schema.fields).filter(f => !f.constraints?.readOnly && !f.constraints?.hidden);
  const samplePaths = paths.slice(0, 3);

  const content = `[Quy tắc cập nhật biến số]
Khi viết phản hồi, nếu có bất kỳ thay đổi nào về trạng thái game, HÃY cập nhật biến bằng khối <UpdateVariable>.

Các biến có thể cập nhật:
${paths.map(f => `- ${f.path}: ${f.label} (${f.type}${f.constraints?.min !== undefined ? `, min: ${f.constraints?.min}` : ''}${f.constraints?.max !== undefined ? `, max: ${f.constraints?.max}` : ''})`).join('\n')}

Quy tắc:
1. Chỉ cập nhật biến đã thay đổi thực sự
2. Dùng "delta" cho thay đổi tương đối (cộng/trừ), "replace" cho thay đổi tuyệt đối
3. KHÔNG tự ý thêm biến mới ngoài danh sách trên
4. Đặt khối <UpdateVariable> ở CUỐI phản hồi

Ví dụ:
<UpdateVariable>
[
  ${samplePaths.map((f, i) => {
    if (f.type === 'number') return `{"op":"delta","path":"${f.path}","value":${i === 0 ? 10 : -5}}`;
    if (f.type === 'string') return `{"op":"replace","path":"${f.path}","value":"giá trị mới"}`;
    return `{"op":"replace","path":"${f.path}","value":${JSON.stringify(f.defaultValue)}}`;
  }).join(',\n  ')}
]
</UpdateVariable>`;

  return {
    comment: `[mvu_update] Quy tắc cập nhật biến - ${charName}`,
    content,
    keys: ['UpdateVariable', 'cập nhật biến'],
    position: 'at_depth_system',
    order: 850,
    constant: true,
    description: 'Hướng dẫn AI cách cập nhật biến game qua JSON Patch.',
  };
}

function flattenPaths(fields: MVUZODField[]): MVUZODField[] {
  const result: MVUZODField[] = [];
  for (const field of fields) {
    if (field.children?.length) {
      result.push(...flattenPaths(field.children));
    } else {
      result.push(field);
    }
  }
  return result;
}

// ─── Main Component ─────────────────────────────────────────────────────

export function VariableListGenerator({ schema }: { schema: MVUZODSchema | null }) {
  const card = useCardStore(s => s.card);
  const addEntry = useCardStore(s => s.addEntry);
  const getNextEntryId = useCardStore(s => s.getNextEntryId);

  const [selectedPreset, setSelectedPreset] = useState('ejs-getvar');
  const [showSettings, setShowSettings] = useState(false);
  const [visiblePaths, setVisiblePaths] = useState<Set<string>>(new Set());
  const [generated, setGenerated] = useState<{ varList: GeneratedVariableEntry | null; updateRules: GeneratedVariableEntry | null }>({
    varList: null,
    updateRules: null,
  });
  const [addedToCard, setAddedToCard] = useState<Set<string>>(new Set());
  const [isGeneratingVarList, setIsGeneratingVarList] = useState(false);
  const [isGeneratingRules, setIsGeneratingRules] = useState(false);

  // Initialize visible paths from schema
  useEffect(() => {
    if (!schema) return;
    const allPaths = new Set<string>();
    function collectPaths(fields: MVUZODField[]) {
      for (const f of fields) {
        allPaths.add(f.path);
        if (f.children?.length) collectPaths(f.children);
      }
    }
    collectPaths(schema.fields);
    setVisiblePaths(allPaths);
  }, [schema]);

  const handleGenerateVarListAI = useCallback(async () => {
    if (!schema) return;
    setIsGeneratingVarList(true);
    try {
      const activeProfile = useSettingsStore.getState().getActiveProfile();
      const params = useSettingsStore.getState().generationParams;
      if (!activeProfile?.apiKey) throw new Error('Chưa cấu hình API AI.');

      const baseVarList = generateVariableListEntry(schema, visiblePaths, selectedPreset, card.data.name || 'Character');

      const contextInfo = `Character: ${card.data.name}\nDescription: ${card.data.description.slice(0, 1000)}\n\nSchema:\n${JSON.stringify(schema, null, 2)}`;
      
      const messages: ChatMessage[] = [
        { role: 'system', content: MVUZOD_VARLIST_PROMPT },
        { role: 'user', content: `=== CONTEXT ===\n${contextInfo}\n\n=== MACRO LIST ===\n${baseVarList.content}\n\nHãy thiết kế lại bảng trạng thái.` },
      ];

      const response = await callAI({
        profile: activeProfile,
        params,
        messages,
      });

      setGenerated(prev => ({ ...prev, varList: { ...baseVarList, content: response.text.trim() } }));
    } catch (error) {
      useToastStore.getState().error(error instanceof Error ? error.message : 'Lỗi khi gọi AI');
    } finally {
      setIsGeneratingVarList(false);
    }
  }, [schema, visiblePaths, selectedPreset, card.data]);

  const handleGenerateUpdateRulesAI = useCallback(async () => {
    if (!schema) return;
    setIsGeneratingRules(true);
    try {
      const activeProfile = useSettingsStore.getState().getActiveProfile();
      const params = useSettingsStore.getState().generationParams;
      if (!activeProfile?.apiKey) throw new Error('Chưa cấu hình API AI.');

      const baseUpdateRules = generateUpdateRulesEntry(schema, card.data.name || 'Character');

      const contextInfo = `Character: ${card.data.name}\nDescription: ${card.data.description.slice(0, 1000)}\n\nSchema:\n${JSON.stringify(schema, null, 2)}`;
      
      const messages: ChatMessage[] = [
        { role: 'system', content: MVUZOD_SIMPLE_UPDATE_RULES_PROMPT },
        { role: 'user', content: `=== CONTEXT ===\n${contextInfo}\n\nHãy viết Quy Tắc Cập Nhật Biến Số bằng tiếng Việt.` },
      ];

      const response = await callAI({
        profile: activeProfile,
        params,
        messages,
      });

      setGenerated(prev => ({ ...prev, updateRules: { ...baseUpdateRules, content: response.text.trim() } }));
    } catch (error) {
      useToastStore.getState().error(error instanceof Error ? error.message : 'Lỗi khi gọi AI');
    } finally {
      setIsGeneratingRules(false);
    }
  }, [schema, card.data]);

  const handleAddToCard = useCallback((type: 'varList' | 'updateRules') => {
    const entry = generated[type];
    if (!entry) return;
    const id = getNextEntryId();
    addEntry({
      id,
      keys: entry.keys,
      secondary_keys: [],
      comment: entry.comment,
      content: entry.content,
      constant: entry.constant,
      selective: false,
      insertion_order: entry.order,
      enabled: true,
      position: 'before_char',
      use_regex: false,
      extensions: {
        position: 0,
        exclude_recursion: false,
        display_index: 0,
        probability: 100,
        useProbability: true,
        depth: 0,
        selectiveLogic: 0,
        outlet_name: '',
        group: '',
        group_override: false,
        group_weight: 100,
        prevent_recursion: true,
        delay_until_recursion: false,
        scan_depth: 0,
        match_whole_words: false,
        use_group_scoring: false,
        case_sensitive: false,
        automation_id: '',
        role: null,
        vectorized: false,
        sticky: 0,
        cooldown: 0,
        delay: 0,
        match_persona_description: false,
        match_character_description: false,
        match_character_personality: false,
        match_character_depth_prompt: false,
        match_scenario: false,
        match_creator_notes: false,
        triggers: [],
        ignore_budget: false,
      },
    });
    setAddedToCard(prev => new Set([...prev, type]));
  }, [generated, addEntry, getNextEntryId]);

  const togglePath = useCallback((path: string) => {
    setVisiblePaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  if (!schema) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center space-y-3">
        <ListTree className="w-8 h-8 mx-auto text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">Cần tạo Schema trước.</p>
        <p className="text-xs text-muted-foreground/60">Quay lại tab "Schema Wizard" để tạo hoặc chọn template.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Info */}
      <div className="rounded-lg bg-violet-500/5 border border-violet-500/20 p-3">
        <p className="text-xs text-violet-400">
          <strong>Variable List Generator</strong> tạo tự động các worldbook entry để AI đọc và cập nhật biến game.
          Tạo 2 entry: (1) danh sách biến hiện tại, (2) quy tắc cập nhật biến.
        </p>
      </div>

      {/* Template preset selector */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold flex items-center gap-1.5">
            <FileCode className="w-3.5 h-3.5 text-primary" />
            Template format
          </h4>
          <button onClick={() => setShowSettings(!showSettings)}
            className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors">
            <Settings2 className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {TEMPLATE_PRESETS.map(preset => (
            <button key={preset.id}
              onClick={() => setSelectedPreset(preset.id)}
              className={`text-left p-3 rounded-lg border transition-all ${
                selectedPreset === preset.id
                  ? 'border-primary/40 bg-primary/5'
                  : 'border-border hover:border-primary/20'
              }`}>
              <div className="text-xs font-medium">{preset.label}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">{preset.description}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Path visibility toggle */}
      {showSettings && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-2">
          <h4 className="text-xs font-semibold">Chọn biến hiển thị cho AI</h4>
          <PathToggleTree fields={schema.fields} visiblePaths={visiblePaths} onToggle={togglePath} depth={0} />
        </div>
      )}

      {/* Generate Buttons Section */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Variable List Actions */}
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <h4 className="text-sm font-semibold flex items-center gap-2">
            <ListTree className="w-4 h-4 text-primary" />
            1. Danh sách biến
          </h4>
          <p className="text-xs text-muted-foreground">Tạo bảng trạng thái hiển thị bằng EJS/Macro.</p>
          <div className="flex gap-2">
            <button onClick={handleGenerateVarListAI} disabled={isGeneratingVarList}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-gradient-to-r from-violet-500/80 to-primary/80 text-white text-xs font-medium hover:from-violet-500 hover:to-primary transition-all disabled:opacity-50">
              {isGeneratingVarList ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
              Tạo bằng AI
            </button>
            <button onClick={() => {
              if (!schema) return;
              const varList = generateVariableListEntry(schema, visiblePaths, selectedPreset, card.data.name || 'Character');
              setGenerated(prev => ({ ...prev, varList }));
            }}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-muted text-foreground text-xs font-medium hover:bg-muted/80 transition-all">
              <Zap className="w-3.5 h-3.5" />
              Tạo tự động
            </button>
          </div>
        </div>

        {/* Update Rules Actions */}
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <h4 className="text-sm font-semibold flex items-center gap-2">
            <Settings2 className="w-4 h-4 text-primary" />
            2. Quy tắc cập nhật
          </h4>
          <p className="text-xs text-muted-foreground">Tạo hướng dẫn cập nhật biến bằng tiếng Việt.</p>
          <div className="flex gap-2">
            <button onClick={handleGenerateUpdateRulesAI} disabled={isGeneratingRules}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-gradient-to-r from-violet-500/80 to-primary/80 text-white text-xs font-medium hover:from-violet-500 hover:to-primary transition-all disabled:opacity-50">
              {isGeneratingRules ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
              Tạo bằng AI
            </button>
            <button onClick={() => {
              if (!schema) return;
              const updateRules = generateUpdateRulesEntry(schema, card.data.name || 'Character');
              setGenerated(prev => ({ ...prev, updateRules }));
            }}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-muted text-foreground text-xs font-medium hover:bg-muted/80 transition-all">
              <Zap className="w-3.5 h-3.5" />
              Tạo tự động
            </button>
          </div>
        </div>
      </div>

      {/* Generated entries preview */}
      {generated.varList && (
        <GeneratedEntryPreview
          title="📋 Entry: Danh sách biến"
          entry={generated.varList}
          onAddToCard={() => handleAddToCard('varList')}
          added={addedToCard.has('varList')}
        />
      )}
      {generated.updateRules && (
        <GeneratedEntryPreview
          title="⚙️ Entry: Quy tắc cập nhật"
          entry={generated.updateRules}
          onAddToCard={() => handleAddToCard('updateRules')}
          added={addedToCard.has('updateRules')}
        />
      )}
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────

function PathToggleTree({ fields, visiblePaths, onToggle, depth }: {
  fields: MVUZODField[];
  visiblePaths: Set<string>;
  onToggle: (path: string) => void;
  depth: number;
}) {
  return (
    <div className={`space-y-0.5 ${depth > 0 ? 'ml-4 pl-2 border-l border-border/30' : ''}`}>
      {fields.map(field => (
        <div key={field.path}>
          <label className="flex items-center gap-2 py-0.5 cursor-pointer group">
            <input
              type="checkbox"
              checked={visiblePaths.has(field.path)}
              onChange={() => onToggle(field.path)}
              className="rounded border-border text-primary focus:ring-primary/30 w-3 h-3"
            />
            <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">
              {field.label || field.path}
            </span>
            <span className="text-[9px] text-muted-foreground/40">{field.type}</span>
          </label>
          {field.children?.length && (
            <PathToggleTree fields={field.children} visiblePaths={visiblePaths} onToggle={onToggle} depth={depth + 1} />
          )}
        </div>
      ))}
    </div>
  );
}

function GeneratedEntryPreview({ title, entry, onAddToCard, added }: {
  title: string;
  entry: GeneratedVariableEntry;
  onAddToCard: () => void;
  added: boolean;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-muted/20">
        <button onClick={() => setExpanded(!expanded)} className="flex items-center gap-2 text-xs font-semibold">
          {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          {title}
        </button>
        <div className="flex gap-1.5">
          <button
            onClick={() => void copyWithToast(entry.content, 'nội dung entry', useToastStore.getState())}
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] bg-muted hover:bg-muted/80 transition-colors">
            <Copy className="w-3 h-3" /> Copy
          </button>
          <button
            onClick={onAddToCard}
            disabled={added}
            className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] transition-colors ${
              added
                ? 'bg-emerald-500/20 text-emerald-400 cursor-default'
                : 'bg-primary text-primary-foreground hover:bg-primary/90'
            }`}>
            {added ? <><Check className="w-3 h-3" /> Đã thêm</> : 'Thêm vào Card'}
          </button>
        </div>
      </div>
      {expanded && (
        <div className="px-4 py-3 space-y-2">
          <div className="flex gap-4 text-[10px] text-muted-foreground">
            <span>Comment: <code className="text-primary">{entry.comment}</code></span>
            <span>Position: <code>{entry.position}</code></span>
            <span>Order: <code>{entry.order}</code></span>
            <span>{entry.constant ? '🔵 Constant' : '🟢 Selective'}</span>
          </div>
          <pre className="text-[10px] font-mono text-muted-foreground bg-muted/20 rounded-lg p-3 overflow-x-auto max-h-48 leading-relaxed whitespace-pre-wrap">
            {entry.content}
          </pre>
        </div>
      )}
    </div>
  );
}

