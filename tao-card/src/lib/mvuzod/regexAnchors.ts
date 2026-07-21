/**
 * ─── MỎ NEO cho regex render ───
 *
 * (User 21/07) Trước đây Status Bar và Opening Form dùng CHUNG một mỏ neo
 * `<StatusPlaceHolderImpl/>` nên hai script regex đè lên nhau — card có cả hai thì chỉ
 * một cái chạy. Tách thành hai hằng số để không bao giờ đụng nhau nữa.
 */

/**
 * Mỏ neo BẢNG TRẠNG THÁI. Đây là thẻ do chính engine MVU chèn vào output của AI mỗi lượt,
 * KHÔNG được đổi tên — đổi là mất chỗ bám, bảng không hiện.
 */
export const STATUS_BAR_ANCHOR = '<StatusPlaceHolderImpl/>';

/**
 * Mỏ neo FORM MỞ ĐẦU. Khác Status Bar ở chỗ: thẻ này do CHÍNH CARD đặt sẵn trong
 * First Message (và các Alternate Greetings), regex chỉ việc thay nó bằng giao diện.
 * Đây là cách các card ngoài thực tế vẫn làm.
 */
export const OPENING_FORM_ANCHOR = '<OpeningFormImpl/>';
