/**
 * varListTemplates.ts — Khuôn in một biến MVU ra entry "Danh sách biến".
 * ─────────────────────────────────────────────────────────────────────────────
 * Tách khỏi VariableListGenerator.tsx để có chỗ kiểm bằng test: ba khuôn cũ nằm trong component
 * và cả ba đều sinh đường dẫn KHÔNG đọc được biến —
 *
 *   getvar('.Người Chơi.HP')                         ← dấu chấm thừa ở đầu + thiếu 'stat_data.'
 *   {{format_message_variable::Người Chơi.HP}}       ← thiếu 'stat_data.'
 *   Mvu.getMvuData(...).stat_data['A']['B']          ← trả về CẶP [giá trị, "mô tả"], in ra cả mô tả
 *
 * mà chẳng test nào chạm tới nên không ai thấy.
 */
import type { MVUZODField } from '../../types/mvuzod.types';

/**
 * `field.path` là JSON Pointer (`/Người Chơi/HP`) → đường dẫn dấu chấm mà getvar/macro đọc được.
 * Phải BỎ đoạn rỗng đầu tiên; `.replace(/\//g,'.')` sẽ để lại một dấu chấm thừa ở đầu.
 */
export function dotPath(field: MVUZODField): string {
  return String(field.path || '').split('/').filter(Boolean).join('.');
}

export interface VarListTemplate {
  id: string;
  label: string;
  description: string;
  /** Một dòng "Nhãn: <giá trị>" để nhét vào entry Danh sách biến. */
  injectionTemplate: (field: MVUZODField) => string;
}

/**
 * MỌI đường dẫn biến MVU đều bắt đầu bằng `stat_data.` — cả `getvar()` lẫn macro
 * `{{format_message_variable::…}}` (rule/EJS实战指南 mục "用 getvar 获取变量"; toàn bộ ejsSnippets
 * của tool cũng viết vậy).
 *
 * `[].concat(x)[0]`: MVU lưu mỗi biến dạng CẶP `[giá_trị, "mô tả"]` (xem mvuRuntime.ts) — in
 * thẳng ra là dính luôn câu mô tả vào bảng. `[].concat` bóc được cặp, mà giá trị trần thì cũng
 * không sao, nên dùng chung được cho mọi biến. Cố tình dùng JS thuần thay vì `_.castArray`:
 * lodash CÓ trong context EJS của các thẻ thật, nhưng khuôn này không cần phụ thuộc vào điều đó.
 */
export const VARLIST_TEMPLATES: VarListTemplate[] = [
  {
    id: 'ejs-getvar',
    label: 'EJS getvar() — Chuẩn',
    description: 'Dùng getvar() để đọc biến, gửi dưới dạng text cho AI',
    injectionTemplate: (field) =>
      `${field.label}: <%= [].concat(getvar('stat_data.${dotPath(field)}', { defaults: '—' }))[0] %>`,
  },
  {
    id: 'ejs-mvu',
    label: 'EJS getMvuData() — MVU Native',
    description: 'Dùng Mvu.getMvuData() trực tiếp, cần MVU ZOD framework',
    injectionTemplate: (field) =>
      `${field.label}: <%= [].concat(_.get(Mvu.getMvuData({type:'message',message_id:'latest'}).stat_data, '${dotPath(field)}'))[0] %>`,
  },
  {
    id: 'macro',
    label: 'SillyTavern Macro',
    description: 'Dùng macro {{format_message_variable::X}} tiêu chuẩn',
    injectionTemplate: (field) =>
      `${field.label}: {{format_message_variable::stat_data.${dotPath(field)}}}`,
  },
];
