/**
 * ─── RUNTIME HELPER CHO BẢNG TRẠNG THÁI MVU ───
 *
 * (User 21/07 — việc 78) Đúc kết từ repo MagicalAstrogy/MagVarUpdate + một card MVU thật
 * đang chạy được.
 *
 * ĐIỂM CỐT TỬ khiến "bảng không ăn biến": MVU lưu MỖI biến dưới dạng CẶP
 *     [giá_trị, "mô tả/điều kiện"]
 * chứ không phải giá trị trần. Ví dụ initvar:
 *     { "Cảnh Giới": ["Luyện Khí", "cảnh giới tu luyện hiện tại"] }
 * Nên `stat_data['Cảnh Giới']` trả về CẢ MẢNG. In thẳng ra bảng thì user thấy
 * "Luyện Khí,cảnh giới tu luyện hiện tại" hoặc "[object Object]" — tưởng là bảng hỏng.
 * PHẢI lấy `[0]`.
 *
 * Các helper dưới đây được NHÚNG THẲNG vào HTML của mọi UI sinh ra (chuỗi JS thuần, không
 * import gì) để mọi bảng đều đọc biến đúng cách mà không phụ thuộc việc AI có nhớ hay không.
 */

/** Đoạn JS nhúng vào <script> của UI. Thuần ES5, không phụ thuộc thư viện ngoài. */
export const MVU_RUNTIME_HELPERS = `
// ─── MVU runtime helpers (sinh tự động — đừng sửa tay) ───
// MVU lưu biến dạng [giá trị, "mô tả"] nên luôn phải bóc phần tử đầu.
function mvuLeaf(v){ return Array.isArray(v) ? v[0] : v; }

// Đọc theo đường dẫn "A.B.C" rồi bóc cặp. Không nổ khi thiếu nhánh.
function mvuGet(data, path, dflt){
  if (data == null) return dflt;
  var parts = String(path).split('.'), cur = data;
  for (var i = 0; i < parts.length; i++){
    if (cur == null) return dflt;
    cur = cur[parts[i]];
  }
  var v = mvuLeaf(cur);
  return (v === undefined || v === null) ? dflt : v;
}

// Ép số an toàn — tránh in NaN ra giao diện.
function mvuNum(v, dflt){
  var n = Number(mvuLeaf(v));
  return isFinite(n) ? n : (dflt === undefined ? 0 : dflt);
}

// Ép chuỗi an toàn. Nếu YAML lỡ parse thành object thì nối key: value thay vì [object Object].
function mvuText(v, dflt){
  var x = mvuLeaf(v);
  if (x === undefined || x === null) return dflt === undefined ? '' : dflt;
  if (typeof x === 'string') return x;
  if (typeof x === 'object'){
    var keys = Object.keys(x).filter(function(k){ return k !== '$meta'; });
    if (keys.length) return keys.map(function(k){ return k + (x[k] ? ': ' + x[k] : ''); }).join(' | ');
    return '';
  }
  return String(x);
}

// Lấy stat_data của ĐÚNG tin nhắn đang chứa UI. Dùng "latest" chỉ làm fallback vì mỗi
// bong bóng chat có state MVU riêng; đọc latest cho mọi iframe khiến bảng cũ/preview và form
// mở đầu dễ nhìn như không cập nhật hoặc nhảy sang dữ liệu của lượt khác.
function mvuCurrentMessageId(){
  try {
    var getId = (typeof getCurrentMessageId === 'function') ? getCurrentMessageId
      : (window.getCurrentMessageId && typeof window.getCurrentMessageId === 'function') ? window.getCurrentMessageId
      : (window.parent && typeof window.parent.getCurrentMessageId === 'function') ? window.parent.getCurrentMessageId
      : null;
    var id = getId ? getId() : null;
    return (id === undefined || id === null || id === '') ? 'latest' : id;
  } catch (e) { return 'latest'; }
}

// Ưu tiên display_data nếu card có (bản đã format để hiện).
function mvuData(){
  try {
    var M = (typeof Mvu !== 'undefined' && Mvu) ? Mvu
          : (window.Mvu ? window.Mvu : (window.parent && window.parent.Mvu ? window.parent.Mvu : null));
    if (!M || typeof M.getMvuData !== 'function') return {};
    var all = M.getMvuData({ type: 'message', message_id: mvuCurrentMessageId() }) || {};
    return all.display_data || all.stat_data || {};
  } catch (e) { return {}; }
}
`.trim();

/**
 * Đoạn script khởi động: vẽ lại bảng khi biến đổi.
 * `renderFnName` là tên hàm render của UI (thường là `render`).
 */
export function buildMvuBootScript(renderFnName = 'render'): string {
  return `
// ─── Khởi động: vẽ lần đầu + vẽ lại mỗi khi MVU cập nhật biến ───
(function(){
  function boot(){
    try {
      var M = (typeof Mvu !== 'undefined' && Mvu) ? Mvu : (window.Mvu || (window.parent && window.parent.Mvu));
      // Sự kiện chuẩn của MVU: bắn sau khi xử lý xong toàn bộ cập nhật biến của lượt đó.
      if (M && M.events && typeof eventOn === 'function') {
        try { eventOn(M.events.VARIABLE_UPDATE_ENDED, ${renderFnName}); } catch (e) {}
      }
    } catch (e) {}
    ${renderFnName}();
    // Lưới an toàn: có card/khung nhúng không bắn được sự kiện → vẫn tự làm mới.
    setInterval(${renderFnName}, 1500);
  }
  if (typeof errorCatched === 'function') { $(errorCatched(boot)); }
  else if (typeof $ === 'function') { $(boot); }
  else { boot(); }
})();
`.trim();
}

/**
 * Luật bơm vào prompt AI khi nhờ nó sinh giao diện.
 * Viết bằng tiếng Việt vì toàn bộ prompt của tool đang dùng tiếng Việt.
 */
export const MVU_VAR_ACCESS_RULES = `
=== ĐỌC BIẾN MVU CHO ĐÚNG (BẮT BUỘC — SAI LÀ BẢNG KHÔNG ĂN BIẾN) ===

MVU lưu MỖI biến dưới dạng CẶP: [giá_trị, "mô tả/điều kiện"] — KHÔNG phải giá trị trần.
  initvar:  { "Cảnh Giới": ["Luyện Khí", "cảnh giới tu luyện hiện tại"] }
  ❌ stat_data['Cảnh Giới']      → ["Luyện Khí", "cảnh giới..."]  (in ra cả mô tả → bảng hỏng)
  ✅ stat_data['Cảnh Giới'][0]   → "Luyện Khí"

BẮT BUỘC dùng helper có sẵn (đã được nhúng vào script, KHÔNG cần tự viết lại):
  mvuGet(d, 'Người Chơi.Cảnh Giới', '—')   → giá trị đã bóc cặp, có mặc định khi thiếu
  mvuNum(d['Máu'], 0)                       → số an toàn (không ra NaN)
  mvuText(d['Ghi Chú'], '')                 → chuỗi an toàn (không ra [object Object])
  mvuData()                                 → stat_data của lượt mới nhất
TUYỆT ĐỐI KHÔNG đọc thẳng kiểu d.A.B rồi in ra — sẽ dính nguyên cặp [giá trị, mô tả].

TÊN BIẾN: dùng ĐÚNG tên trong schema/initvar, giữ nguyên khoảng trắng và in hoa
(vd 'Cảnh Giới' — KHÔNG viết 'Cảnh giới', KHÔNG đổi thành 'canh_gioi').

VẼ LẠI KHI BIẾN ĐỔI: script đã tự đăng ký sự kiện VARIABLE_UPDATE_ENDED của MVU và có
setInterval dự phòng — chỉ cần đặt toàn bộ code vẽ trong một hàm tên \`render\`.
`.trim();
