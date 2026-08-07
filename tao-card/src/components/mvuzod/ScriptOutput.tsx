/**
 * ScriptOutput — Multi-panel output view for all generated MVUZOD artifacts
 * Displays: Schema Script, InitVar YAML, Variable List, Update Rules, Output Format, Regex
 * Each panel has copy-to-clipboard and description.
 */

import { useState, useMemo, useCallback } from 'react';
import {
  FileCode, Database, ListTree, Sparkles, Shield,
  Copy, Check, ChevronDown, ChevronRight, Eye, EyeOff,
  Download, AlertTriangle,
} from 'lucide-react';
import type { MVUZODSchema, InitVarEntry } from '../../types/mvuzod.types';
import {
  generateAllOutputs,
  type AllGeneratedOutputs,
  type GeneratedRegex,
} from '../../lib/mvuzod/scriptGenerator';
import { copyWithToast } from '../../lib/copyToClipboard';   // (bug 224) copy chạy được cả trong iframe của Hub
import { useToastStore } from '../../store/toastStore';

// ─── Output Panel Types ──────────────────────────────────────────────────

interface OutputPanel {
  id: string;
  label: string;
  icon: typeof FileCode;
  description: string;
  worldbookInfo?: {
    entryName: string;
    position: string;
    order: number;
    constant: boolean;
    notes: string;
  };
  color: string;
}

const PANELS: OutputPanel[] = [
  {
    id: 'schema',
    label: 'Schema Script',
    icon: FileCode,
    description: 'Kịch bản cấu trúc biến — Đăng ký Zod schema cho MVU framework',
    worldbookInfo: undefined, // This goes to Tavern Helper Scripts, not worldbook
    color: 'violet',
  },
  {
    id: 'initvar',
    label: 'InitVar YAML',
    icon: Database,
    description: '[initvar] — Giá trị biến khởi tạo (worldbook entry, phải TẮT)',
    worldbookInfo: {
      entryName: '[initvar] Khởi tạo biến - đừng mở',
      position: 'Bất kỳ (entry phải ở trạng thái TẮT)',
      order: 0,
      constant: false,
      notes: 'MVU chỉ đọc initvar entry khi entry đang bị TẮT (disabled). KHÔNG bật entry này.',
    },
    color: 'emerald',
  },
  {
    id: 'varlist',
    label: 'Biến số (Variable List)',
    icon: ListTree,
    description: 'Danh sách biến — Hiển thị biến hiện tại cho AI đọc',
    worldbookInfo: {
      entryName: 'Danh sách biến',
      position: 'D0 hoặc D1 (at_depth_system)',
      order: 200,
      constant: true,
      notes: 'Đặt tại D0/D1 để AI luôn thấy giá trị biến mới nhất. KHÔNG thêm [mvu_update] prefix.',
    },
    color: 'blue',
  },
  {
    id: 'update_rules',
    label: 'Update Rules',
    icon: Sparkles,
    description: '[mvu_update] — Quy tắc hướng dẫn AI cập nhật biến',
    worldbookInfo: {
      entryName: '[mvu_update] Quy tắc cập nhật biến',
      position: 'Bất kỳ (khuyến nghị before_char hoặc after_char)',
      order: 100,
      constant: true,
      notes: 'Tiền tố [mvu_update] bắt buộc. Entry này hướng dẫn AI khi nào/cách nào update biến.',
    },
    color: 'amber',
  },
  {
    id: 'output_format',
    label: 'Output Format',
    icon: FileCode,
    description: '[mvu_update] — Định dạng JSON Patch cho AI xuất biến',
    worldbookInfo: {
      entryName: '[mvu_update] Định dạng đầu ra biến',
      position: 'Bất kỳ',
      order: 101,
      constant: true,
      notes: 'Tiền tố [mvu_update] bắt buộc. Cho AI biết format xuất biến (JSON Patch trong <UpdateVariable>).',
    },
    color: 'orange',
  },
  {
    id: 'regex',
    label: 'Regex Patterns',
    icon: Shield,
    description: 'Regex ẩn <UpdateVariable> khỏi hiển thị chat',
    worldbookInfo: undefined,
    color: 'rose',
  },
];

// ─── Main Component ──────────────────────────────────────────────────────

interface ScriptOutputProps {
  schema: MVUZODSchema | null;
  initVarValues?: Record<string, unknown>;
  initVarEntries?: InitVarEntry[];
}

export function ScriptOutput({ schema, initVarValues }: ScriptOutputProps) {
  const [activePanel, setActivePanel] = useState('schema');
  const [varListMode, setVarListMode] = useState<'full' | 'selective'>('full');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const outputs = useMemo<AllGeneratedOutputs | null>(() => {
    if (!schema) return null;
    return generateAllOutputs(schema, initVarValues, varListMode);
  }, [schema, initVarValues, varListMode]);

  // (bug 224) Đường lùi execCommand đã nằm trong copyToClipboard — ở đây chỉ cần đổi nhãn nút.
  const handleCopy = useCallback(async (text: string, id: string) => {
    if (!(await copyWithToast(text, 'nội dung', useToastStore.getState()))) return;
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  const handleDownloadAll = useCallback(() => {
    if (!outputs) return;
    const allContent = [
      '// ═══ 1. Schema Script (paste vào Tavern Helper → Kịch bản) ═══',
      outputs.schemaScript,
      '',
      '// ═══ 2. InitVar YAML (worldbook entry, trạng thái TẮT) ═══',
      outputs.initVarYAML,
      '',
      '// ═══ 3. Variable List (worldbook entry, D0/D1) ═══',
      outputs.variableListEntry,
      '',
      '// ═══ 4. Update Rules (worldbook entry, [mvu_update]) ═══',
      outputs.updateRulesEntry,
      '',
      '// ═══ 5. Output Format (worldbook entry, [mvu_update]) ═══',
      outputs.outputFormatEntry,
      '',
      '// ═══ 6. Emphasis (worldbook entry, D0, [mvu_update]) ═══',
      outputs.emphasisEntry,
    ].join('\n');

    const blob = new Blob([allContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mvuzod_outputs.txt';
    a.click();
    URL.revokeObjectURL(url);
  }, [outputs]);

  if (!schema || !outputs) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <AlertTriangle className="w-8 h-8 mb-3 opacity-40" />
        <p className="text-sm">Cần tạo Schema trước khi xem output</p>
        <p className="text-xs mt-1 opacity-60">Vào tab Schema Wizard để bắt đầu</p>
      </div>
    );
  }

  const currentPanel = PANELS.find(p => p.id === activePanel) ?? PANELS[0];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <FileCode className="w-4 h-4 text-primary" />
            Script & Entry Output
          </h3>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {schema.fields.length} top-level fields → {PANELS.length} outputs
          </p>
        </div>
        <button
          onClick={handleDownloadAll}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
        >
          <Download className="w-3.5 h-3.5" />
          Tải tất cả
        </button>
      </div>

      {/* Panel selector */}
      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
        {PANELS.map(panel => {
          const Icon = panel.icon;
          const isActive = activePanel === panel.id;
          return (
            <button
              key={panel.id}
              onClick={() => setActivePanel(panel.id)}
              className={`flex flex-col items-center gap-1 px-2 py-2 rounded-lg border transition-all text-center ${
                isActive
                  ? `border-${panel.color}-500/30 bg-${panel.color}-500/5 shadow-sm`
                  : 'border-border/50 hover:border-border hover:bg-muted/30'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-primary' : 'text-muted-foreground'}`} />
              <span className={`text-[10px] font-medium leading-tight ${isActive ? 'text-foreground' : 'text-muted-foreground'}`}>
                {panel.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Active panel content */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {/* Panel header */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-muted/20 border-b border-border">
          <div className="flex items-center gap-2">
            <currentPanel.icon className="w-4 h-4 text-primary" />
            <div>
              <span className="text-xs font-medium">{currentPanel.label}</span>
              <p className="text-[10px] text-muted-foreground">{currentPanel.description}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {activePanel === 'varlist' && (
              <button
                onClick={() => setVarListMode(m => m === 'full' ? 'selective' : 'full')}
                className="flex items-center gap-1 px-2 py-1 rounded text-[10px] border border-border hover:bg-muted/50 transition-colors"
              >
                {varListMode === 'full' ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                {varListMode === 'full' ? 'Full' : 'Selective'}
              </button>
            )}
            {activePanel !== 'regex' && (
              <button
                onClick={() => handleCopy(getContentForPanel(activePanel, outputs), activePanel)}
                className={`flex items-center gap-1 px-2.5 py-1 rounded text-[10px] font-medium transition-colors ${
                  copiedId === activePanel
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : 'bg-primary text-primary-foreground hover:bg-primary/90'
                }`}
              >
                {copiedId === activePanel ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                {copiedId === activePanel ? 'Đã copy!' : 'Copy'}
              </button>
            )}
          </div>
        </div>

        {/* Worldbook info bar (if applicable) */}
        {currentPanel.worldbookInfo && (
          <WorldbookInfoBar info={currentPanel.worldbookInfo} />
        )}

        {/* Content */}
        <div className="p-0">
          {activePanel === 'regex' ? (
            <RegexPatternsView patterns={outputs.regexPatterns} onCopy={handleCopy} copiedId={copiedId} />
          ) : (
            <pre className="p-4 text-xs font-mono text-foreground/80 overflow-x-auto max-h-[500px] overflow-y-auto leading-relaxed whitespace-pre-wrap">
              {getContentForPanel(activePanel, outputs)}
            </pre>
          )}
        </div>
      </div>

      {/* Usage guide */}
      <UsageGuide activePanel={activePanel} />
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────

function WorldbookInfoBar({ info }: { info: NonNullable<OutputPanel['worldbookInfo']> }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="px-4 py-2 bg-amber-500/5 border-b border-amber-500/10">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 w-full text-left"
      >
        {expanded ? <ChevronDown className="w-3 h-3 text-amber-400" /> : <ChevronRight className="w-3 h-3 text-amber-400" />}
        <span className="text-[10px] text-amber-400 font-medium">
          📋 Worldbook Entry: {info.entryName}
        </span>
      </button>
      {expanded && (
        <div className="mt-2 ml-4.5 space-y-1 text-[10px] text-muted-foreground">
          <div><strong>Vị trí:</strong> {info.position}</div>
          <div><strong>Order:</strong> {info.order}</div>
          <div><strong>Constant:</strong> {info.constant ? '✅ BẬT (luôn active)' : '⬛ TẮT (disabled)'}</div>
          <div className="text-amber-400/80 mt-1">💡 {info.notes}</div>
        </div>
      )}
    </div>
  );
}

function RegexPatternsView({
  patterns,
  onCopy,
  copiedId,
}: {
  patterns: GeneratedRegex[];
  onCopy: (text: string, id: string) => void;
  copiedId: string | null;
}) {
  return (
    <div className="divide-y divide-border">
      {patterns.map((pattern, i) => (
        <div key={i} className="p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs font-medium">{pattern.name}</span>
              <p className="text-[10px] text-muted-foreground">{pattern.description}</p>
            </div>
            <button
              onClick={() => onCopy(pattern.findRegex, `regex-${i}`)}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] transition-colors ${
                copiedId === `regex-${i}`
                  ? 'bg-emerald-500/20 text-emerald-400'
                  : 'bg-muted hover:bg-muted/80 text-muted-foreground'
              }`}
            >
              {copiedId === `regex-${i}` ? <Check className="w-2.5 h-2.5" /> : <Copy className="w-2.5 h-2.5" />}
              Copy regex
            </button>
          </div>
          <div className="flex gap-2 text-[10px]">
            <div className="flex-1">
              <div className="text-muted-foreground mb-0.5">Find:</div>
              <code className="block p-2 rounded bg-muted/30 font-mono break-all">{pattern.findRegex}</code>
            </div>
            <div className="flex-1">
              <div className="text-muted-foreground mb-0.5">Replace:</div>
              <code className="block p-2 rounded bg-muted/30 font-mono">
                {pattern.replaceString || <span className="text-muted-foreground italic">(trống — xóa match)</span>}
              </code>
            </div>
          </div>
          <div className="text-[10px] text-muted-foreground">
            Scope: <span className="font-medium">{pattern.scope === 'ai_output' ? 'AI Output' : pattern.scope === 'user_input' ? 'User Input' : 'Cả hai'}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function UsageGuide({ activePanel }: { activePanel: string }) {
  const guides: Record<string, { title: string; steps: string[] }> = {
    schema: {
      title: '📌 Hướng dẫn: Schema Script',
      steps: [
        'Mở SillyTavern → Tavern Helper → Kịch bản (Scripts) → Tạo script mới "Cấu trúc biến"',
        'Paste code trên vào nội dung script',
        'z (Zod 4) và _ (Lodash) đã có sẵn toàn cục — KHÔNG import chúng',
        'Script tự đăng ký schema khi card load vào chat mới',
      ],
    },
    initvar: {
      title: '📌 Hướng dẫn: InitVar',
      steps: [
        'Tạo worldbook entry mới với tên "[initvar] Khởi tạo biến - đừng mở"',
        'Paste YAML content trên vào nội dung entry',
        'QUAN TRỌNG: Entry phải ở trạng thái TẮT (disabled) — MVU chỉ đọc initvar khi TẮT',
        'Nếu dùng nhiều opening, đặt <initvar>...</initvar> block trực tiếp trong mỗi opening message',
      ],
    },
    varlist: {
      title: '📌 Hướng dẫn: Variable List',
      steps: [
        'Tạo worldbook entry "Danh sách biến" (KHÔNG thêm [mvu_update] prefix)',
        'Paste content trên vào → Entry luôn BẬT (constant)',
        'Đặt vị trí: D0 hoặc D1 (at_depth_system) | Order: 200',
        'Macro {{format_message_variable::stat_data}} tự thay bằng giá trị biến hiện tại',
      ],
    },
    update_rules: {
      title: '📌 Hướng dẫn: Update Rules',
      steps: [
        'Tạo worldbook entry "[mvu_update] Quy tắc cập nhật biến"',
        'Tiền tố [mvu_update] BẮT BUỘC — MVU dùng nó để nhận diện',
        'Entry luôn BẬT (constant) | Order: 100',
        'Tùy chỉnh "check" rules để hướng dẫn AI cập nhật biến chính xác hơn',
      ],
    },
    output_format: {
      title: '📌 Hướng dẫn: Output Format',
      steps: [
        'Tạo worldbook entry "[mvu_update] Định dạng đầu ra biến"',
        'Tiền tố [mvu_update] BẮT BUỘC',
        'Entry luôn BẬT (constant) | Order: 101',
        'Nên tạo thêm entry nhấn mạnh (emphasis) tại D0 để đảm bảo AI không quên output biến',
      ],
    },
    regex: {
      title: '📌 Hướng dẫn: Regex Patterns',
      steps: [
        'Mở SillyTavern → Settings → Regex Scripts',
        'Tạo từng regex pattern theo danh sách trên',
        'Scope "AI Output" = áp dụng cho phản hồi AI',
        'Regex ẩn block <UpdateVariable> giúp chat hiển thị sạch hơn',
      ],
    },
  };

  const guide = guides[activePanel];
  if (!guide) return null;

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-2">
      <h4 className="text-xs font-semibold">{guide.title}</h4>
      <ol className="text-[11px] text-muted-foreground space-y-1.5 list-decimal list-inside">
        {guide.steps.map((step, i) => (
          <li key={i} dangerouslySetInnerHTML={{ __html: step.replace(/KHÔNG|BẮT BUỘC|QUAN TRỌNG|TẮT/g, '<strong class="text-amber-400">$&</strong>') }} />
        ))}
      </ol>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function getContentForPanel(panelId: string, outputs: AllGeneratedOutputs): string {
  switch (panelId) {
    case 'schema': return outputs.schemaScript;
    case 'initvar': return outputs.initVarYAML;
    case 'varlist': return outputs.variableListEntry;
    case 'update_rules': return outputs.updateRulesEntry;
    case 'output_format': return outputs.outputFormatEntry;
    default: return '';
  }
}

