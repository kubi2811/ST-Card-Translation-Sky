// ─── Kiểu dữ liệu cho tool "Dịch Script" (tab native, Phase B) ───
// Dịch bundle JS TavernHelper 1-3MB Trung→Việt. Nguyên tắc vàng: CODE KHÔNG BAO GIỜ
// GỬI CHO AI — chỉ gửi danh sách chuỗi CJK đã tách (surgical extract), nên cấu trúc
// script được bảo toàn 100% theo thiết kế chứ không phải nhờ AI ngoan.
import type { GlossaryEntry } from '../types/card';

export interface ScriptTranslateOptions {
  /** Làm đẹp code (Prettier) trước khi dịch — auto bật khi phát hiện file minified */
  beautify: boolean;
  /** Chèn khối chiến thuật NSFW (promptBuilder) — cho script 18+ */
  nsfw: boolean;
  /**
   * Regex khớp nhãn tiếng Trung (vd tên nhân vật) → THÊM nhánh tiếng Việt giữ nguyên Hán:
   * /秋青子/ → /(?:秋青子|Thu Thanh Tử)/ — vì regex đó phải khớp CẢ output cũ lẫn mới.
   */
  regexAlternation: boolean;
}

export const DEFAULT_SCRIPT_OPTIONS: ScriptTranslateOptions = {
  beautify: true,
  nsfw: false,
  regexAlternation: true,
};

export type ScriptStage =
  | 'idle' | 'beautify' | 'extract' | 'translate' | 'reinsert' | 'regex' | 'validate' | 'done' | 'error';

export interface ScriptProgress {
  stage: ScriptStage;
  /** Lô đã xong / tổng số lô (chỉ stage translate) */
  done?: number;
  total?: number;
  note?: string;
}

export interface ScriptTranslateReport {
  /** Gốc có parse được không (gốc vỡ sẵn thì lỗi sau KHÔNG phải do dịch) */
  parseOkBefore: boolean;
  parseOk: boolean;
  parseError?: string;
  parityOk: boolean;
  parityDetail?: string;
  /** Token CJK cần dịch mà chưa có bản dịch (sau retry) */
  residualTokens: number;
  residualSamples: string[];
  /** Token bị BỎ QUA CÓ CHỦ ĐÍCH (object key / dot-notation / CSS class — giữ nguyên là ĐÚNG) */
  preservedTokens: number;
  tokenTotal: number;
  cjkCharsIn: number;
  cjkCharsOut: number;
  regexChanged: number;
  regexReverted: number;
  bytesIn: number;
  bytesOut: number;
  durationMs: number;
}

export interface ScriptPipelineDeps {
  /** Cấu hình proxy chính (store.proxy) — engine đa luồng đọc RPM/model/key từ đây */
  proxy: import('../types/card').ProxySettings;
  providers: import('../types/card').ProviderConfig[];
  /** Bảng tên/thuật ngữ (Pha 0 + user sửa tay) — bơm vào MỌI lô để tên nhất quán */
  glossary: GlossaryEntry[];
  /** Kiểu tên riêng + đồng nhân — dùng lại đúng setting của Dịch Card */
  nameStyle: import('../types/card').NameStyle;
  fandomMode: boolean;
  fandomName: string;
}

export interface ScriptRunControl {
  signal: AbortSignal;
  /** Trả true khi user bấm Tạm dừng — pool sẽ chờ */
  isPaused?: () => boolean;
  /**
   * Gọi sau mỗi lô xong, KÈM danh sách token hiện tại — để UI lưu tiến độ (resume sau F5).
   * Phải truyền token qua callback vì UI không thấy mảng token cho tới khi run xong.
   */
  onTokensUpdated?: (tokens: import('../utils/surgical').CJKToken[]) => void;
}

export interface ScriptTranslateResult {
  output: string;
  report: ScriptTranslateReport;
  /** Token cuối cùng (kèm translated) — UI dùng cho "Dịch lại mục lỗi" + lưu resume */
  tokens: import('../utils/surgical').CJKToken[];
}
