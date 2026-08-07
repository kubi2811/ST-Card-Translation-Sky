/**
 * MVUZODPage — MVUZOD Studio Multi-Tab Workspace
 * 7-tab workspace with full script generation & game preview:
 * Tab 1: Schema Wizard — Create/edit Zod schema
 * Tab 2: InitVar Editor — Visual initial variable setup
 * Tab 3: Variable List — Auto-generate worldbook entries for AI
 * Tab 4: Update Rules — Configure [mvu_update] entries
 * Tab 5: Patch Simulator — Test JSON Patch operations
 * Tab 6: Script Output — All generated outputs
 * Tab 7: Game Frontend — Preview game UI + generated code
 * Tab 8: Playground — Interactive variable testing
 */

import { useState, useMemo } from 'react';
import {
  Wrench, Wand2, FlaskConical, Database, ListTree,
  FileCode, Gamepad2, Sparkles, TestTube2, MonitorSmartphone,
} from 'lucide-react';
import { useCardStore } from '../store/cardStore';
import { SchemaBuilder } from '../components/mvuzod/SchemaBuilder';
import { PatchPreview } from '../components/mvuzod/PatchPreview';
import { InitVarEditor } from '../components/mvuzod/InitVarEditor';
import { VariableListGenerator } from '../components/mvuzod/VariableListGenerator';
import { UpdateRulesEditor } from '../components/mvuzod/UpdateRulesEditor';
import { ScriptOutput } from '../components/mvuzod/ScriptOutput';
import { GameUiStudio } from '../components/mvuzod/GameUiStudio';
import { FrontendStudio } from '../components/mvuzod/FrontendStudio';
import { VariablePlayground } from '../components/mvuzod/VariablePlayground';
import type { MVUZODSchema, MVUZODStudioTab, InitVarConfig } from '../types/mvuzod.types';
import { t as ui } from '../i18n';

const TABS: Array<{ id: MVUZODStudioTab; label: string; icon: typeof Wand2; description: string }> = [
  { id: 'wizard', label: 'Schema', icon: Wand2, description: ui.mzTabSchemaDesc },
  { id: 'initvar', label: 'InitVar', icon: Database, description: ui.mzTabInitvarDesc },
  { id: 'varlist', label: ui.mzTabVarlist, icon: ListTree, description: ui.mzTabVarlistDesc },
  { id: 'update', label: 'Update', icon: Sparkles, description: ui.mzTabUpdateDesc },
  { id: 'patch', label: 'Patch', icon: FlaskConical, description: 'Test JSON Patch operations' },
  { id: 'script', label: 'Scripts', icon: FileCode, description: ui.mzTabScriptDesc },
  { id: 'game', label: 'Game UI', icon: Gamepad2, description: ui.mzTabGameDesc },
  { id: 'frontend', label: ui.mzTabFrontend, icon: MonitorSmartphone, description: ui.mzTabFrontendDesc },
  { id: 'playground', label: 'Playground', icon: TestTube2, description: ui.mzTabPlaygroundDesc },
];

export function MVUZODPage() {
  const card = useCardStore(s => s.card);
  const [tab, setTab] = useState<MVUZODStudioTab>('wizard');

  // Try to get schema from card extensions
  const existingSchema: MVUZODSchema | null = useMemo(() => {
    const ext = card.data.extensions as unknown as Record<string, unknown>;
    if (ext?.mvuzod) {
      return (ext.mvuzod as Record<string, unknown>).schema as MVUZODSchema ?? null;
    }
    return null;
  }, [card.data.extensions]);

  // initvar đi kèm schema — Game UI phải đồng biến với CẢ HAI (biến chỉ khai trong initvar
  // vẫn là biến hợp lệ; nếu chỉ đối chiếu schema thì báo "bịa" oan).
  const existingInitVar: InitVarConfig | null = useMemo(() => {
    const ext = card.data.extensions as unknown as Record<string, unknown>;
    if (ext?.mvuzod) {
      return (ext.mvuzod as Record<string, unknown>).initVarConfig as InitVarConfig ?? null;
    }
    return null;
  }, [card.data.extensions]);

  const hasSchema = !!existingSchema;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 pt-5 pb-3 shrink-0">
        <div className="p-2.5 rounded-xl bg-gradient-to-br from-violet-500/20 to-purple-500/20 border border-violet-500/10">
          <Wrench className="w-5 h-5 text-violet-400" />
        </div>
        <div className="flex-1">
          <h1 className="text-lg font-semibold flex items-center gap-2">
            MVUZOD Studio
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-500/10 text-violet-400 font-medium">
              v2.0
            </span>
          </h1>
          <p className="text-xs text-muted-foreground">
            Zod schema • JSON Patch • MVU Variables • Game Frontend
          </p>
        </div>
        {hasSchema && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
            <Sparkles className="w-3 h-3 text-emerald-400" />
            <span className="text-[10px] text-emerald-400 font-medium">Schema loaded</span>
          </div>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex gap-0.5 px-6 pb-3 shrink-0 overflow-x-auto scrollbar-none">
        {TABS.map(t => {
          const Icon = t.icon;
          const isActive = tab === t.id;
          const needsSchema = ['initvar', 'varlist', 'update', 'patch', 'script', 'game'].includes(t.id);
          const isDisabled = needsSchema && !hasSchema;

          return (
            <button
              key={t.id}
              onClick={() => !isDisabled && setTab(t.id)}
              disabled={isDisabled}
              title={isDisabled ? ui.mzNeedSchema : t.description}
              className={`group relative flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
                isActive
                  ? 'bg-primary/10 text-primary shadow-sm shadow-primary/5'
                  : isDisabled
                    ? 'text-muted-foreground/30 cursor-not-allowed'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
              {isActive && (
                <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-6 h-0.5 rounded-full bg-primary" />
              )}
            </button>
          );
        })}
      </div>

      {/* Divider */}
      <div className="h-px bg-border shrink-0" />

      {/* Content — all tabs stay mounted, only visibility toggles via CSS */}
      <div className="flex-1 overflow-hidden" style={{ display: tab === 'wizard' ? 'flex' : 'none' }}>
        <SchemaBuilder />
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin" style={{ display: tab === 'initvar' ? undefined : 'none' }}>
        <div className="max-w-5xl mx-auto px-6 py-5">
          <InitVarEditor schema={existingSchema} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin" style={{ display: tab === 'varlist' ? undefined : 'none' }}>
        <div className="max-w-5xl mx-auto px-6 py-5">
          <VariableListGenerator schema={existingSchema} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin" style={{ display: tab === 'update' ? undefined : 'none' }}>
        <div className="max-w-5xl mx-auto px-6 py-5">
          <UpdateRulesEditor schema={existingSchema} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin" style={{ display: tab === 'patch' ? undefined : 'none' }}>
        <div className="max-w-5xl mx-auto px-6 py-5">
          <PatchPreview schema={existingSchema} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin" style={{ display: tab === 'script' ? undefined : 'none' }}>
        <div className="max-w-5xl mx-auto px-6 py-5">
          <ScriptOutput schema={existingSchema} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin" style={{ display: tab === 'game' ? undefined : 'none' }}>
        <div className="max-w-6xl mx-auto px-6 py-5">
          <GameUiStudio schema={existingSchema} initVarConfig={existingInitVar} />
        </div>
      </div>

      <div className="flex-1 overflow-hidden" style={{ display: tab === 'frontend' ? undefined : 'none' }}>
        <FrontendStudio schema={existingSchema} initVarConfig={existingInitVar} />
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin" style={{ display: tab === 'playground' ? undefined : 'none' }}>
        <div className="max-w-5xl mx-auto px-6 py-5">
          <VariablePlayground schema={existingSchema} />
        </div>
      </div>
    </div>
  );
}

// Old inline ScriptPreviewTab and GameFrontendTab have been replaced
// by dedicated components: ScriptOutput and GameFrontendPreview
