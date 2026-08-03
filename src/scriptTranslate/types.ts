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
  /**
   * (bug 187 — Hạng mục B) Số phận KHOÁ DỮ LIỆU (object key / dot-notation / đường dẫn):
   *   'rename' — đổi theo Từ Điển (card đã dịch biến → script PHẢI đổi theo, thiếu khoá nào
   *              trong Từ Điển là chặn, vì sót một khoá là đọc ra undefined không ai báo);
   *   'keep'   — giữ nguyên tiếng Trung (card CHƯA đổi biến → đổi khoá mới là hỏng).
   * Đây là quyết định user phải chọn TRƯỚC khi dịch — tool không đoán được card của họ.
   */
  keyMode: 'rename' | 'keep';
  /**
   * (review 187) Cổng chặn coverage nằm TRONG pipeline: keyMode 'rename' mà Từ Điển thiếu
   * khoá → ném lỗi TRƯỚC mọi call API. Mặc định bật (tab Dịch Script); Dịch Preset tắt vì
   * hợp đồng của nó xưa nay là đổi-được-thì-đổi (bug 151), khoá thiếu giữ Hán không phải lỗi.
   */
  enforceDictCoverage: boolean;
  /**
   * (bug 200 — Hạng mục G) Chuẩn hoá dấu câu CJK cosmetic trong văn xuôi/comment của bản dịch.
   * Theo TỪNG VỊ TRÍ qua AST — delimiter chức năng (.split('、')…), khoá, đường dẫn, regex
   * không bao giờ bị đụng. Mặc định bật; tắt được khi user muốn giữ nguyên văn phong gốc.
   */
  punctNormalize: boolean;
}

export const DEFAULT_SCRIPT_OPTIONS: ScriptTranslateOptions = {
  beautify: true,
  nsfw: false,
  regexAlternation: true,
  keyMode: 'rename',
  enforceDictCoverage: true,
  punctNormalize: true,
};

export type ScriptStage =
  | 'idle' | 'beautify' | 'extract' | 'translate' | 'reinsert' | 'regex' | 'punct' | 'validate' | 'verify' | 'done' | 'error';

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
  /** (bug 151) Khoá dữ liệu được ĐỔI TÊN theo từ điển user (tất định, không qua AI). */
  dictRenamed: number;
  /** (bug 151) Số ký tự Hán nằm TRONG các token giữ nguyên — để "0/82 chưa dịch" thôi mâu
   *  thuẫn với "còn 247 ký tự Trung": hai con số đếm hai tập khác nhau, phải nói rõ ra. */
  preservedCjkChars: number;
  /** (bug 151) Vài tên khoá tiêu biểu đang giữ nguyên — user thêm vào Từ Điển là đổi được. */
  preservedSamples: string[];
  cjkCharsIn: number;
  cjkCharsOut: number;
  regexChanged: number;
  regexReverted: number;
  /**
   * (bug 200 — Mục 1.3/1.4) Cụm CJK nằm trong character class của regex — pass alternation
   * CHỦ ĐỘNG không đụng (đúng), nhưng phải BÁO ra kèm truy nguồn Từ Điển: trùng khoá đã dịch
   * là rủi ro cao (trường dữ liệu regex này soi có thể đã bị dịch ⇒ .test() luôn false).
   * Cảnh báo để người review quyết — KHÔNG tự viết lại class.
   */
  regexSkippedInClass?: import('./regexAlternation').SkippedInClassAnalysis[];
  /** (bug 200 — Hạng mục G) Số vị trí dấu câu CJK cosmetic đã chuẩn hoá trong văn xuôi/comment. */
  punctNormalized?: number;
  /** (bug 200 — Hạng mục G) Số vị trí giữ nguyên vì là delimiter chức năng / vị trí rủi ro. */
  punctKeptFunctional?: number;
  bytesIn: number;
  bytesOut: number;
  /** (bug 160) Số dòng trước/sau — phình ra là có xuống dòng bị chèn vào giữa chuỗi JS. */
  linesIn?: number;
  linesOut?: number;
  durationMs: number;
  /** (bug 187 — Hạng mục A) Cơ chế trích token: 'ast' (chuẩn) hay 'regex' (dự phòng khi không parse được). */
  extractMode?: 'ast' | 'regex';
  /** (bug 187 — Hạng mục B) Coverage Từ Điển khoá tại thời điểm chạy (chỉ có ở keyMode 'rename'). */
  dictCoverage?: import('./astExtract').DictCoverage;
  /** (bug 187 — Hạng mục B) Chế độ khoá user đã chọn cho lần chạy này. */
  keyMode?: 'rename' | 'keep';
  /** (bug 187 — Hạng mục F) 4 phép kiểm AST sau dịch — cổng QA trước khi cho export. */
  astVerify?: import('./astVerifier').AstVerifyReport;
  /** (bug 187 — Hạng mục D) Nhật ký retry/lỗi từng lô — lỗi không được nuốt âm thầm nữa. */
  retryLog?: string[];
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
