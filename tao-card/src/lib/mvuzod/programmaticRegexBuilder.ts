/**
 * src/lib/mvuzod/programmaticRegexBuilder.ts — Programmatic Regex Builder
 * ──────────────────────────────────────────────────────────────────────────────
 * TypeScript engine: Schema + Theme → full HTML document (CSS + HTML + JS)
 * NO AI needed — instant generation, deterministic output.
 *
 * Supports: status_bar, opening_form, full_set
 */

import { OPENING_FORM_ANCHOR, STATUS_BAR_ANCHOR } from './regexAnchors';
import type { MVUZODSchema, MVUZODField } from '../../types/mvuzod.types';
import type { RegexScript } from '../../types/regex.types';
import {
  type ThemePreset,
  THEME_PRESETS,
  DEFAULT_THEME_ID,
  generateStatusBarCSS,
  generateOpeningFormCSS,
  generateStatusBarSharedJS,
  generateOpeningFormSharedJS,
  generatePopulateFunction,
  generateFieldBindingJS,
  generateInitWrapper,
  guessFieldIcon,
  guessBarColor,
  renderProgressBarHTML,
  renderDataCardHTML,
  renderPanelHTML,
  renderRecordListHTML,
  renderModalHTML,
  assembleHtmlDocument,
} from './gameHtmlTemplates';

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type ProgrammaticComponent = 'status_bar' | 'opening_form' | 'full_set';

export interface ProgrammaticBuildOptions {
  schema: MVUZODSchema;
  component: ProgrammaticComponent;
  themeId?: string;
  /** Game name for header display */
  gameName?: string;
}

export interface ProgrammaticBuildResult {
  scripts: Omit<RegexScript, 'id'>[];
  /** Total output size in bytes */
  totalSize: number;
  /** Number of schema fields rendered */
  fieldsRendered: number;
  /** Full HTML preview string (for iframe) */
  previewHtml: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// SCHEMA ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════

interface FieldAnalysis {
  field: MVUZODField;
  /** Actual key path from root (for _.get) */
  keyPath: string[];
  /** DOM element ID prefix */
  elementId: string;
  /** Auto-detected icon */
  icon: string;
  /** Max value for progress bars */
  maxValue?: number;
}

interface SectionAnalysis {
  field: MVUZODField;
  /** Section label for panel header */
  label: string;
  icon: string;
  /** DOM ID prefix for this section */
  sectionId: string;
  /** Direct children analysis */
  numericFields: FieldAnalysis[];
  stringFields: FieldAnalysis[];
  enumFields: FieldAnalysis[];
  booleanFields: FieldAnalysis[];
  recordFields: FieldAnalysis[];
  nestedSections: SectionAnalysis[];
  /** All flat leaf fields (for counting) */
  allLeafFields: FieldAnalysis[];
}

interface SchemaAnalysis {
  sections: SectionAnalysis[];
  totalLeafFields: number;
  editableFields: FieldAnalysis[];
}

/**
 * (User 22/07 — bug 78) TÊN BIẾN nằm ở `path`, KHÔNG phải ở `label`.
 *
 * `label` là chữ hiển thị cho người đọc ("Thông tin Người Chơi"), còn tên biến thật MVU dùng
 * nằm trong `path` ("/Player/Name"). Bản cũ dựng keyPath từ `label`, nên Opening Form ghi
 * biến tên tiếng Việt trong khi schema/initvar khai tên tiếng Anh — đo trên thẻ thật
 * (bugNeedFix/41): giao nhau giữa tên biến của Form và của Schema là ĐÚNG 0.
 * Vì thế nhập form xong biến chẳng vào đâu cả.
 */
function varNameOf(field: { path?: string; label?: string }): string {
  const seg = String(field.path ?? '').split('/').filter(Boolean).pop();
  return seg || String(field.label ?? '');
}

function analyzeSchema(schema: MVUZODSchema): SchemaAnalysis {
  const sections: SectionAnalysis[] = [];
  let globalFieldCount = 0;
  const editableFields: FieldAnalysis[] = [];

  for (const field of schema.fields) {
    if (field.constraints?.hidden) continue;
    // keyPath phải theo TÊN BIẾN (path), không theo nhãn hiển thị — xem varNameOf.
    const section = analyzeSection(field, [varNameOf(field)], `stcs-${sanitizeId(field.label)}`);
    sections.push(section);
    globalFieldCount += section.allLeafFields.length;
    editableFields.push(
      ...section.allLeafFields.filter(f => !f.field.constraints?.readOnly),
    );
  }

  return { sections, totalLeafFields: globalFieldCount, editableFields };
}

function analyzeSection(
  field: MVUZODField,
  parentKeyPath: string[],
  sectionIdPrefix: string,
): SectionAnalysis {
  const icon = guessFieldIcon(field.label);
  const section: SectionAnalysis = {
    field,
    label: field.label,
    icon,
    sectionId: sectionIdPrefix,
    numericFields: [],
    stringFields: [],
    enumFields: [],
    booleanFields: [],
    recordFields: [],
    nestedSections: [],
    allLeafFields: [],
  };

  const children = field.children ?? [];
  for (const child of children) {
    if (child.constraints?.hidden) continue;

    const childKeyPath = [...parentKeyPath, varNameOf(child)];
    const childElementId = `${sectionIdPrefix}-${sanitizeId(child.label)}`;

    const fa: FieldAnalysis = {
      field: child,
      keyPath: childKeyPath,
      elementId: childElementId,
      icon: guessFieldIcon(child.label),
      maxValue: getMaxValue(child),
    };

    if (child.type === 'object' && child.children?.length) {
      // Nested section
      const nested = analyzeSection(child, childKeyPath, childElementId);
      section.nestedSections.push(nested);
      section.allLeafFields.push(...nested.allLeafFields);
    } else if (child.type === 'record') {
      section.recordFields.push(fa);
      section.allLeafFields.push(fa);
    } else if (child.type === 'number') {
      section.numericFields.push(fa);
      section.allLeafFields.push(fa);
    } else if (child.constraints?.enumValues?.length) {
      section.enumFields.push(fa);
      section.allLeafFields.push(fa);
    } else if (child.type === 'boolean') {
      section.booleanFields.push(fa);
      section.allLeafFields.push(fa);
    } else {
      // string and others
      section.stringFields.push(fa);
      section.allLeafFields.push(fa);
    }
  }

  return section;
}

// ═══════════════════════════════════════════════════════════════════════════
// STATUS BAR BUILDER
// ═══════════════════════════════════════════════════════════════════════════

function buildStatusBar(
  schema: MVUZODSchema,
  gameName?: string,
): { html: string; js: string; fieldsRendered: number } {
  const analysis = analyzeSchema(schema);
  const htmlParts: string[] = [];
  const bindings: string[] = [];

  // ── Header ──
  const title = gameName || 'Game Status';
  htmlParts.push(
    `<div class="stcs-header">` +
    `<div class="stcs-header-title">${title}</div>` +
    `<div class="stcs-header-subtitle">` +
    `<span id="stcs-header-info">Loading...</span>` +
    `</div>` +
    `</div>`,
  );

  // Try to find a "time" or "location" field for header subtitle
  const headerFields = findHeaderFields(analysis);
  for (const hf of headerFields) {
    bindings.push(generateFieldBindingJS(hf.keyPath, 'stcs-header-info', 'string'));
  }

  // ── Panels for each top-level section ──
  let fieldCount = 0;
  let panelIndex = 0;

  for (const section of analysis.sections) {
    const panelContent = buildSectionContent(section, bindings);
    fieldCount += section.allLeafFields.length;

    htmlParts.push(renderPanelHTML(
      section.sectionId,
      section.label,
      section.icon,
      panelContent,
      panelIndex > 0, // collapse all except first
    ));
    panelIndex++;
  }

  // ── Modals ──
  // One generic detail modal
  htmlParts.push(renderModalHTML('stcs-detail-modal', 'stcs-detail-title', 'stcs-detail-body'));

  // ── Record item click handler JS ──
  const recordClickJS = buildRecordClickHandlers(analysis);

  // ── Assemble JS ──
  const sharedJS = generateStatusBarSharedJS();
  const populateFn = generatePopulateFunction(bindings);
  const fullJS = generateInitWrapper(populateFn, sharedJS + '\n' + recordClickJS);

  return {
    html: htmlParts.join('\n'),
    js: fullJS,
    fieldsRendered: fieldCount,
  };
}

function buildSectionContent(section: SectionAnalysis, bindings: string[]): string {
  const parts: string[] = [];

  // Numeric fields → progress bars
  if (section.numericFields.length > 0) {
    for (const nf of section.numericFields) {
      const barColor = guessBarColor(nf.field.label);
      const max = nf.maxValue ?? 100;
      parts.push(renderProgressBarHTML(nf.elementId, nf.field.label, nf.icon, barColor, max));
      bindings.push(generateFieldBindingJS(nf.keyPath, nf.elementId, 'number', max));
    }
  }

  // String + enum fields → data grid
  const displayFields = [...section.stringFields, ...section.enumFields, ...section.booleanFields];
  if (displayFields.length > 0) {
    parts.push('<div class="stcs-grid-2">');
    for (const df of displayFields) {
      parts.push(renderDataCardHTML(df.elementId, df.field.label, df.icon));
      bindings.push(generateFieldBindingJS(df.keyPath, df.elementId, df.field.type));
    }
    parts.push('</div>');
  }

  // Record fields → scrollable lists
  for (const rf of section.recordFields) {
    const listId = `${rf.elementId}-list`;
    parts.push(`<div class="stcs-divider"></div>`);
    parts.push(`<div style="font-size:var(--fs-sm);color:var(--text-secondary);margin-bottom:4px">${rf.icon} ${rf.field.label}</div>`);
    parts.push(renderRecordListHTML(listId, 'Chưa có dữ liệu', true));

    // JS binding for record: iterate entries
    bindings.push(buildRecordBinding(rf));
  }

  // Nested sections → recursive panels
  for (const nested of section.nestedSections) {
    const nestedContent = buildSectionContent(nested, bindings);
    parts.push(`<div class="stcs-divider"></div>`);
    parts.push(renderPanelHTML(
      nested.sectionId,
      nested.label,
      nested.icon,
      nestedContent,
      false,
    ));
  }

  return parts.join('\n');
}

function buildRecordBinding(rf: FieldAnalysis): string {
  const pathExpr = rf.keyPath.map(k => `'${k.replace(/'/g, "\\'")}'`).join(', ');
  const listId = `${rf.elementId}-list`;
  const childFields = rf.field.children ?? [];

  // Build item HTML template using child fields
  let itemTemplate: string;
  if (childFields.length > 0) {
    const subValues = childFields
      .slice(0, 4) // max 4 sub-fields displayed
      .map(c => `' + (entry['${c.label}'] || '—') + '`)
      .join(' | ');
    itemTemplate =
      `'<li class="stcs-list-item interactive" data-record-key="' + key + '" data-record-path="${rf.keyPath.join('/')}">' +` +
      `'<span>' + key + '</span>' +` +
      `'<span style="font-size:var(--fs-sm);color:var(--text-secondary);font-weight:normal">${subValues}</span>' +` +
      `'</li>'`;
  } else {
    itemTemplate =
      `'<li class="stcs-list-item"><span>' + key + '</span><span style="color:var(--text-secondary)">' + (typeof entry === 'string' ? entry : JSON.stringify(entry)) + '</span></li>'`;
  }

  return `    // Record: ${rf.field.label}
    (function() {
        var records = _.get(d, [${pathExpr}], {});
        var html = '';
        var entries = Object.entries(records);
        if (entries.length === 0) {
            html = '<li class="stcs-list-item" style="justify-content:center;font-weight:normal;color:var(--text-muted)">Chưa có dữ liệu</li>';
        } else {
            entries.forEach(function(pair) {
                var key = pair[0], entry = pair[1] || {};
                html += ${itemTemplate};
            });
        }
        stcsSetHtml('${listId}', html);
    })();`;
}

function buildRecordClickHandlers(analysis: SchemaAnalysis): string {
  // Collect all record fields that have children (so we can show detail modal)
  const recordFields: FieldAnalysis[] = [];
  for (const section of analysis.sections) {
    collectRecordFields(section, recordFields);
  }

  if (recordFields.length === 0) return '';

  return `
    // ── Record Detail Modal ──
    document.addEventListener('click', function(e) {
        var item = e.target.closest('.stcs-list-item.interactive');
        if (!item) return;
        var key = item.getAttribute('data-record-key');
        var path = item.getAttribute('data-record-path');
        if (!key || !path) return;

        var all = getAllVariables();
        var d = _.get(all, ['stat_data'], {});
        var pathParts = path.split('/');
        var record = _.get(d, pathParts, {});
        var entry = record[key];
        if (!entry) return;

        stcsSetText('stcs-detail-title', key);

        var bodyHtml = '';
        if (typeof entry === 'object' && entry !== null) {
            Object.entries(entry).forEach(function(pair) {
                bodyHtml += '<div class="stcs-attr-row"><span>' + pair[0] + '</span><span class="val">' + (pair[1] ?? '—') + '</span></div>';
            });
        } else {
            bodyHtml = '<div>' + String(entry) + '</div>';
        }
        stcsSetHtml('stcs-detail-body', bodyHtml);
        stcsShowModal('stcs-detail-modal');
    });
`;
}

function collectRecordFields(section: SectionAnalysis, result: FieldAnalysis[]): void {
  result.push(...section.recordFields);
  for (const nested of section.nestedSections) {
    collectRecordFields(nested, result);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// OPENING FORM BUILDER
// ═══════════════════════════════════════════════════════════════════════════

function buildOpeningForm(
  schema: MVUZODSchema,
  gameName?: string,
): { html: string; js: string; fieldsRendered: number } {
  const analysis = analyzeSchema(schema);
  const pages: string[] = [];
  let fieldCount = 0;
  const sliderInits: string[] = [];

  // ── Page 0: Cover ──
  pages.push(buildCoverPage(gameName || 'Game Setup'));

  // ── Pages for each editable section ──
  for (const section of analysis.sections) {
    const editableLeafs = section.allLeafFields.filter(
      f => !f.field.constraints?.readOnly,
    );
    if (editableLeafs.length === 0) continue;

    const { pageHtml, sliders } = buildFormPage(
      pages.length,
      section,
      editableLeafs,
    );
    pages.push(pageHtml);
    sliderInits.push(...sliders);
    fieldCount += editableLeafs.length;
  }

  // ── Final page: Summary + Confirm ──
  pages.push(buildSummaryPage(pages.length));

  const totalPages = pages.length;

  // ── Assemble HTML ──
  // Step indicator
  const stepsHtml = '<div class="stcs-steps">' +
    Array.from({ length: totalPages }, (_, i) =>
      `<div class="stcs-step-dot${i === 0 ? ' active' : ''}"></div>`,
    ).join('') +
    '</div>';

  const pagesHtml = pages.map((p, i) =>
    `<div class="stcs-page${i === 0 ? ' active' : ''}" id="stcs-page-${i}">${p}</div>`,
  ).join('\n');

  const bodyHtml = `<div class="stcs-wizard">${stepsHtml}\n${pagesHtml}</div>`;

  // ── Assemble JS ──
  const sharedJS = generateOpeningFormSharedJS(totalPages);
  const sliderInitJS = sliderInits.length > 0
    ? '\n    // Slider init\n' + sliderInits.map(s => `    syncSlider('${s}', '${s}-display');`).join('\n')
    : '';

  const submitJS = buildSubmitHandler(analysis);

  const fullJS = `${sharedJS}\n${sliderInitJS}\n\n${submitJS}\n\n    // Show first page\n    goToPage(0);`;

  return { html: bodyHtml, js: fullJS, fieldsRendered: fieldCount };
}

function buildCoverPage(title: string): string {
  return `<div style="text-align:center;padding:clamp(24px,6vw,48px) 0">` +
    `<div class="stcs-page-title" style="font-size:var(--fs-2xl)">${title}</div>` +
    `<div class="stcs-page-desc">Thiết lập thông số ban đầu cho trò chơi</div>` +
    `<div class="stcs-btn-row" style="justify-content:center">` +
    `<button class="stcs-btn stcs-btn-primary" onclick="goToPage(1)">Bắt đầu ▶</button>` +
    `</div>` +
    `</div>`;
}

function buildFormPage(
  pageIndex: number,
  section: SectionAnalysis,
  fields: FieldAnalysis[],

): { pageHtml: string; sliders: string[] } {
  const parts: string[] = [];
  const sliders: string[] = [];

  parts.push(`<div class="stcs-page-title">${section.icon} ${section.label}</div>`);
  parts.push(`<div class="stcs-page-desc">Chọn hoặc nhập giá trị khởi tạo</div>`);

  // Group fields by type
  const enums = fields.filter(f => f.field.constraints?.enumValues?.length);
  const numbers = fields.filter(f => f.field.type === 'number' && !f.field.constraints?.enumValues?.length);
  const strings = fields.filter(f => f.field.type === 'string' && !f.field.constraints?.enumValues?.length);
  const booleans = fields.filter(f => f.field.type === 'boolean');

  // Enum fields → card grid selection
  for (const ef of enums) {
    const values = ef.field.constraints.enumValues ?? [];
    const groupId = `${ef.elementId}-cards`;
    parts.push(`<div style="margin-bottom:clamp(16px,4vw,24px)">`);
    parts.push(`<div class="stcs-input-label">${ef.icon} ${ef.field.label}</div>`);
    parts.push(`<div class="stcs-card-grid" id="${groupId}">`);
    for (const v of values) {
      const isDefault = v === ef.field.defaultValue;
      parts.push(
        `<div class="stcs-card${isDefault ? ' selected' : ''}" data-value="${escapeAttr(v)}" onclick="selectCard(this, '${groupId}')">` +
        `<div class="stcs-card-title">${v}</div>` +
        `</div>`,
      );
    }
    parts.push(`</div></div>`);
  }

  // Number fields → sliders
  for (const nf of numbers) {
    const min = nf.field.constraints?.clamp?.[0] ?? nf.field.constraints?.min ?? 0;
    const max = nf.field.constraints?.clamp?.[1] ?? nf.field.constraints?.max ?? 100;
    const def = typeof nf.field.defaultValue === 'number' ? nf.field.defaultValue : Math.floor((min + max) / 2);
    const sliderId = `${nf.elementId}-slider`;

    parts.push(
      `<div class="stcs-slider-group">` +
      `<div class="stcs-slider-header">` +
      `<span class="stcs-slider-label">${nf.icon} ${nf.field.label}</span>` +
      `<span class="stcs-slider-value" id="${sliderId}-display">${def}</span>` +
      `</div>` +
      `<input type="range" class="stcs-slider" id="${sliderId}" min="${min}" max="${max}" value="${def}">` +
      `</div>`,
    );
    sliders.push(sliderId);
  }

  // String fields → text inputs
  for (const sf of strings) {
    const def = typeof sf.field.defaultValue === 'string' ? sf.field.defaultValue : '';
    parts.push(
      `<div class="stcs-input-group">` +
      `<label class="stcs-input-label" for="${sf.elementId}-input">${sf.icon} ${sf.field.label}</label>` +
      `<input type="text" class="stcs-input" id="${sf.elementId}-input" value="${escapeAttr(def)}" placeholder="Nhập ${sf.field.label}">` +
      `</div>`,
    );
  }

  // Boolean fields → checkbox (styled)
  for (const bf of booleans) {
    const checked = bf.field.defaultValue === true ? ' checked' : '';
    parts.push(
      `<div class="stcs-input-group" style="display:flex;align-items:center;gap:8px">` +
      `<input type="checkbox" id="${bf.elementId}-check"${checked} style="width:18px;height:18px;accent-color:var(--theme-main)">` +
      `<label for="${bf.elementId}-check" style="cursor:pointer">${bf.icon} ${bf.field.label}</label>` +
      `</div>`,
    );
  }

  // Navigation buttons
  const prevBtn = pageIndex > 0
    ? `<button class="stcs-btn" onclick="goToPage(${pageIndex - 1})">◀ Quay lại</button>`
    : `<div></div>`;
  const nextBtn = `<button class="stcs-btn stcs-btn-primary" onclick="goToPage(${pageIndex + 1})">Tiếp tục ▶</button>`;
  parts.push(`<div class="stcs-btn-row">${prevBtn}${nextBtn}</div>`);

  return { pageHtml: parts.join('\n'), sliders };
}

function buildSummaryPage(pageIndex: number): string {
  const parts: string[] = [];

  parts.push(`<div class="stcs-page-title">📋 Tổng kết</div>`);
  parts.push(`<div class="stcs-page-desc">Xem lại các thông số đã chọn</div>`);

  parts.push(`<table class="stcs-summary-table" id="stcs-summary-table">`);
  parts.push(`<tr><td colspan="2" style="text-align:center;color:var(--text-muted)">Nhấn Xác nhận để bắt đầu</td></tr>`);
  parts.push(`</table>`);

  // Navigation
  parts.push(
    `<div class="stcs-btn-row">` +
    `<button class="stcs-btn" onclick="goToPage(${pageIndex - 1})">◀ Quay lại</button>` +
    `<button class="stcs-btn stcs-btn-primary" onclick="onConfirm()">✓ Xác nhận</button>` +
    `</div>`,
  );

  return parts.join('\n');
}

function buildSubmitHandler(analysis: SchemaAnalysis): string {
  // Build field → stat_data path mappings
  const mappings: Array<{ inputId: string; path: string[]; type: string }> = [];
  for (const section of analysis.sections) {
    collectEditableMappings(section, mappings);
  }

  return `
    function onConfirm() {
        var data = collectFormData();
        // Build summary
        var summaryHtml = '';
        Object.entries(data).forEach(function(pair) {
            summaryHtml += '<tr><td>' + pair[0].replace(/stcs-|[-_]slider|-input|-cards|-check/g, ' ').trim() + '</td><td>' + pair[1] + '</td></tr>';
        });
        stcsSetHtml('stcs-summary-table', summaryHtml || '<tr><td colspan="2">Không có dữ liệu</td></tr>');
        var mappings = ${JSON.stringify(mappings)};
        var slashCommands = [];
        
        mappings.forEach(function(m) {
            var val = data[m.inputId];
            if (val !== undefined) {
                var path = 'stat_data.' + m.path.join('.');
                slashCommands.push('/setvar key="' + path + '" value="' + val + '"');
            }
        });

        if (slashCommands.length > 0) {
            var cmdText = slashCommands.join('\\n');
            console.log('[STCS] Executing commands:\\n' + cmdText);
            
            // If running in SillyTavern UI, try to execute slash commands
            if (typeof executeSlashCommands === 'function') {
                executeSlashCommands(cmdText);
            } else {
                // Fallback: paste into chat textarea
                var ta = document.getElementById('send_textarea');
                if (ta) {
                    ta.value = cmdText;
                    var btn = document.getElementById('send_but');
                    if (btn) btn.click();
                }
            }
        }
    }
`;
}

function collectEditableMappings(
  section: SectionAnalysis,
  result: Array<{ inputId: string; path: string[]; type: string }>,
): void {
  for (const f of [...section.numericFields, ...section.stringFields, ...section.enumFields, ...section.booleanFields]) {
    if (!f.field.constraints?.readOnly) {
      result.push({ inputId: f.elementId, path: f.keyPath, type: f.field.type });
    }
  }
  for (const nested of section.nestedSections) {
    collectEditableMappings(nested, result);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build regex scripts programmatically from schema.
 * Returns complete regex scripts ready to apply.
 */
export function buildProgrammaticRegex(options: ProgrammaticBuildOptions): ProgrammaticBuildResult {
  const theme = THEME_PRESETS[options.themeId ?? DEFAULT_THEME_ID] ?? THEME_PRESETS[DEFAULT_THEME_ID];

  switch (options.component) {
    case 'status_bar':
      return buildStatusBarResult(options.schema, theme, options.gameName);
    case 'opening_form':
      return buildOpeningFormResult(options.schema, theme, options.gameName);
    case 'full_set':
      return buildFullSetResult(options.schema, theme, options.gameName);
  }
}

function buildStatusBarResult(
  schema: MVUZODSchema,
  theme: ThemePreset,
  gameName?: string,
): ProgrammaticBuildResult {
  const css = generateStatusBarCSS(theme);
  const { html, js, fieldsRendered } = buildStatusBar(schema, gameName);
  const fullHtml = assembleHtmlDocument(css, html, js, theme.fontImport);

  // Build 2 regex scripts (Pattern A from gameRegexPrompt)
  const scripts: Omit<RegexScript, 'id'>[] = [
    {
      scriptName: '[AI] Ẩn StatusPlaceHolder',
      findRegex: STATUS_BAR_ANCHOR,
      replaceString: '',
      trimStrings: [],
      placement: [2],
      disabled: false,
      markdownOnly: false,
      promptOnly: true,
      runOnEdit: false,
      substituteRegex: 0,
      minDepth: null,
      maxDepth: null,
    },
    {
      scriptName: '[Render] Status Bar',
      findRegex: STATUS_BAR_ANCHOR,
      replaceString: fullHtml,
      trimStrings: [],
      placement: [2],
      disabled: false,
      markdownOnly: true,
      promptOnly: false,
      runOnEdit: false,
      substituteRegex: 0,
      minDepth: null,
      maxDepth: null,
    },
  ];

  return {
    scripts,
    totalSize: fullHtml.length,
    fieldsRendered,
    previewHtml: fullHtml,
  };
}

function buildOpeningFormResult(
  schema: MVUZODSchema,
  theme: ThemePreset,
  gameName?: string,
): ProgrammaticBuildResult {
  const css = generateOpeningFormCSS(theme);
  const { html, js, fieldsRendered } = buildOpeningForm(schema, gameName);
  const fullHtml = assembleHtmlDocument(css, html, js, theme.fontImport);

  const scripts: Omit<RegexScript, 'id'>[] = [
    // Vế ẨN: mỏ neo phải bị gỡ khỏi prompt gửi AI, không thì mỗi lượt chat đều bẩn context.
    {
      scriptName: '[AI] Ẩn Opening Form',
      findRegex: OPENING_FORM_ANCHOR,
      replaceString: '',
      trimStrings: [],
      placement: [2],
      disabled: false,
      markdownOnly: false,
      promptOnly: true,
      runOnEdit: true,
      substituteRegex: 0,
      minDepth: null,
      maxDepth: null,
    },
    // Vế RENDER: thay mỏ neo bằng giao diện thật.
    {
      scriptName: '[Render] Opening Form',
      // (bug 72) Trước đây dùng NHẦM mỏ neo của Status Bar nên hai giao diện tranh nhau
      // một chỗ bám — cái nào chạy trước thì cái kia mất tích.
      findRegex: OPENING_FORM_ANCHOR,
      replaceString: fullHtml,
      trimStrings: [],
      placement: [2],
      disabled: false,
      markdownOnly: true,
      promptOnly: false,
      runOnEdit: true,
      // Macro in Find Regex phải TẮT: bật lên là SillyTavern chạy macro trên cả khối HTML/JS.
      substituteRegex: 0,
      // Ephemerality null = áp dụng mọi lượt. Để 0/0 thì form chỉ sống đúng tin nhắn mới nhất
      // rồi biến mất — đúng triệu chứng "form không hiện".
      minDepth: null,
      maxDepth: null,
    },
  ];

  return {
    scripts,
    totalSize: fullHtml.length,
    fieldsRendered,
    previewHtml: fullHtml,
  };
}

function buildFullSetResult(
  schema: MVUZODSchema,
  theme: ThemePreset,
  gameName?: string,
): ProgrammaticBuildResult {
  const statusResult = buildStatusBarResult(schema, theme, gameName);
  const formResult = buildOpeningFormResult(schema, theme, gameName);

  // Hide UpdateVariable scripts
  const hideScripts: Omit<RegexScript, 'id'>[] = [
    {
      scriptName: '[AI] Ẩn UpdateVariable',
      findRegex: '/\\<UpdateVariable\\>[\\s\\S]*?\\<\\/UpdateVariable\\>/g',
      replaceString: '',
      trimStrings: [],
      placement: [2],
      disabled: false,
      markdownOnly: false,
      promptOnly: true,
      runOnEdit: false,
      substituteRegex: 0,
      minDepth: null,
      maxDepth: null,
    },
  ];

  const allScripts = [...hideScripts, ...statusResult.scripts, ...formResult.scripts];
  const totalSize = allScripts.reduce((sum, s) => sum + s.replaceString.length, 0);

  return {
    scripts: allScripts,
    totalSize,
    fieldsRendered: statusResult.fieldsRendered + formResult.fieldsRendered,
    previewHtml: statusResult.previewHtml, // Use status bar as primary preview
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function findHeaderFields(analysis: SchemaAnalysis): FieldAnalysis[] {
  const result: FieldAnalysis[] = [];
  for (const section of analysis.sections) {
    for (const f of [...section.stringFields, ...section.enumFields]) {
      const lower = f.field.label.toLowerCase();
      if (/thời|time|ngày|tháng|khu vực|vị trí|location|地点|时间/.test(lower)) {
        result.push(f);
        if (result.length >= 2) return result;
      }
    }
  }
  return result;
}

function getMaxValue(field: MVUZODField): number | undefined {
  if (field.type !== 'number') return undefined;
  if (field.constraints?.clamp) return field.constraints.clamp[1];
  if (field.constraints?.max !== undefined) return field.constraints.max;
  return 100; // default max for progress bars
}

/** Sanitize a label string into a safe DOM ID fragment */
function sanitizeId(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9\u00C0-\u024F\u1E00-\u1EFF\u4E00-\u9FFF]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30);
}

/** Escape string for use in HTML attributes */
function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Check if a component type should use programmatic generation.
 */
export function isProgrammaticComponent(component: string): component is ProgrammaticComponent {
  return ['status_bar', 'opening_form', 'full_set'].includes(component);
}

/**
 * Format bytes into human-readable string.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
