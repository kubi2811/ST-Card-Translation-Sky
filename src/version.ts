// ─── App version ───
// BUMP `APP_VERSION` on every fix so builds are distinguishable in the UI (shown in the
// sidebar header). Use the patch number for small fixes; keep `APP_VERSION_NOTE` to a one-line
// summary of the most recent change (shown on hover).
export const APP_VERSION = '1.99.23';
export const APP_VERSION_NOTE = 'Trợ Lý AI — P3 roadmap: CODE INTELLIGENCE. (1) Khối code trong chat giờ có SYNTAX HIGHLIGHT thật (shiki — engine TextMate đúng màu VS Code, lazy-load 1 lần, khối >60k ký tự hoặc lỗi WASM tự fallback về khung trơn — không bao giờ chậm/chặn chat). (2) CHẨN ĐOÁN CÚ PHÁP TỨC THỜI: JS/TS qua acorn (nhận cả ES module import của TavernHelper script), JSON qua parse — banner vàng "⚠ Lỗi cú pháp gần dòng N" ngay trên khối code (bắt được cả 3 đời format lỗi V8, kể cả bản mới chỉ cho snippet). (3) Nút "🔧 AI sửa": gửi ĐÚNG dòng lỗi + 7 dòng ngữ cảnh quanh nó (đánh dấu ►) + toàn bộ code cho trợ lý — sửa trúng đích thay vì đoán mò cả file. +5 test. Verify live: 2 khối shiki 37 token màu, banner + nút hiện đúng khối JS vỡ. | 1.99.22: LoopController + ký ức sống.';
