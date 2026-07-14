// ─── App version ───
// BUMP `APP_VERSION` on every fix so builds are distinguishable in the UI (shown in the
// sidebar header). Use the patch number for small fixes; keep `APP_VERSION_NOTE` to a one-line
// summary of the most recent change (shown on hover).
export const APP_VERSION = '1.99.2';
export const APP_VERSION_NOTE = 'Dịch Card: (1) Log lỗi KEY SAI giờ CHỈ RÕ key nào — khi 1 key trong pool bị 401/403, log hiện "Key #N/tổng sai/hết hạn (key: sk-abc…wxyz) → gỡ key này ra" (che giữa, giữ 6 đầu + 4 cuối để đối chiếu) → user biết đúng key hỏng mà gỡ. (2) Surgical EJS (Đợt 1b) mở rộng bắt cả tavern_helper (không chỉ lorebook) — nơi entry rule/note/action EJS-prose bị "dịch nửa vời" hay nằm; gate thật vẫn là "có <%…%> + prose CJK". Live-verify card Mafia: surgical chạy (che 21 khối code/entry), AI KHÔNG làm rơi token → prose Việt hoá, code nguyên vẹn. | 1.99: surgical EJS mask code chỉ dịch prose. | 1.98: đồng nhất từ điển EJS.';
