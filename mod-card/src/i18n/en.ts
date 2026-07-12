/**
 * mod-card/src/i18n/en.ts — English. NGUỒN của kiểu `ModUiKeys`.
 * vi.ts / zh.ts phải có ĐÚNG cùng tập key (TypeScript ép) — thiếu là lỗi biên dịch.
 *
 * ⚠️ TUYỆT ĐỐI KHÔNG đưa vào đây (đã rà, đều là "chuỗi logic/prompt", dịch là hỏng):
 *   - lib/prompts.ts (prompt AI)
 *   - `value="nhẹ|vừa|sâu"` của Mức đào sâu → lưu localStorage + gửi vào prompt (opts.intensity)
 *   - `new DOMException('Người dùng đã dừng')` → bị so bằng regex /đã dừng|aborted/i
 *   - `name: 'Yêu cầu tùy chỉnh của người dùng'` → tên rule nhồi vào prompt (formatRules)
 *   - `[Đã sửa ...]` trong currentContext → context gửi cho AI
 */
const en = {
  // Header
  appSubtitle: 'Safely auto-edit Character Card V3 with an LLM',
  settingsBtn: '⚙️ LLM Settings',

  // Cột trái — tệp
  fileSection: 'Character File',
  fileLoadedPrefix: '✅ Loaded:',
  fileUnnamed: 'Unnamed',
  fileLorebookMode: '📖 LOREBOOK Mod mode ({count} entries) → exports Lorebook separately',
  fileMvuZod: '🧬 RPG architecture: MVU-ZOD Card',
  fileLoadAnother: 'Load another file',

  // Biến Zod
  zodSection: 'Variable Database (Zod)',
  zodDesc: 'Variables hard-defined in the Zod Schema:',
  zodRemapped: 'Renamed {count} MVU-Zod variables. See the Compare / Export tab.',

  // Yêu cầu mod
  modSection: 'AI Mod Request',
  modPlaceholder: 'Enter a custom request… e.g. Rename the character from Ngân Kỳ to Anh Kiệt, and change the plot to a medieval knight…',
  subExpandDone: 'Deep-dived one part. See the Compare / Export tab.',

  // Orchestrator
  orchSection: 'Orchestrator Controls',
  expandMode: '✨ Expand / deep-dive mode',
  expandModeDesc: 'Instead of literal edits, the AI reads the whole lorebook, adds 3–4 expanded parts and writes in more detail (staying on-lore).',
  expandIntensityLabel: 'Depth:',
  intensityLight: 'Light',
  intensityMedium: 'Medium',
  intensityDeep: 'Deep',
  runBtn: '🚀 Run Auto Mod Card',
  stopBtn: '⏹ Stop',
  scriptWarnBold: '{count} script(s) may have BROKEN syntax',
  scriptWarnRest: 'after the mod (loading into SillyTavern may disable buttons) — check manually in the Diff table:',

  // Tabs
  tabWorkspace: 'Workspace (Sections)',
  tabDiff: 'Diff Table (Result)',
  tabSettings: 'Settings',
  needCardHint: 'Load a JSON card in the left column to start.',

  // Phân tích
  analysisTitle: 'Analysis Report',
  analysisEmpty: 'No analysis yet. Click "Run Auto Mod Card".',
  analysisReason: 'Reason:',
  analysisPreview: 'Planned change:',

  // Kết quả
  resultTitle: 'Result (Diff Viewer & Audit)',
  resultEmpty: 'Run "Auto Mod Card" to see the results here.',
  auditTitle: '1. Consistency (Audit Score)',
  validationTitle: '2. Validation Status',
  validationVerified: 'Verified: {count} protected fields.',
  suggestLabel: 'Suggestion',
  downloadLorebook: '⬇️ Download Lorebook JSON (separate)',
  downloadJson: '⬇️ Download JSON (Avatar re-embedded)',
  jsonBefore: 'Original JSON (text fields only)',
  jsonAfter: 'Modded JSON (changes applied)',

  // Cài đặt
  settingsTitle: '⚙️ LLM & Proxy Configuration',
  settingsAutosave: 'Auto-saved — every change is stored in your browser instantly; refresh / reopen keeps it (no Save button needed).',
  cfgProvider: '1. Provider',
  cfgBaseUrl: '2. Proxy Base URL',
  cfgBaseUrlPhOpenai: 'e.g. https://api.openrouter.ai/v1 or https://api.openai.com/v1',
  cfgBaseUrlPhGemini: 'Default (Google API) or your own proxy URL',
  cfgBaseUrlPhAnthropic: 'Default (Anthropic API) or your own proxy URL',
  cfgBaseUrlHint: "Leave blank to use the provider's default API directly.",
  cfgApiKey: '3. API Key / Proxy Password',
  cfgApiKeyPh: 'Enter your API Key or proxy password',
  cfgApiKeyNote: '🔒 Security: stored only locally in your browser (Local Storage) and never uploaded to any third-party server other than the proxy you chose.',
  cfgScanning: '🔄 Scanning models…',
  cfgScanBtn: '🔍 Scan model list from proxy',
  cfgModel: '4. Choose a model',
  cfgPickFromList: 'Pick from list',
  cfgTypeManually: 'Type model name',
  cfgModelPh: 'Type the exact model name, e.g. gpt-4o, gemini-1.5-pro-latest',
  cfgRecommended: '(recommended)',
  cfgMaxTokens: '5. Max Output Tokens',
  cfgTemperature: '6. Creativity (Temperature)',

  // Alert
  alertNeedKeyScan: 'Please enter an API Key before scanning.',
  alertScanFailed: 'Model scan failed',
  alertScanOk: 'Successfully scanned {count} models!',
  alertScanErrPrefix: 'Model scan error: ',
  alertNeedCardKey: 'Please load a card and enter an API Key under Settings before running.',
  alertNeedRule: 'Please add at least 1 Rule or enter a custom request.',
  alertProcessErrPrefix: 'An error occurred while processing: ',

  // Trạng thái pipeline
  stage1: 'Stage 1: Initialising and preparing...',
  stage2: 'Stage 2: Calling the LLM to analyse the card (Analyze Phase)...',
  stage3: 'Stage 3: Modding the sections marked NEEDS_MOD...',
  stage3Part: 'Stage 3: {verb} "{label}" — part {done}/{total} (large entry, split to avoid errors)...',
  stage3Section: 'Stage 3: {verb} section {label}...',
  verbExpand: 'EXPANDING',
  verbMod: 'modding',
  stage4Keyword: 'Stage 4: Syncing keywords (Keyword Sync)...',
  stage4Audit: 'Stage 4: Scoring consistency (Consistency Audit)...',
  stage5: 'Stage 5: Running structural safety checks (Validation)...',
  stageDone: 'Whole Mod pipeline finished! Results are in the Diff table.',
  stageStopped: '⏹ Stopped as requested.',
  stageStopping: '⏹ Stopping…',
  stageError: 'Pipeline error.',

  // ─── Dùng chung ───
  errNoApiKey: 'No API Key configured in the Settings tab.',

  // FileUploader
  fuAlertBadJson: 'Failed to read the JSON file. It must be a Character Card V3 or a Lorebook file (with "entries").\n',
  fuTitle: 'Load a character card OR a Lorebook (JSON)',
  fuDesc: 'Character Card V3 → mod the whole card · Lorebook (with "entries") → mod & export the Lorebook only',

  // ModRulesManager
  mrAddRule: '+ Add Rule',
  mrEmpty: 'No mod rules configured yet.',
  mrEdit: 'Edit',
  mrDelete: 'Delete',
  mrEditTitle: 'Edit Rule',
  mrName: 'Rule name',
  mrNamePh: 'e.g. Change theme NTR → NTL',
  mrOldTheme: 'Old theme',
  mrNewTheme: 'New theme',
  mrKeywords: 'Detection keywords (comma-separated)',
  mrDetails: 'Change details',
  mrCancel: 'Cancel',
  mrSave: 'Save',

  // VarRemapPanel
  vrErrNoRequest: 'Enter a request to rename/redefine variables first.',
  vrErrNoRemap: 'The AI proposed no variable changes (your request matched no variable, or the parse was empty). Try rephrasing.',
  vrErrNoRow: 'No rows selected/changed.',
  vrTitle: '🧬 Mod MVU-Zod variables',
  vrDesc: 'Rename / redefine {count} schema variables as requested — applied consistently across schema, getvar, initvar and mvu_update. MVU runtime is untouched.',
  vrPh: "e.g. Translate the stat variables (hp → sinh_lực, mp → linh_lực); redefine 'affection' as trust level instead of romance…",
  vrAnalyzing: 'Analysing variables…',
  vrAnalyze: '🔎 Analyse variables',
  vrApply: '✅ Apply ({count})',
  vrApplied: 'Applied to the card.',
  vrColOld: 'Old variable',
  vrColNew: 'New name',
  vrColDesc: 'New meaning',
  vrKeepPh: '(keep as is)',

  // SubExpandPanel
  seErrNoSection: 'Pick a section.',
  seErrNoMarker: 'Name the part to deep-dive (e.g. <Appearance> or "Ngoại hình").',
  seTitle: '🔬 Deep-dive one part',
  seDesc: 'Expand exactly ONE part inside a section (e.g. the appearance block) and leave the rest untouched.',
  seSelectSection: 'Pick a section',
  seMarkerPh: 'Part to deep-dive — e.g. <Appearance>  or  "Ngoại hình"',
  seRequestPh: 'Extra instructions (optional) — e.g. describe the outfit, scars and demeanour in detail…',
  seRunning: 'Deep-diving…',
  seRun: '🔬 Deep-dive',
  seApply: '✅ Apply',
  sePreview: 'Preview (editable before applying):',

  // ExtraProvidersPanel
  epTitle: '🔀 Extra providers (run in parallel)',
  epDesc: 'Add backup providers → the engine round-robins calls with the main provider, running several at once. Use a comparable model to keep quality.',
  epRemove: 'Remove',
  epBaseUrlPh: 'Base URL (if proxy)',
  epModelPh: 'Model (e.g. gemini-2.5-flash)',
  epAdd: '+ Add provider',
};

export default en;
export type ModUiKeys = typeof en;
