/**
 * types.ts — hợp đồng giữa app Tạo Card và bộ front-end (bug 192).
 *
 * `FrontendKitOptions` là thứ NGƯỜI DÙNG chỉnh trong tab Front-End.
 * `StfeConfig` là thứ được SINH RA từ options + schema, rồi tuần tự hoá thành mã config
 * nhúng vào giao diện. Nó chỉ chứa DỮ LIỆU — không hàm nào — nên sinh ra an toàn:
 * runtime đã có sẵn bản tổng quát chạy bằng chính mấy mô tả khai báo này.
 */
import type { RegexScript } from '../../types';

/** Một trường trên biểu mẫu màn khởi tạo. */
export interface StfeFormField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select';
  /** Đường dẫn kiểu "Nhân Vật.Tên" trong stat_data. */
  path: string;
  value: string | number;
  options?: string[];
  min?: number;
  max?: number;
  placeholder?: string;
  hint?: string;
  allowEmpty?: boolean;
  showIf?: { key: string; equals: string };
  emptyValue?: string | number;
}

export interface StfePanelField {
  k: string;
  p: string;
  hideEmpty?: boolean;
  wide?: boolean;
  suffix?: 'p2';
  p2?: string;
}

export interface StfePanel {
  id: string;
  label: string;
  type: 'chat' | 'fields' | 'list';
  fields?: StfePanelField[];
  path?: string;
  name?: string;
  tag?: string;
  tagPrefix?: string;
  desc?: string;
  groupBy?: string;
  empty?: string;
  note?: { k: string; p: string }[];
  bar?: { cur: string; max: string; label: string };
}

export interface StfeHeaderSpec {
  namePath: string;
  /** `tpl` dùng một cặp ngoặc nhọn: "{Thế Giới.Ngày}/{Thế Giới.Tháng}". */
  chips: { k: string; tpl: string }[];
  money: { k: string; p: string }[];
  bars: { label: string; cur: string; max: string; color?: string }[];
}

export interface StfeScenario {
  id: string;
  title: string;
  desc: string;
  seed: string;
}

/** Suy một giá trị từ lựa chọn khác trên biểu mẫu (VD thiên phú → thể lực tối đa). */
export interface StfeDerive {
  fromKey: string;
  map: Record<string, number | string>;
  fallback?: number | string;
  targets: string[];
}

export interface StfeConfig {
  id: string;
  title: string;
  subtitle: string;
  updateTag: string;
  bootTag: string;
  historyTurns: number;
  maxStoredTurns: number;
  maxSnapshots: number;
  theme: Record<string, string>;
  defaultStat: Record<string, unknown>;
  form: StfeFormField[];
  derive: StfeDerive[];
  scenarios: StfeScenario[];
  scenarioPath?: string;
  freeNote: { label: string; placeholder: string };
  headerSpec: StfeHeaderSpec;
  panels: StfePanel[];
  pathTable: string[];
  quickActions: string[];
  openingExtra?: string;
}

/** Bảng màu dựng sẵn cho tab Front-End. */
export interface StfeThemePreset {
  id: string;
  label: string;
  vars: Record<string, string>;
}

/** Những gì người dùng chỉnh được trong tab Front-End. */
export interface FrontendKitOptions {
  title: string;
  subtitle: string;
  /** Thẻ đánh dấu màn khởi tạo, đặt trong first_mes. */
  bootTag: string;
  /** Thẻ cập nhật biến THẬT của thẻ này — dò từ card, không đoán. */
  updateTag: string;
  themeId: string;
  historyTurns: number;
  /** Key của các trường schema được đưa lên biểu mẫu khởi tạo. */
  formPaths: string[];
  /** Đường dẫn các trường làm chip ở thanh đầu. */
  chipPaths: string[];
  /** Cặp hiện tại/tối đa làm thanh chỉ số. */
  bars: { label: string; cur: string; max: string }[];
  /** Đường dẫn tên nhân vật hiển thị ở thanh đầu. */
  namePath: string;
  scenarios: StfeScenario[];
  quickActions: string[];
  openingExtra: string;
  derive: StfeDerive[];
  /** Đường dẫn ghi tóm tắt bối cảnh mở màn (thường là ".../Bối Cảnh"). */
  scenarioPath: string;
}

export interface FrontendBuildResult {
  configSource: string;
  openingHtml: string;
  mainHtml: string;
  /** Vi phạm luật payload; rỗng là sạch. */
  violations: string[];
  scripts: RegexScript[];
  firstMes: string;
  sizes: { opening: number; main: number };
}
