/**
 * (bug 208) Cầu nối một chiều Hub → App để mở Trợ Lý AI.
 *
 * Nút Trợ Lý AI nằm trên rail của Hub (ngay trên nút Cập nhật), còn panel thì sống trong
 * App (Dịch Card). Hằng số đứng ở file riêng vì AppHub đã import App — cho App import ngược
 * lại AppHub là tạo vòng, mà vòng import trong Vite thì lúc chạy mới lộ (một bên nhận
 * undefined), đúng loại lỗi khó dò nhất.
 */
export const OPEN_AI_COMPANION_EVENT = 'hub:open-ai-companion';

/** Phát tín hiệu mở Trợ Lý AI. Bên nhận nằm trong App. */
export function requestOpenAiCompanion(): void {
  window.dispatchEvent(new CustomEvent(OPEN_AI_COMPANION_EVENT));
}
