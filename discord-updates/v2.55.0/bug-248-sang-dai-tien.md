@Sáng Đại Tiên

# UPDATE v2.55.0 : TOKEN TỐI ĐA RIÊNG CHO TỪNG PROVIDER (NHỚ BẤM UPDATE)

Có gì mới / đã fix:

**1) Mỗi provider phụ có ô "Token tối đa mỗi yêu cầu" riêng (bug 248):**
- Trước đây: một con số chung cho tất cả. Trộn Gemini (tối đa 65.536) với GLM-5.3 (tới 128.000) thì đặt kiểu nào cũng dở: hoặc phí GLM, hoặc Gemini báo lỗi.
- Bây giờ: vào **Provider phụ**, mỗi thẻ provider có ô mới **"Token tối đa mỗi yêu cầu"**. Ví dụ đặt Gemini 65536, GLM-5.3 128000.
- Để **0** thì provider đó dùng mức chung như trước. Cấu hình cũ của bạn không bị đổi gì.
- Provider chính vẫn dùng ô **"Số token tối đa mỗi yêu cầu"** chung.
