/**
 * mod-card/src/i18n/vi.ts — Tiếng Việt.
 * ⚠️ Mỗi value là BẢN SAO NGUYÊN VĂN chuỗi đang hiển thị hôm nay (không sửa chính tả,
 * không đổi hoa/thường, giữ nguyên "..." vs "…" và emoji). Bấm VI = giao diện y hệt trước.
 */
import type { ModUiKeys } from './en';

const vi: ModUiKeys = {
  // Header
  appSubtitle: 'Chỉnh sửa tự động Character Card V3 an toàn với LLM',
  settingsBtn: '⚙️ Cài đặt LLM',

  // Cột trái — tệp
  fileSection: 'Tệp Nhân Vật',
  fileLoadedPrefix: '✅ Đã tải:',
  fileUnnamed: 'Vô danh',
  fileLorebookMode: '📖 Chế độ Mod LOREBOOK ({count} mục) → xuất riêng Lorebook',
  fileMvuZod: '🧬 Kiến trúc RPG: MVU-ZOD Card',
  fileLoadAnother: 'Tải tệp khác',

  // Biến Zod
  zodSection: 'Cơ sở dữ liệu Biến số (Zod)',
  zodDesc: 'Các biến được định nghĩa cứng trong Zod Schema:',
  zodRemapped: 'Đã đổi {count} biến MVU-Zod. Xem tab So sánh / Xuất file.',

  // Yêu cầu mod
  modSection: 'Yêu cầu Mod bằng AI',
  modPlaceholder: 'Nhập yêu cầu tùy chỉnh... VD: Đổi tên nhân vật từ Ngân Kỳ sang Anh Kiệt, và đổi cốt truyện thành một hiệp sĩ trung cổ...',
  subExpandDone: 'Đã đào sâu 1 phần. Xem tab So sánh / Xuất file.',

  // Orchestrator
  orchSection: 'Điều khiển Orchestrator',
  expandMode: '✨ Chế độ Mở rộng / đào sâu',
  expandModeDesc: 'Thay vì làm theo nghĩa đen, AI đọc toàn cảnh lorebook, bổ sung 3-4 phần mở rộng & viết chi tiết hơn (bám lore).',
  expandIntensityLabel: 'Mức đào sâu:',
  intensityLight: 'Nhẹ',
  intensityMedium: 'Vừa',
  intensityDeep: 'Sâu',
  runBtn: '🚀 Chạy Mod Card Tự Động',
  stopBtn: '⏹ Dừng',
  scriptWarnBold: '{count} script có thể VỠ cú pháp',
  scriptWarnRest: 'sau khi mod (nạp vào SillyTavern dễ liệt nút) — kiểm tra tay ở Bảng Diff:',

  // Tabs
  tabWorkspace: 'Workspace (Sections)',
  tabDiff: 'Bảng Diff (Kết quả)',
  tabSettings: 'Cài đặt',
  needCardHint: 'Hãy tải một thẻ JSON ở cột bên trái để bắt đầu.',

  // Phân tích
  analysisTitle: 'Kết quả Phân tích (Analysis Report)',
  analysisEmpty: 'Chưa có kết quả phân tích. Hãy nhấn "Bắt đầu Phân Tích".',
  analysisReason: 'Lý do:',
  analysisPreview: 'Dự kiến sửa:',

  // Kết quả
  resultTitle: 'Kết Quả (Diff Viewer & Audit)',
  resultEmpty: 'Hãy chạy "Mod Card Tự Động" để xem kết quả tại đây.',
  auditTitle: '1. Nhất Quán (Audit Score)',
  validationTitle: '2. Kiểm Định (Validation Status)',
  validationVerified: 'Đã xác thực: {count} trường bảo vệ.',
  suggestLabel: 'Đề xuất',
  downloadLorebook: '⬇️ Tải Lorebook JSON (riêng)',
  downloadJson: '⬇️ Tải xuống JSON (Đã ghép Avatar)',
  jsonBefore: 'JSON Gốc (Chỉ hiển thị Text fields)',
  jsonAfter: 'JSON Sau Mod (Đã áp dụng thay đổi)',

  // Cài đặt
  settingsTitle: '⚙️ Cài Đặt Cấu Hình LLM & Proxy',
  settingsAutosave: 'Tự động lưu — mọi thay đổi lưu ngay vào trình duyệt, F5 / mở lại KHÔNG mất (không cần nút Lưu).',
  cfgProvider: '1. Nhà Cung Cấp (Provider)',
  cfgBaseUrl: '2. Đường Dẫn Proxy (Proxy Base URL)',
  cfgBaseUrlPhOpenai: 'VD: https://api.openrouter.ai/v1 hoặc https://api.openai.com/v1',
  cfgBaseUrlPhGemini: 'Mặc định (Google API) hoặc URL Proxy của bạn',
  cfgBaseUrlPhAnthropic: 'Mặc định (Anthropic API) hoặc URL Proxy của bạn',
  cfgBaseUrlHint: 'Để trống nếu muốn sử dụng API mặc định trực tiếp của nhà cung cấp.',
  cfgApiKey: '3. API Key / Mật Khẩu Proxy (Proxy Password)',
  cfgApiKeyPh: 'Nhập API Key hoặc Mật khẩu Proxy của bạn',
  cfgApiKeyNote: '🔒 Bảo mật: Thông tin chỉ lưu cục bộ trong trình duyệt của bạn (Local Storage) và không bao giờ tải lên bất kỳ máy chủ bên thứ ba nào ngoại trừ proxy bạn đã chọn.',
  cfgScanning: '🔄 Đang Quét Models...',
  cfgScanBtn: '🔍 Quét Danh Sách Model Từ Proxy',
  cfgModel: '4. Chọn Model Cần Dùng',
  cfgPickFromList: 'Chọn từ danh sách',
  cfgTypeManually: 'Nhập tay tên model',
  cfgModelPh: 'Nhập chính xác tên model, VD: gpt-4o, gemini-1.5-pro-latest',
  cfgRecommended: '(Khuyên dùng)',
  cfgMaxTokens: '5. Output Tokens Tối Đa (Max Output)',
  cfgTemperature: '6. Độ Sáng Tạo (Temperature)',

  // Alert
  alertNeedKeyScan: 'Vui lòng nhập API Key trước khi quét.',
  alertScanFailed: 'Quét model thất bại',
  alertScanOk: 'Đã quét thành công {count} models!',
  alertScanErrPrefix: 'Lỗi quét model: ',
  alertNeedCardKey: 'Vui lòng tải thẻ và nhập API Key trong phần Cài đặt trước khi chạy.',
  alertNeedRule: 'Vui lòng thêm ít nhất 1 Rule hoặc nhập Yêu cầu tùy chỉnh.',
  alertProcessErrPrefix: 'Gặp lỗi trong quá trình xử lý: ',

  // Trạng thái pipeline
  stage1: 'Giai đoạn 1: Đang khởi tạo và chuẩn bị...',
  stage2: 'Giai đoạn 2: Đang gọi LLM phân tích thẻ (Analyze Phase)...',
  stage3: 'Giai đoạn 3: Đang tiến hành Mod các section được đánh dấu (NEEDS_MOD)...',
  stage3Part: 'Giai đoạn 3: {verb} "{label}" — phần {done}/{total} (entry lớn, chia nhỏ cho khỏi lỗi)...',
  stage3Section: 'Giai đoạn 3: Đang {verb} section {label}...',
  verbExpand: 'MỞ RỘNG',
  verbMod: 'mod',
  stage4Keyword: 'Giai đoạn 4: Đang đồng bộ hóa từ khóa (Keyword Sync)...',
  stage4Audit: 'Giai đoạn 4: Đang đánh giá độ nhất quán (Consistency Audit)...',
  stage5: 'Giai đoạn 5: Đang chạy kiểm định tính an toàn cấu trúc (Validation)...',
  stageDone: 'Hoàn tất toàn bộ quy trình Mod! Đã có kết quả ở Bảng Diff.',
  stageStopped: '⏹ Đã dừng theo yêu cầu.',
  stageStopping: '⏹ Đang dừng…',
  stageError: 'Lỗi quy trình.',

  // ─── Dùng chung ───
  errNoApiKey: 'Chưa cấu hình API Key ở tab Cài đặt.',

  // FileUploader
  fuAlertBadJson: 'Lỗi đọc file JSON. Cần là Character Card V3 hoặc file Lorebook (có "entries").\n',
  fuTitle: 'Tải thẻ nhân vật HOẶC Lorebook (JSON)',
  fuDesc: 'Character Card V3 → mod cả thẻ · Lorebook (có "entries") → mod & xuất riêng Lorebook',

  // ModRulesManager
  mrAddRule: '+ Thêm Rule',
  mrEmpty: 'Chưa có quy tắc mod nào được thiết lập.',
  mrEdit: 'Sửa',
  mrDelete: 'Xóa',
  mrEditTitle: 'Chỉnh sửa Rule',
  mrName: 'Tên quy tắc',
  mrNamePh: 'VD: Đổi Theme NTR → NTL',
  mrOldTheme: 'Theme cũ',
  mrNewTheme: 'Theme mới',
  mrKeywords: 'Từ khóa nhận biết (cách nhau dấu phẩy)',
  mrDetails: 'Chi tiết thay đổi',
  mrCancel: 'Hủy',
  mrSave: 'Lưu',

  // VarRemapPanel
  vrErrNoRequest: 'Nhập yêu cầu đổi tên/nghĩa biến trước.',
  vrErrNoRemap: 'AI không đề xuất đổi biến nào (yêu cầu không khớp biến, hoặc parse rỗng). Thử diễn đạt lại.',
  vrErrNoRow: 'Không có dòng nào được chọn/đổi.',
  vrTitle: '🧬 Mod biến MVU-Zod',
  vrDesc: 'Đổi TÊN / NGHĨA của {count} biến trong schema theo yêu cầu — tự áp đồng bộ khắp schema, getvar, initvar, mvu_update. Runtime MVU không bị đụng.',
  vrPh: "VD: Đổi các biến chỉ số sang tiếng Việt (hp → sinh_lực, mp → linh_lực); đổi nghĩa biến 'affection' thành mức độ tin tưởng thay vì tình cảm…",
  vrAnalyzing: 'Đang phân tích biến…',
  vrAnalyze: '🔎 Phân tích biến',
  vrApply: '✅ Áp dụng ({count})',
  vrApplied: 'Đã áp dụng vào thẻ.',
  vrColOld: 'Biến cũ',
  vrColNew: 'Tên mới',
  vrColDesc: 'Nghĩa mới',
  vrKeepPh: '(giữ nguyên)',

  // SubExpandPanel
  seErrNoSection: 'Chọn 1 section.',
  seErrNoMarker: 'Nêu phần cần đào sâu (vd: <Appearance> hoặc "Ngoại hình").',
  seTitle: '🔬 Đào sâu 1 phần',
  seDesc: 'Mở rộng chi tiết đúng MỘT phần trong 1 section (vd block ngoại hình), giữ nguyên phần còn lại.',
  seSelectSection: 'Chọn section',
  seMarkerPh: 'Phần cần đào sâu — vd: <Appearance>  hoặc  "Ngoại hình"',
  seRequestPh: 'Yêu cầu thêm (tuỳ chọn) — vd: tả kỹ trang phục, sẹo, khí chất…',
  seRunning: 'Đang đào sâu…',
  seRun: '🔬 Đào sâu',
  seApply: '✅ Áp dụng',
  sePreview: 'Xem trước (có thể sửa trước khi áp):',

  // ExtraProvidersPanel
  epTitle: '🔀 Provider bổ sung (chạy song song)',
  epDesc: 'Thêm provider phụ → engine rải call round-robin với provider chính, chạy nhiều provider cùng lúc. Dùng model tốt tương đương để giữ chất lượng.',
  epRemove: 'Xoá',
  epBaseUrlPh: 'Base URL (nếu proxy)',
  epModelPh: 'Model (vd gemini-2.5-flash)',
  epAdd: '+ Thêm provider',
};

export default vi;
