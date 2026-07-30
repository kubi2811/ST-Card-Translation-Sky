/**
 * src/lib/mvuzod/programmaticRegexBuilder.ts — Programmatic Regex Builder
 * ──────────────────────────────────────────────────────────────────────────────
 * TypeScript engine: Schema + Theme → full HTML document (CSS + HTML + JS)
 * NO AI needed — instant generation, deterministic output.
 *
 * Supports: status_bar, opening_form, full_set
 */

import { OPENING_FORM_ANCHOR, STATUS_BAR_ANCHOR } from './regexAnchors';
import { decideNumericBounds } from './numericSemantics';
import { normalizeFieldPath } from './normalizeSchema';
import type { MVUZODSchema, MVUZODField, StatRelation } from '../../types/mvuzod.types';
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
  renderCounterHTML,
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
  /**
   * (bug 116) Vài bối cảnh bắt đầu sinh từ ý tưởng của người chơi — Opening Form thêm một
   * trang cho người chơi CHỌN 1. Bối cảnh chọn được đưa vào văn bản hồ sơ để gửi làm tin
   * nhắn đầu tiên. Không có thì form bỏ qua trang này.
   */
  scenarios?: Array<{ title: string; desc: string }>;
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
  /**
   * (bug 159-8) `array` TRƯỚC ĐÂY KHÔNG CÓ CHỖ NÀO ĐỂ VỀ.
   * Chuỗi phân loại là object → record → number → enum → boolean → else, nên array rơi vào `else`
   * và bị dựng thành MỘT Ô NHẬP CHỮ. Đúng cảnh user báo: "Túi đồ chỉ cho nhập một vật phẩm và
   * số lượng", còn Status Bar thì "không hiện gì".
   */
  arrayFields: FieldAnalysis[];
  nestedSections: SectionAnalysis[];
  /** All flat leaf fields (for counting) */
  allLeafFields: FieldAnalysis[];
  /**
   * (bug 149) Section này CHÍNH NÓ là một biến lá (schema phẳng: "Ngày", "Khung Giờ" nằm thẳng
   * ở cấp cao nhất, không nằm trong nhóm nào). analyzeSection chỉ phân loại CON, nên với schema
   * phẳng mọi mảng trên đều rỗng và trường lá cấp cao nhất trở nên vô hình với mọi phép tìm.
   */
  selfLeaf?: FieldAnalysis;
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
  // (bug 159-6) BỘ SINH ID CHỐNG TRÙNG — dùng chung cho cả lần dựng.
  // sanitizeId() bỏ mọi ký tự lạ rồi CẮT 30 ký tự, nên rất dễ ra hai id giống nhau:
  // "Máu (HP)" và "Máu HP" đều thành "máu-hp"; hai tên dài chung 30 ký tự đầu cũng vậy.
  // ID trùng thì getElementById trả về phần tử ĐẦU TIÊN ⇒ Opening Form ghi/đọc sai trường,
  // đúng cảnh "thêm biến mới thì phát sinh lỗi nhỏ" mà user báo. Trùng thì nối -2, -3…
  const mint = makeIdMinter();

  for (const field of schema.fields) {
    if (field.constraints?.hidden) continue;
    // keyPath phải theo TÊN BIẾN (path), không theo nhãn hiển thị — xem varNameOf.
    const section = analyzeSection(field, [varNameOf(field)], mint(`stcs-${sanitizeId(field.label)}`), mint);
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
  mint: (base: string) => string = (b) => b,
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
    arrayFields: [],
    nestedSections: [],
    allLeafFields: [],
  };

  const children = field.children ?? [];
  for (const child of children) {
    if (child.constraints?.hidden) continue;

    const childKeyPath = [...parentKeyPath, varNameOf(child)];
    const childElementId = mint(`${sectionIdPrefix}-${sanitizeId(child.label)}`);

    const fa: FieldAnalysis = {
      field: child,
      keyPath: childKeyPath,
      elementId: childElementId,
      icon: guessFieldIcon(child.label),
      maxValue: getMaxValue(child),
    };

    if (child.type === 'object' && child.children?.length) {
      // Nested section
      const nested = analyzeSection(child, childKeyPath, childElementId, mint);
      section.nestedSections.push(nested);
      section.allLeafFields.push(...nested.allLeafFields);
    } else if (child.type === 'record') {
      section.recordFields.push(fa);
      section.allLeafFields.push(fa);
    } else if (child.type === 'array') {
      // (bug 159-8) Phải đứng TRƯỚC nhánh `else`, không thì array thành ô nhập chữ.
      section.arrayFields.push(fa);
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

  // (bug 149) Schema PHẲNG: trường lá nằm thẳng ở cấp cao nhất cũng thành một "section", nhưng
  // vòng lặp trên chỉ phân loại CON nên mọi mảng ở đây rỗng. Ghi lại chính nó làm lá để các
  // phép tìm (vd trường thời gian cho dòng phụ header) còn thấy được nó.
  if (children.length === 0 && field.type !== 'object') {
    section.selfLeaf = {
      field,
      keyPath: parentKeyPath,
      elementId: sectionIdPrefix,
      icon,
      maxValue: getMaxValue(field),
    };
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
  // (bug 149) "Loading..." là CHỖ TRỐNG chờ trường thời gian/nơi chốn ghi đè. Không tìm thấy
  // trường nào thì chẳng có gì ghi đè, và chữ đó nằm lì mãi — trong khung xem trước lẫn trong
  // CARD THẬT. Nên phải tìm trường TRƯỚC rồi mới dựng header: có thì để chỗ trống, không có
  // thì bỏ hẳn dòng phụ đi. Thà thiếu một dòng còn hơn khoe chữ "Loading..." vĩnh viễn.
  const title = gameName || 'Game Status';
  const headerFields = findHeaderFields(analysis);
  htmlParts.push(
    `<div class="stcs-header">` +
    `<div class="stcs-header-title">${title}</div>` +
    (headerFields.length
      ? `<div class="stcs-header-subtitle"><span id="stcs-header-info">…</span></div>`
      : '') +
    `</div>`,
  );
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

  // Numeric fields → thanh tiến trình (chỉ khi CÓ trần) hoặc con số trần trụi (bộ đếm).
  if (section.numericFields.length > 0) {
    for (const nf of section.numericFields) {
      // (bugNeedFix/113) Có trần hữu hạn ⇒ thanh tiến trình (HP, VP, thang sao — tỉ lệ có nghĩa).
      // Không trần ⇒ CHỈ hiện số (ngày, tiền, số lượng). Vẽ thanh cho tiền là vô nghĩa, mà tệ hơn
      // là gợi cho người chơi tưởng 100 là mức tối đa.
      if (nf.maxValue !== undefined) {
        const barColor = guessBarColor(nf.field.label);
        parts.push(renderProgressBarHTML(nf.elementId, nf.field.label, nf.icon, barColor, nf.maxValue));
        bindings.push(generateFieldBindingJS(nf.keyPath, nf.elementId, 'number', nf.maxValue));
      } else {
        parts.push(renderCounterHTML(nf.elementId, nf.field.label, nf.icon));
        bindings.push(generateFieldBindingJS(nf.keyPath, nf.elementId, 'number'));
      }
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

  // (bug 159-8) Array → danh sách cuộn, mỗi phần tử một dòng. Dùng lại đúng khung của record
  // (renderRecordListHTML) vì hai thứ cùng là "danh sách hiện lên màn hình", khác nhau chỉ ở chỗ
  // record tra theo TÊN KHOÁ còn array tra theo THỨ TỰ.
  for (const af of section.arrayFields) {
    const listId = `${af.elementId}-list`;
    parts.push(`<div class="stcs-divider"></div>`);
    parts.push(`<div style="font-size:var(--fs-sm);color:var(--text-secondary);margin-bottom:4px">${af.icon} ${af.field.label}</div>`);
    parts.push(renderRecordListHTML(listId, 'Trống', true));
    bindings.push(buildArrayBinding(af));
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

/**
 * (bug 159-8) Binding cho `array`: lặp theo CHỈ SỐ, hiện mỗi phần tử một dòng.
 * Phần tử là object (khai qua "_child") thì ghép vài trường con lại cho dễ đọc; phần tử là giá
 * trị đơn thì in thẳng. Mảng rỗng hiện "Trống" — chứ không im lặng như trước.
 */
function buildArrayBinding(af: FieldAnalysis): string {
  const pathExpr = af.keyPath.map(k => `'${k.replace(/'/g, "\'")}'`).join(', ');
  const listId = `${af.elementId}-list`;
  // children của array mang path "_child" — đó là khai cấu trúc MỘT phần tử.
  const childFields = (af.field.children ?? []).filter(c => String(c.path || '').includes('/_child/'));
  const subValues = childFields.slice(0, 4)
    .map(c => `' + (item['${c.label}'] == null ? '—' : item['${c.label}']) + '`)
    .join(' | ');

  return `    // Array: ${af.field.label}
    (function() {
        var arr = _.get(d, [${pathExpr}], []);
        if (!Array.isArray(arr)) arr = [];
        var el = document.getElementById('${listId}');
        if (!el) return;
        if (arr.length === 0) {
            el.innerHTML = '<li class="stcs-list-item" style="justify-content:center;font-weight:normal;color:var(--text-muted)">Trống</li>';
            return;
        }
        var html = '';
        arr.forEach(function(item, i) {
            if (item !== null && typeof item === 'object') {
                html += '<li class="stcs-list-item interactive" data-array-index="' + i + '" data-array-path="${af.keyPath.join('/')}">'
                     + '<span>' + (item['${childFields[0]?.label ?? 'Tên'}'] || ('#' + (i + 1))) + '</span>'
                     + '<span style="font-size:var(--fs-sm);color:var(--text-secondary);font-weight:normal">${subValues}</span>'
                     + '</li>';
            } else {
                html += '<li class="stcs-list-item"><span>#' + (i + 1) + '</span><span style="color:var(--text-secondary)">' + item + '</span></li>';
            }
        });
        el.innerHTML = html;
    })();
`;
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
  scenarios?: Array<{ title: string; desc: string }>,
): { html: string; js: string; fieldsRendered: number } {
  const analysis = analyzeSchema(schema);
  const pages: string[] = [];
  let fieldCount = 0;
  const sliderInits: string[] = [];

  // (Goal 28/07) Quan hệ mềm giữa chỉ số liên quan: đổi path → id input thật của form.
  // Trường PHỤ THUỘC phải là ô nhập số TỰ DO (gỡ một phần bug 113) + có chỗ hiện cảnh báo.
  const relations = compileRelationsForForm(schema, analysis);
  const depPaths = new Set(relations.map(r => r.depPath));

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
      depPaths,
    );
    pages.push(pageHtml);
    sliderInits.push(...sliders);
    fieldCount += editableLeafs.length;
  }

  // ── (bug 116) Trang chọn BỐI CẢNH BẮT ĐẦU — chỉ khi Auto Creator sinh được bối cảnh ──
  const validScenarios = (scenarios ?? []).filter(s => s?.title?.trim());
  if (validScenarios.length > 0) {
    pages.push(buildScenarioPage(pages.length, validScenarios));
  }

  // ── Summary + Confirm ──
  pages.push(buildSummaryPage(pages.length));

  // ── (bug 116) Trang KẾT QUẢ — hiện sau khi bấm Xác nhận, theo khuôn thẻ mẫu One Piece:
  //    "Đã ghi thành công biến MVU" + ô hồ sơ + nút Sao chép để gửi làm tin nhắn đầu. ──
  pages.push(buildResultPage());

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

  const submitJS = buildSubmitHandler(analysis, gameName || 'Game', validScenarios);
  // (Goal 28/07) JS cảnh báo mềm — phải nằm SAU submitJS để bọc tiếp goToPage/selectCard đã bọc.
  const relationJS = buildRelationJS(relations);

  const fullJS = `${sharedJS}\n${sliderInitJS}\n\n${submitJS}\n${relationJS}\n\n    // Show first page\n    goToPage(0);`;

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
  /** (Goal 28/07) Path (đã chuẩn hoá) của các trường PHỤ THUỘC trong statRelations. */
  depPaths: Set<string> = new Set(),
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

  // Number fields → thanh trượt (có trần) hoặc ô nhập số (bộ đếm không trần).
  for (const nf of numbers) {
    // (bugNeedFix/113) Slider `min=0 max=100` cho tiền/ngày là sai từ gốc: người chơi không thể
    // nhập 5000 đồng, và kéo hết thanh cũng chỉ tới 100.
    // (Goal 28/07) Trường PHỤ THUỘC trong statRelations cũng LUÔN là ô nhập tự do — ràng buộc
    // là cảnh báo mềm (div -warn bên dưới), không phải trần slider.
    const bounds = decideNumericBounds(nf.field);
    const isDep = depPaths.has(normalizeFieldPath(nf.field.path));
    if (!bounds.bounded || isDep) {
      const def0 = typeof nf.field.defaultValue === 'number' ? nf.field.defaultValue : 0;
      parts.push(
        `<div class="stcs-slider-group">` +
        `<div class="stcs-slider-header">` +
        `<span class="stcs-slider-label">${nf.icon} ${nf.field.label}</span>` +
        `</div>` +
        `<input type="number" class="stcs-input" id="${nf.elementId}-slider" value="${def0}"` +
        (bounds.min !== undefined ? ` min="${bounds.min}"` : '') + ` step="1"` +
        (isDep ? ` oninput="stcsRelationCheck()"` : '') + `>` +
        (isDep ? `<div id="${nf.elementId}-slider-warn" style="display:none;color:#f59e0b;font-size:var(--fs-sm);margin-top:6px;line-height:1.5"></div>` : '') +
        `</div>`,
      );
      continue;
    }
    const min = bounds.min ?? 0;
    const max = bounds.max!;
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

/**
 * (bug 116) Trang chọn bối cảnh bắt đầu. Dùng lưới thẻ `.stcs-card-grid` sẵn có nên
 * `collectFormData` thu được giá trị qua id `stcs-scenario-cards` mà không cần code thu riêng.
 */
function buildScenarioPage(
  pageIndex: number,
  scenarios: Array<{ title: string; desc: string }>,
): string {
  const cards = scenarios.map((s, i) =>
    `<div class="stcs-card${i === 0 ? ' selected' : ''}" data-value="${escapeAttr(s.title)}" onclick="selectCard(this, 'stcs-scenario-cards')">` +
    `<div style="font-weight:700;margin-bottom:4px">${escapeAttr(s.title)}</div>` +
    `<div style="font-size:var(--fs-sm);color:var(--text-muted)">${escapeAttr(s.desc || '')}</div>` +
    `</div>`,
  ).join('');

  return `<div class="stcs-page-title">🗺️ Chọn bối cảnh bắt đầu</div>` +
    `<div class="stcs-page-desc">Câu chuyện sẽ mở màn theo bối cảnh bạn chọn.</div>` +
    `<div class="stcs-card-grid" id="stcs-scenario-cards">${cards}</div>` +
    `<div class="stcs-btn-row">` +
    `<button class="stcs-btn" onclick="goToPage(${pageIndex - 1})">◀ Quay lại</button>` +
    `<button class="stcs-btn stcs-btn-primary" onclick="goToPage(${pageIndex + 1})">Tiếp tục ▶</button>` +
    `</div>`;
}

/**
 * (bug 116) Trang kết quả sau khi Xác nhận — khuôn thẻ mẫu One Piece:
 * trạng thái ghi biến + "Sao chép nội dung dưới đây và gửi làm tin nhắn đầu tiên" + nút Sao chép.
 * Nội dung do JS đổ vào sau khi ghi xong (stcs-result-status / stcs-out-text).
 */
function buildResultPage(): string {
  return `<div id="stcs-result-status" style="text-align:center;padding:8px 0"></div>` +
    `<div class="stcs-page-desc" style="text-align:center">Sao chép nội dung dưới đây và gửi làm tin nhắn đầu tiên:</div>` +
    `<textarea id="stcs-out-text" readonly rows="12" style="width:100%;box-sizing:border-box;font-family:monospace;font-size:var(--fs-sm);` +
    `background:var(--bg-input,rgba(0,0,0,0.25));color:inherit;border:1px solid var(--border,rgba(255,255,255,0.15));border-radius:8px;padding:10px"></textarea>` +
    `<div class="stcs-btn-row" style="justify-content:center">` +
    `<button class="stcs-btn stcs-btn-primary" id="stcs-copy-btn" onclick="copyProfileText()">📋 Sao chép</button>` +
    `</div>`;
}

function buildSummaryPage(pageIndex: number): string {
  const parts: string[] = [];

  parts.push(`<div class="stcs-page-title">📋 Tổng kết</div>`);
  parts.push(`<div class="stcs-page-desc">Xem lại các thông số đã chọn rồi bấm Xác nhận — thiết lập sẽ được ghi vào biến MVU.</div>`);

  // (bug 116) Bảng đổ dữ liệu NGAY KHI VÀO trang này (nút "Tiếp tục ▶" của trang trước gọi
  // renderSummary qua goToPage-hook bên dưới) — bản cũ chỉ đổ sau khi bấm Xác nhận, lúc đó
  // user đã chuyển sang trang kết quả rồi nên chẳng ai kịp "xem lại".
  parts.push(`<table class="stcs-summary-table" id="stcs-summary-table">`);
  parts.push(`<tr><td colspan="2" style="text-align:center;color:var(--text-muted)">…</td></tr>`);
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

function buildSubmitHandler(
  analysis: SchemaAnalysis,
  gameName: string,
  scenarios: Array<{ title: string; desc: string }>,
): string {
  // Build field → stat_data path mappings
  const mappings: EditableMapping[] = [];
  for (const section of analysis.sections) {
    collectEditableMappings(section, mappings);
  }

  // (bug 116) VIẾT LẠI theo ĐÚNG khuôn thẻ mẫu One Piece — thẻ đã chứng minh chạy được:
  //   1. dựng cây stat_data từ form;
  //   2. ghi MỘT đường duy nhất: insertOrAssignVariables({stat_data}, {type:'message',
  //      message_id:'latest'}) — API này TavernHelper BƠM SẴN vào iframe nên luôn gọi được,
  //      và ghi vào biến MESSAGE-scoped là đúng chỗ MVU đọc (trình quản lý biến hiện
  //      message mới nhất). Bản cũ đi đường Mvu.parseMessage trước với chuỗi fallback
  //      3 tầng — nhiều phong cách là nhiều chỗ hỏng, đúng lời user dặn.
  //   3. xong thì sang trang kết quả: trạng thái + hồ sơ + nút Sao chép, người chơi gửi
  //      hồ sơ đó làm tin nhắn đầu tiên.
  return `
    var STCS_GAME_NAME = ${JSON.stringify(gameName)};
    var STCS_SCENARIOS = ${JSON.stringify(scenarios)};

    function buildProfileText(data, mappings) {
        var lines = [];
        lines.push('══════════════════════════════════');
        lines.push('⚙️ ' + STCS_GAME_NAME + ' · Hồ sơ khởi đầu');
        lines.push('══════════════════════════════════');
        var lastGroup = '';
        mappings.forEach(function(m) {
            var val = data[m.inputId];
            if (val === undefined || val === '') return;
            var group = m.path.length > 1 ? m.path[0] : '';
            if (group && group !== lastGroup) { lines.push(''); lines.push('─── ' + group + ' ───'); lastGroup = group; }
            lines.push(m.path[m.path.length - 1] + ': ' + val);
        });
        var chosen = data['stcs-scenario-cards'];
        if (chosen) {
            var sc = null;
            STCS_SCENARIOS.forEach(function(s) { if (s.title === chosen) sc = s; });
            lines.push('');
            lines.push('─── Bối cảnh bắt đầu ───');
            lines.push(chosen + (sc && sc.desc ? '\\n' + sc.desc : ''));
        }
        lines.push('');
        lines.push('(Thiết lập trên đã được ghi vào biến MVU — hãy mở màn câu chuyện theo đúng hồ sơ và bối cảnh này.)');
        return lines.join('\\n');
    }

    function showResult(ok, detail, profileText) {
        var st = document.getElementById('stcs-result-status');
        if (st) st.innerHTML = ok
            ? '<div style="font-size:var(--fs-xl);font-weight:800;color:#22c55e">✅ Đã ghi thành công biến MVU</div>'
            : '<div style="font-size:var(--fs-xl);font-weight:800;color:#f59e0b">⚠ Chưa ghi được biến MVU</div>'
              + '<div style="font-size:var(--fs-sm);color:var(--text-muted);margin-top:4px">' + (detail || '')
              + ' — vẫn có thể sao chép hồ sơ bên dưới và gửi làm tin nhắn đầu tiên.</div>';
        var out = document.getElementById('stcs-out-text');
        if (out) out.value = profileText;
        goToPage(totalPages - 1);
    }

    function copyProfileText() {
        var el = document.getElementById('stcs-out-text');
        if (!el) return;
        var done = function() {
            var btn = document.getElementById('stcs-copy-btn');
            if (btn) { btn.textContent = '✅ Đã sao chép'; setTimeout(function() { btn.textContent = '📋 Sao chép'; }, 2000); }
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(el.value).then(done).catch(function() {
                el.select(); el.setSelectionRange(0, 999999); document.execCommand('copy'); done();
            });
        } else {
            el.select(); el.setSelectionRange(0, 999999); document.execCommand('copy'); done();
        }
    }

    // (bug 116) Đổ bảng tóm tắt NGAY KHI VÀO trang Tổng kết — để user thật sự "xem lại"
    // trước khi Xác nhận. Trang tổng kết là trang áp chót (trang chót là kết quả).
    function renderSummary() {
        var data = collectFormData();
        var mappings = ${JSON.stringify(mappings)};
        var html = '';
        mappings.forEach(function(m) {
            var val = data[m.inputId];
            if (val === undefined || val === '') return;
            html += '<tr><td>' + m.path[m.path.length - 1] + '</td><td>' + val + '</td></tr>';
        });
        var chosen = data['stcs-scenario-cards'];
        if (chosen) html += '<tr><td>Bối cảnh</td><td>' + chosen + '</td></tr>';
        stcsSetHtml('stcs-summary-table', html || '<tr><td colspan="2">Chưa nhập thông tin nào</td></tr>');
    }
    var _stcsGoToPage = goToPage;
    goToPage = function(n) {
        if (n === totalPages - 2) renderSummary();
        _stcsGoToPage(n);
    };

    function onConfirm() {
        var data = collectFormData();
        var mappings = ${JSON.stringify(mappings)};

        // Dựng cây stat_data từ form.
        var tree = {};
        var wrote = 0;
        mappings.forEach(function(m) {
            var val = data[m.inputId];
            if (val === undefined) return;
            var v;
            if (m.type === 'number') { var n2 = Number(val); v = isFinite(n2) ? n2 : String(val); }
            else if (m.type === 'boolean') { v = (val === true || val === 'true'); }
            else { v = String(val); }
            var node = tree, p = m.path;
            for (var i = 0; i < p.length - 1; i++) { if (!node[p[i]] || typeof node[p[i]] !== 'object') node[p[i]] = {}; node = node[p[i]]; }
            node[p[p.length - 1]] = v;
            wrote++;
        });

        var profileText = buildProfileText(data, mappings);

        // (bugNeedFix/114) TUYỆT ĐỐI KHÔNG im lặng: không thu được gì thì nói thẳng vì sao.
        if (!wrote) {
            var ids = mappings.map(function(m) { return m.inputId; });
            console.error('[STCS] Không thu được giá trị nào từ form. Cần các id: ' + ids.join(', ')
                + ' — nhưng form chỉ có: ' + Object.keys(data).join(', '));
            showResult(false, 'Form và bảng biến không khớp id (xem Console)', profileText);
            return;
        }

        // (bug 116) MỘT đường ghi duy nhất — đúng khuôn thẻ One Piece:
        // insertOrAssignVariables được TavernHelper bơm thẳng vào iframe; nếu vì lý do gì
        // không có ở scope hiện tại thì với lên parent. Ghi MESSAGE-scoped 'latest' — đúng
        // chỗ MVU đọc và trình quản lý biến hiển thị.
        var opts = { type: 'message', message_id: 'latest' };
        var fn = (typeof insertOrAssignVariables === 'function') ? insertOrAssignVariables
               : (window.TavernHelper && typeof window.TavernHelper.insertOrAssignVariables === 'function') ? window.TavernHelper.insertOrAssignVariables
               : (window.parent && window.parent.TavernHelper && typeof window.parent.TavernHelper.insertOrAssignVariables === 'function') ? window.parent.TavernHelper.insertOrAssignVariables
               : null;
        if (!fn) {
            console.error('[STCS] Không tìm thấy API insertOrAssignVariables (TavernHelper chưa nạp?).');
            showResult(false, 'Thiếu API TavernHelper', profileText);
            return;
        }
        Promise.resolve(fn({ stat_data: tree }, opts)).then(function() {
            console.log('[STCS] Đã ghi ' + wrote + ' biến vào stat_data (message latest).');
            // Báo cho status bar / UI khác vẽ lại (nếu MVU có mặt) — giống thẻ mẫu.
            try {
                var M = (typeof Mvu !== 'undefined' && Mvu) ? Mvu : (window.parent && window.parent.Mvu);
                if (M && M.events && typeof eventEmit === 'function') eventEmit(M.events.VARIABLE_UPDATE_ENDED);
            } catch (e) { /* chỉ để vẽ lại UI — lỗi thì thôi */ }
            showResult(true, '', profileText);
        }).catch(function(e) {
            console.error('[STCS] insertOrAssignVariables thất bại:', e);
            showResult(false, String(e && e.message || e), profileText);
        });
    }
`;
}

/**
 * (bugNeedFix/114) HẬU TỐ ID phải khớp ĐÚNG id thật của thẻ input trong form.
 *
 * Đây là gốc rễ của bug: form render input với id có hậu tố —
 *     số        → `<id>-slider`   (thanh trượt hoặc ô nhập số)
 *     chuỗi     → `<id>-input`
 *     lựa chọn  → `<id>-cards`    (lưới thẻ, giá trị ở data-value của thẻ .selected)
 *     bật/tắt   → `<id>-check`    (checkbox)
 * …nhưng bảng `mappings` lại ghi id TRẦN (không hậu tố). Nên `data[m.inputId]` luôn `undefined`,
 * mọi field bị bỏ qua, `cmds` rỗng và hàm `return` IM LẶNG — không lỗi, không toast. Người dùng
 * thấy form nhận chữ, bấm Xác nhận thấy bảng tóm tắt hiện ra, nhưng trình quản lý biến trống
 * trơn: đúng lời báo "chỉ mới đang nhập cho có, chứ chưa cập nhật vào Trình quản lý biến".
 */
type EditableKind = 'number' | 'string' | 'enum' | 'boolean';

const INPUT_ID_SUFFIX: Record<EditableKind, string> = {
  number: '-slider',
  string: '-input',
  enum: '-cards',
  boolean: '-check',
};

export interface EditableMapping {
  /** ID THẬT của thẻ input trong DOM (đã kèm hậu tố). */
  inputId: string;
  path: string[];
  /** Kiểu để đổi giá trị sang literal đúng khi dựng lệnh _.set. */
  type: EditableKind;
}

function collectEditableMappings(
  section: SectionAnalysis,
  result: EditableMapping[],
): void {
  const buckets: Array<[EditableKind, typeof section.numericFields]> = [
    ['number', section.numericFields],
    ['string', section.stringFields],
    ['enum', section.enumFields],
    ['boolean', section.booleanFields],
  ];
  for (const [kind, list] of buckets) {
    for (const f of list) {
      if (f.field.constraints?.readOnly) continue;
      result.push({ inputId: `${f.elementId}${INPUT_ID_SUFFIX[kind]}`, path: f.keyPath, type: kind });
    }
  }
  for (const nested of section.nestedSections) {
    collectEditableMappings(nested, result);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// (Goal 28/07) RÀNG BUỘC MỀM GIỮA CHỈ SỐ LIÊN QUAN
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Bản relation đã đổi path → id input THẬT của form (kèm nhãn hiển thị). Relation nào có
 * trường không nhập được trên form (readOnly/hidden/không tồn tại) thì bỏ — không có ô để
 * đọc giá trị thì không cảnh báo được, và cũng không được bịa.
 */
interface CompiledRelation {
  depPath: string;
  aId: string;
  aLabel: string;
  dId: string;
  dLabel: string;
  basis: string;
  lms: Array<{ a: number | [number, number] | string; min?: number; max?: number; note?: string }>;
}

function compileRelationsForForm(schema: MVUZODSchema, analysis: SchemaAnalysis): CompiledRelation[] {
  const rels = (schema.statRelations ?? []).filter(r => Array.isArray(r?.landmarks) && r.landmarks.length);
  if (rels.length === 0) return [];

  // Map path chuẩn hoá → id input + nhãn. Hậu tố id theo ĐÚNG cách buildFormPage render:
  // có enumValues → lưới thẻ '-cards', còn lại số → '-slider'.
  const byPath = new Map<string, { inputId: string; label: string }>();
  const walk = (sections: SectionAnalysis[]) => {
    for (const s of sections) {
      for (const fa of s.allLeafFields) {
        const f = fa.field;
        if (f.constraints?.readOnly) continue;
        if (f.constraints?.enumValues?.length) {
          byPath.set(normalizeFieldPath(f.path), { inputId: `${fa.elementId}-cards`, label: f.label });
        } else if (f.type === 'number') {
          byPath.set(normalizeFieldPath(f.path), { inputId: `${fa.elementId}-slider`, label: f.label });
        }
      }
    }
  };
  walk(analysis.sections);

  const out: CompiledRelation[] = [];
  for (const r of rels as StatRelation[]) {
    const aPath = normalizeFieldPath(r.anchorPath);
    const dPath = normalizeFieldPath(r.dependentPath);
    const a = byPath.get(aPath);
    const d = byPath.get(dPath);
    if (!a || !d || !r.basis) continue;
    out.push({
      depPath: dPath,
      aId: a.inputId, aLabel: a.label,
      dId: d.inputId, dLabel: d.label,
      basis: r.basis,
      lms: r.landmarks.map(lm => ({
        a: lm.anchor,
        ...(lm.plausibleMin !== undefined ? { min: lm.plausibleMin } : {}),
        ...(lm.plausibleMax !== undefined ? { max: lm.plausibleMax } : {}),
        ...(lm.note ? { note: lm.note } : {}),
      })),
    });
  }
  return out;
}

/**
 * JS cảnh báo mềm nhúng vào form. Nguyên tắc (đúng lời user):
 *  • Giá trị neo KHÔNG khớp mốc nào ⇒ im lặng — lore không nói tới thì không bịa.
 *  • Mốc số khớp CHÍNH XÁC hoặc trong khoảng [lo,hi]; KHÔNG nội suy (nội suy = công thức).
 *  • Cảnh báo luôn kèm CĂN CỨ (note của mốc / basis của relation) + khoảng thường thấy,
 *    và nói rõ người chơi được quyền giữ nguyên. KHÔNG BAO GIỜ chặn Xác nhận.
 */
function buildRelationJS(relations: CompiledRelation[]): string {
  if (relations.length === 0) return '';
  const runtime = relations.map(({ depPath: _d, ...r }) => r);
  return `
    // ── (Goal 28/07) Cảnh báo mềm giữa chỉ số liên quan ──
    var STCS_RELATIONS = ${JSON.stringify(runtime)};

    function stcsFindLandmark(lms, raw) {
        var num = Number(raw);
        var isNum = String(raw).trim() !== '' && isFinite(num);
        for (var i = 0; i < lms.length; i++) {
            var a = lms[i].a;
            if (Array.isArray(a)) { if (isNum && num >= a[0] && num <= a[1]) return lms[i]; }
            else if (typeof a === 'number') { if (isNum && num === a) return lms[i]; }
            else if (String(raw).trim() === String(a).trim()) return lms[i];
        }
        return null;
    }

    function stcsRelationWarnings() {
        var data = collectFormData();
        var out = [];
        STCS_RELATIONS.forEach(function(r) {
            var av = data[r.aId], dvRaw = data[r.dId];
            if (av === undefined || av === '' || dvRaw === undefined || dvRaw === '') return;
            var dv = Number(dvRaw);
            if (!isFinite(dv)) return;
            var lm = stcsFindLandmark(r.lms, av);
            if (!lm) return;
            var low = (typeof lm.min === 'number' && dv < lm.min);
            var high = (typeof lm.max === 'number' && dv > lm.max);
            if (!low && !high) return;
            var range = (typeof lm.min === 'number' ? lm.min : '…') + '–' + (typeof lm.max === 'number' ? lm.max : '…');
            var msg = '⚠ ' + r.dLabel + ' = ' + dv + ' có vẻ ' + (high ? 'cao' : 'thấp') + ' bất thường so với '
                + r.aLabel + ' = ' + av + ' — ' + (lm.note || r.basis)
                + ' (khoảng thường thấy: ' + range + '). Bạn vẫn có thể giữ nguyên nếu đó là chủ đích.';
            out.push({ id: r.dId, msg: msg });
        });
        return out;
    }

    function stcsRelationCheck() {
        var warns = stcsRelationWarnings();
        var byId = {};
        warns.forEach(function(w) { byId[w.id] = (byId[w.id] ? byId[w.id] + '<br>' : '') + w.msg; });
        STCS_RELATIONS.forEach(function(r) {
            var el = document.getElementById(r.dId + '-warn');
            if (!el) return;
            var m = byId[r.dId];
            if (m) { el.innerHTML = m; el.style.display = 'block'; }
            else { el.innerHTML = ''; el.style.display = 'none'; }
        });
    }

    // Neo là lưới thẻ (enum) → soát lại ngay khi người chơi đổi lựa chọn.
    var _stcsRelSelectCard = selectCard;
    selectCard = function(el, gridId) { _stcsRelSelectCard(el, gridId); stcsRelationCheck(); };
    // Đổ cảnh báo (nếu có) xuống dưới bảng Tổng kết — người chơi thấy căn cứ lần cuối
    // trước khi Xác nhận; Xác nhận KHÔNG bị chặn.
    var _stcsRelGoToPage = goToPage;
    goToPage = function(n) {
        _stcsRelGoToPage(n);
        if (n === totalPages - 2) {
            var warns = stcsRelationWarnings();
            var tbl = document.getElementById('stcs-summary-table');
            if (tbl && warns.length) {
                tbl.innerHTML += warns.map(function(w) {
                    return '<tr><td colspan="2" style="color:#f59e0b;line-height:1.5">' + w.msg + '</td></tr>';
                }).join('');
            }
        }
        stcsRelationCheck();
    };
    if (document.addEventListener) document.addEventListener('input', stcsRelationCheck);
`;
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
      return buildOpeningFormResult(options.schema, theme, options.gameName, options.scenarios);
    case 'full_set':
      return buildFullSetResult(options.schema, theme, options.gameName, options.scenarios);
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
  scenarios?: Array<{ title: string; desc: string }>,
): ProgrammaticBuildResult {
  const css = generateOpeningFormCSS(theme);
  const { html, js, fieldsRendered } = buildOpeningForm(schema, gameName, scenarios);
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
  scenarios?: Array<{ title: string; desc: string }>,
): ProgrammaticBuildResult {
  const statusResult = buildStatusBarResult(schema, theme, gameName);
  const formResult = buildOpeningFormResult(schema, theme, gameName, scenarios);

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

/**
 * (bug 149) Tìm 1-2 trường để hiện ở dòng phụ dưới tiêu đề (thời gian / nơi chốn).
 *
 * Hai lỗ khiến chữ "Loading..." nằm lì trên thanh trạng thái — KHÔNG chỉ trong khung xem trước
 * mà cả trong card thật:
 *   1. chỉ quét stringFields + enumFields, bỏ qua NUMBER. Mà "Ngày", "Tháng", "Năm", "Lượt"
 *      hầu như luôn là số — đúng schema trong ảnh user gửi ("Ngày (SC)" kiểu Number).
 *   2. bộ từ khoá thiếu những chữ hay dùng nhất trong tiếng Việt: giờ, buổi, mùa, năm, nơi,
 *      địa điểm, bản đồ. "Khung Giờ" của user không khớp chữ nào trong bảng cũ.
 */
function findHeaderFields(analysis: SchemaAnalysis): FieldAnalysis[] {
  const RE = /thời|time|ngày|tháng|năm|mùa|giờ|buổi|lượt|turn|date|khu vực|vị trí|nơi|địa điểm|bản đồ|map|location|place|地点|时间|日期/;
  const result: FieldAnalysis[] = [];
  // Quét cả section LỒNG NHAU: "Trạng thái thế giới › Khu vực hiện tại" nằm ở tầng hai, quét
  // mỗi tầng một thì đúng trường cần tìm lại là trường bị bỏ qua.
  const walk = (sections: SectionAnalysis[]) => {
    for (const s of sections) {
      // selfLeaf đứng đầu: với schema PHẲNG thì đó là nơi duy nhất trường lá tồn tại.
      const cands = [...(s.selfLeaf ? [s.selfLeaf] : []), ...s.stringFields, ...s.enumFields, ...s.numericFields];
      for (const f of cands) {
        if (result.length >= 2) return;
        if (RE.test(f.field.label.toLowerCase())) result.push(f);
      }
      if (result.length >= 2) return;
      walk(s.nestedSections);
      if (result.length >= 2) return;
    }
  };
  walk(analysis.sections);
  return result;
}

function getMaxValue(field: MVUZODField): number | undefined {
  if (field.type !== 'number') return undefined;
  // (bugNeedFix/113) TRƯỚC ĐÂY: không khai trần thì `return 100`. Hệ quả đúng như user báo —
  // "Ngày (Thời gian trôi) 1/100", "Tiền tệ Veil Coin 75/100", kèm thanh tiến trình vô nghĩa.
  // Ngày, tiền, số lượng vật phẩm là BỘ ĐẾM: không có trần, ý nghĩa nằm ở con số chứ không ở
  // tỉ lệ. Nay hỏi numericSemantics: chỉ biến thật sự có trần mới trả về max (⇒ mới vẽ thanh).
  const d = decideNumericBounds(field);
  return d.bounded ? d.max : undefined;
}

/** Sanitize a label string into a safe DOM ID fragment */
/**
 * (bug 159-6) Sinh id DUY NHẤT trong một lần dựng. Trùng thì nối hậu tố -2, -3…
 * Tên rỗng sau khi lọc (vd nhãn toàn ký tự lạ) thì đặt tên thay thế, không để id rỗng —
 * id rỗng làm mọi getElementById('') trả về null và cả form chết lặng.
 */
function makeIdMinter(): (base: string) => string {
  const used = new Map<string, number>();
  return (raw: string) => {
    const base = raw.replace(/-+$/, '') || 'stcs-field';
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  };
}

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
