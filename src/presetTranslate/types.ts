// ─── Kiểu dữ liệu cho tool "Dịch Preset" (tab native, Phase C) ───
// Dịch preset SillyTavern (JSON ~1MB, 250+ prompts) Trung→Việt. Nguyên tắc vàng:
// đổi tên biến {{setvar}}/tag XML = DETERMINISTIC sau AI (thay toàn cục bằng code),
// không bao giờ nhờ AI đổi trong từng lô — bảo đảm setvar/getvar khớp nhau tuyệt đối
// (mẫu thật: 342/342 setvar + 290/290 getvar phải giữ nguyên số lượng sau dịch).
import type { GlossaryEntry, STPreset } from '../types/card';

export interface PresetTranslateOptions {
  nsfw: boolean;
  /** Dịch cả script TavernHelper nhúng trong preset (đi nguyên pipeline Dịch Script) */
  translateEmbeddedScripts: boolean;
}

export const DEFAULT_PRESET_OPTIONS: PresetTranslateOptions = {
  nsfw: false,
  translateEmbeddedScripts: true,
};

/** Từ điển hợp nhất Pha 0 — nguồn nhất quán DUY NHẤT xuyên prompts ↔ regex ↔ script nhúng */
export interface PresetDict {
  /** Tên tag XML tự chế AI phải xuất ra: 正文 → Chính văn */
  tags: Record<string, string>;
  /** Tên biến {{setvar::X}}/{{getvar::X}} tiếng Trung → identifier ASCII: 美型化 → beautify */
  vars: Record<string, string>;
  /** Tên riêng (nhân vật/thế giới) — bơm vào prompt AI như glossary */
  names: GlossaryEntry[];
}

export const emptyPresetDict = (): PresetDict => ({ tags: {}, vars: {}, names: [] });

export type PresetStage =
  | 'idle' | 'parse' | 'translate' | 'consistency' | 'regex' | 'scripts' | 'validate' | 'done' | 'error';

export interface PresetProgress {
  stage: PresetStage;
  done?: number;
  total?: number;
  note?: string;
}

/** 1 hàng regex trong inventory */
export interface RegexRow {
  idx: number;
  scriptName: string;
  findRegex: string;
  cjkTerms: string[];
  /** 'auto' = mọi cụm CJK đều nằm trong dict tag/var → thay an toàn; 'manual' = có cụm lạ → GIỮ NGUYÊN + báo */
  decision: 'auto' | 'manual' | 'none';
}

export interface PresetInventory {
  promptCount: number;
  translateNameCount: number;
  translateContentCount: number;
  regexRows: RegexRow[];
  helperScripts: Array<{ idx: number; name: string; size: number; cjk: number }>;
  totalCjkChars: number;
}

export interface PresetTranslateReport {
  jsonOk: boolean;
  structureOk: boolean;
  structureErrors: string[];
  macroParityOk: boolean;
  macroParityErrors: string[];
  regexChanged: number;
  regexReverted: number;
  regexManual: string[];
  /** (việc 118) Số findRegex được đồng bộ NHÃN với prompt đã dịch (选项一： → Lựa chọn 1:). */
  regexLabelSynced?: number;
  /** (bug 153) Số đơn vị bị dịch LẠI vì lần trước còn sót chữ Hán giữa chừng. */
  residualRetried?: number;
  /** (việc 118) Số replaceString (HTML làm đẹp) của regex script được dịch. */
  regexHtmlTranslated?: number;
  scriptsTranslated: number;
  unitsTotal: number;
  unitsFailed: number;
  bytesIn: number;
  bytesOut: number;
  durationMs: number;
}

export interface PresetTranslateResult {
  outputJson: string;
  preset: STPreset;
  report: PresetTranslateReport;
}
